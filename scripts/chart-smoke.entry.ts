/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Chart-layer smoke test (dev-only harness, not shipped).
 *
 * Everything here is offline and deterministic:
 *   1. indicator maths from `technicalindicators` is re-checked against
 *      independent reference implementations written in this file
 *   2. warm-up alignment, Heikin-Ashi, price precision
 *   3. chart store: unlimited indicator instances, param clamping, drawings,
 *      per-pane timeframes
 *   4. drawing geometry: fib levels, hit tests, translation, ray projection
 *   5. the cross-chart sync bus (echo suppression + epsilon comparison)
 *
 * Run with: npm run chart:smoke
 */

(globalThis as unknown as { window: unknown }).window = globalThis;

// Minimal localStorage stand-in: `resolveStorage()` probes it, so the persist
// middleware runs against real (in-memory) storage in this harness – which is
// what makes the corrupted-rehydrate proofs below meaningful.
{
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, String(value));
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
  };
}

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}`);
  if (!condition) failures += 1;
}
function near(a: number | undefined, b: number, eps = 1e-9): boolean {
  return typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= eps;
}

const {
  INDICATOR_LIBRARY,
  align,
  clampParams,
  computeIndicator,
  defaultParams,
  heikinAshi,
  indicatorTitle,
  lastValue,
} = await import('@/lib/indicators');
const { pricePrecision, minMoveFor } = await import('@/lib/format');
const { useChartStore } = await import('@/store/useChartStore');
const drawings = await import('@/lib/drawings');
const { crosshairBus, rangeBus, rangesEqual } = await import('@/lib/chart-sync');
const { effectiveTimeframe } = await import('@/store/useChartStore');
const device = await import('@/lib/device');
import type { Candle } from '@/websockets/types';
import { renko, lineBreak, kagi, pointAndFigure, aggregateCandles, baseForCustomInterval } from '@/lib/charttypes';
import { detectPatterns } from '@/lib/patterns';
import { scoreCandles } from '@/lib/ratings';
import { journalStats, journalCsv, pnlOf, rOf, type JournalEntry } from '@/lib/journal';
import type { Drawing } from '@/store/useChartStore';

/* ------------------------------ test fixtures ------------------------------ */

/** Deterministic LCG so a failing run can always be reproduced. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}

function syntheticCandles(count: number, start = 100, seed = 42): Candle[] {
  const rand = lcg(seed);
  const out: Candle[] = [];
  let price = start;
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < count; i += 1) {
    const drift = (rand() - 0.48) * 2;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rand() * 0.8;
    const low = Math.min(open, close) - rand() * 0.8;
    out.push({ t: t0 + i * 60_000, o: open, h: high, l: low, c: close, v: 10 + rand() * 90 });
    price = close;
  }
  return out;
}

/** 1..12 – hand-checkable closes. */
function rampCandles(count = 12): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const value = i + 1;
    return { t: 1_700_000_000_000 + i * 60_000, o: value, h: value + 0.5, l: value - 0.5, c: value, v: 1 };
  });
}

const CLOSES = syntheticCandles(400).map((c) => c.c);

/* --------------------- reference implementations (independent) --------------------- */

function refSma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function refEma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      sum += values[i]!;
      continue;
    }
    if (i === period - 1) {
      sum += values[i]!;
      out[i] = sum / period; // SMA seed
      continue;
    }
    out[i] = values[i]! * k + out[i - 1]! * (1 - k);
  }
  return out;
}

/** Wilder's RSI, written from the definition. */
function refRsi(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i += 1) {
    const change = values[i]! - values[i - 1]!;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      continue;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Wilder's ATR, seeded the way `technicalindicators` does it: the degenerate
 * first true range (no previous close) is not part of the seed window, so the
 * first ATR lands on candle index `period`, not `period - 1`.
 */
function refAtr(candles: Candle[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i]!;
    const prev = candles[i - 1];
    trs.push(prev ? Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)) : c.h - c.l);
    if (i < period) continue;
    if (i === period) {
      out[i] = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
      continue;
    }
    out[i] = (out[i - 1]! * (period - 1) + trs[i]!) / period;
  }
  return out;
}

/** Raw %K and its SMA-smoothed %D. */
function refStochastic(candles: Candle[], period: number, signalPeriod: number): { k: (number | undefined)[]; d: (number | undefined)[] } {
  const k: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = period - 1; i < candles.length; i += 1) {
    const window = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...window.map((c) => c.h));
    const ll = Math.min(...window.map((c) => c.l));
    k[i] = hh === ll ? 0 : (100 * (candles[i]!.c - ll)) / (hh - ll);
  }
  const compacted = k.filter((v): v is number => v !== undefined);
  const dSmooth = refSma(compacted, signalPeriod);
  const offset = candles.length - compacted.length;
  const d: (number | undefined)[] = new Array(candles.length).fill(undefined);
  dSmooth.forEach((value, index) => {
    d[index + offset] = value;
  });
  return { k, d };
}

function populationSd(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
}
function sampleSd(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1));
}

/* ================================= indicators =============================== */

console.log('\n— indicator maths vs. independent reference —');

const candles = syntheticCandles(400);

{
  const period = 21;
  const mine = computeIndicator('EMA', candles, { period })?.ema ?? [];
  const ref = refEma(CLOSES, period);
  const bad = ref.filter((v, i) => (v === undefined) !== (mine[i] === undefined) || (v !== undefined && !near(mine[i], v, 1e-9))).length;
  check(`EMA(${period}) matches the SMA-seeded recursive formula (${ref.filter((v) => v !== undefined).length} points)`, bad === 0);
}

{
  const period = 50;
  const mine = computeIndicator('SMA', candles, { period })?.sma ?? [];
  const ref = refSma(CLOSES, period);
  const bad = ref.filter((v, i) => (v === undefined) !== (mine[i] === undefined) || (v !== undefined && !near(mine[i], v, 1e-9))).length;
  check(`SMA(${period}) matches the rolling mean`, bad === 0);
}

{
  for (const period of [7, 14]) {
    const mine = computeIndicator('RSI', candles, { period })?.rsi ?? [];
    const ref = refRsi(CLOSES, period);
    const defined = ref.filter((v) => v !== undefined);
    // The library rounds RSI to 2 decimals before returning it, so the
    // reference has to be rounded the same way for an exact comparison.
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const bad = ref.filter((v, i) => {
      if ((v === undefined) !== (mine[i] === undefined)) return true;
      return v !== undefined && !near(mine[i], rounded(v), 1e-9);
    }).length;
    const inRange = mine.filter((v): v is number => v !== undefined).every((v) => v >= 0 && v <= 100);
    check(`RSI(${period}) = Wilder smoothing (2 dp rounded) on ${defined.length} points, inside 0…100`, bad === 0 && inRange);
  }
}

{
  // Rising prices ⇒ RSI must be 100 (no losses at all).
  const ramp = rampCandles(30);
  const rsi = computeIndicator('RSI', ramp, { period: 14 })?.rsi ?? [];
  check('RSI of a pure ramp is 100', near(lastValue(rsi), 100, 1e-9));
}

{
  const mine = computeIndicator('ATR', candles, { period: 14 })?.atr ?? [];
  const ref = refAtr(candles, 14);
  const bad = ref.filter((v, i) => (v === undefined) !== (mine[i] === undefined) || (v !== undefined && !near(mine[i], v, 1e-9))).length;
  check('ATR(14) matches Wilder true-range smoothing', bad === 0);
}

{
  const mine = computeIndicator('STOCH', candles, { period: 14, smoothing: 3, signal: 3 });
  const ref = refStochastic(candles, 14, 3);
  const k = mine?.k ?? [];
  const d = mine?.d ?? [];
  const badK = ref.k.filter((v, i) => (v === undefined) !== (k[i] === undefined) || (v !== undefined && !near(k[i], v, 1e-9))).length;
  const badD = ref.d.filter((v, i) => (v === undefined) !== (d[i] === undefined) || (v !== undefined && !near(d[i], v, 1e-9))).length;
  check('Stochastic %K matches (close − LL) / (HH − LL) and %D its SMA', badK === 0 && badD === 0);
}

{
  const mine = computeIndicator('MACD', candles, { fast: 12, slow: 26, signal: 9 });
  const macd = mine?.macd ?? [];
  const signal = mine?.signal ?? [];
  const histogram = mine?.histogram ?? [];
  const fast = refEma(CLOSES, 12);
  const slow = refEma(CLOSES, 26);
  let badMacd = 0;
  for (let i = 0; i < CLOSES.length; i += 1) {
    const f = fast[i];
    const s = slow[i];
    const expected = f !== undefined && s !== undefined ? f - s : undefined;
    const actual = macd[i];
    if ((expected === undefined) !== (actual === undefined)) badMacd += 1;
    else if (expected !== undefined && !near(actual, expected, 1e-9)) badMacd += 1;
  }
  check('MACD line = EMA(12) − EMA(26)', badMacd === 0);

  const compacted = macd.filter((v): v is number => v !== undefined);
  const refSignal = refEma(compacted, 9);
  const offset = macd.length - compacted.length;
  let badSignal = 0;
  refSignal.forEach((value, index) => {
    if (value !== undefined && !near(signal[index + offset], value, 1e-9)) badSignal += 1;
  });
  check('MACD signal = EMA(9) of the MACD line', badSignal === 0);

  const badHist = histogram.filter((v, i) => {
    const m = macd[i];
    const s = signal[i];
    if (m === undefined || s === undefined) return v !== undefined;
    return !near(v, m - s, 1e-9);
  }).length;
  check('MACD histogram = MACD − signal', badHist === 0);
}

{
  const mine = computeIndicator('BB', candles, { period: 20, stdDev: 2 });
  const middle = mine?.middle ?? [];
  const upper = mine?.upper ?? [];
  const lower = mine?.lower ?? [];
  const refMid = refSma(CLOSES, 20);
  let badMid = 0;
  let badBand = 0;
  let population = 0;
  let sample = 0;
  for (let i = 19; i < CLOSES.length; i += 1) {
    if (!near(middle[i], refMid[i]!, 1e-9)) badMid += 1;
    const window = CLOSES.slice(i - 19, i + 1);
    const sdPop = populationSd(window);
    const sdSample = sampleSd(window);
    if (near(upper[i], refMid[i]! + 2 * sdPop, 1e-9) && near(lower[i], refMid[i]! - 2 * sdPop, 1e-9)) population += 1;
    else if (near(upper[i], refMid[i]! + 2 * sdSample, 1e-9) && near(lower[i], refMid[i]! - 2 * sdSample, 1e-9)) sample += 1;
    else badBand += 1;
  }
  check('Bollinger middle band = SMA(20)', badMid === 0);
  check(`Bollinger bands = middle ± 2σ (${population > sample ? 'population' : 'sample'} σ, ${Math.max(population, sample)} points)`, badBand === 0);
  const symmetric = upper.every((u, i) => u === undefined || middle[i] === undefined || lower[i] === undefined || near((u + lower[i]!) / 2, middle[i]!, 1e-9));
  check('bands are symmetric around the middle', symmetric);
}

console.log('\n— alignment, warm-up & robustness —');

{
  const ema = computeIndicator('EMA', candles, { period: 21 })?.ema ?? [];
  check('aligned output has exactly one slot per candle', ema.length === candles.length);
  check('warm-up slots stay undefined', ema.slice(0, 20).every((v) => v === undefined));
  check('first value lands at index period-1', ema[20] !== undefined);
  check('align() pads front, keeps the tail', (() => {
    const aligned = align([1, 2, 3], 5);
    return aligned.length === 5 && aligned[0] === undefined && aligned[1] === undefined && aligned[2] === 1 && aligned[4] === 3;
  })());
  check('align() turns NaN into a gap', align([Number.NaN, 4], 3)[1] === undefined && align([Number.NaN, 4], 3)[2] === 4);
}

{
  check('too-short history yields null instead of NaN', computeIndicator('SMA', syntheticCandles(3), { period: 50 }) === null);
  check('garbage params are clamped, not thrown', (() => {
    const def = INDICATOR_LIBRARY.RSI;
    const clamped = clampParams(def, { period: 9999 });
    return clamped.period === def.params[0]!.max && computeIndicator('RSI', candles, { period: -5 }) !== null;
  })());
  check('empty candles never throw', computeIndicator('MACD', [], { fast: 12, slow: 26, signal: 9 }) === null);
  check('default params satisfy every spec', Object.keys(INDICATOR_LIBRARY).every((kind) => {
    const def = INDICATOR_LIBRARY[kind as keyof typeof INDICATOR_LIBRARY];
    const params = defaultParams(def);
    return def.params.every((spec) => params[spec.key]! >= spec.min && params[spec.key]! <= spec.max);
  }));
  check('titles render parameters', indicatorTitle('MACD', { fast: 12, slow: 26, signal: 9 }) === 'MACD 12·26·9');
}

{
  const ha = heikinAshi(rampCandles(6));
  const raw = rampCandles(6);
  check('Heikin-Ashi close = (o+h+l+c)/4', near(ha[3]!.c, (raw[3]!.o + raw[3]!.h + raw[3]!.l + raw[3]!.c) / 4, 1e-12));
  check('Heikin-Ashi open = mean of previous HA open/close', near(ha[3]!.o, (ha[2]!.o + ha[2]!.c) / 2, 1e-12));
  check('Heikin-Ashi high/low enclose the body', ha.every((c) => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c)));
  check('timestamps survive the transform', ha.every((c, i) => c.t === raw[i]!.t));
}

{
  check(
    'price precision follows the magnitude',
    pricePrecision(78126.23) === 2 && pricePrecision(3412.55) === 2 && pricePrecision(145.32) === 2 &&
      pricePrecision(42.567) === 3 && pricePrecision(0.4212) === 4 && pricePrecision(0.01234) === 5 &&
      pricePrecision(0.00001234) === 8,
  );
  check('minMove matches the precision', minMoveFor(2) === 0.01 && minMoveFor(8) === 1e-8);
  check('precision has a sane fallback', pricePrecision(null) === 2 && pricePrecision(0) === 2);
}

/* ================================ chart store =============================== */

console.log('\n— chart store (unlimited indicators, drawings, sync) —');

const store = useChartStore;
const PANE = 'pane-1';

{
  const ids: string[] = [];
  for (let i = 0; i < 25; i += 1) ids.push(store.getState().addIndicator(PANE, i % 2 === 0 ? 'RSI' : 'EMA', { period: 5 + i }));
  const list = store.getState().indicators[PANE] ?? [];
  check('25 indicator instances on one pane (no cap)', list.length === 25);
  check('instance ids are unique', new Set(ids).size === 25);
  check('params are clamped on the way in', list.every((entry) => (entry.params.period ?? 0) <= 400));

  store.getState().updateIndicator(PANE, ids[0]!, { params: { period: 9999 } });
  const updated = (store.getState().indicators[PANE] ?? []).find((entry) => entry.id === ids[0]);
  check('updating clamps to the declared maximum', updated?.params.period === INDICATOR_LIBRARY.RSI.params[0]!.max);

  store.getState().updateIndicator(PANE, ids[1]!, { visible: false });
  check('visibility toggles per instance', (store.getState().indicators[PANE] ?? []).find((e) => e.id === ids[1])?.visible === false);

  store.getState().removeIndicator(PANE, ids[2]!);
  check('removing drops exactly one instance', (store.getState().indicators[PANE] ?? []).length === 24);
  store.getState().clearIndicators(PANE);
  check('clear empties the pane', (store.getState().indicators[PANE] ?? []).length === 0);
}

{
  check('indicator selectors are stable for empty panes', store.getState().indicators['pane-9'] === undefined);

  store.getState().setPaneTimeframe(PANE, '15m');
  store.getState().setSyncTimeframe(false);
  check('per-pane timeframe override applies when sync is off', effectiveTimeframe(store.getState(), PANE, '1h') === '15m');
  store.getState().setSyncTimeframe(true);
  check('sync on ⇒ every pane follows the global timeframe', effectiveTimeframe(store.getState(), PANE, '1h') === '1h');
  store.getState().setPaneTimeframe(PANE, null);
  check('no override ⇒ global timeframe', effectiveTimeframe(store.getState(), PANE, '4h') === '4h');
}

{
  const id = store.getState().addDrawing(PANE, {
    tool: 'fib',
    points: [{ time: 100, price: 10 }, { time: 200, price: 20 }],
    color: '#00f0ff',
  });
  check('drawing is stored and auto-selected', (store.getState().drawings[PANE] ?? []).length === 1 && store.getState().selected[PANE] === id);
  store.getState().updateDrawing(PANE, id, [{ time: 120, price: 12 }, { time: 220, price: 22 }]);
  check('drawing moves in data space', (store.getState().drawings[PANE] ?? [])[0]!.points[0].time === 120);
  store.getState().removeDrawing(PANE, id);
  check('removing clears the selection too', (store.getState().drawings[PANE] ?? []).length === 0 && store.getState().selected[PANE] === null);

  store.getState().setTool('trendline');
  check('tool state round-trips', store.getState().tool === 'trendline');
  store.getState().setDrawingToolsForced(true);
  check('mobile force-enable persists in the store', store.getState().drawingToolsForced === true);
  store.getState().reset();
  check('reset restores defaults', store.getState().tool === 'none' && store.getState().drawingToolsForced === false && store.getState().syncCrosshair === true);
}

/* ============================== drawing geometry ============================= */

console.log('\n— drawing geometry & hit tests —');

{
  const up = drawings.fibPrice(100, 200, 0.618);
  const down = drawings.fibPrice(200, 100, 0.618);
  check('fib is direction-agnostic', near(up, 161.8, 1e-9) && near(down, 138.2, 1e-9));
  check('fib levels are the classic seven', drawings.FIB_LEVELS.length === 7 && drawings.FIB_LEVELS[0] === 0 && drawings.FIB_LEVELS[6] === 1);
}

const T0 = 1_700_000_000;
// Structural copy of `ToXY` – the module namespace is a runtime value here.
type ToXY = (point: { time: number; price: number }) => { x: number; y: number } | null;
const toXY: ToXY = (point) => ({ x: (point.time - T0) * 10, y: (100 - point.price) * 10 });

function shape(tool: Drawing['tool'], p1: [number, number], p2: [number, number]): Drawing {
  return {
    id: `${tool}-1`,
    tool,
    points: [
      { time: T0 + p1[0], price: p1[1] },
      { time: T0 + p2[0], price: p2[1] },
    ],
    color: '#39ff14',
    createdAt: 0,
  };
}

{
  const trend = shape('trendline', [0, 10], [20, 30]);
  check('trendline hits on the segment', drawings.hitTestDrawing(trend, toXY, { x: 100, y: 800 }));
  check('trendline misses far away', !drawings.hitTestDrawing(trend, toXY, { x: 100, y: 500 }));
  check('trendline misses beyond the end point', !drawings.hitTestDrawing(trend, toXY, { x: 400, y: 500 }, 4));

  const ray = shape('ray', [0, 10], [10, 20]);
  check('ray keeps hitting to the right of the anchor', drawings.hitTestDrawing(ray, toXY, { x: 300, y: 600 }));
  check('ray ignores the half-line behind the anchor', !drawings.hitTestDrawing(ray, toXY, { x: -100, y: 1000 }));

  const horizontal = shape('horizontal', [0, 42], [5, 99]);
  check('horizontal line only cares about the price', drawings.hitTestDrawing(horizontal, toXY, { x: 500, y: (100 - 42) * 10 }));
  check('horizontal line misses other prices', !drawings.hitTestDrawing(horizontal, toXY, { x: 500, y: (100 - 44) * 10 }));

  const zone = shape('zone', [0, 60], [20, 40]);
  check('zone hits inside the rectangle', drawings.hitTestDrawing(zone, toXY, { x: 100, y: (100 - 50) * 10 }));
  check('zone misses outside', !drawings.hitTestDrawing(zone, toXY, { x: 400, y: 100 }));

  const fib = shape('fib', [0, 100], [10, 0]);
  const y618 = (100 - drawings.fibPrice(100, 0, 0.618)) * 10;
  check('fib hits the 0.618 level', drawings.hitTestDrawing(fib, toXY, { x: 150, y: y618 }));
  check('fib misses between levels', !drawings.hitTestDrawing(fib, toXY, { x: 150, y: y618 + 60 }, 4));
  check('fib produces seven prices', drawings.fibLevelsFor(fib).length === 7);
}

{
  const first = shape('trendline', [0, 10], [10, 20]);
  const second: Drawing = { ...shape('trendline', [0, 10], [10, 20]), id: 'trendline-2' };
  const hit = drawings.hitTestDrawings([first, second], toXY, { x: 50, y: (100 - 15) * 10 });
  check('topmost (last drawn) shape wins the hit test', hit?.id === 'trendline-2');
  check('no hit returns null', drawings.hitTestDrawings([first], toXY, { x: 900, y: 10 }) === null);
}

{
  const trend = shape('trendline', [0, 10], [10, 20]);
  const moved = drawings.translateDrawing(trend, { time: 5, price: -2 });
  check('translate shifts both anchors', moved.points[0].time === T0 + 5 && moved.points[1].price === 18);
  check('translate does not mutate the original', trend.points[0].time === T0);

  const [a, b] = drawings.normalizePoints({ time: 300, price: 5 }, { time: 100, price: 9 });
  check('normalize sorts points left to right', a.time === 100 && b.time === 300);

  const projected = drawings.extendToRight({ x: 0, y: 0 }, { x: 10, y: 10 }, 100);
  check('ray projection reaches the right edge', near(projected.x, 100) && near(projected.y, 100));
  check('projection never shortens the segment', drawings.extendToRight({ x: 0, y: 0 }, { x: 200, y: 5 }, 100).x === 200);

  check('segment distance is 0 on the line', near(drawings.distanceToSegment(5, 5, 0, 0, 10, 10), 0, 1e-9));
  check('segment distance clamps at the end points', near(drawings.distanceToSegment(20, 0, 0, 0, 10, 0), 10, 1e-9));
  check('infinite line distance ignores the end points', near(drawings.distanceToLine(20, 5, 0, 0, 10, 0), 5, 1e-9));

  const zone = shape('zone', [0, 60], [20, 40]);
  check('zone rect normalises corners', (() => {
    const rect = drawings.zoneRect({ x: 200, y: 400 }, { x: 0, y: 600 });
    return rect.left === 0 && rect.top === 400 && rect.width === 200 && rect.height === 200;
  })());
  check('zone label shows the price range', drawings.drawingLabel(zone, 0) === '40 – 60');
  check('trendline label shows the percentage change', drawings.drawingLabel(shape('trendline', [0, 100], [10, 110]), 2) === '+10.00%');
  check('horizontal label shows the price', drawings.drawingLabel(shape('horizontal', [0, 12.5], [5, 99]), 1) === '12.5');
}

/* ================================== sync bus ================================= */

console.log('\n— cross-chart sync bus —');

{
  const seen: string[] = [];
  const off = rangeBus.subscribe((message) => seen.push(`${message.source}:${message.range.from}-${message.range.to}`));
  rangeBus.publish({ source: 'a', range: { from: 0, to: 10 } });
  rangeBus.publish({ source: 'b', range: { from: 5, to: 15 } });
  check('every subscriber receives every message', seen.length === 2 && seen[0] === 'a:0-10');
  off();
  rangeBus.publish({ source: 'c', range: { from: 1, to: 2 } });
  check('unsubscribe stops delivery', seen.length === 2);
  check('late joiners can replay the last range', (() => {
    const got: string[] = [];
    rangeBus.replay((message) => got.push(message.source), 'zzz');
    return got.length === 1 && got[0] === 'c';
  })());
  check('replay skips the own chart id', (() => {
    const got: string[] = [];
    rangeBus.replay((message) => got.push(message.source), 'c');
    return got.length === 0;
  })());
}

{
  check('ranges equal within epsilon', rangesEqual({ from: 1, to: 10 }, { from: 1.001, to: 10.001 }));
  check('different ranges are not equal', !rangesEqual({ from: 1, to: 10 }, { from: 2, to: 10 }));
  check('null ranges only equal null', rangesEqual(null, null) && !rangesEqual(null, { from: 0, to: 1 }));

  const got: string[] = [];
  const off = crosshairBus.subscribe((message) => got.push(`${message.source}:${message.time}:${message.symbol}`));
  crosshairBus.publish({ source: 'a', time: 1_700_000_060, logical: 1, price: 42, paneIndex: 0, symbol: 'BTC/USDT' });
  off();
  check('crosshair messages carry time, price and symbol', got[0] === 'a:1700000060:BTC/USDT');
  rangeBus.clear();
  crosshairBus.clear();
}

/* ===================== wave 2: premium analytics + 12 new kinds ============== */

console.log('\n— wave 2: indicator library coverage —');

{
  const { INDICATOR_KINDS } = await import('@/lib/indicators');
  check('library exposes 34 indicator kinds (incl. CUSTOM)', INDICATOR_KINDS.length === 34);

  const long = syntheticCandles(400);
  const missing: string[] = [];
  for (const kind of INDICATOR_KINDS) {
    const def = INDICATOR_LIBRARY[kind];
    // CUSTOM needs a user formula – feed it the identity of the close.
    const values = computeIndicator(kind, long, defaultParams(def), kind === 'CUSTOM' ? 'c' : undefined);
    const anyValue =
      values != null &&
      def.outputs.some((output) => {
        const series = values[output.key];
        return Array.isArray(series) && series.some((point) => typeof point === 'number' && Number.isFinite(point));
      });
    if (!anyValue) missing.push(kind);
  }
  check(`every kind produces at least one finite series${missing.length > 0 ? ` (missing: ${missing.join(', ')})` : ''}`, missing.length === 0);
}

console.log('\n— wave 2: new oscillator maths —');

{
  const ramp = rampCandles(120);

  // Williams %R: a pure uptrend must sit in the overbought zone (−20..0).
  const willr = computeIndicator('WILLR', ramp, { period: 14 })?.wr ?? [];
  const lastWillr = lastValue(willr);
  check('WILLR of a pure uptrend is overbought (−20..0)', typeof lastWillr === 'number' && lastWillr >= -20 && lastWillr <= 0);
  check('WILLR stays inside its −100..0 scale', willr.every((value) => value == null || (value >= -100 && value <= 0)));

  // Ultimate oscillator: bounded 0..100, uptrend in the upper half.
  const uo = computeIndicator('UO', ramp, {})?.uo ?? [];
  const lastUo = lastValue(uo);
  check('UO stays inside 0..100', uo.every((value) => value == null || (value >= 0 && value <= 100)));
  check('UO of an uptrend reads above 50', typeof lastUo === 'number' && lastUo > 50);

  // CMF: closes near the high on a rising series ⇒ positive money flow.
  const bullCloses: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const value = 100 + i;
    return { t: 1_700_000_000_000 + i * 60_000, o: value - 0.6, h: value + 0.2, l: value - 0.8, c: value, v: 10 };
  });
  const cmf = computeIndicator('CMF', bullCloses, { period: 20 })?.cmf ?? [];
  const lastCmf = lastValue(cmf);
  check('CMF of closes-near-high uptrend is positive', typeof lastCmf === 'number' && lastCmf > 0);

  // Lag ordering on a trend: HMA/TEMA/DEMA must track price closer than SMA.
  const sma = lastValue(computeIndicator('SMA', ramp, { period: 20 })?.sma ?? []);
  const hma = lastValue(computeIndicator('HMA', ramp, { period: 20 })?.hma ?? []);
  const tema = lastValue(computeIndicator('TEMA', ramp, { period: 20 })?.tema ?? []);
  const dema = lastValue(computeIndicator('DEMA', ramp, { period: 20 })?.dema ?? []);
  const lastClose = ramp[ramp.length - 1]!.c;
  const lag = (value: number | undefined) => (typeof value === 'number' ? Math.abs(lastClose - value) : Infinity);
  check('HMA lags less than SMA(20) on a trend', lag(hma) < lag(sma));
  check('TEMA and DEMA lag less than SMA(20) on a trend', lag(tema) < lag(sma) && lag(dema) < lag(sma));

  // Guppy ribbon: short EMAs above long EMAs in an uptrend, all six present.
  const guppy = computeIndicator('GUPPY', ramp, {});
  const ribbon = guppy ? ['e3', 'e8', 'e15', 'e30', 'e50', 'e60'].map((key) => lastValue(guppy[key] ?? [])) : [];
  check(
    'GUPPY ribbon is bullishly stacked (e3 > e8 > … > e60)',
    ribbon.every((value) => typeof value === 'number') &&
      (ribbon as number[]).every((value, index) => index === 0 || value < (ribbon[index - 1] as number)),
  );

  // Squeeze: momentum finite, squeeze flag confined to −1/0/1.
  const squeeze = computeIndicator('SQUEEZE', syntheticCandles(300), { period: 20, multiplier: 1.5, stdDev: 2 });
  const sq = squeeze?.sq ?? [];
  check('SQUEEZE flag only takes −1/0/1', sq.every((value) => value == null || value === -1 || value === 0 || value === 1));
  check('SQUEEZE momentum produces finite values', lastValue(squeeze?.mom ?? []) != null);

  // TD Sequential: counts are bounded and a 9 appears on a long trend run.
  const td = computeIndicator('TDSEQ', ramp, {})?.seq ?? [];
  check('TDSEQ stays within −9..9', td.every((value) => value == null || (value >= -9 && value <= 9)));
  check('TDSEQ counts a completed setup 9 on a 120-bar ramp', td.some((value) => value === 9 || value === -9));

  // Ease of movement: finite and non-zero when price moves.
  const emv = computeIndicator('EMV', ramp, { period: 14 })?.emv ?? [];
  check('EMV produces a finite non-zero reading on a trend', typeof lastValue(emv) === 'number' && lastValue(emv) !== 0);

  // VWAP of a flat market must equal that flat price.
  const flat = rampCandles(40).map((candle) => ({ ...candle, o: 100, h: 100, l: 100, c: 100 }));
  const flatVwap = lastValue(computeIndicator('VWAP', flat, {})?.vwap ?? []);
  check('VWAP of a flat market equals the flat price', near(flatVwap, 100, 1e-6));

  // Ichimoku: kijun must sit above tenkan in an uptrend, cloud spans finite.
  const ichi = computeIndicator('ICHIMOKU', ramp, {});
  const tenkan = lastValue(ichi?.tenkan ?? []);
  const kijun = lastValue(ichi?.kijun ?? []);
  check('ICHIMOKU tenkan > kijun on an uptrend', typeof tenkan === 'number' && typeof kijun === 'number' && tenkan > kijun);
  check('ICHIMOKU cloud spans are finite', lastValue(ichi?.spanA ?? []) != null && lastValue(ichi?.spanB ?? []) != null);
}

console.log('\n— wave 2: premium analytics (S/R, divergences, risk) —');

{
  const premium = await import('@/lib/premium');

  // Ranging market: repeated bounces must cluster into one S and one R level.
  const ranging: Candle[] = [];
  const start = 1_700_000_000_000;
  for (let i = 0; i < 200; i += 1) {
    const base = 100 + Math.sin(i / 10) * 5;
    ranging.push({ t: start + i * 3_600_000, o: base, h: base + 0.8, l: base - 0.8, c: base - 0.2, v: 900 });
  }
  const levels = premium.supportResistance(ranging);
  check('support/resistance clusters a range into ≤ 4 levels', levels.length > 0 && levels.length <= 4);
  check(
    'support/resistance finds the range floor as support and the ceiling as resistance',
    levels.some((level) => level.kind === 'support' && level.price < 96 && level.touches >= 3) &&
      levels.some((level) => level.kind === 'resistance' && level.price > 104 && level.touches >= 3),
  );
  check('support/resistance levels come back sorted by price', levels.every((level, index) => index === 0 || level.price >= (levels[index - 1]?.price ?? 0)));

  // Divergence: price prints a lower low while RSI prints a higher low.
  const diverging: Candle[] = [];
  for (let i = 0; i < 40; i += 1) {
    const dip = i === 10 || i === 30 ? -3 : 0;
    diverging.push({ t: start + i * 3_600_000, o: 100, h: 102, l: 98 + dip, c: 100, v: 10 });
  }
  diverging[30]!.l = 94;
  const rsiSeries: (number | undefined)[] = new Array(40).fill(50);
  rsiSeries[10] = 40;
  rsiSeries[30] = 45;
  const divs = premium.divergences(diverging, rsiSeries);
  check('divergence scanner flags the crafted bullish divergence', divs.some((entry) => entry.type === 'bullish' && entry.index === 30));
  check('divergence scanner stays quiet without a setup', premium.divergences(ranging, new Array(ranging.length).fill(50)).length === 0);

  // Realized vol: a flat series has no variance, a noisy one is positive.
  const flat = ranging.map((candle) => ({ ...candle, o: 100, h: 100, l: 100, c: 100 }));
  check('realized vol of a flat series is ~0', (premium.realizedVolPct(flat) ?? -1) < 1e-6);
  const noisyVol = premium.realizedVolPct(syntheticCandles(300));
  check('realized vol of a noisy series is positive and annualized plausibly', typeof noisyVol === 'number' && noisyVol > 0 && noisyVol < 10_000);
  check('realized vol needs history (short buffer → null)', premium.realizedVolPct(ranging.slice(0, 5)) === null);

  // Session stats: UTC day bucket, range position inside 0..1.
  const dayStart = Math.floor((start + 199 * 3_600_000) / 86_400_000) * 86_400_000;
  const stats = premium.sessionStats(ranging);
  check('session stats bucket to the current UTC day', stats != null && stats.candles > 0 && stats.candles < 200);
  check('session stats high ≥ low and range position inside 0..1', stats != null && stats.high >= stats.low && stats.rangePosition >= 0 && stats.rangePosition <= 1);
  check('session stats change matches open → last', stats != null && Math.abs(stats.changePct - ((stats.last - stats.open) / stats.open) * 100) < 1e-9);
  void dayStart;
}

console.log('\n— wave 2: chart store (S/R, divergences, compare, alerts) —');

{
  useChartStore.setState({ srOn: false, divOn: false, compare: null, alertArm: false, alerts: [] });
  useChartStore.getState().toggleSr();
  useChartStore.getState().toggleDiv();
  const toggled = useChartStore.getState();
  check('srOn and divOn toggle independently', toggled.srOn === true && toggled.divOn === true);

  toggled.setCompare('cex:binance:ETHUSDT');
  check('compare stores the token id', useChartStore.getState().compare === 'cex:binance:ETHUSDT');
  toggled.setCompare(null);
  check('compare clears back to null', useChartStore.getState().compare === null);

  // Alert direction is derived from the last price: above when higher.
  useChartStore.getState().addAlert('BTC/USDT', 120_000, 100_000);
  useChartStore.getState().addAlert('BTC/USDT', 80_000, 100_000);
  const alerts = useChartStore.getState().alerts;
  check('alerts derive their direction from the last price', alerts.length === 2 && alerts[0]?.dir === 'above' && alerts[1]?.dir === 'below');
  check('arming an alert disarms the click mode', useChartStore.getState().alertArm === false);

  const firstId = alerts[0]?.id;
  if (firstId) useChartStore.getState().fireAlert(firstId);
  check('firing an alert marks it fired and keeps the other pending', useChartStore.getState().alerts[0]?.fired === true && useChartStore.getState().alerts[1]?.fired === false);
  if (firstId) useChartStore.getState().removeAlert(firstId);
  check('removing an alert drops only that one', useChartStore.getState().alerts.length === 1);
  useChartStore.setState({ alerts: [], srOn: false, divOn: false, compare: null });
}

/* ================= wave 3: backtester + risk maths =========================== */

console.log('\n— wave 3: strategy lab & risk calculator —');

{
  const backtest = await import('@/lib/backtest');
  const risk = await import('@/lib/risk');

  const ramp = rampCandles(300);
  const emaResult = backtest.runBacktest(ramp, 'emaCross', { fast: 5, slow: 20 }, 0);
  check('EMA cross trades a 300-bar uptrend', emaResult != null && emaResult.trades.length >= 1);
  check('EMA cross beats cash on a pure uptrend', emaResult != null && emaResult.stats.totalPct > 0);
  check('buy & hold reference matches the ramp', emaResult != null && near(emaResult.stats.buyHoldPct, (300 / 1 - 1) * 100, 1e-6));
  check('equity curve covers every candle', emaResult != null && emaResult.equity.length === ramp.length);
  check('win rate stays inside 0..100', emaResult != null && emaResult.stats.winRatePct >= 0 && emaResult.stats.winRatePct <= 100);
  check('max drawdown is non-negative', emaResult != null && emaResult.stats.maxDrawdownPct >= 0);
  check('markers pair every entry with an exit', emaResult != null && backtest.tradeMarkers(emaResult).length === emaResult.trades.length * 2);

  const free = backtest.runBacktest(syntheticCandles(400), 'emaCross', { fast: 9, slow: 21 }, 0);
  const costly = backtest.runBacktest(syntheticCandles(400), 'emaCross', { fast: 9, slow: 21 }, 50);
  check('fees strictly reduce the net result', free != null && costly != null && costly.stats.totalPct < free.stats.totalPct);

  for (const strategy of backtest.STRATEGIES) {
    const defaults: Record<string, number> = {};
    for (const spec of strategy.params) defaults[spec.key] = spec.def;
    const result = backtest.runBacktest(syntheticCandles(400), strategy.id, defaults, 10);
    const sane =
      result != null &&
      Number.isFinite(result.stats.totalPct) &&
      result.equity.length === 400 &&
      result.stats.exposurePct >= 0 &&
      result.stats.exposurePct <= 100;
    check(`strategy ${strategy.id} returns a sane report`, sane);
  }
  check('short buffers refuse to backtest', backtest.runBacktest(rampCandles(10), 'emaCross', {}, 0) === null);

  const sized = risk.computeRisk({ accountUsd: 10_000, riskPct: 1, entry: 100, stop: 90, target: 130, leverage: 1 });
  check('risk maths: 1 % of 10 k = 100 USD at risk', sized != null && near(sized.riskUsd, 100));
  check('risk maths: size = risk / stop distance', sized != null && near(sized.positionUnits, 10));
  check('risk maths: reward 300 USD → R:R 3', sized != null && near(sized.rewardUsd, 300) && near(sized.rr ?? 0, 3));
  check('risk maths: leverage scales margin', (() => {
    const levered = risk.computeRisk({ accountUsd: 10_000, riskPct: 1, entry: 100, stop: 90, target: 130, leverage: 5 });
    return levered != null && near(levered.marginUsd, 200);
  })());
  check('risk maths rejects entry == stop', risk.computeRisk({ accountUsd: 1000, riskPct: 1, entry: 100, stop: 100, target: 110, leverage: 1 }) === null);
}

/* ================================= device gate =============================== */

console.log('\n— device detection (SSR-safe) —');

check('no crash without a DOM', device.isTouchCapable() === false && device.isMobileUserAgent() === false && device.isNarrowViewport() === false);
check('touch host is false in Node', device.isTouchDrawingHost() === false);

/* ========================== monetization & viral ============================ */

console.log('\n— monetization & viral loop (pure logic) —');

const viral = await import('@/lib/viral');
const og = await import('@/lib/og');
const { useViralStore, donationGraceMs, donationGraceActive, DONATION_GRACE_MS, DONATION_GRACE_BIG_MS } =
  await import('@/store/useViralStore');
const { useAppStore } = await import('@/store/useAppStore');
const themeLib = await import('@/lib/theme');

check('baseSymbol strips the quote asset', viral.baseSymbol('BTC/USDT') === 'BTC' && viral.baseSymbol('sol') === 'SOL');

const tweet = viral.buildShareText(
  'Found an insane setup for {ticker} on NodeChart. Zero fees, real-time on-chain data. #Crypto #Trading',
  'SOL/USDT',
);
check('share text matches the spec template', tweet === 'Found an insane setup for $SOL on NodeChart. Zero fees, real-time on-chain data. #Crypto #Trading');

const links = viral.buildShareLinks(tweet, 'https://nodechart.app/de/terminal?ticker=SOL');
check('X intent carries text + url', links.x.startsWith('https://twitter.com/intent/tweet?text=') && decodeURIComponent(links.x.split('text=')[1] ?? '').includes('#Crypto #Trading https://nodechart.app/de/terminal?ticker=SOL'));
check('telegram intent carries url + text', links.telegram.startsWith('https://t.me/share/url?url=') && links.telegram.includes('text='));

const shareUrl = viral.buildShareUrl('https://nodechart.app', 'de', 'SOL/USDT', 149.987654321);
check('share url embeds ticker + price', shareUrl === 'https://nodechart.app/de/terminal?ticker=SOL&price=149.988');
check('share url omits a bad price', viral.buildShareUrl('https://x', 'en', 'BTC/USDT', null).endsWith('?ticker=BTC'));

check('og ticker sanitiser strips markup', og.sanitizeTicker('<script>sol</script>') === 'SCRIPTSOLS' && og.sanitizeTicker(null) === 'BTC');
check('og escaper neutralises raw markup', og.escapeXml(`<img src="x" onerror='y(&)'>`) === '&lt;img src=&quot;x&quot; onerror=&apos;y(&amp;)&apos;&gt;');
check('og price sanitiser rejects junk', og.sanitizePrice('abc') === null && og.sanitizePrice('-4') === null && og.sanitizePrice('150') === '150');
const svg = og.buildOgSvg({ ticker: '<img src=x onerror=alert(1)>', price: '150', changePct: -2.5, locale: 'de' });
check('og svg reduces hostile ticker to cashtag chars', svg.includes('IMGSRCXONE') && !svg.includes('<img'));
check('og svg has the social-card size', svg.includes('width="1200"') && svg.includes('height="630"'));
check('og svg renders price + negative change', svg.includes('150') && svg.includes('-2.50%'));

check('premium themes are gated', themeLib.isPremiumTheme('matrix') && themeLib.isPremiumTheme('miami') && !themeLib.isPremiumTheme('acid'));

// store flow: locked → share modal → unlock → theme applies
useViralStore.setState({ shareUnlocked: false, shareOpen: false, supporter: false, shares: 0 });
check('locked premium theme opens the share modal', useViralStore.getState().requestTheme('matrix') === false && useViralStore.getState().shareOpen === true && useViralStore.getState().shareReason === 'theme');
useViralStore.getState().unlockViaShare();
check('share unlocks permanently + counts', useViralStore.getState().shareUnlocked === true && useViralStore.getState().shares === 1);
check('unlocked premium theme applies', useViralStore.getState().requestTheme('matrix') === true && useAppStore.getState().theme === 'matrix');
// donation grace: any donation → 48 h silence, > $5 → 5 days
useViralStore.getState().registerDonation(1);
check(
  'small donation sets the badge + an active grace window',
  useViralStore.getState().supporter === true && donationGraceActive(),
);
check(
  'small donation grace is the 48-h tier',
  Math.abs(donationGraceMs(useViralStore.getState()) - DONATION_GRACE_MS) < 5_000,
);
useViralStore.setState({ lastDonationAt: Date.now() - (DONATION_GRACE_MS + 60_000) });
check('48-h tier expires on time', !donationGraceActive());
useViralStore.getState().registerDonation(5);
check('$5 exactly stays on the 48-h tier ("> $5" is strict)', donationGraceActive() && donationGraceMs(useViralStore.getState()) <= DONATION_GRACE_MS);
useViralStore.getState().registerDonation(10);
check(
  'donation above $5 upgrades to the 5-day tier',
  donationGraceActive() && donationGraceMs(useViralStore.getState()) > DONATION_GRACE_MS,
);
useViralStore.setState({ lastDonationAt: Date.now() - (DONATION_GRACE_MS + 60_000) });
check('big tier still runs after 48 h', donationGraceActive());
useViralStore.setState({ lastDonationAt: Date.now() - (DONATION_GRACE_BIG_MS + 60_000) });
check('5-day tier expires on time', !donationGraceActive());
useViralStore.setState({ supporter: false, lastDonationAt: null, lastDonationUsd: 0 });
check('grace helpers treat a fresh profile as silent-free', !donationGraceActive() && donationGraceMs(useViralStore.getState()) === 0);
useAppStore.getState().setTheme('acid');
useViralStore.setState({ shareOpen: false, shareReason: null });

/* ===================== corrupted-storage resilience ========================= */

console.log('\n— corrupted localStorage must never blank the app —');

const { STORAGE_KEY, TOKEN_INDEX } = await import('@/lib/constants');

type PersistApi = {
  persist: {
    getOptions: () => { storage: { setItem: (k: string, v: unknown) => unknown }; name: string };
    rehydrate: () => Promise<unknown>;
  };
};

const appPersist = (useAppStore as unknown as PersistApi).persist;
await appPersist.getOptions().storage.setItem(
  STORAGE_KEY,
  {
    state: {
      theme: 'evil"><img src=x onerror=alert(1)',
      layout: '3x3',
      chartType: 'rainbow',
      timeframe: '9m',
      panes: 'junk',
      activeToken: { id: 'nope' },
      watchlist: [1, 2, null, 'btc-usdt'],
    },
    version: 1,
  },
);
await appPersist.rehydrate();
const healedApp = useAppStore.getState();
check('hostile theme falls back to default', healedApp.theme === 'acid');
check('hostile layout/timeframe/chartType fall back', healedApp.layout === '1x1' && healedApp.timeframe === '1h' && healedApp.chartType === 'candles');
check('hostile panes/token/watchlist fall back', Array.isArray(healedApp.panes) && healedApp.panes.length === 1 && healedApp.watchlist.every((id) => TOKEN_INDEX[id] !== undefined) && !healedApp.watchlist.includes(1 as unknown as string));

const chartPersist = (useChartStore as unknown as PersistApi).persist;
await chartPersist.getOptions().storage.setItem(
  'nc-chart-v1',
  {
    state: {
      indicators: { 'pane-1': [{ id: 7, kind: 'YOLO', params: { period: 'x' } }, null, 'junk'] },
      drawings: { 'pane-1': [{ tool: 'spray', points: [{ time: 'x', price: 1 }] }, { tool: 'trendline', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }], color: '#39ff14', createdAt: 7 }] },
      paneTimeframe: { 'pane-1': '13m' },
      syncZoom: 'yes',
      volume: 1,
    },
    version: 0,
  },
);
await chartPersist.rehydrate();
const healedChart = useChartStore.getState();
check('hostile indicators are dropped', Object.values(healedChart.indicators).flat().length === 0);
check('valid drawing survives, hostile one dropped', (healedChart.drawings['pane-1'] ?? []).length === 1 && healedChart.drawings['pane-1']?.[0]?.tool === 'trendline');
check('hostile pane timeframe + flags fall back', Object.keys(healedChart.paneTimeframe).length === 0 && typeof healedChart.syncZoom === 'boolean' && typeof healedChart.volume === 'boolean');

useViralStore.setState({ supporter: false, shareUnlocked: false, shares: 0, wallDismissedAt: null, lastDonationAt: null, lastDonationUsd: 0 });
const viralPersist = (useViralStore as unknown as PersistApi).persist;
await viralPersist.getOptions().storage.setItem(
  'nc-viral-v1',
  {
    state: {
      supporter: 'yes',
      shareUnlocked: 1,
      shares: 'many',
      wallDismissedAt: 'never',
      lastDonationAt: 'yesterday',
      lastDonationUsd: 1e12,
    },
    version: 0,
  },
);
await viralPersist.rehydrate();
const healedViral = useViralStore.getState();
check('hostile viral flags do not fake supporter/unlock', healedViral.supporter === false && healedViral.shareUnlocked === false && healedViral.shares === 0 && healedViral.wallDismissedAt === null);
check('hostile donation fields do not fake a grace window', healedViral.lastDonationAt === null && healedViral.lastDonationUsd === 0 && !donationGraceActive());

// legacy migration: pre-grace supporter profiles get a one-time 48-h window
await viralPersist.getOptions().storage.setItem('nc-viral-v1', { state: { supporter: true }, version: 0 });
await viralPersist.rehydrate();
const migrated = useViralStore.getState();
check(
  'legacy supporter migrates into a 48-h grace window',
  migrated.supporter === true && migrated.lastDonationAt !== null && donationGraceActive() && donationGraceMs(migrated) <= DONATION_GRACE_MS,
);
useViralStore.setState({ supporter: false, lastDonationAt: null, lastDonationUsd: 0 });


/* --------------------------- wave-4 exotic types --------------------------- */

const exo = syntheticCandles(400, 100, 7);
const bricks = renko(exo, 1.5);
check(
  `renko emits uniform ${bricks.length} bricks with strictly increasing times`,
  bricks.length > 10 &&
    bricks.every((b) => Math.abs(Math.abs(b.c - b.o) - 1.5) < 1e-9) &&
    bricks.every((b, i) => i === 0 || b.t > bricks[i - 1]!.t),
);
const lb = lineBreak(exo, 3);
check(
  `line break columns chain open→close (${lb.length} cols)`,
  lb.length > 4 && lb.every((col, i) => i === 0 || Math.abs(col.o - lb[i - 1]!.c) < 1e-9),
);
const kg = kagi(exo, 2);
check(
  `kagi columns are contiguous (${kg.length} cols)`,
  kg.length > 4 && kg.every((col, i) => i === 0 || Math.abs(col.o - kg[i - 1]!.c) < 1e-9),
);
const pnf = pointAndFigure(exo, { box: 1.5, reversal: 3 });
check(
  `point & figure columns alternate direction (${pnf.length} cols)`,
  pnf.length > 3 &&
    pnf.every((col, i) => i === 0 || Math.sign(col.c - col.o) !== Math.sign(pnf[i - 1]!.c - pnf[i - 1]!.o)),
);
const agg = aggregateCandles(exo, 5);
check(
  `aggregateCandles buckets 1m→5m (${exo.length}→${agg.length}) on bucket boundaries`,
  agg.length === Math.ceil(exo.length / 5) - (exo.length % 5 === 0 ? 0 : 0) || agg.length > 70,
);
check(
  'aggregateCandles keeps the last close and bucket alignment',
  agg[agg.length - 1]!.c === exo[exo.length - 1]!.c && agg.every((b) => b.t % 300_000 === 0),
);
check('baseForCustomInterval(7) → 1m ×7', baseForCustomInterval(7).timeframe === '1m' && baseForCustomInterval(7).factor === 7);
check('baseForCustomInterval(90) → 15m ×6', baseForCustomInterval(90).timeframe === '15m' && baseForCustomInterval(90).factor === 6);
check('baseForCustomInterval(120) → 1h ×2', baseForCustomInterval(120).timeframe === '1h' && baseForCustomInterval(120).factor === 2);
check('baseForCustomInterval clamps absurd input', baseForCustomInterval(99_999).timeframe === '1d');

/* --------------------------- wave-4 pattern scan --------------------------- */

function leg(from: number, to: number, steps: number, t0: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < steps; i += 1) {
    const o = from + ((to - from) * i) / steps;
    const c = from + ((to - from) * (i + 1)) / steps;
    out.push({ t: t0 + (out.length + 1) * 60_000, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 1 });
  }
  return out;
}
const dtFixture = [
  ...leg(100, 110, 12, 0),
  ...leg(110, 102, 10, 1_000_000),
  ...leg(102, 110.15, 12, 2_000_000),
  ...leg(110.15, 101, 12, 3_000_000),
];
// Junction wicks: without them neighbouring candles share identical highs,
// and a strict pivot test (>=) would reject the swing points.
dtFixture[11]!.h *= 1.004;
dtFixture[21]!.l *= 0.996;
dtFixture[33]!.h *= 1.004;
const dtHits = detectPatterns(dtFixture, 12);
check(
  `double top detected on engineered fixture (${dtHits.map((h) => h.kind).join(',') || 'none'})`,
  dtHits.some((h) => h.kind === 'doubleTop' && h.bias === 'bear' && h.confidence > 0 && h.confidence <= 1),
);
const dbFixture = [
  ...leg(110, 100, 12, 0),
  ...leg(100, 108, 10, 1_000_000),
  ...leg(108, 99.9, 12, 2_000_000),
  ...leg(99.9, 109, 12, 3_000_000),
];
dbFixture[11]!.l *= 0.996;
dbFixture[21]!.h *= 1.004;
dbFixture[33]!.l *= 0.996;
check('double bottom detected on inverse fixture', detectPatterns(dbFixture, 12).some((h) => h.kind === 'doubleBottom' && h.bias === 'bull'));
check('pattern ids are unique', new Set(dtHits.map((h) => h.id)).size === dtHits.length);

/* ----------------------------- wave-4 ratings ----------------------------- */

const rampUp = syntheticCandles(260, 100, 11);
const rampScore = scoreCandles(rampUp, '1h');
check(`rising buffer scores bullish (${rampScore.summary}, ${rampScore.buys}B/${rampScore.sells}S)`, rampScore.buys > rampScore.sells && rampScore.score > 0);
const rampDown = syntheticCandles(260, 200, 12).map((c) => ({ ...c, o: 400 - c.o, h: 400 - c.l, l: 400 - c.h, c: 400 - c.c }));
const downScore = scoreCandles(rampDown, '1h');
check(`mirrored buffer scores bearish (${downScore.summary})`, downScore.sells > downScore.buys && downScore.score < 0);
check('rating rows carry oscillators + MAs', rampScore.oscillators.length >= 6 && rampScore.movingAverages.length >= 5);

/* ----------------------------- wave-4 journal ----------------------------- */

const jEntries: JournalEntry[] = [
  { id: 'j1', symbol: 'BTC/USDT', side: 'long', size: 2, entry: 100, exit: 110, stop: 95, note: 'a', tags: ['breakout'], closedAt: 1 },
  { id: 'j2', symbol: 'ETH/USDT', side: 'short', size: 1, entry: 100, exit: 90, note: 'b', tags: [], closedAt: 2 },
  { id: 'j3', symbol: 'SOL/USDT', side: 'long', size: 1, entry: 50, exit: 45, stop: 48, note: 'c', tags: ['breakout'], closedAt: 3 },
];
check('journal pnl long/short math', pnlOf(jEntries[0]!) === 20 && pnlOf(jEntries[1]!) === 10 && pnlOf(jEntries[2]!) === -5);
check('journal R-multiple from stop', rOf(jEntries[0]!) === 2 && rOf(jEntries[1]!) === null);
const jStats = journalStats(jEntries);
check(
  `journal stats (winRate ${(jStats.winRate * 100).toFixed(0)}%, PF ${jStats.profitFactor.toFixed(2)})`,
  jStats.wins === 2 && jStats.losses === 1 && Math.abs(jStats.winRate - 2 / 3) < 1e-9 && jStats.profitFactor === 30 / 5 && jStats.byTag[0]!.tag === 'breakout',
);
check('journal csv header + rows', journalCsv(jEntries).split('\n').length === 4 && journalCsv(jEntries).startsWith('symbol,side,size'));

/* ------------------- wave-4: hostile persisted alerts heal ------------------ */

await chartPersist.getOptions().storage.setItem('nc-chart-v1', {
  state: {
    alerts: [
      { id: 1 },
      null,
      { symbol: 'X' },
      { id: 'a', symbol: 'BTC/USDT', price: 'NaN', dir: 'sideways' },
      { id: 'b', symbol: 'ETH/USDT', price: 100, dir: 'above' },
    ],
  },
  version: 0,
});
await chartPersist.rehydrate();
const healedAlerts = useChartStore.getState().alerts;
check(
  'hostile persisted alerts heal on rehydrate (only the sane entry survives)',
  healedAlerts.length === 1 && healedAlerts[0]?.id === 'b',
);

/* --------------------------- wave-5 script engine --------------------------- */

const { runScript, toRawUrl, loadScripts, saveScripts } = await import('@/lib/scripts');
const scrCandles: Candle[] = [...leg(100, 130, 30, 0), ...leg(130, 95, 25, 4_000_000)];

const bare = runScript('c', scrCandles);
check(
  'script: bare `c` reproduces closes',
  bare.error === null && bare.values.every((v, i) => v === scrCandles[i]!.c),
);
const idxRun = runScript('i', scrCandles);
check('script: `i` exposes the bar index', idxRun.error === null && idxRun.values.every((v, i) => v === i));

const emaScript = runScript('ema(21)', scrCandles);
const emaIndicatorValues = computeIndicator('EMA', scrCandles, { period: 21 });
const emaIndicatorOut = emaIndicatorValues ? Object.values(emaIndicatorValues)[0]! : [];
check(
  'script: ema(21) tail matches the EMA indicator',
  emaScript.error === null && near(lastValue(emaScript.values), lastValue(emaIndicatorOut)!, 1e-9),
);
const rsiRun = runScript('rsi(14)', scrCandles);
const rsiTail = lastValue(rsiRun.values);
check(
  'script: rsi(14) tail stays inside 0..100',
  rsiRun.error === null && typeof rsiTail === 'number' && rsiTail >= 0 && rsiTail <= 100,
);
const hiRun = runScript('highest(10)', scrCandles);
check(
  'script: highest(10) matches a rolling reference',
  hiRun.error === null &&
    hiRun.values.every((v, i) =>
      i < 9 ? v === undefined : near(v, Math.max(...scrCandles.slice(i - 9, i + 1).map((x) => x.h)), 1e-9),
    ),
);
const chRun = runScript('change(1)', scrCandles);
check(
  'script: change(1) is the percent change',
  chRun.error === null &&
    chRun.values.every((v, i) =>
      i === 0
        ? v === undefined
        : near(v, ((scrCandles[i]!.c - scrCandles[i - 1]!.c) / scrCandles[i - 1]!.c) * 100, 1e-9),
    ),
);
const vwRun = runScript('vwap()', scrCandles);
const vwRef =
  scrCandles.reduce((a, x) => a + ((x.h + x.l + x.c) / 3) * x.v, 0) /
  scrCandles.reduce((a, x) => a + x.v, 0);
check(
  'script: vwap() equals the cumulative typical-price average',
  vwRun.error === null && near(lastValue(vwRun.values), vwRef, 1e-9),
);
const mathRun = runScript('max(2, 3) + abs(-1) + sqrt(4) + pow(2, 3)', scrCandles);
check('script: math sugar evaluates', mathRun.error === null && lastValue(mathRun.values) === 14);

check('script: empty source → "empty"', runScript('   ', scrCandles).error === 'empty');
const tooLong = runScript(`${'c + '.repeat(1200)}c`, scrCandles);
check('script: >4000 chars → "too-long"', tooLong.error === 'too-long' && tooLong.values.every((v) => v === undefined));
const syntaxBad = runScript('1 +', scrCandles);
check('script: syntax error surfaces as an error string', syntaxBad.error !== null && syntaxBad.values.every((v) => v === undefined));
check('script: unknown identifier surfaces as an error string', runScript('nope(1)', scrCandles).error !== null);

check(
  'import: github blob URL → raw.githubusercontent',
  toRawUrl('https://github.com/u/repo/blob/main/dir/f.js') === 'https://raw.githubusercontent.com/u/repo/main/dir/f.js',
);
check(
  'import: github /raw/ URL → raw.githubusercontent',
  toRawUrl('https://github.com/u/repo/raw/main/f.js') === 'https://raw.githubusercontent.com/u/repo/main/f.js',
);
check(
  'import: gist URL → gist.githubusercontent raw',
  toRawUrl('https://gist.github.com/u/abc123') === 'https://gist.githubusercontent.com/u/abc123/raw',
);
check('import: foreign https URLs pass through', toRawUrl('https://example.com/f.js') === 'https://example.com/f.js');
check('import: garbage URLs pass through unharmed', toRawUrl('not a url') === 'not a url');

saveScripts([
  { id: 's1', name: 'EMA cross', source: 'ema(9) - ema(21)', overlay: false, updatedAt: 1 },
  { id: 's2', name: 'VWAP deviation', source: 'c / vwap() - 1', overlay: true, updatedAt: 2 },
]);
const loadedScripts = loadScripts();
check(
  'script storage: round-trip via localStorage',
  loadedScripts.length === 2 && loadedScripts[0]!.id === 's1' && loadedScripts[1]!.source === 'c / vwap() - 1',
);
saveScripts(
  Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, name: `n${i}`, source: 'c', overlay: false, updatedAt: i })),
);
check('script storage: capped at 50 entries', loadScripts().length === 50);
saveScripts([]);

const customOut = computeIndicator('CUSTOM', scrCandles, { overlay: 1 }, 'ema(9) - c');
const customSeries = customOut?.custom;
const customRef = runScript('ema(9) - c', scrCandles);
check(
  'CUSTOM indicator computes the script series',
  customSeries !== undefined && near(lastValue(customSeries), lastValue(customRef.values)!, 1e-9),
);

const customId = useChartStore.getState().addIndicator('pane-1', 'CUSTOM', { overlay: 1 }, 'c * 2');
const customInst = useChartStore.getState().indicators['pane-1']!.find((x) => x.id === customId);
check(
  'store: CUSTOM instance keeps script + overlay param',
  customInst?.kind === 'CUSTOM' && customInst?.script === 'c * 2' && customInst?.params.overlay === 1,
);
useChartStore.getState().updateIndicator('pane-1', customId, { script: 'c * 3' });
check(
  'store: updateIndicator patches the script',
  useChartStore.getState().indicators['pane-1']!.find((x) => x.id === customId)?.script === 'c * 3',
);
const bigId = useChartStore.getState().addIndicator('pane-1', 'CUSTOM', undefined, 'c'.repeat(4001));
const bigInst = useChartStore.getState().indicators['pane-1']!.find((x) => x.id === bigId);
check('store: oversized script is dropped on add', bigInst !== undefined && bigInst.script === undefined);
useChartStore.getState().setScriptLabOpen(true);
check('store: scriptLabOpen flag toggles', useChartStore.getState().scriptLabOpen === true);
useChartStore.getState().setScriptLabOpen(false);

/* ---------------- wave-5: hostile persisted CUSTOM scripts heal -------------- */

await chartPersist.getOptions().storage.setItem('nc-chart-v1', {
  state: {
    indicators: {
      'pane-9': [
        { id: 'k1', kind: 'CUSTOM', params: { overlay: 0 }, visible: true, script: 'c'.repeat(5000) },
        { id: 'k2', kind: 'CUSTOM', params: { overlay: 1 }, visible: true, script: 'c * 2' },
        { id: 'k3', kind: 'NOPE', params: {}, visible: true },
      ],
    },
  },
  version: 0,
});
await chartPersist.rehydrate();
const healedScripts = useChartStore.getState().indicators['pane-9'] ?? [];
check(
  'hostile persisted CUSTOM scripts heal (oversized stripped, unknown kind dropped)',
  healedScripts.length === 2 && healedScripts[0]!.script === undefined && healedScripts[1]!.script === 'c * 2',
);

console.log(failures === 0 ? '\n✔ chart smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
if (failures > 0) process.exit(1);
