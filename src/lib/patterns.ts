/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Wave-4 automatic chart-pattern recognition. TradingView ships "Auto Chart
 * Patterns" only on Ultimate ($239.95/mo). This detector runs fully client
 * side over the visible candle buffer and marks classics on the chart:
 * double top/bottom, head & shoulders (±), ascending/descending triangles,
 * bull/bear flags — each with a confidence score.
 */
import type { Candle } from '@/websockets/types';

export type PatternKind =
  | 'doubleTop'
  | 'doubleBottom'
  | 'headShoulders'
  | 'invHeadShoulders'
  | 'triAsc'
  | 'triDesc'
  | 'flagBull'
  | 'flagBear';

export interface Pattern {
  id: string;
  kind: PatternKind;
  /** Unix-ms of the confirmation point (right edge of the pattern). */
  time: number;
  /** Price level the pattern completes at (neckline / breakout). */
  price: number;
  /** 0..1 heuristic confidence. */
  confidence: number;
  /** Expected directional bias once confirmed. */
  bias: 'bull' | 'bear';
}

interface Pivot {
  i: number;
  price: number;
  /** Unix-ms, matching `Candle.t`. */
  t: number;
}

export function pivots(candles: Candle[], lookback = 4): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const candle = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      if (candles[j]!.h >= candle.h) isHigh = false;
      if (candles[j]!.l <= candle.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ i, price: candle.h, t: candle.t });
    if (isLow) lows.push({ i, price: candle.l, t: candle.t });
  }
  return { highs, lows };
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(a, b) * tol;

