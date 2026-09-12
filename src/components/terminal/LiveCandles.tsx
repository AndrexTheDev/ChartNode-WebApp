// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import type { Candle } from '@/websockets/types';

interface LiveCandlesProps {
  candles: Candle[];
  className?: string;
  /** How many of the newest candles to draw. */
  window?: number;
}

const W = 640;
const H = 300;
const PAD = { top: 14, right: 58, bottom: 12, left: 6 };

/**
 * Minimal canvas-free candle renderer for live store data.
 * Deliberately tiny: Part 3 swaps this for a real canvas engine with pan/zoom
 * and indicators. Until then it proves the WebSocket pipeline end-to-end.
 */
export function LiveCandles({ candles, className, window: size = 90 }: LiveCandlesProps) {
  const view = useMemo(() => candles.slice(-size), [candles, size]);

  if (view.length < 2) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center', className)}>
        <span className="font-mono text-2xs uppercase tracking-cyber text-faint">···</span>
      </div>
    );
  }

  const values = view.flatMap((c) => [c.h, c.l]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / view.length;
  const bodyW = Math.max(2, step * 0.62);

  const y = (value: number) => PAD.top + innerH - ((value - min) / span) * innerH;
  const x = (index: number) => PAD.left + index * step + step / 2;

  const last = view[view.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-full w-full', className)} preserveAspectRatio="none" aria-hidden>
      {/* grid */}
      {Array.from({ length: 4 }, (_, i) => {
        const gy = PAD.top + (innerH / 3) * i;
        const value = max - (span / 3) * i;
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} stroke="hsl(var(--nc-line) / 0.5)" strokeDasharray="2 5" />
            <text x={W - PAD.right + 6} y={gy + 3} fill="hsl(var(--nc-faint))" fontSize="9" fontFamily="var(--font-mono), monospace">
              {value.toFixed(value < 1 ? 6 : 2)}
            </text>
          </g>
        );
      })}

      {/* candles */}
      {view.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? 'hsl(var(--nc-bull))' : 'hsl(var(--nc-bear))';
        return (
          <g key={c.t}>
            <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="1" />
            <rect
              x={x(i) - bodyW / 2}
              y={y(Math.max(c.o, c.c))}
              width={bodyW}
              height={Math.max(1.25, Math.abs(y(c.o) - y(c.c)))}
              fill={color}
              opacity={up ? 0.95 : 0.85}
            />
          </g>
        );
      })}

      {/* last price line */}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(last.c)} y2={y(last.c)} stroke="hsl(var(--nc-primary) / 0.7)" strokeDasharray="4 4" />
      <rect x={W - PAD.right + 2} y={y(last.c) - 8} width={PAD.right - 6} height={16} fill="hsl(var(--nc-primary))" />
      <text
        x={W - PAD.right + 6}
        y={y(last.c) + 4}
        fill="hsl(var(--nc-primary-fg))"
        fontSize="9"
        fontWeight="700"
        fontFamily="var(--font-mono), monospace"
      >
        {last.c.toFixed(last.c < 1 ? 6 : 2)}
      </text>
    </svg>
  );
}
