/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Indicator engine.
 *
 * All maths comes from `technicalindicators` (Wilder / standard formulas) – we
 * only add three things on top:
 *
 *   1. **Alignment.** Every library returns an array *shorter* than the input
 *      (the warm-up period is dropped, values stay aligned to the END of the
 *      series). `align()` re-pads the front so index `i` always belongs to
 *      candle `i`, which is what a chart needs.
 *   2. **NaN hygiene.** Missing/NaN values become `undefined` so the chart
 *      draws a gap instead of a line through zero.
 *   3. **A declarative library.** Each indicator describes its parameters
 *      (for the settings modal), its outputs (series to draw) and where it
 *      lives (`overlay` on price, or its own `pane` below).
 *
 * Number of indicator *instances* per chart is unlimited – the store keeps an
 * array, and each instance renders as its own series.
 */

import {
  ADX as AdxCalc,
  ATR,
  BollingerBands,
  CCI as CciCalc,
  EMA,
  MACD,
  MFI as MfiCalc,
  OBV as ObvCalc,
  PSAR as PsarCalc,
  RSI,
  SMA,
  Stochastic,
  StochasticRSI,
  TRIX as TrixCalc,
  VWAP as VwapCalc,
  WilliamsR as WilliamsRCalc,
  IchimokuCloud as IchimokuCalc,
} from 'technicalindicators';
import type { Candle } from '@/websockets/types';
import { runScript } from '@/lib/scripts';

export type IndicatorKind =
  | 'EMA' | 'SMA' | 'BB' | 'RSI' | 'MACD' | 'ATR' | 'STOCH'
  // premium tier – normally paywalled elsewhere
  | 'SUPERTREND' | 'KELTNER' | 'DONCHIAN' | 'STOCHRSI' | 'OBV' | 'MFI' | 'CCI'
  | 'ADX' | 'PSAR' | 'TRIX' | 'PPO' | 'DPO' | 'BBPCT' | 'AROON'
  // wave 2 – pro analytics tier
  | 'ICHIMOKU' | 'VWAP' | 'WILLR' | 'HMA' | 'TEMA' | 'DEMA' | 'GUPPY'
  | 'SQUEEZE' | 'TDSEQ' | 'CMF' | 'EMV' | 'UO'
  // wave 5 – your own code
  | 'CUSTOM';

/** Where the output series are rendered. */
export type Placement = 'overlay' | 'pane';

export type OutputStyle = 'line' | 'histogram' | 'band';

/** Parameter keys double as i18n keys (`chart.params.<key>`). */
export type ParamKey =
  | 'period' | 'fast' | 'slow' | 'signal' | 'stdDev' | 'smoothing' | 'multiplier' | 'step' | 'max'
  | 'overlay';

export interface ParamSpec {
  key: ParamKey;
  /** i18n key suffix: `chart.params.<key>`. */
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface OutputSpec {
  key: string;
  style: OutputStyle;
  /** CSS color – cyberpunk palette, see `styles/globals.css` tokens. */
  color: string;
  /** Line width in px (line/band only). */
  width?: number;
  /** Dashed rendering. */
  dashed?: boolean;
}

export type IndicatorValues = Record<string, (number | undefined)[]>;

export interface IndicatorDef {
  kind: IndicatorKind;
  placement: Placement;
  params: ParamSpec[];
  outputs: OutputSpec[];
  /** Fixed scale for oscillators, so 0–100 stays readable. */
  scale?: { min: number; max: number };
  /** Horizontal reference lines inside a pane (RSI 30/70, Stoch 20/80). */
  levels?: number[];
  /** Requested pane height in px. */
  paneHeight?: number;
  compute: (candles: Candle[], params: Record<string, number>, script?: string) => IndicatorValues;
}

/* ---------------------------------- palette -------------------------------- */

/** Neon series colors, cycled so N instances of the same type stay distinct. */
export const SERIES_COLORS = [
  '#00f0ff', // cyan
  '#ff2fb9', // magenta
  '#c6ff00', // acid
  '#ffb020', // amber
  '#7c5cff', // violet
  '#22e07a', // green
  '#ff5c5c', // red
  '#4dd2ff', // sky
] as const;

export function colorFor(kind: IndicatorKind, index: number, outputIndex = 0): string {
  const base = SERIES_COLORS.indexOf(
    INDICATOR_LIBRARY[kind].outputs[outputIndex]?.color as (typeof SERIES_COLORS)[number],
  );
  const start = base >= 0 ? base : 0;
  return SERIES_COLORS[(start + index) % SERIES_COLORS.length] ?? SERIES_COLORS[0]!;
}

/* ------------------------------ default params ----------------------------- */

export function defaultParams(def: IndicatorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const param of def.params) out[param.key] = param.default;
  return out;
}

