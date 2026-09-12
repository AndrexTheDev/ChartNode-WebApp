// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Candle } from '@/websockets/types';

/**
 * Strategy backtester – the feature TradingView locks behind Premium/Ultimate
 * (and Pine Script), here as zero-config maths on the candle buffer.
 *
 * Every strategy is long-only and signals on the candle close; fills happen at
 * that same close (documented, conservative). Fees are charged per side in
 * basis points. The equity curve is mark-to-market per candle so the drawdown
 * numbers are honest, not just trade-end snapshots.
 */

export type StrategyId = 'emaCross' | 'rsiReversion' | 'bbReversion' | 'supertrend' | 'macdCross' | 'donchian';

export interface StrategyParam {
  key: string;
  min: number;
  max: number;
  def: number;
}

export interface StrategyDef {
  id: StrategyId;
  params: StrategyParam[];
}

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'emaCross',
    params: [
      { key: 'fast', min: 2, max: 100, def: 9 },
      { key: 'slow', min: 5, max: 300, def: 21 },
    ],
  },
  {
    id: 'rsiReversion',
    params: [
      { key: 'period', min: 2, max: 50, def: 14 },
      { key: 'entry', min: 5, max: 45, def: 30 },
      { key: 'exit', min: 40, max: 90, def: 55 },
    ],
  },
  {
    id: 'bbReversion',
    params: [
      { key: 'period', min: 5, max: 100, def: 20 },
      { key: 'stdDev', min: 0.5, max: 4, def: 2 },
    ],
  },
  {
    id: 'supertrend',
    params: [
      { key: 'period', min: 3, max: 50, def: 10 },
      { key: 'multiplier', min: 0.5, max: 8, def: 3 },
    ],
  },
  {
    id: 'macdCross',
    params: [
      { key: 'fast', min: 2, max: 60, def: 12 },
      { key: 'slow', min: 5, max: 120, def: 26 },
      { key: 'signal', min: 2, max: 60, def: 9 },
    ],
  },
  {
    id: 'donchian',
    params: [
      { key: 'entry', min: 5, max: 200, def: 20 },
      { key: 'exit', min: 3, max: 100, def: 10 },
    ],
  },
];

export interface BtTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** Net return of the round trip, percent (fees included). */
  pnlPct: number;
  bars: number;
}

export interface BtStats {
  trades: number;
  winRatePct: number;
  profitFactor: number | null;
  /** Compounded net return, percent. */
  totalPct: number;
  buyHoldPct: number;
  maxDrawdownPct: number;
  avgTradePct: number;
  bestTradePct: number;
  worstTradePct: number;
  /** Share of candles spent in the market, percent. */
  exposurePct: number;
  sharpe: number | null;
}

export interface BacktestResult {
  trades: BtTrade[];
  /** Mark-to-market equity, 1 = start capital, per candle. */
  equity: { t: number; eq: number }[];
  stats: BtStats;
}

/* ------------------------------ math helpers ------------------------------- */

