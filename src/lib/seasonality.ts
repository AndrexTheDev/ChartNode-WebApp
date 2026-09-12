// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Candle } from '@/websockets/types';

/**
 * Clock Edge – circadian seasonality engine (NodeChart original).
 *
 * Crypto never closes, but its participants keep office hours: US open,
 * Asian lunch, weekend thinness. The engine slices the seeded history by
 * UTC hour and weekday, measures the forward return over the next `forward`
 * candles per bucket and – crucially – only calls a bucket an "edge" when the
 * sample is big enough and the t-stat says the mean is not noise.
 *
 * The payoff: a heatmap that tells you *when* your setup historically works,
 * and a live "edge now" read for the running hour.
 */

export interface SeasonBucket {
  key: number;
  n: number;
  winRate: number;
  meanBps: number;
  /** mean / (std / √n); |t| ≥ 2 with n ≥ 30 counts as significant */
  t: number;
  significant: boolean;
}

export interface Seasonality {
  hours: SeasonBucket[];
  weekdays: SeasonBucket[];
  nowHour: SeasonBucket | null;
  nowWeekday: SeasonBucket | null;
  samples: number;
}

function bucketStats(entries: number[]): Omit<SeasonBucket, 'key'> {
  const n = entries.length;
  if (n === 0) return { n: 0, winRate: 0, meanBps: 0, t: 0, significant: false };
  const wins = entries.filter((value) => value > 0).length;
  const mean = entries.reduce((a, b) => a + b, 0) / n;
  const std =
    n > 1 ? Math.sqrt(entries.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 && std > 0 ? mean / (std / Math.sqrt(n)) : 0;
  return {
    n,
    winRate: wins / n,
    meanBps: mean,
    t,
    significant: n >= 30 && Math.abs(t) >= 2,
  };
}

export function seasonality(candles: Candle[], forward = 4): Seasonality | null {
  if (candles.length < 100) return null;
  const hourEntries = new Map<number, number[]>();
  const dayEntries = new Map<number, number[]>();

  for (let i = 0; i + forward < candles.length; i += 1) {
    const candle = candles[i]!;
    const ahead = candles[i + forward]!;
    if (candle.c <= 0) continue;
    const fwdBps = ((ahead.c - candle.c) / candle.c) * 10_000;
    const date = new Date(candle.t);
    const hour = date.getUTCHours();
    const day = date.getUTCDay();
    const hourList = hourEntries.get(hour) ?? [];
    hourList.push(fwdBps);
    hourEntries.set(hour, hourList);
    const dayList = dayEntries.get(day) ?? [];
    dayList.push(fwdBps);
    dayEntries.set(day, dayList);
  }

  const hours: SeasonBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    key: hour,
    ...(hourEntries.get(hour) ? bucketStats(hourEntries.get(hour)!) : { n: 0, winRate: 0, meanBps: 0, t: 0, significant: false }),
  }));
  const weekdays: SeasonBucket[] = Array.from({ length: 7 }, (_, day) => ({
    key: day,
    ...(dayEntries.get(day) ? bucketStats(dayEntries.get(day)!) : { n: 0, winRate: 0, meanBps: 0, t: 0, significant: false }),
  }));

  const now = new Date();
  return {
    hours,
    weekdays,
    nowHour: hours[now.getUTCHours()] ?? null,
    nowWeekday: weekdays[now.getUTCDay()] ?? null,
    samples: candles.length,
  };
}

export const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6];