/** Clamps user input into the declared range – protects the maths from NaN. */
export function clampParams(def: IndicatorDef, params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of def.params) {
    const raw = params[spec.key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.default;
    const stepped = spec.step >= 1 ? Math.round(value) : value;
    out[spec.key] = Math.min(spec.max, Math.max(spec.min, stepped));
  }
  return out;
}

/* --------------------------------- helpers --------------------------------- */

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.c);
}

function finiteOrUndefined(value: number | undefined | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Pads a warm-up-shortened result back to candle length (front-aligned gaps).
 * `values` must be aligned to the END of the input series.
 */
export function align(values: (number | undefined)[], length: number): (number | undefined)[] {
  const out = new Array<number | undefined>(length).fill(undefined);
  const offset = length - values.length;
  if (offset < 0) {
    // Longer than the candles (never expected) – keep the tail.
    const trimmed = values.slice(-length);
    for (let i = 0; i < trimmed.length; i += 1) out[i] = finiteOrUndefined(trimmed[i]);
    return out;
  }
  for (let i = 0; i < values.length; i += 1) out[offset + i] = finiteOrUndefined(values[i]);
  return out;
}

/** Heikin-Ashi transform (used by the `heikinAshi` chart type). */
export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let prevOpen: number | null = null;
  let prevClose: number | null = null;

  for (const c of candles) {
    const haClose: number = (c.o + c.h + c.l + c.c) / 4;
    const haOpen: number =
      prevOpen === null || prevClose === null ? (c.o + c.c) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(c.h, haOpen, haClose);
    const haLow = Math.min(c.l, haOpen, haClose);
    out.push({ t: c.t, o: haOpen, h: haHigh, l: haLow, c: haClose, v: c.v, closed: c.closed });
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

/* --------------------------------- library --------------------------------- */

const p = (key: ParamKey, min: number, max: number, step: number, def: number): ParamSpec => ({
  key,
  min,
  max,
  step,
  default: def,
});

/* ------------------------- premium maths helpers --------------------------- */

function highs(candles: Candle[]): number[] {
  return candles.map((c) => c.h);
}
function lows(candles: Candle[]): number[] {
  return candles.map((c) => c.l);
}
function volumes(candles: Candle[]): number[] {
  return candles.map((c) => c.v ?? 0);
}

/** Wilder ATR as a plain array aligned to the input length. */
function atrSeries(candles: Candle[], period: number): (number | undefined)[] {
  const rows = ATR.calculate({ period, high: highs(candles), low: lows(candles), close: closes(candles) });
  return align(rows, candles.length);
}

/** Supertrend (band-flip) – the trend-following staple paid platforms gate. */
function supertrend(candles: Candle[], period: number, multiplier: number): (number | undefined)[] {
  const atr = atrSeries(candles, period);
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  let upper = Number.NaN;
  let lower = Number.NaN;
  let trend = 1;
  let line = Number.NaN;
  for (let i = 0; i < candles.length; i += 1) {
    const a = atr[i];
    // i === 0-Guard: die Band-Clamps lesen candles[i - 1].c – bei der ersten
    // Kerze wäre das undefined!. Mit period ≥ 2 ist atr[0] ohnehin undefined,
    // aber period 1 / Custom-Params dürfen keinen Crash erzeugen.
    if (a == null || i === 0) continue;
    const mid = (candles[i]!.h + candles[i]!.l) / 2;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;
    upper = Number.isNaN(upper) ? basicUpper : basicUpper < upper || candles[i - 1]!.c > upper ? basicUpper : upper;
    lower = Number.isNaN(lower) ? basicLower : basicLower > lower || candles[i - 1]!.c < lower ? basicLower : lower;
    if (Number.isNaN(line)) line = trend === 1 ? lower : upper;
    if (trend === 1 && candles[i]!.c < lower) {
      trend = -1;
      line = upper;
    } else if (trend === -1 && candles[i]!.c > upper) {
      trend = 1;
      line = lower;
    } else {
      line = trend === 1 ? lower : upper;
    }
    out[i] = line;
  }
  return out;
}

/** Anchored-from-zero VWAP-style rolling bands: Keltner = EMA ± mult·ATR. */
function keltner(candles: Candle[], period: number, multiplier: number) {
  const mid = align(EMA.calculate({ period, values: closes(candles) }), candles.length);
  const atr = atrSeries(candles, period);
  const upper = mid.map((m, i) => (m != null && atr[i] != null ? m + multiplier * (atr[i] as number) : undefined));
  const lower = mid.map((m, i) => (m != null && atr[i] != null ? m - multiplier * (atr[i] as number) : undefined));
  return { upper, mid, lower };
}

function donchian(candles: Candle[], period: number) {
  const upper: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const lower: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const mid: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = period - 1; i < candles.length; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      hi = Math.max(hi, candles[j]!.h);
      lo = Math.min(lo, candles[j]!.l);
    }
    upper[i] = hi;
    lower[i] = lo;
    mid[i] = (hi + lo) / 2;
  }
  return { upper, mid, lower };
}

