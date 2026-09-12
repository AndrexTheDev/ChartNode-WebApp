// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/cn';

interface MockChartProps {
  className?: string;
  /** Deterministic seed so the server and client render identical markup. */
  seed?: number;
  bars?: number;
}

/** Mulberry32 – tiny deterministic PRNG. Same seed => same chart everywhere. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candle {
  x: number;
  open: number;
  close: number;
  high: number;
  low: number;
  up: boolean;
  volume: number;
}

function buildCandles(seed: number, count: number): Candle[] {
  const random = prng(seed);
  const candles: Candle[] = [];
  let price = 100;

  for (let i = 0; i < count; i += 1) {
    const drift = (random() - 0.46) * 6;
    const open = price;
    const close = Math.max(18, open + drift);
    const high = Math.max(open, close) + random() * 3;
    const low = Math.min(open, close) - random() * 3;
    candles.push({ x: i, open, close, high, low: Math.max(12, low), up: close >= open, volume: random() });
    price = close;
  }
  return candles;
}

const W = 640;
const H = 300;
const PAD = { top: 16, right: 56, bottom: 44, left: 8 };

/**
 * Decorative candlestick chart for the hero + terminal placeholders.
 * Deterministic (seeded) so SSG markup and hydration markup are identical.
 * Pure inline SVG – no chart library, no network, no hydration mismatch.
 */
export function MockChart({ className, seed = 20260909, bars = 46 }: MockChartProps) {
  const { candles, min, max, last } = useMemo(() => {
    const c = buildCandles(seed, bars);
    const values = c.flatMap((d) => [d.high, d.low]);
    return { candles: c, min: Math.min(...values), max: Math.max(...values), last: c[c.length - 1]! };
  }, [seed, bars]);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / candles.length;
  const bodyW = Math.max(3, step * 0.58);

  const y = (value: number) => PAD.top + innerH - ((value - min) / (max - min || 1)) * innerH;
  const x = (index: number) => PAD.left + index * step + step / 2;

  const gridLines = 5;
  const priceAtLast = last.close;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn('h-full w-full', className)}
      role="img"
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`mc-area-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--nc-primary) / 0.28)" />
          <stop offset="100%" stopColor="hsl(var(--nc-primary) / 0)" />
        </linearGradient>
        <linearGradient id={`mc-line-${seed}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(var(--nc-secondary))" />
          <stop offset="100%" stopColor="hsl(var(--nc-primary))" />
        </linearGradient>
      </defs>

      {/* horizontal grid + price axis */}
      {Array.from({ length: gridLines }, (_, i) => {
        const gy = PAD.top + (innerH / (gridLines - 1)) * i;
        const value = max - ((max - min) / (gridLines - 1)) * i;
        return (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={gy}
              y2={gy}
              stroke="hsl(var(--nc-line) / 0.6)"
              strokeDasharray="2 5"
              strokeWidth="1"
            />
            <text
              x={W - PAD.right + 8}
              y={gy + 3}
              fill="hsl(var(--nc-faint))"
              fontSize="9"
              fontFamily="var(--font-mono), monospace"
            >
              {value.toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* volume histogram */}
      {candles.map((c, i) => (
        <rect
          key={`v-${i}`}
          x={x(i) - bodyW / 2}
          y={H - PAD.bottom + 10 + (1 - c.volume) * 22}
          width={bodyW}
          height={Math.max(1, c.volume * 22)}
          fill={c.up ? 'hsl(var(--nc-bull) / 0.35)' : 'hsl(var(--nc-bear) / 0.35)'}
        />
      ))}

      {/* candles */}
      {candles.map((c, i) => {
        const color = c.up ? 'hsl(var(--nc-bull))' : 'hsl(var(--nc-bear))';
        return (
          <g
            key={i}
            className="origin-bottom animate-candle-grow"
            style={{ animationDelay: `${i * 14}ms` }}
          >
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" />
            <rect
              x={x(i) - bodyW / 2}
              y={y(Math.max(c.open, c.close))}
              width={bodyW}
              height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))}
              fill={color}
              opacity={c.up ? 0.92 : 0.85}
            />
          </g>
        );
      })}

      {/* trend line over the closes */}
      <polyline
        points={candles.map((c, i) => `${x(i)},${y(c.close)}`).join(' ')}
        fill="none"
        stroke={`url(#mc-line-${seed})`}
        strokeWidth="1.25"
        opacity="0.55"
      />

      {/* last-price marker */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={y(priceAtLast)}
        y2={y(priceAtLast)}
        stroke="hsl(var(--nc-primary) / 0.75)"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <g>
        <rect
          x={W - PAD.right + 2}
          y={y(priceAtLast) - 8}
          width={PAD.right - 6}
          height={16}
          fill="hsl(var(--nc-primary))"
        />
        <text
          x={W - PAD.right + 6}
          y={y(priceAtLast) + 4}
          fill="hsl(var(--nc-primary-fg))"
          fontSize="9"
          fontWeight="700"
          fontFamily="var(--font-mono), monospace"
        >
          {priceAtLast.toFixed(1)}
        </text>
      </g>

      {/* pulsing head of the series */}
      <circle cx={x(candles.length - 1)} cy={y(priceAtLast)} r="3" fill="hsl(var(--nc-primary))">
        <animate attributeName="r" values="3;6;3" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.35;1" dur="2.2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
