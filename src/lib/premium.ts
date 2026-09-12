// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Candle } from '@/websockets/types';

/**
 * Premium chart analytics computed locally from the candle buffer –
 * the features paid charting suites put behind a subscription:
 *
 *   • **Volume Profile (visible range)** – volume distributed over price bins,
 *     plus Point of Control and the 70 % Value Area (VAH/VAL).
 *   • **Anchored VWAP** – session VWAP starting at a user-chosen anchor candle.
 *
 * Pure maths, no network, no dependencies.
 */

export interface VolumeBin {
  p0: number;
  p1: number;
  vol: number;
}

export interface VolumeProfileResult {
  bins: VolumeBin[];
  /** Price of the highest-volume bin. */
  poc: number;
  /** Value-area high / low (70 % of volume around the POC). */
  vah: number;
  val: number;
  maxVol: number;
}

export function volumeProfile(candles: Candle[], binCount = 48): VolumeProfileResult | null {
  if (candles.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const candle of candles) {
    low = Math.min(low, candle.l);
    high = Math.max(high, candle.h);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;

  const step = (high - low) / binCount;
  const bins: VolumeBin[] = Array.from({ length: binCount }, (_, i) => ({
    p0: low + i * step,
    p1: low + (i + 1) * step,
    vol: 0,
  }));

  for (const candle of candles) {
    // distribute the candle volume across the bins its range covers
    const from = Math.max(0, Math.floor((candle.l - low) / step));
    const to = Math.min(binCount - 1, Math.floor((candle.h - low) / step));
    const span = to - from + 1;
    const per = (candle.v ?? 0) / span;
    for (let i = from; i <= to; i += 1) bins[i]!.vol += per;
  }

  const maxVol = bins.reduce((max, bin) => Math.max(max, bin.vol), 0);
  if (maxVol <= 0) return null;
  const pocBin = bins.reduce((best, bin) => (bin.vol > best.vol ? bin : best), bins[0]!);

  // 70 % value area: grow from the POC towards the richer neighbour bin
  const total = bins.reduce((sum, bin) => sum + bin.vol, 0);
  let included = pocBin.vol;
  let lo = bins.indexOf(pocBin);
  let hi = lo;
  while (included < total * 0.7 && (lo > 0 || hi < bins.length - 1)) {
    const below = lo > 0 ? bins[lo - 1]!.vol : -1;
    const above = hi < bins.length - 1 ? bins[hi + 1]!.vol : -1;
    if (above >= below) {
      hi += 1;
      included += bins[hi]!.vol;
    } else {
      lo -= 1;
      included += bins[lo]!.vol;
    }
  }

  return {
    bins,
    poc: (pocBin.p0 + pocBin.p1) / 2,
    vah: bins[hi]!.p1,
    val: bins[lo]!.p0,
    maxVol,
  };
}

export interface VwapPoint {
  time: number;
  value: number;
}

/**
 * Anchored VWAP: cumulative Σ(typical·volume) / Σ(volume) starting at the
 * anchor candle. Returns [] when the anchor is outside the buffer.
 */
export function anchoredVwap(candles: Candle[], anchorTime: number): VwapPoint[] {
  const start = candles.findIndex((candle) => candle.t >= anchorTime);
  if (start < 0) return [];
  let cumPV = 0;
  let cumV = 0;
  const out: VwapPoint[] = [];
  for (let i = start; i < candles.length; i += 1) {
    const candle = candles[i]!;
    const typical = (candle.h + candle.l + candle.c) / 3;
    const vol = candle.v ?? 0;
    cumPV += typical * vol;
    cumV += vol;
    if (cumV > 0) out.push({ time: candle.t, value: cumPV / cumV });
  }
  return out;
}

/* ------------------------- auto support / resistance ------------------------ */

export interface SrLevel {
  price: number;
  /** How many pivots clustered into this level. */
  touches: number;
  kind: 'support' | 'resistance';
}

/**
 * Fractal pivots (window w) clustered by proximity (0.35 % of price) into
 * levels; the strongest `maxLevels` come back sorted by price. The kind is
 * decided against the last close and the pivot balance of the cluster.
 */
export function supportResistance(candles: Candle[], window = 3, maxLevels = 4): SrLevel[] {
  if (candles.length < window * 2 + 1) return [];
  const pivots: { price: number; kind: 'support' | 'resistance' }[] = [];
  for (let i = window; i < candles.length - window; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      if (candles[j]!.h >= candles[i]!.h) isHigh = false;
      if (candles[j]!.l <= candles[i]!.l) isLow = false;
    }
    if (isHigh) pivots.push({ price: candles[i]!.h, kind: 'resistance' });
    if (isLow) pivots.push({ price: candles[i]!.l, kind: 'support' });
  }
  if (pivots.length === 0) return [];

  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: { prices: number[]; supports: number; resistances: number }[] = [];
  for (const pivot of sorted) {
    const last = clusters.length > 0 ? clusters[clusters.length - 1]! : null;
    // Anchor on the cluster MEAN (not the last pivot) so dense ranges cannot
    // chain-link dozens of pivots into one degenerate level.
    const anchor = last ? last.prices.reduce((sum, value) => sum + value, 0) / last.prices.length : null;
    if (last && anchor != null && pivot.price - anchor <= pivot.price * 0.0035) {
      last.prices.push(pivot.price);
      if (pivot.kind === 'support') last.supports += 1;
      else last.resistances += 1;
    } else {
      clusters.push({
        prices: [pivot.price],
        supports: pivot.kind === 'support' ? 1 : 0,
        resistances: pivot.kind === 'resistance' ? 1 : 0,
      });
    }
  }

  const lastClose = candles[candles.length - 1]!.c;
  return clusters
    .map((cluster) => {
      const price = cluster.prices.reduce((sum, value) => sum + value, 0) / cluster.prices.length;
      let kind: 'support' | 'resistance';
      if (lastClose < price) kind = cluster.resistances >= cluster.supports ? 'resistance' : 'support';
      else kind = cluster.supports >= cluster.resistances ? 'support' : 'resistance';
      return { price, touches: cluster.prices.length, kind };
    })
    .sort((a, b) => b.touches - a.touches)
    .slice(0, maxLevels)
    .sort((a, b) => a.price - b.price);
}