/** Detect patterns; returns newest-first, capped. */
export function detectPatterns(candles: Candle[], cap = 8): Pattern[] {
  if (candles.length < 40) return [];
  const { highs, lows } = pivots(candles);
  const out: Pattern[] = [];
  const tol = 0.004;

  // Double top / bottom: two co-equal pivots with a neckline pivot between.
  for (let a = 0; a < highs.length - 1; a += 1) {
    for (let b = a + 1; b < highs.length; b += 1) {
      const left = highs[a]!;
      const right = highs[b]!;
      if (right.i - left.i < 6 || right.i - left.i > 80) continue;
      if (!near(left.price, right.price, tol)) continue;
      const between = lows.filter((l) => l.i > left.i && l.i < right.i);
      if (between.length === 0) continue;
      const neck = Math.min(...between.map((l) => l.price));
      const depth = (left.price - neck) / left.price;
      if (depth < 0.004) continue;
      out.push({
        id: `dt-${left.i}-${right.i}`,
        kind: 'doubleTop',
        time: right.t,
        price: neck,
        confidence: Math.min(0.95, 0.5 + depth * 12 + (1 - Math.abs(left.price - right.price) / left.price / tol) * 0.2),
        bias: 'bear',
      });
      break;
    }
  }
  for (let a = 0; a < lows.length - 1; a += 1) {
    for (let b = a + 1; b < lows.length; b += 1) {
      const left = lows[a]!;
      const right = lows[b]!;
      if (right.i - left.i < 6 || right.i - left.i > 80) continue;
      if (!near(left.price, right.price, tol)) continue;
      const between = highs.filter((h) => h.i > left.i && h.i < right.i);
      if (between.length === 0) continue;
      const neck = Math.max(...between.map((h) => h.price));
      const depth = (neck - left.price) / left.price;
      if (depth < 0.004) continue;
      out.push({
        id: `db-${left.i}-${right.i}`,
        kind: 'doubleBottom',
        time: right.t,
        price: neck,
        confidence: Math.min(0.95, 0.5 + depth * 12 + (1 - Math.abs(left.price - right.price) / left.price / tol) * 0.2),
        bias: 'bull',
      });
      break;
    }
  }

  // Head & shoulders (and inverse): three pivots, middle extreme, shoulders near-equal.
  for (let i = 0; i + 2 < highs.length; i += 1) {
    const [l, h, r] = [highs[i]!, highs[i + 1]!, highs[i + 2]!];
    if (h.i - l.i < 4 || r.i - h.i < 4) continue;
    if (!(h.price > l.price && h.price > r.price)) continue;
    if (!near(l.price, r.price, tol * 1.5)) continue;
    const neckPivots = lows.filter((p) => p.i > l.i && p.i < r.i);
    if (neckPivots.length < 2) continue;
    out.push({
      id: `hs-${l.i}-${r.i}`,
      kind: 'headShoulders',
      time: r.t,
      price: Math.min(...neckPivots.map((p) => p.price)),
      confidence: Math.min(0.9, 0.45 + ((h.price - Math.max(l.price, r.price)) / h.price) * 20),
      bias: 'bear',
    });
  }
  for (let i = 0; i + 2 < lows.length; i += 1) {
    const [l, h, r] = [lows[i]!, lows[i + 1]!, lows[i + 2]!];
    if (h.i - l.i < 4 || r.i - h.i < 4) continue;
    if (!(h.price < l.price && h.price < r.price)) continue;
    if (!near(l.price, r.price, tol * 1.5)) continue;
    const neckPivots = highs.filter((p) => p.i > l.i && p.i < r.i);
    if (neckPivots.length < 2) continue;
    out.push({
      id: `ihs-${l.i}-${r.i}`,
      kind: 'invHeadShoulders',
      time: r.t,
      price: Math.max(...neckPivots.map((p) => p.price)),
      confidence: Math.min(0.9, 0.45 + ((Math.min(l.price, r.price) - h.price) / h.price) * 20),
      bias: 'bull',
    });
  }

  // Triangles: flat highs + rising lows (asc) / falling highs + flat lows (desc).
  for (let i = 0; i + 1 < highs.length; i += 1) {
    const h1 = highs[i]!;
    const h2 = highs[i + 1]!;
    if (h2.i - h1.i < 5) continue;
    const lowsBetween = lows.filter((l) => l.i >= h1.i - 4 && l.i <= h2.i + 4);
    if (lowsBetween.length < 2) continue;
    const l1 = lowsBetween[0]!;
    const l2 = lowsBetween[lowsBetween.length - 1]!;
    if (near(h1.price, h2.price, tol) && l2.price > l1.price * 1.002) {
      out.push({
        id: `ta-${h1.i}-${h2.i}`,
        kind: 'triAsc',
        time: h2.t,
        price: h2.price,
        confidence: 0.55 + Math.min(0.3, ((l2.price - l1.price) / l1.price) * 8),
        bias: 'bull',
      });
    }
    if (near(l1.price, l2.price, tol) && h2.price < h1.price * 0.998) {
      out.push({
        id: `td-${h1.i}-${h2.i}`,
        kind: 'triDesc',
        time: h2.t,
        price: l2.price,
        confidence: 0.55 + Math.min(0.3, ((h1.price - h2.price) / h1.price) * 8),
        bias: 'bear',
      });
    }
  }

  // Flags: impulse move (>= 3x ATR-ish in <= 12 bars) then tight consolidation.
  const range = (from: number, to: number) => {
    const slice = candles.slice(from, to + 1);
    return {
      high: Math.max(...slice.map((c) => c.h)),
      low: Math.min(...slice.map((c) => c.l)),
    };
  };
  for (let start = 20; start < candles.length - 6; start += 1) {
    for (const len of [8, 10, 12]) {
      const end = start + len;
      if (end >= candles.length - 5) break;
      const impulse = range(start, end);
      const move = impulse.high - impulse.low;
      const base = impulse.low;
      if (move / (base || 1) < 0.015) continue;
      const up = candles[end]!.c > candles[start]!.c;
      const flagEnd = Math.min(candles.length - 1, end + 10);
      if (flagEnd - end < 4) continue;
      const flag = range(end + 1, flagEnd);
      const flagRange = flag.high - flag.low;
      if (flagRange > move * 0.5 || flagRange <= 0) continue;
      const drift = candles[flagEnd]!.c - candles[end]!.c;
      if (up && drift > 0) continue;
      if (!up && drift < 0) continue;
      out.push({
        id: `fl-${start}-${flagEnd}`,
        kind: up ? 'flagBull' : 'flagBear',
        time: candles[flagEnd]!.t,
        price: up ? flag.high : flag.low,
        confidence: Math.min(0.85, 0.5 + (move / (base || 1)) * 6),
        bias: up ? 'bull' : 'bear',
      });
      start = flagEnd;
      break;
    }
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => b.time - a.time || b.confidence - a.confidence)
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .slice(0, cap);
}
