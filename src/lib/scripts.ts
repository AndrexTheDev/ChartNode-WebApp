/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Wave-5 Script Lab – write your own indicator scripts or import them
 * (e.g. from GitHub raw / gists). Everything executes locally in the
 * browser; nothing is uploaded, nothing is paywalled.
 *
 * A script is a single expression evaluated once per bar, Pine-style:
 *
 *   ema(21) - ema(55)          // scalar helpers read the current bar
 *   rsi(14)                    // 0..100 oscillator
 *   c / vwap() - 1             // raw bar fields: o h l c v
 *   (highest(20) - c) / atr(14)
 *
 * Helper series are memoised per run, so a script stays O(n · series).
 */
import type { Candle } from '@/websockets/types';
import { EMA, SMA, RSI, ATR, Stochastic } from 'technicalindicators';

export interface StoredScript {
  id: string;
  name: string;
  source: string;
  overlay: boolean;
  updatedAt: number;
}

const KEY = 'nc-scripts-v1';

export function loadScripts(): StoredScript[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as StoredScript[]).filter(
          (entry) => entry && typeof entry.id === 'string' && typeof entry.source === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

export function saveScripts(scripts: StoredScript[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(scripts.slice(0, 50)));
  } catch {
    /* private mode – scripts stay in memory */
  }
}

/* ------------------------------- vector math ------------------------------ */

type Series = (number | undefined)[];

function rightAlign(values: (number | undefined)[], length: number): Series {
  const out: Series = new Array<number | undefined>(length).fill(undefined);
  const defined = values.filter((v): v is number => v != null && Number.isFinite(v));
  const offset = length - defined.length;
  defined.forEach((value, i) => {
    out[offset + i] = value;
  });
  return out;
}

const closes = (candles: Candle[]) => candles.map((c) => c.c);

function emaSeries(candles: Candle[], period: number): Series {
  if (candles.length < period) return new Array(candles.length).fill(undefined);
  return rightAlign(EMA.calculate({ period, values: closes(candles) }), candles.length);
}
function smaSeries(candles: Candle[], period: number): Series {
  if (candles.length < period) return new Array(candles.length).fill(undefined);
  return rightAlign(SMA.calculate({ period, values: closes(candles) }), candles.length);
}
function rsiSeries(candles: Candle[], period: number): Series {
  if (candles.length < period + 1) return new Array(candles.length).fill(undefined);
  return rightAlign(RSI.calculate({ period, values: closes(candles) }), candles.length);
}
function atrSeries(candles: Candle[], period: number): Series {
  if (candles.length < period + 1) return new Array(candles.length).fill(undefined);
  return rightAlign(
    ATR.calculate({
      period,
      high: candles.map((c) => c.h),
      low: candles.map((c) => c.l),
      close: closes(candles),
    }),
    candles.length,
  );
}
function stochSeries(candles: Candle[], period: number): Series {
  if (candles.length < period) return new Array(candles.length).fill(undefined);
  const result = Stochastic.calculate({
    period,
    signalPeriod: 3,
    high: candles.map((c) => c.h),
    low: candles.map((c) => c.l),
    close: closes(candles),
  });
  return rightAlign(result.map((r) => r.k), candles.length);
}
function vwapSeries(candles: Candle[]): Series {
  const out: Series = [];
  let cumPV = 0;
  let cumV = 0;
  for (const candle of candles) {
    const typical = (candle.h + candle.l + candle.c) / 3;
    cumPV += typical * candle.v;
    cumV += candle.v;
    out.push(cumV > 0 ? cumPV / cumV : undefined);
  }
  return out;
}
function rolling(candles: Candle[], period: number, pick: (slice: Candle[]) => number): Series {
  const out: Series = [];
  for (let i = 0; i < candles.length; i += 1) {
    if (i + 1 < period) {
      out.push(undefined);
      continue;
    }
    out.push(pick(candles.slice(i + 1 - period, i + 1)));
  }
  return out;
}

/* --------------------------------- the run -------------------------------- */

export interface ScriptRunResult {
  values: Series;
  error: string | null;
}

const compileCache = new Map<string, (i: number, api: Record<string, unknown>) => number>();

/*
 * Globals that a script expression must not reach. They are passed as
 * *parameters* holding `undefined`, which shadows the same-named globals
 * inside the function scope – the cheapest sandbox layer available without
 * allocating a separate realm.
 *
 * Trust model (by design, wave-5 doctrine): scripts run in the trader's OWN
 * browser, same level as pasting an expression into the devtools console –
 * self-inflicted by choice, including imported community scripts. What this
 * shadowing prevents is ACCIDENTAL reach into DOM/network/storage from a
 * plain indicator expression, and it keeps typos like `close` vs `closed`
 * from resolving to `window.close`. It is defense in depth, not a hard
 * boundary: determined code can still escape (e.g. via indirect eval), so
 * the import dialog keeps its explicit warning.
 */