/* ----------------------------- divergence scanner --------------------------- */

export interface Divergence {
  /** Candle index of the second (confirming) pivot. */
  index: number;
  type: 'bullish' | 'bearish';
  price: number;
}

/**
 * Classic RSI divergences on pivot lows/highs: price prints a lower low while
 * RSI prints a higher low (bullish) – and the mirror image (bearish). The two
 * pivots must be 5..60 candles apart to count.
 */
export function divergences(candles: Candle[], rsi: (number | undefined)[], window = 2): Divergence[] {
  const out: Divergence[] = [];
  if (candles.length < 20) return out;
  const pivotLows: number[] = [];
  const pivotHighs: number[] = [];
  for (let i = window; i < candles.length - window; i += 1) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      if (candles[j]!.l <= candles[i]!.l) isLow = false;
      if (candles[j]!.h >= candles[i]!.h) isHigh = false;
    }
    if (isLow) pivotLows.push(i);
    if (isHigh) pivotHighs.push(i);
  }

  const pairUp = (indices: number[], bullish: boolean) => {
    for (let k = 1; k < indices.length; k += 1) {
      const a = indices[k - 1]!;
      const b = indices[k]!;
      const gap = b - a;
      if (gap < 5 || gap > 60) continue;
      const rsiA = rsi[a];
      const rsiB = rsi[b];
      if (rsiA == null || rsiB == null) continue;
      if (bullish) {
        if (candles[b]!.l < candles[a]!.l && rsiB > rsiA + 1) {
          out.push({ index: b, type: 'bullish', price: candles[b]!.l });
        }
      } else if (candles[b]!.h > candles[a]!.h && rsiB < rsiA - 1) {
        out.push({ index: b, type: 'bearish', price: candles[b]!.h });
      }
    }
  };
  pairUp(pivotLows, true);
  pairUp(pivotHighs, false);
  return out.sort((a, b) => a.index - b.index).slice(-12);
}

/* -------------------------- risk & session numbers -------------------------- */

/**
 * Annualized realized volatility from log returns. The annualization factor is
 * derived from the median candle spacing, so 1m and 1d buffers both work.
 */
export function realizedVolPct(candles: Candle[], lookback = 100): number | null {
  if (candles.length < lookback / 2 + 2) return null;
  const slice = candles.slice(-lookback);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i += 1) {
    const prev = slice[i - 1]!.c;
    const cur = slice[i]!.c;
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < 10) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const dtMs = slice[slice.length - 1]!.t - slice[0]!.t;
  const periods = slice.length - 1;
  if (dtMs <= 0 || periods <= 0) return null;
  const candleYears = dtMs / periods / (365 * 24 * 3600 * 1000);
  if (candleYears <= 0) return null;
  return Math.sqrt(variance / candleYears) * 100;
}

export interface SessionStats {
  open: number;
  high: number;
  low: number;
  last: number;
  /** 0..1 – where the last price sits inside today's range. */
  rangePosition: number;
  changePct: number;
  candles: number;
}

/** Today's (UTC) OHLC plus range position, computed from the candle buffer. */
export function sessionStats(candles: Candle[]): SessionStats | null {
  if (candles.length === 0) return null;
  const lastTime = candles[candles.length - 1]!.t;
  const dayStart = Math.floor(lastTime / 86_400_000) * 86_400_000;
  const today = candles.filter((candle) => candle.t >= dayStart);
  if (today.length === 0) return null;
  const open = today[0]!.o;
  const high = today.reduce((max, candle) => Math.max(max, candle.h), -Infinity);
  const low = today.reduce((min, candle) => Math.min(min, candle.l), Infinity);
  const last = today[today.length - 1]!.c;
  const span = high - low;
  return {
    open,
    high,
    low,
    last,
    rangePosition: span > 0 ? (last - low) / span : 0.5,
    changePct: open > 0 ? ((last - open) / open) * 100 : 0,
    candles: today.length,
  };
}