function ema(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Desired position (0 or 1) per candle – the whole strategy in one array. */
function positionSignal(candles: Candle[], id: StrategyId, params: Record<string, number>): (0 | 1)[] {
  const closes = candles.map((candle) => candle.c);
  const n = candles.length;
  const signal: (0 | 1)[] = new Array(n).fill(0);
  const get = (key: string, fallback: number) => params[key] ?? fallback;

  if (id === 'emaCross') {
    const fast = ema(closes, Math.round(get('fast', 9)));
    const slow = ema(closes, Math.round(get('slow', 21)));
    for (let i = 0; i < n; i += 1) {
      const f = fast[i];
      const s = slow[i];
      signal[i] = f != null && s != null && f > s ? 1 : 0;
    }
    return signal;
  }

  if (id === 'rsiReversion') {
    const period = Math.round(get('period', 14));
    const entry = get('entry', 30);
    const exit = get('exit', 55);
    const r = rsi(closes, period);
    let inPosition = false;
    for (let i = 0; i < n; i += 1) {
      const value = r[i];
      if (value == null) continue;
      if (!inPosition && value < entry) inPosition = true;
      else if (inPosition && value > exit) inPosition = false;
      signal[i] = inPosition ? 1 : 0;
    }
    return signal;
  }

  if (id === 'bbReversion') {
    const period = Math.round(get('period', 20));
    const mult = get('stdDev', 2);
    let inPosition = false;
    for (let i = period - 1; i < n; i += 1) {
      const window = closes.slice(i - period + 1, i + 1);
      const mean = window.reduce((sum, value) => sum + value, 0) / period;
      const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
      const sd = Math.sqrt(variance);
      const lower = mean - mult * sd;
      if (!inPosition && closes[i]! < lower) inPosition = true;
      else if (inPosition && closes[i]! > mean) inPosition = false;
      signal[i] = inPosition ? 1 : 0;
    }
    return signal;
  }

  if (id === 'supertrend') {
    const period = Math.round(get('period', 10));
    const mult = get('multiplier', 3);
    let trendUp = true;
    let upperBand = Infinity;
    let lowerBand = -Infinity;
    for (let i = period - 1; i < n; i += 1) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = Math.max(0, i - period + 1); j <= i; j += 1) {
        hh = Math.max(hh, candles[j]!.h);
        ll = Math.min(ll, candles[j]!.l);
      }
      const mid = (hh + ll) / 2;
      // ATR via true-range mean
      let trSum = 0;
      for (let j = Math.max(1, i - period + 1); j <= i; j += 1) {
        trSum += Math.max(
          candles[j]!.h - candles[j]!.l,
          Math.abs(candles[j]!.h - candles[j - 1]!.c),
          Math.abs(candles[j]!.l - candles[j - 1]!.c),
        );
      }
      const atr = trSum / period;
      const basicUpper = mid + mult * atr;
      const basicLower = mid - mult * atr;
      upperBand = basicUpper < upperBand || closes[i - 1]! > upperBand ? basicUpper : upperBand;
      lowerBand = basicLower > lowerBand || closes[i - 1]! < lowerBand ? basicLower : lowerBand;
      if (trendUp && closes[i]! < lowerBand) trendUp = false;
      else if (!trendUp && closes[i]! > upperBand) trendUp = true;
      signal[i] = trendUp ? 1 : 0;
    }
    return signal;
  }

  if (id === 'macdCross') {
    const fast = ema(closes, Math.round(get('fast', 12)));
    const slow = ema(closes, Math.round(get('slow', 26)));
    const macd: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const f = fast[i];
      const s = slow[i];
      macd.push(f != null && s != null ? f - s : NaN);
    }
    const defined = macd.filter((value) => Number.isFinite(value));
    const signalLine = ema(defined, Math.round(get('signal', 9)));
    const offset = defined.length - signalLine.length;
    let cursor = 0;
    let prevDiff: number | null = null;
    let inPosition = false;
    for (let i = 0; i < n; i += 1) {
      const m = macd[i] ?? NaN;
      if (!Number.isFinite(m)) continue;
      const sigIndex = cursor - offset;
      const sig = sigIndex >= 0 ? signalLine[sigIndex] : undefined;
      cursor += 1;
      if (sig == null) continue;
      const diff = m - sig;
      if (prevDiff != null) {
        if (!inPosition && prevDiff <= 0 && diff > 0) inPosition = true;
        else if (inPosition && prevDiff >= 0 && diff < 0) inPosition = false;
      }
      prevDiff = diff;
      signal[i] = inPosition ? 1 : 0;
    }
    return signal;
  }

  // donchian breakout
  const entryN = Math.round(get('entry', 20));
  const exitN = Math.round(get('exit', 10));
  let inPosition = false;
  for (let i = entryN; i < n; i += 1) {
    const priorHigh = candles.slice(i - entryN, i).reduce((max, candle) => Math.max(max, candle.h), -Infinity);
    const priorLow = candles.slice(i - exitN, i).reduce((min, candle) => Math.min(min, candle.l), Infinity);
    if (!inPosition && closes[i]! > priorHigh) inPosition = true;
    else if (inPosition && closes[i]! < priorLow) inPosition = false;
    signal[i] = inPosition ? 1 : 0;
  }
  return signal;
}

