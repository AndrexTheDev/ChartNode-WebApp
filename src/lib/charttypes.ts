/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Wave-4 exotic chart types — TradingView gates intraday Renko / Kagi /
 * Line Break / Point & Figure behind Plus ($29.95). Here they are pure
 * client-side transforms over the live candle buffer, available on every
 * timeframe, for free.
 *
 * All transforms return plain `Candle[]` with strictly increasing unix-second
 * times so lightweight-charts can render them with the standard candlestick
 * series (bricks/columns get flat wicks by construction).
 */
import type { Candle } from '@/websockets/types';
import type { Timeframe } from '@/store/types';

/** Simple True-Range average (no dependency, no alignment surprises). */
export function averageTrueRange(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-Math.max(period + 1, 2));
  let sum = 0;
  let n = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const prev = slice[i - 1]!;
    const cur = slice[i]!;
    sum += Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

function bump(time: number, last: number): number {
  return time > last ? time : last + 1;
}

function brick(open: number, close: number, t: number, v = 0): Candle {
  return { t, o: open, h: Math.max(open, close), l: Math.min(open, close), c: close, v };
}

/**
 * Renko: fixed-size bricks (default = ATR14 of the visible buffer).
 * A new brick forms only when price moves a full box beyond the last close.
 */
export function renko(candles: Candle[], box?: number): Candle[] {
  if (candles.length < 2) return [];
  const size = box && box > 0 ? box : averageTrueRange(candles);
  if (!(size > 0)) return [];
  const out: Candle[] = [];
  let level = candles[0]!.c;
  let lastTime = 0;
  for (const candle of candles.slice(1)) {
    // Multiple bricks can form inside one source bar (gaps included).
    for (;;) {
      if (candle.c >= level + size) {
        lastTime = bump(candle.t, lastTime);
        out.push(brick(level, level + size, lastTime, candle.v));
        level += size;
      } else if (candle.c <= level - size) {
        lastTime = bump(candle.t, lastTime);
        out.push(brick(level, level - size, lastTime, candle.v));
        level -= size;
      } else break;
    }
  }
  return out;
}

/**
 * Three Line Break: a new column only when close exceeds the extreme of the
 * previous `lines` columns — filters noise harder than Renko.
 */
export function lineBreak(candles: Candle[], lines = 3): Candle[] {
  if (candles.length < 2) return [];
  const out: Candle[] = [];
  let lastTime = 0;
  for (const candle of candles) {
    if (out.length === 0) {
      lastTime = candle.t;
      out.push(brick(candle.o, candle.c, lastTime, candle.v));
      continue;
    }
    const window = out.slice(-lines);
    const highest = Math.max(...window.map((w) => Math.max(w.o, w.c)));
    const lowest = Math.min(...window.map((w) => Math.min(w.o, w.c)));
    const prevClose = out[out.length - 1]!.c;
    if (candle.c > highest && candle.c > prevClose) {
      lastTime = bump(candle.t, lastTime);
      out.push(brick(prevClose, candle.c, lastTime, candle.v));
    } else if (candle.c < lowest && candle.c < prevClose) {
      lastTime = bump(candle.t, lastTime);
      out.push(brick(prevClose, candle.c, lastTime, candle.v));
    }
  }
  return out;
}

/**
 * Kagi: continuous vertical columns that reverse only after a reversal
 * amount (default ATR-based). Rendered as tight vertical candles.
 */
export function kagi(candles: Candle[], reversal?: number): Candle[] {
  if (candles.length < 2) return [];
  const rev = reversal && reversal > 0 ? reversal : averageTrueRange(candles) * 1.5;
  if (!(rev > 0)) return [];
  const out: Candle[] = [];
  let colOpen = candles[0]!.c;
  let colExtreme = colOpen;
  let rising = true;
  let lastTime = candles[0]!.t;
  for (const candle of candles.slice(1)) {
    const price = candle.c;
    if (rising) {
      colExtreme = Math.max(colExtreme, price);
      if (price <= colExtreme - rev) {
        lastTime = bump(candle.t, lastTime);
        out.push(brick(colOpen, colExtreme, lastTime, candle.v));
        colOpen = colExtreme;
        colExtreme = price;
        rising = false;
      }
    } else {
      colExtreme = Math.min(colExtreme, price);
      if (price >= colExtreme + rev) {
        lastTime = bump(candle.t, lastTime);
        out.push(brick(colOpen, colExtreme, lastTime, candle.v));
        colOpen = colExtreme;
        colExtreme = price;
        rising = true;
      }
    }
  }
  lastTime = bump(candles[candles.length - 1]!.t, lastTime);
  out.push(brick(colOpen, colExtreme, lastTime));
  return out;
}