const SHADOWED_GLOBALS = [
  'window',
  'document',
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
  'location',
  'history',
  'navigator',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'cookieStore',
  'importScripts',
  'Worker',
  'SharedWorker',
  'ServiceWorker',
  'Function',
] as const;

function compile(source: string): (i: number, api: Record<string, unknown>) => number {
  const hit = compileCache.get(source);
  if (hit) return hit;
  // The expression runs in the trader's own browser only – same trust level
  // as a browser console. The api object is the only intended scope; the
  // shadow parameters above keep platform globals out of reach by accident.
  const fn = new Function(
    'i',
    'api',
    ...SHADOWED_GLOBALS,
    // NOTE: deliberately sloppy mode – `with` is forbidden in strict mode and
    // the api-scope is the whole point of this engine.
    `with (api) { return (${source}); }`,
  ) as (i: number, api: Record<string, unknown>) => number;
  compileCache.set(source, fn);
  return fn;
}

/** Evaluate a script over candles; errors are returned, never thrown. */
export function runScript(source: string, candles: Candle[]): ScriptRunResult {
  const n = candles.length;
  const empty: Series = new Array(n).fill(undefined);
  if (!source.trim()) return { values: empty, error: 'empty' };
  if (source.length > 4000) return { values: empty, error: 'too-long' };
  let fn: (i: number, api: Record<string, unknown>) => number;
  try {
    fn = compile(source);
  } catch (err) {
    return { values: empty, error: err instanceof Error ? err.message : 'compile' };
  }

  const memo = new Map<string, Series>();
  const series = (key: string, build: () => Series): Series => {
    const hit = memo.get(key);
    if (hit) return hit;
    const built = build();
    memo.set(key, built);
    return built;
  };
  const at = (s: Series, i: number) => s[i];

  const iRef = { value: 0 };
  const api: Record<string, unknown> = {
    // raw bar fields at i
    get o() {
      return candles[iRef.value]?.o;
    },
    get h() {
      return candles[iRef.value]?.h;
    },
    get l() {
      return candles[iRef.value]?.l;
    },
    get c() {
      return candles[iRef.value]?.c;
    },
    get v() {
      return candles[iRef.value]?.v;
    },
    // memoised indicator helpers (value at the current bar)
    ema: (period: number) => at(series(`ema${period}`, () => emaSeries(candles, period)), iRef.value),
    sma: (period: number) => at(series(`sma${period}`, () => smaSeries(candles, period)), iRef.value),
    rsi: (period: number) => at(series(`rsi${period}`, () => rsiSeries(candles, period)), iRef.value),
    atr: (period: number) => at(series(`atr${period}`, () => atrSeries(candles, period)), iRef.value),
    stoch: (period: number) => at(series(`stoch${period}`, () => stochSeries(candles, period)), iRef.value),
    vwap: () => at(series('vwap', () => vwapSeries(candles)), iRef.value),
    highest: (period: number) =>
      at(
        series(`hi${period}`, () => rolling(candles, period, (slice) => Math.max(...slice.map((c) => c.h)))),
        iRef.value,
      ),
    lowest: (period: number) =>
      at(
        series(`lo${period}`, () => rolling(candles, period, (slice) => Math.min(...slice.map((c) => c.l)))),
        iRef.value,
      ),
    change: (period: number) => {
      const i = iRef.value;
      const prev = candles[i - period]?.c;
      const cur = candles[i]?.c;
      return prev != null && cur != null && prev !== 0 ? ((cur - prev) / prev) * 100 : undefined;
    },
    // math sugar
    abs: Math.abs,
    max: Math.max,
    min: Math.min,
    sqrt: Math.sqrt,
    log: Math.log,
    pow: Math.pow,
  };
  const values: Series = new Array(n).fill(undefined);
  try {
    for (let i = 0; i < n; i += 1) {
      iRef.value = i;
      const value = fn(i, api);
      values[i] = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
  } catch (err) {
    return { values: empty, error: err instanceof Error ? err.message : 'runtime' };
  }
  return { values, error: null };
}

/* --------------------------------- import --------------------------------- */

/** github.com blob/page URLs → raw.githubusercontent.com (CORS-open). */
export function toRawUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'github.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      // /:user/:repo/blob/:ref/:path…
      if (parts.length >= 5 && parts[2] === 'blob') {
        return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`;
      }
      if (parts.length >= 4 && parts[2] === 'raw') {
        return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`;
      }
    }
    if (parsed.hostname === 'gist.github.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw`;
    }
    return url;
  } catch {
    return url;
  }
}

export async function importScriptSource(url: string): Promise<string> {
  const target = toRawUrl(url.trim());
  if (!/^https:\/\//i.test(target)) throw new Error('https-only');
  const response = await fetch(target);
  if (!response.ok) throw new Error(`http-${response.status}`);
  const text = await response.text();
  if (text.length > 20_000) throw new Error('too-large');
  return text.trim();
}