/* --------------------------------- engine ---------------------------------- */

export function runBacktest(
  candles: Candle[],
  strategy: StrategyId,
  params: Record<string, number>,
  feeBps = 10,
): BacktestResult | null {
  if (candles.length < 40) return null;
  const signal = positionSignal(candles, strategy, params);
  const fee = feeBps / 10_000;

  const trades: BtTrade[] = [];
  const equity: { t: number; eq: number }[] = [];
  let cash = 1;
  let entryPrice = 0;
  let entryTime = 0;
  let entryIndex = 0;
  let inPosition = false;
  let inMarketCandles = 0;
  let peak = 1;
  let maxDrawdown = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i]!;
    const want = signal[i] ?? 0;

    if (!inPosition && want === 1) {
      inPosition = true;
      entryPrice = candle.c;
      entryTime = candle.t;
      entryIndex = i;
      cash *= 1 - fee;
    } else if (inPosition && want === 0) {
      const gross = candle.c / entryPrice;
      cash *= gross * (1 - fee);
      trades.push({
        entryTime,
        exitTime: candle.t,
        entryPrice,
        exitPrice: candle.c,
        pnlPct: (gross * (1 - fee) * (1 - fee) - 1) * 100,
        bars: i - entryIndex,
      });
      inPosition = false;
    }

    if (inPosition) inMarketCandles += 1;
    const mark = inPosition ? cash * (candle.c / entryPrice) : cash;
    equity.push({ t: candle.t, eq: mark });
    peak = Math.max(peak, mark);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (1 - mark / peak) * 100 : 0);
  }

  if (inPosition) {
    const last = candles[candles.length - 1]!;
    const gross = last.c / entryPrice;
    cash *= gross * (1 - fee);
    trades.push({
      entryTime,
      exitTime: last.t,
      entryPrice,
      exitPrice: last.c,
      pnlPct: (gross * (1 - fee) * (1 - fee) - 1) * 100,
      bars: candles.length - 1 - entryIndex,
    });
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0);
  const losses = trades.filter((trade) => trade.pnlPct <= 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlPct, 0));
  const returns = trades.map((trade) => trade.pnlPct);
  const mean = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance =
    returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0;
  const first = candles[0]!.c;
  const lastClose = candles[candles.length - 1]!.c;

  const stats: BtStats = {
    trades: trades.length,
    winRatePct: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    totalPct: (cash - 1) * 100,
    buyHoldPct: first > 0 ? (lastClose / first - 1) * 100 : 0,
    maxDrawdownPct: maxDrawdown,
    avgTradePct: mean,
    bestTradePct: returns.length > 0 ? Math.max(...returns) : 0,
    worstTradePct: returns.length > 0 ? Math.min(...returns) : 0,
    exposurePct: (inMarketCandles / candles.length) * 100,
    sharpe: variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(Math.max(1, trades.length)) : null,
  };

  return { trades, equity, stats };
}

/** Entry/exit markers for the chart (time in unix ms). */
export function tradeMarkers(result: BacktestResult): { time: number; side: 'buy' | 'sell' }[] {
  const out: { time: number; side: 'buy' | 'sell' }[] = [];
  for (const trade of result.trades) {
    out.push({ time: trade.entryTime, side: 'buy' });
    out.push({ time: trade.exitTime, side: 'sell' });
  }
  return out.sort((a, b) => a.time - b.time);
}