function aroon(candles: Candle[], period: number) {
  const up: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const down: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = period; i < candles.length; i += 1) {
    let hiIdx = 0;
    let loIdx = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j <= i; j += 1) {
      if (candles[j]!.h >= hi) {
        hi = candles[j]!.h;
        hiIdx = j;
      }
      if (candles[j]!.l <= lo) {
        lo = candles[j]!.l;
        loIdx = j;
      }
    }
    up[i] = ((hiIdx - (i - period)) / period) * 100;
    down[i] = ((loIdx - (i - period)) / period) * 100;
  }
  return { up, down };
}

/* ------------------------------ wave-2 helpers ------------------------------ */

function wma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    let weight = 0;
    for (let j = 0; j < period; j += 1) {
      sum += values[i - j]! * (period - j);
      weight += period - j;
    }
    out[i] = sum / weight;
  }
  return out;
}

function emaOn(values: (number | undefined)[], period: number): (number | undefined)[] {
  const positions: number[] = [];
  const defined: number[] = [];
  values.forEach((value, index) => {
    if (value != null) {
      positions.push(index);
      defined.push(value);
    }
  });
  const raw = EMA.calculate({ period, values: defined });
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  // EMA.calculate returns a shorter, RIGHT-aligned result – map it back onto
  // the original positions from the end, never from the start.
  const offset = defined.length - raw.length;
  raw.forEach((value, i) => {
    const target = positions[i + offset];
    if (target != null && typeof value === 'number' && Number.isFinite(value)) out[target] = value;
  });
  return out;
}

function rolling(values: number[], period: number, fn: (win: number[]) => number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i += 1) {
    out[i] = fn(values.slice(i - period + 1, i + 1));
  }
  return out;
}

/** TTM-style squeeze: Bollinger inside Keltner = coiled volatility. */
function squeeze(candles: Candle[], period: number, kcMult: number, stdDev: number) {
  const closeValues = closes(candles);
  const bb = BollingerBands.calculate({ period, values: closeValues, stdDev });
  const bbOffset = candles.length - bb.length;
  const mid = emaOn(closeValues, period);
  const atr = atrSeries(candles, period);
  const mom: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const sq: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = 0; i < candles.length; i += 1) {
    // Single-pass rolling window: `Math.max(...arr)` spreads the whole window
    // onto the stack (RangeError on long periods) and `closes(candles)`
    // rebuilt the full close array on every bar – O(n²) for one indicator.
    const from = Math.max(0, i - period + 1);
    let hh = -Infinity;
    let ll = Infinity;
    let sum = 0;
    for (let j = from; j <= i; j += 1) {
      const c = candles[j]!;
      if (c.h > hh) hh = c.h;
      if (c.l < ll) ll = c.l;
      sum += closeValues[j]!;
    }
    const count = i - from + 1;
    const avg = (hh + ll) / 2;
    const closeSma = sum / count;
    mom[i] = candles[i]!.c - (avg / 2 + closeSma / 2);
    const row = bb[i - bbOffset];
    const m = mid[i];
    const a = atr[i];
    if (row && m != null && a != null) {
      const kcUpper = m + kcMult * a;
      const kcLower = m - kcMult * a;
      sq[i] = row.upper != null && row.lower != null && row.upper < kcUpper && row.lower > kcLower ? 1 : 0;
    }
  }
  return { mom, sq };
}

/** TD Sequential setup count (−9 bearish / +9 bullish). */
function tdSequential(candles: Candle[]): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  let bull = 0;
  let bear = 0;
  for (let i = 4; i < candles.length; i += 1) {
    const ref = candles[i - 4]!.c;
    if (candles[i]!.c < ref) {
      bull = bull < 0 ? 1 : Math.min(9, bull + 1);
      bear = 0;
    } else if (candles[i]!.c > ref) {
      bear = bear > 0 ? -1 : Math.max(-9, bear - 1);
      bull = 0;
    } else {
      bull = 0;
      bear = 0;
    }
    out[i] = bull !== 0 ? bull : bear !== 0 ? bear : undefined;
  }
  return out;
}

function chaikinMoneyFlow(candles: Candle[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = period - 1; i < candles.length; i += 1) {
    let mfv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const c = candles[j]!;
      const range = c.h - c.l;
      const multiplier = range > 0 ? (c.c - c.l - (c.h - c.c)) / range : 0;
      mfv += multiplier * (c.v ?? 0);
      vol += c.v ?? 0;
    }
    out[i] = vol > 0 ? mfv / vol : undefined;
  }
  return out;
}

function easeOfMovement(candles: Candle[], period: number): (number | undefined)[] {
  const raw: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1]!;
    const c = candles[i]!;
    const dm = (c.h + c.l) / 2 - (prev.h + prev.l) / 2;
    const range = c.h - c.l;
    const box = range > 0 && (c.v ?? 0) > 0 ? (c.v ?? 0) / 1e6 / range : 0;
    raw[i] = box > 0 ? dm / box : undefined;
  }
  const defined = raw.map((v) => v ?? 0);
  return rolling(defined, period, (w) => w.reduce((a, b) => a + b, 0) / w.length).map((v, i) =>
    i >= period && raw[i] != null ? v : undefined,
  );
}

