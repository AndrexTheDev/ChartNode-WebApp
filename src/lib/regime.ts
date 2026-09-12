// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { ADX, EMA } from 'technicalindicators';
import type { Candle } from '@/websockets/types';

/**
 * Regime Compass – market-state interpreter (NodeChart original).
 *
 * Indicators answer "what is the value?"; traders need "what kind of market
 * is this, and which of my tools make sense in it?". The Compass fuses trend
 * strength (ADX), realised volatility against its own median, EMA structure,
 * and – when the PRO panel is open – funding, breadth and liquidation flow
 * into one of five regimes, with a confidence score, the driver values and a
 * rolling history so you can *see* the market change character.
 */

export type RegimeId = 'trend-strong' | 'trend-weak' | 'range' | 'vol-expand' | 'liq-storm';

export interface RegimeDriver {
  key: 'adx' | 'rv' | 'slope' | 'funding' | 'breadth' | 'liq';
  value: number;
}

export interface RegimeRead {
  id: RegimeId;
  /** 0.5..0.95 – how clearly the drivers point one way */
  confidence: number;
  drivers: RegimeDriver[];
}

export interface RegimeInput {
  candles: Candle[];
  /** percent per funding interval */
  fundingRate?: number | null;
  /** 0..100 advancer share */
  advPct?: number | null;
  liq5mUsd?: number | null;
  liqMedianUsd?: number | null;
}

function atrPctSeries(candles: Candle[], period = 14): number[] {
  const out: number[] = [];
  for (let i = period; i < candles.length; i += 1) {
    const slice = candles.slice(i - period, i + 1);
    let trSum = 0;
    for (let k = 1; k < slice.length; k += 1) {
      const prev = slice[k - 1]!;
      const cur = slice[k]!;
      trSum += Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    }
    const close = slice[slice.length - 1]!.c;
    if (close > 0) out.push((trSum / period / close) * 100);
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function classifyRegime(input: RegimeInput): RegimeRead | null {
  const { candles } = input;
  if (candles.length < 80) return null;
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const closes = candles.map((c) => c.c);

  const adxOut = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const adx = adxOut[adxOut.length - 1]?.adx ?? 0;
  const ema21 = EMA.calculate({ period: 21, values: closes });
  const ema55 = EMA.calculate({ period: 55, values: closes });
  const e21 = ema21[ema21.length - 1];
  const e55 = ema55[ema55.length - 1];
  const slope = e21 != null && e55 != null && e55 > 0 ? ((e21 - e55) / e55) * 100 : 0;

  const rvSeries = atrPctSeries(candles);
  const rv = rvSeries[rvSeries.length - 1] ?? 0;
  const rvMedian = median(rvSeries.slice(0, -1));
  const rvRatio = rvMedian > 0 ? rv / rvMedian : 1;

  const drivers: RegimeDriver[] = [
    { key: 'adx', value: adx },
    { key: 'rv', value: rvRatio },
    { key: 'slope', value: slope },
  ];
  if (input.fundingRate != null) drivers.push({ key: 'funding', value: input.fundingRate });
  if (input.advPct != null) drivers.push({ key: 'breadth', value: input.advPct });
  const liqRatio =
    input.liq5mUsd != null && input.liqMedianUsd != null && input.liqMedianUsd > 0
      ? input.liq5mUsd / input.liqMedianUsd
      : null;
  if (liqRatio != null) drivers.push({ key: 'liq', value: liqRatio });

  const fundingExtreme = input.fundingRate != null && Math.abs(input.fundingRate) >= 0.05;
  let id: RegimeId;
  if ((liqRatio != null && liqRatio >= 3) || (fundingExtreme && rvRatio >= 1.6)) {
    id = 'liq-storm';
  } else if (rvRatio >= 1.6 && adx < 25) {
    id = 'vol-expand';
  } else if (adx >= 25 && Math.abs(slope) >= 0.75) {
    id = 'trend-strong';
  } else if (adx >= 25) {
    id = 'trend-weak';
  } else {
    id = 'range';
  }

  // confidence: distance of the decisive drivers from their class boundaries
  const adxScore = Math.min(1, Math.abs(adx - 18) / 17);
  const rvScore = Math.min(1, Math.abs(rvRatio - 1.3) / 1.2);
  const slopeScore = Math.min(1, Math.abs(slope) / 1.5);
  const confidence = Math.max(0.5, Math.min(0.95, 0.5 + 0.45 * (0.45 * adxScore + 0.3 * rvScore + 0.25 * slopeScore)));

  return { id, confidence, drivers };
}

/** Rolling regime history (one read per `step` bars over the last `span`). */
export function regimeHistory(candles: Candle[], step = 60, span = 480): RegimeId[] {
  const slice = candles.slice(-span);
  const out: RegimeId[] = [];
  for (let end = 120; end <= slice.length; end += step) {
    const read = classifyRegime({ candles: slice.slice(0, end) });
    if (read) out.push(read.id);
  }
  return out;
}

export const REGIME_IDS: RegimeId[] = ['trend-strong', 'trend-weak', 'range', 'vol-expand', 'liq-storm'];