export interface PnfOptions {
  box?: number;
  reversal?: number;
}

/**
 * Point & Figure: X/O columns, `reversal` boxes against the trend.
 * Each column is emitted as one synthetic candle (open = column start,
 * close = column end) so the whole history stays readable on one chart.
 */
export function pointAndFigure(candles: Candle[], options: PnfOptions = {}): Candle[] {
  if (candles.length < 2) return [];
  const box = options.box && options.box > 0 ? options.box : averageTrueRange(candles);
  const reversalBoxes = options.reversal ?? 3;
  if (!(box > 0)) return [];
  const out: Candle[] = [];
  let dir: 1 | -1 = 1;
  let colStart = candles[0]!.c;
  let colEnd = colStart;
  const flush = (time: number) => {
    if (Math.abs(colEnd - colStart) >= box) {
      out.push({
        t: bump(time, out.length ? out[out.length - 1]!.t : 0),
        o: colStart,
        h: Math.max(colStart, colEnd),
        l: Math.min(colStart, colEnd),
        c: colEnd,
        v: 0,
      });
    }
  };
  for (const candle of candles.slice(1)) {
    const level = Math.floor(candle.c / box) * box;
    if (dir === 1) {
      while (level >= colEnd + box) {
        colEnd += box;
      }
      if (level <= colEnd - reversalBoxes * box) {
        flush(candle.t);
        dir = -1;
        colStart = colEnd;
        colEnd = level + box;
      }
    } else {
      while (level + box <= colEnd) {
        colEnd -= box;
      }
      if (level >= colEnd + reversalBoxes * box) {
        flush(candle.t);
        dir = 1;
        colStart = colEnd;
        colEnd = level;
      }
    }
  }
  flush(candles[candles.length - 1]!.t);
  return out;
}

export type ExoticType = 'renko' | 'lineBreak' | 'kagi' | 'pnf';

export function transformExotic(type: ExoticType, candles: Candle[]): Candle[] {
  switch (type) {
    case 'renko':
      return renko(candles);
    case 'lineBreak':
      return lineBreak(candles);
    case 'kagi':
      return kagi(candles);
    case 'pnf':
      return pointAndFigure(candles);
    default:
      return candles;
  }
}

/** Merge candles into N-minute buckets (custom intervals). */
export function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1) return candles;
  const span = minutes * 60 * 1000; // candle.t is unix-ms
  const out: Candle[] = [];
  let bucket: Candle | null = null;
  for (const candle of candles) {
    const start = Math.floor(candle.t / span) * span;
    if (!bucket || bucket.t !== start) {
      if (bucket) out.push(bucket);
      bucket = { ...candle, t: start };
    } else {
      bucket.h = Math.max(bucket.h, candle.h);
      bucket.l = Math.min(bucket.l, candle.l);
      bucket.c = candle.c;
      bucket.v += candle.v;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

const BASES: Array<{ minutes: number; timeframe: Timeframe }> = [
  { minutes: 1, timeframe: '1m' },
  { minutes: 5, timeframe: '5m' },
  { minutes: 15, timeframe: '15m' },
  { minutes: 60, timeframe: '1h' },
  { minutes: 240, timeframe: '4h' },
  { minutes: 1440, timeframe: '1d' },
];

/**
 * Feed plan for a custom interval: subscribe the largest native timeframe
 * that divides N (keeps websocket depth sane), aggregate client-side.
 * TradingView sells this as "custom timeframes" (Essential+).
 */
export function baseForCustomInterval(minutes: number): { timeframe: Timeframe; factor: number } {
  const clamped = Math.min(Math.max(Math.round(minutes), 2), 43200);
  for (let i = BASES.length - 1; i >= 0; i -= 1) {
    const base = BASES[i]!;
    if (clamped % base.minutes === 0 && clamped >= base.minutes) {
      return { timeframe: base.timeframe, factor: clamped / base.minutes };
    }
  }
  return { timeframe: '1m', factor: clamped };
}