function ultimateOscillator(candles: Candle[]): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const bp: number[] = [];
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.c : c.c;
    bp.push(c.c - Math.min(c.l, prevClose));
    tr.push(Math.max(c.h, prevClose) - Math.min(c.l, prevClose));
  }
  const avg = (period: number, i: number) => {
    let b = 0;
    let t = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      b += bp[j] ?? 0;
      t += tr[j] ?? 0;
    }
    return t > 0 ? b / t : 0;
  };
  for (let i = 28; i < candles.length; i += 1) {
    const a7 = avg(7, i);
    const a14 = avg(14, i);
    const a28 = avg(28, i);
    out[i] = ((4 * a7 + 2 * a14 + a28) / 7) * 100;
  }
  return out;
}

export const INDICATOR_LIBRARY: Record<IndicatorKind, IndicatorDef> = {
  EMA: {
    kind: 'EMA',
    placement: 'overlay',
    params: [p('period', 2, 400, 1, 21)],
    outputs: [{ key: 'ema', style: 'line', color: '#00f0ff', width: 2 }],
    compute: (candles, params) => ({
      ema: align(EMA.calculate({ period: params.period ?? 21, values: closes(candles) }), candles.length),
    }),
  },

  SMA: {
    kind: 'SMA',
    placement: 'overlay',
    params: [p('period', 2, 400, 1, 50)],
    outputs: [{ key: 'sma', style: 'line', color: '#c6ff00', width: 2 }],
    compute: (candles, params) => ({
      sma: align(SMA.calculate({ period: params.period ?? 50, values: closes(candles) }), candles.length),
    }),
  },

  BB: {
    kind: 'BB',
    placement: 'overlay',
    params: [p('period', 5, 200, 1, 20), p('stdDev', 0.5, 5, 0.1, 2)],
    outputs: [
      { key: 'upper', style: 'line', color: '#7c5cff', width: 1, dashed: true },
      { key: 'middle', style: 'line', color: '#4dd2ff', width: 1 },
      { key: 'lower', style: 'line', color: '#7c5cff', width: 1, dashed: true },
    ],
    compute: (candles, params) => {
      const rows = BollingerBands.calculate({
        period: params.period ?? 20,
        stdDev: params.stdDev ?? 2,
        values: closes(candles),
      });
      return {
        upper: align(rows.map((r) => r.upper), candles.length),
        middle: align(rows.map((r) => r.middle), candles.length),
        lower: align(rows.map((r) => r.lower), candles.length),
      };
    },
  },

  RSI: {
    kind: 'RSI',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14)],
    outputs: [{ key: 'rsi', style: 'line', color: '#ff2fb9', width: 2 }],
    scale: { min: 0, max: 100 },
    levels: [30, 50, 70],
    paneHeight: 140,
    compute: (candles, params) => ({
      rsi: align(RSI.calculate({ period: params.period ?? 14, values: closes(candles) }), candles.length),
    }),
  },

  MACD: {
    kind: 'MACD',
    placement: 'pane',
    params: [p('fast', 2, 50, 1, 12), p('slow', 3, 100, 1, 26), p('signal', 2, 50, 1, 9)],
    outputs: [
      { key: 'histogram', style: 'histogram', color: '#22e07a' },
      { key: 'macd', style: 'line', color: '#00f0ff', width: 2 },
      { key: 'signal', style: 'line', color: '#ffb020', width: 1 },
    ],
    levels: [0],
    paneHeight: 150,
    compute: (candles, params) => {
      const rows = MACD.calculate({
        values: closes(candles),
        fastPeriod: params.fast ?? 12,
        slowPeriod: params.slow ?? 26,
        signalPeriod: params.signal ?? 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      return {
        macd: align(rows.map((r) => r.MACD), candles.length),
        signal: align(rows.map((r) => r.signal), candles.length),
        histogram: align(rows.map((r) => r.histogram), candles.length),
      };
    },
  },

  ATR: {
    kind: 'ATR',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14)],
    outputs: [{ key: 'atr', style: 'line', color: '#ffb020', width: 2 }],
    levels: [],
    paneHeight: 120,
    compute: (candles, params) => ({
      atr: align(
        ATR.calculate({
          period: params.period ?? 14,
          high: candles.map((c) => c.h),
          low: candles.map((c) => c.l),
          close: closes(candles),
        }),
        candles.length,
      ),
    }),
  },

  STOCH: {
    kind: 'STOCH',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14), p('smoothing', 1, 20, 1, 3), p('signal', 1, 20, 1, 3)],
    outputs: [
      { key: 'k', style: 'line', color: '#00f0ff', width: 2 },
      { key: 'd', style: 'line', color: '#ff2fb9', width: 1 },
    ],
    scale: { min: 0, max: 100 },
    levels: [20, 80],
    paneHeight: 140,
    compute: (candles, params) => {
      const rows = Stochastic.calculate({
        period: params.period ?? 14,
        signalPeriod: params.signal ?? 3,
        high: candles.map((c) => c.h),
        low: candles.map((c) => c.l),
        close: closes(candles),
      });
      return {
        k: align(rows.map((r) => r.k), candles.length),
        d: align(rows.map((r) => r.d), candles.length),
      };
    },
  },
  /* ------------------------------ premium tier ----------------------------- */

  SUPERTREND: {
    kind: 'SUPERTREND',
    placement: 'overlay',
    params: [p('period', 2, 100, 1, 10), p('multiplier', 0.5, 10, 0.1, 3)],
    outputs: [{ key: 'supertrend', style: 'line', color: '#22e07a', width: 2 }],
    levels: [],
    compute: (candles, params) => ({
      supertrend: supertrend(candles, params.period ?? 10, params.multiplier ?? 3),
    }),
  },

  KELTNER: {
    kind: 'KELTNER',
    placement: 'overlay',
    params: [p('period', 2, 200, 1, 20), p('multiplier', 0.5, 10, 0.1, 2)],
    outputs: [
      { key: 'upper', style: 'band', color: '#7c5cff' },
      { key: 'mid', style: 'line', color: '#00f0ff', width: 1 },
      { key: 'lower', style: 'band', color: '#7c5cff' },
    ],
    levels: [],
    compute: (candles, params) => keltner(candles, params.period ?? 20, params.multiplier ?? 2),
  },

  DONCHIAN: {
    kind: 'DONCHIAN',
    placement: 'overlay',
    params: [p('period', 2, 200, 1, 20)],
    outputs: [
      { key: 'upper', style: 'band', color: '#ffb020' },
      { key: 'mid', style: 'line', color: '#ffb020', width: 1, dashed: true },
      { key: 'lower', style: 'band', color: '#ffb020' },
    ],
    levels: [],
    compute: (candles, params) => donchian(candles, params.period ?? 20),
  },

  PSAR: {
    kind: 'PSAR',
    placement: 'overlay',
    params: [p('step', 0.001, 0.1, 0.001, 0.02), p('max', 0.05, 0.5, 0.01, 0.2)],
    outputs: [{ key: 'psar', style: 'line', color: '#ff2fb9', width: 1 }],
    levels: [],
    compute: (candles, params) => ({
      psar: align(
        PsarCalc.calculate({ high: highs(candles), low: lows(candles), step: params.step ?? 0.02, max: params.max ?? 0.2 }),
        candles.length,
      ),
    }),
  },

  STOCHRSI: {
    kind: 'STOCHRSI',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14), p('smoothing', 1, 20, 1, 3), p('signal', 1, 20, 1, 3)],
    outputs: [
      { key: 'k', style: 'line', color: '#00f0ff', width: 2 },
      { key: 'd', style: 'line', color: '#ffb020', width: 1 },
    ],
    scale: { min: 0, max: 100 },
    levels: [20, 80],
    paneHeight: 140,
    compute: (candles, params) => {
      const rows = StochasticRSI.calculate({
        values: closes(candles),
        rsiPeriod: params.period ?? 14,
        stochasticPeriod: params.period ?? 14,
        kPeriod: params.smoothing ?? 3,
        dPeriod: params.signal ?? 3,
      });
      return {
        k: align(rows.map((r) => r.k * 100), candles.length),
        d: align(rows.map((r) => r.d * 100), candles.length),
      };
    },
  },

  OBV: {
    kind: 'OBV',
    placement: 'pane',
    params: [],
    outputs: [{ key: 'obv', style: 'line', color: '#c6ff00', width: 2 }],
    levels: [0],
    paneHeight: 120,
    compute: (candles) => ({
      obv: align(ObvCalc.calculate({ close: closes(candles), volume: volumes(candles) }), candles.length),
    }),
  },

  MFI: {
    kind: 'MFI',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14)],
    outputs: [{ key: 'mfi', style: 'line', color: '#4dd2ff', width: 2 }],
    scale: { min: 0, max: 100 },
    levels: [20, 80],
    paneHeight: 130,
    compute: (candles, params) => ({
      mfi: align(
        MfiCalc.calculate({
          period: params.period ?? 14,
          high: highs(candles),
          low: lows(candles),
          close: closes(candles),
          volume: volumes(candles),
        }),
        candles.length,
      ),
    }),
  },

  CCI: {
    kind: 'CCI',
    placement: 'pane',
    params: [p('period', 2, 200, 1, 20)],
    outputs: [{ key: 'cci', style: 'line', color: '#ff2fb9', width: 2 }],
    levels: [-100, 100],
    paneHeight: 130,
    compute: (candles, params) => ({
      cci: align(
        CciCalc.calculate({ period: params.period ?? 20, high: highs(candles), low: lows(candles), close: closes(candles) }),
        candles.length,
      ),
    }),
  },

  ADX: {
    kind: 'ADX',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14)],
    outputs: [
      { key: 'adx', style: 'line', color: '#eefbea', width: 2 },
      { key: 'pdi', style: 'line', color: '#22e07a', width: 1 },
      { key: 'mdi', style: 'line', color: '#ff5c5c', width: 1 },
    ],
    scale: { min: 0, max: 100 },
    levels: [25],
    paneHeight: 140,
    compute: (candles, params) => {
      const rows = AdxCalc.calculate({
        period: params.period ?? 14,
        high: highs(candles),
        low: lows(candles),
        close: closes(candles),
      });
      return {
        adx: align(rows.map((r) => r.adx), candles.length),
        pdi: align(rows.map((r) => r.pdi), candles.length),
        mdi: align(rows.map((r) => r.mdi), candles.length),
      };
    },
  },

  TRIX: {
    kind: 'TRIX',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 15)],
    outputs: [{ key: 'trix', style: 'line', color: '#7c5cff', width: 2 }],
    levels: [0],
    paneHeight: 120,
    compute: (candles, params) => ({
      trix: align(TrixCalc.calculate({ period: params.period ?? 15, values: closes(candles) }), candles.length),
    }),
  },

  PPO: {
    kind: 'PPO',
    placement: 'pane',
    params: [p('fast', 2, 100, 1, 12), p('slow', 3, 200, 1, 26), p('signal', 1, 50, 1, 9)],
    outputs: [
      { key: 'ppo', style: 'line', color: '#00f0ff', width: 2 },
      { key: 'signal', style: 'line', color: '#ffb020', width: 1 },
      { key: 'histogram', style: 'histogram', color: '#22e07a' },
    ],
    levels: [0],
    paneHeight: 140,
    compute: (candles, params) => {
      const fast = EMA.calculate({ period: params.fast ?? 12, values: closes(candles) });
      const slow = EMA.calculate({ period: params.slow ?? 26, values: closes(candles) });
      const fastAligned = align(fast, candles.length);
      const slowAligned = align(slow, candles.length);
      const ppo = candles.map((_, i) => {
        const f = fastAligned[i];
        const sl = slowAligned[i];
        return f != null && sl != null && sl !== 0 ? ((f - sl) / sl) * 100 : undefined;
      });
      const defined = ppo.filter((v): v is number => v != null);
      const signalRaw = EMA.calculate({ period: params.signal ?? 9, values: defined });
      const signalAligned = align(signalRaw, defined.length);
      const signal: (number | undefined)[] = [];
      let cursor = 0;
      for (const value of ppo) {
        signal.push(value != null ? signalAligned[cursor++] : undefined);
      }
      const histogram = ppo.map((v, i) => (v != null && signal[i] != null ? v - (signal[i] as number) : undefined));
      return { ppo, signal, histogram };
    },
  },

  DPO: {
    kind: 'DPO',
    placement: 'pane',
    params: [p('period', 3, 200, 1, 20)],
    outputs: [{ key: 'dpo', style: 'line', color: '#4dd2ff', width: 2 }],
    levels: [0],
    paneHeight: 120,
    compute: (candles, params) => {
      const period = params.period ?? 20;
      const shift = Math.floor(period / 2) + 1;
      const sma = align(SMA.calculate({ period, values: closes(candles) }), candles.length);
      const dpo: (number | undefined)[] = new Array(candles.length).fill(undefined);
      for (let i = 0; i + shift < candles.length; i += 1) {
        const ref = sma[i + shift];
        if (ref != null) dpo[i] = candles[i]!.c - ref;
      }
      return { dpo };
    },
  },

  BBPCT: {
    kind: 'BBPCT',
    placement: 'pane',
    params: [p('period', 2, 200, 1, 20), p('stdDev', 0.5, 5, 0.1, 2)],
    outputs: [{ key: 'pctB', style: 'line', color: '#c6ff00', width: 2 }],
    scale: { min: 0, max: 1 },
    levels: [0.2, 0.8],
    paneHeight: 120,
    compute: (candles, params) => {
      const rows = BollingerBands.calculate({
        period: params.period ?? 20,
        values: closes(candles),
        stdDev: params.stdDev ?? 2,
      });
      const offset = candles.length - rows.length;
      const pctB: (number | undefined)[] = new Array(candles.length).fill(undefined);
      rows.forEach((row, index) => {
        const value = num(row.pb);
        if (value != null) pctB[index + offset] = value;
      });
      return { pctB };
    },
  },

  AROON: {
    kind: 'AROON',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 25)],
    outputs: [
      { key: 'up', style: 'line', color: '#22e07a', width: 2 },
      { key: 'down', style: 'line', color: '#ff5c5c', width: 2 },
    ],
    scale: { min: 0, max: 100 },
    levels: [30, 70],
    paneHeight: 140,
    compute: (candles, params) => aroon(candles, params.period ?? 25),
  },

  /* ---------------------------- wave-2 pro tier ----------------------------- */

  ICHIMOKU: {
    kind: 'ICHIMOKU',
    placement: 'overlay',
    params: [],
    outputs: [
      { key: 'tenkan', style: 'line', color: '#00f0ff', width: 1 },
      { key: 'kijun', style: 'line', color: '#ff2fb9', width: 1 },
      { key: 'spanA', style: 'band', color: '#22e07a' },
      { key: 'spanB', style: 'band', color: '#ff5c5c' },
    ],
    levels: [],
    compute: (candles) => {
      const rows = IchimokuCalc.calculate({
        high: highs(candles),
        low: lows(candles),
        conversionPeriod: 9,
        basePeriod: 26,
        spanPeriod: 52,
        displacement: 26,
      });
      const offset = candles.length - rows.length;
      const pick = (key: 'conversion' | 'base' | 'spanA' | 'spanB') => {
        const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
        rows.forEach((row, i) => {
          const value = row[key as keyof typeof row];
          if (typeof value === 'number' && Number.isFinite(value)) out[i + offset] = value;
        });
        return out;
      };
      return { tenkan: pick('conversion'), kijun: pick('base'), spanA: pick('spanA'), spanB: pick('spanB') };
    },
  },

  VWAP: {
    kind: 'VWAP',
    placement: 'overlay',
    params: [],
    outputs: [{ key: 'vwap', style: 'line', color: '#ffb020', width: 2 }],
    levels: [],
    compute: (candles) => ({
      vwap: align(
        VwapCalc.calculate({
          high: highs(candles),
          low: lows(candles),
          close: closes(candles),
          volume: volumes(candles),
        }),
        candles.length,
      ),
    }),
  },

  WILLR: {
    kind: 'WILLR',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14)],
    outputs: [{ key: 'wr', style: 'line', color: '#7c5cff', width: 2 }],
    scale: { min: -100, max: 0 },
    levels: [-20, -80],
    paneHeight: 120,
    compute: (candles, params) => ({
      wr: align(
        WilliamsRCalc.calculate({ period: params.period ?? 14, high: highs(candles), low: lows(candles), close: closes(candles) }),
        candles.length,
      ),
    }),
  },

  HMA: {
    kind: 'HMA',
    placement: 'overlay',
    params: [p('period', 2, 200, 1, 16)],
    outputs: [{ key: 'hma', style: 'line', color: '#4dd2ff', width: 2 }],
    levels: [],
    compute: (candles, params) => {
      const n = params.period ?? 16;
      const half = Math.max(1, Math.round(n / 2));
      const root = Math.max(1, Math.round(Math.sqrt(n)));
      const wHalf = wma(closes(candles), half);
      const wFull = wma(closes(candles), n);
      const diff = wHalf.map((v, i) => (v != null && wFull[i] != null ? 2 * v - (wFull[i] as number) : undefined));
      const defined = diff.filter((v): v is number => v != null);
      const smoothed = wma(defined, root);
      const out: (number | undefined)[] = [];
      let cursor = 0;
      for (const value of diff) out.push(value != null ? smoothed[cursor++] : undefined);
      return { hma: out };
    },
  },

  TEMA: {
    kind: 'TEMA',
    placement: 'overlay',
    params: [p('period', 2, 200, 1, 21)],
    outputs: [{ key: 'tema', style: 'line', color: '#c6ff00', width: 2 }],
    levels: [],
    compute: (candles, params) => {
      const n = params.period ?? 21;
      const e1 = emaOn(closes(candles), n);
      const e2 = emaOn(e1, n);
      const e3 = emaOn(e2, n);
      return {
        tema: e1.map((v, i) => (v != null && e2[i] != null && e3[i] != null ? 3 * v - 3 * (e2[i] as number) + (e3[i] as number) : undefined)),
      };
    },
  },

  DEMA: {
    kind: 'DEMA',
    placement: 'overlay',
    params: [p('period', 2, 200, 1, 21)],
    outputs: [{ key: 'dema', style: 'line', color: '#4dd2ff', width: 2 }],
    levels: [],
    compute: (candles, params) => {
      const n = params.period ?? 21;
      const e1 = emaOn(closes(candles), n);
      const e2 = emaOn(e1, n);
      return { dema: e1.map((v, i) => (v != null && e2[i] != null ? 2 * v - (e2[i] as number) : undefined)) };
    },
  },

  GUPPY: {
    kind: 'GUPPY',
    placement: 'overlay',
    params: [],
    outputs: [
      { key: 'e3', style: 'line', color: '#00f0ff', width: 1 },
      { key: 'e8', style: 'line', color: '#22e07a', width: 1 },
      { key: 'e15', style: 'line', color: '#c6ff00', width: 1 },
      { key: 'e30', style: 'line', color: '#ffb020', width: 1 },
      { key: 'e50', style: 'line', color: '#ff2fb9', width: 1 },
      { key: 'e60', style: 'line', color: '#7c5cff', width: 1 },
    ],
    levels: [],
    compute: (candles) => ({
      e3: emaOn(closes(candles), 3),
      e8: emaOn(closes(candles), 8),
      e15: emaOn(closes(candles), 15),
      e30: emaOn(closes(candles), 30),
      e50: emaOn(closes(candles), 50),
      e60: emaOn(closes(candles), 60),
    }),
  },

  SQUEEZE: {
    kind: 'SQUEEZE',
    placement: 'pane',
    params: [p('period', 5, 100, 1, 20), p('multiplier', 0.5, 5, 0.1, 1.5), p('stdDev', 0.5, 5, 0.1, 2)],
    outputs: [
      { key: 'mom', style: 'histogram', color: '#00f0ff' },
      { key: 'sq', style: 'line', color: '#ff2fb9', width: 1 },
    ],
    scale: { min: -1, max: 1 },
    levels: [0],
    paneHeight: 140,
    compute: (candles, params) => squeeze(candles, params.period ?? 20, params.multiplier ?? 1.5, params.stdDev ?? 2),
  },

  TDSEQ: {
    kind: 'TDSEQ',
    placement: 'pane',
    params: [],
    outputs: [{ key: 'seq', style: 'histogram', color: '#ffb020' }],
    scale: { min: -9, max: 9 },
    levels: [9, -9],
    paneHeight: 110,
    compute: (candles) => ({ seq: tdSequential(candles) }),
  },

  CMF: {
    kind: 'CMF',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 20)],
    outputs: [{ key: 'cmf', style: 'line', color: '#22e07a', width: 2 }],
    levels: [0],
    paneHeight: 120,
    compute: (candles, params) => ({ cmf: chaikinMoneyFlow(candles, params.period ?? 20) }),
  },

  EMV: {
    kind: 'EMV',
    placement: 'pane',
    params: [p('period', 2, 100, 1, 14)],
    outputs: [{ key: 'emv', style: 'line', color: '#4dd2ff', width: 2 }],
    levels: [0],
    paneHeight: 120,
    compute: (candles, params) => ({ emv: easeOfMovement(candles, params.period ?? 14) }),
  },

  UO: {
    kind: 'UO',
    placement: 'pane',
    params: [],
    outputs: [{ key: 'uo', style: 'line', color: '#ffb020', width: 2 }],
    scale: { min: 0, max: 100 },
    levels: [30, 70],
    paneHeight: 130,
    compute: (candles) => ({ uo: ultimateOscillator(candles) }),
  },

  /**
   * Wave-5 Script Lab entry: the script source travels with the instance
   * (`IndicatorInstance.script`), overlay vs pane via the `overlay` param.
   */
  CUSTOM: {
    kind: 'CUSTOM',
    placement: 'pane',
    params: [p('overlay', 0, 1, 1, 0)],
    outputs: [{ key: 'custom', style: 'line', color: '#ffb020', width: 2 }],
    compute: (candles, _params, script) => ({ custom: runScript(script ?? '', candles).values }),
  },
};

