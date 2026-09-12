/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Wave-4 multi-timeframe technical ratings. TradingView shows a single
 * "Technicals" gauge; NodeChart scores every timeframe at once (5m → 1w)
 * from live REST seeds — no account, no paywall, no ad break.
 */
import type { Candle } from '@/websockets/types';
import type { ExchangeId } from '@/websockets/types';
import { fetchSeed, restReachableFromBrowser } from '@/websockets/rest';

export type Signal = 'buy' | 'sell' | 'neutral';
export type Summary = 'strongBuy' | 'buy' | 'neutral' | 'sell' | 'strongSell';

export interface RatingRow {
  name: string;
  value: number;
  signal: Signal;
}

export interface RatingScore {
  timeframe: string;
  oscillators: RatingRow[];
  movingAverages: RatingRow[];
  buys: number;
  sells: number;
  neutrals: number;
  summary: Summary;
  /** -2 .. +2 for the gauge needle. */
  score: number;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return NaN;
  const k = 2 / (period + 1);
  let prev = values[0]!;
  for (let i = 1; i < values.length; i += 1) prev = values[i]! * k + prev * (1 - k);
  return prev;
}

function sma(values: number[], period: number): number {
  if (values.length === 0) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function stochK(candles: Candle[], period = 14): number {
  if (candles.length < period) return 50;
  const slice = candles.slice(-period);
  const high = Math.max(...slice.map((c) => c.h));
  const low = Math.min(...slice.map((c) => c.l));
  if (high === low) return 50;
  return ((candles[candles.length - 1]!.c - low) / (high - low)) * 100;
}

function macdDiff(closes: number[]): number {
  if (closes.length < 35) return 0;
  // Approximate MACD histogram sign via EMA distance of the tail windows.
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macd = e12 - e26;
  const series: number[] = [];
  for (let i = Math.max(26, closes.length - 9); i <= closes.length; i += 1) {
    series.push(ema(closes.slice(0, i), 12) - ema(closes.slice(0, i), 26));
  }
  const signal = series.length >= 3 ? ema(series, 9) : macd;
  return macd - signal;
}

function roc(closes: number[], period = 12): number {
  if (closes.length <= period) return 0;
  const prev = closes[closes.length - 1 - period]!;
  return prev === 0 ? 0 : ((closes[closes.length - 1]! - prev) / prev) * 100;
}

function williamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;
  const slice = candles.slice(-period);
  const high = Math.max(...slice.map((c) => c.h));
  const low = Math.min(...slice.map((c) => c.l));
  if (high === low) return -50;
  return ((high - candles[candles.length - 1]!.c) / (high - low)) * -100;
}

function cci(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const tp = slice.map((c) => (c.h + c.l + c.c) / 3);
  const mean = tp.reduce((a, b) => a + b, 0) / tp.length;
  const md = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / tp.length;
  if (md === 0) return 0;
  return (tp[tp.length - 1]! - mean) / (0.015 * md);
}

function summarise(buys: number, sells: number, total: number): { summary: Summary; score: number } {
  if (total === 0) return { summary: 'neutral', score: 0 };
  const ratio = (buys - sells) / total;
  if (ratio >= 0.6) return { summary: 'strongBuy', score: 2 };
  if (ratio >= 0.2) return { summary: 'buy', score: 1 };
  if (ratio <= -0.6) return { summary: 'strongSell', score: -2 };
  if (ratio <= -0.2) return { summary: 'sell', score: -1 };
  return { summary: 'neutral', score: 0 };
}

/** Pure scorer over one candle buffer. */
export function scoreCandles(candles: Candle[], timeframe: string): RatingScore {
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1] ?? NaN;
  const movingAverages: RatingRow[] = [];
  const maDefs: Array<[string, number]> = [
    ['EMA10', 10],
    ['EMA20', 20],
    ['EMA50', 50],
    ['EMA100', 100],
    ['EMA200', 200],
    ['SMA20', 20],
    ['SMA50', 50],
    ['SMA200', 200],
  ];
  for (const [name, period] of maDefs) {
    if (closes.length < period) continue;
    const value = name.startsWith('EMA') ? ema(closes, period) : sma(closes, period);
    movingAverages.push({ name, value, signal: last > value ? 'buy' : last < value ? 'sell' : 'neutral' });
  }
  const r = rsi(closes);
  const k = stochK(candles);
  const wr = williamsR(candles);
  const cc = cci(candles);
  const oscillators: RatingRow[] = [
    { name: 'RSI14', value: r, signal: r < 30 ? 'buy' : r > 70 ? 'sell' : 'neutral' },
    { name: 'STOCH%K', value: k, signal: k < 20 ? 'buy' : k > 80 ? 'sell' : 'neutral' },
    { name: 'MACD', value: macdDiff(closes), signal: macdDiff(closes) > 0 ? 'buy' : macdDiff(closes) < 0 ? 'sell' : 'neutral' },
    { name: 'WILLR', value: wr, signal: wr < -80 ? 'buy' : wr > -20 ? 'sell' : 'neutral' },
    { name: 'CCI20', value: cc, signal: cc < -100 ? 'buy' : cc > 100 ? 'sell' : 'neutral' },
    { name: 'ROC12', value: roc(closes), signal: roc(closes) > 0 ? 'buy' : roc(closes) < 0 ? 'sell' : 'neutral' },
  ];
  const all = [...oscillators, ...movingAverages];
  const buys = all.filter((row) => row.signal === 'buy').length;
  const sells = all.filter((row) => row.signal === 'sell').length;
  const { summary, score } = summarise(buys, sells, all.length);
  return {
    timeframe,
    oscillators,
    movingAverages,
    buys,
    sells,
    neutrals: all.length - buys - sells,
    summary,
    score,
  };
}

export const RATING_TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d', '1w'] as const;

interface CacheEntry {
  at: number;
  rows: RatingScore[];
}
const cache = new Map<string, CacheEntry>();

/** Fetch + score six timeframes in parallel; 60s cache; graceful on failure. */
export async function fetchRatingMatrix(exchange: ExchangeId, symbol: string): Promise<RatingScore[]> {
  const key = `${exchange}:${symbol}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const results = await Promise.all(
    RATING_TIMEFRAMES.map(async (timeframe) => {
      // CORS-blinde Venue im Browser: Primary überspringen → Gate-Fallback unten.
      if (!restReachableFromBrowser(exchange)) return null;
      try {
        const candles = await fetchSeed({ exchange, symbol, timeframe });
        if (!candles || candles.length < 30) return null;
        return scoreCandles(candles.slice(-300), timeframe);
      } catch {
        return null;
      }
    }),
  );
  let rows = results.filter((row): row is RatingScore => row != null);
  if (rows.length === 0 && exchange !== 'gate') {
    // Regional block on the primary venue – Gate is the CORS-safe fallback.
    const fallback = await Promise.all(
      RATING_TIMEFRAMES.map(async (timeframe) => {
        try {
          const candles = await fetchSeed({ exchange: 'gate', symbol, timeframe });
          if (!candles || candles.length < 30) return null;
          return scoreCandles(candles.slice(-300), timeframe);
        } catch {
          return null;
        }
      }),
    );
    rows = fallback.filter((row): row is RatingScore => row != null);
  }
  if (rows.length > 0) cache.set(key, { at: Date.now(), rows });
  return rows;
}