export const INDICATOR_KINDS = Object.keys(INDICATOR_LIBRARY) as IndicatorKind[];

/** Overlay indicators, then pane indicators – the order used by the modal. */
export const OVERLAY_INDICATORS = INDICATOR_KINDS.filter((k) => INDICATOR_LIBRARY[k].placement === 'overlay');
export const PANE_INDICATORS = INDICATOR_KINDS.filter((k) => INDICATOR_LIBRARY[k].placement === 'pane');

/**
 * Runs one indicator instance. Returns `null` when there is not enough history
 * for the warm-up period (the chart then simply draws nothing yet).
 */
export function computeIndicator(
  kind: IndicatorKind,
  candles: Candle[],
  params: Record<string, number>,
  script?: string,
): IndicatorValues | null {
  const def = INDICATOR_LIBRARY[kind];
  if (!def || candles.length < 2) return null;

  let values: IndicatorValues;
  try {
    values = def.compute(candles, clampParams(def, params), script);
  } catch {
    // A malformed parameter must never take the chart down.
    return null;
  }

  // History shorter than the warm-up period ⇒ every slot is a gap. Returning
  // null keeps the chart from creating an empty series (and an empty pane).
  const hasData = Object.values(values).some((output) => output.some((value) => value !== undefined));
  return hasData ? values : null;
}

/** Human readable one-line summary, e.g. `EMA 21` / `MACD 12·26·9`. */
export function indicatorTitle(kind: IndicatorKind, params: Record<string, number>): string {
  const def = INDICATOR_LIBRARY[kind];
  const values = def.params.map((spec) => params[spec.key] ?? spec.default);
  return values.length > 0 ? `${kind} ${values.join('·')}` : kind;
}

/** Latest value of an output, for the legend readout. */
export function lastValue(values: (number | undefined)[] | undefined): number | undefined {
  if (!values) return undefined;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}
