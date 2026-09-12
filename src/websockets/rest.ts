// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import type { Timeframe } from '@/store/types';
import { fetchJson, isBlockedStatus, HttpError } from '@/api/http';
import type { Candle, ExchangeId, FeedKey } from './types';
import { FeedBlockedError } from './types';
import { BINANCE_INTERVAL } from './adapters/binance';
import { BYBIT_INTERVAL } from './adapters/bybit';
import { OKX_BAR, toOkxSymbol } from './adapters/okx';
import { KRAKEN_INTERVAL, krakenRestPair } from './adapters/kraken';
import { COINBASE_GRANULARITY } from './adapters/coinbase';
import { GATE_INTERVAL } from './adapters/gate';
import { BITFINEX_INTERVAL } from './adapters/bitfinex';
import { HTX_PERIOD } from './adapters/htx';
import { COINEX_KLINE_TYPE } from './adapters/coinex';
import { joinSymbol, num, pairWith, toBitfinexSymbol, toHtxRestSymbol } from './adapters/shared';

const SEED_LIMIT = 300;

/** The exchange does not list this pair (404 / empty result / "unknown pair"). */
export class UnsupportedPairError extends Error {
  constructor(
    readonly exchange: ExchangeId,
    readonly symbol: string,
  ) {
    super(`${exchange} does not list ${symbol}`);
    this.name = 'UnsupportedPairError';
  }
}

/** REST granularities differ from the WebSocket channel names on some venues. */
const BITGET_REST_GRANULARITY: Record<Timeframe, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1hour',
  '4h': '4hour',
  '1d': '1day',
  '1w': '1week',
};

const KUCOIN_REST_TYPE: Record<Timeframe, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1hour',
  '4h': '4hour',
  '1d': '1day',
  '1w': '1week',
};

/**
 * Seed URL per exchange. Exported so the region probe can measure reachability
 * with the exact request the chart will make.
 *
 * `null` ⇒ no REST history (Crypto.com seeds from its subscribe snapshot).
 */
export function seedUrl(key: FeedKey): string | null {
  const limit = SEED_LIMIT;
  switch (key.exchange) {
    case 'binance':
      // Public market-data mirror – works in regions where api.binance.com is 451.
      return `https://data-api.binance.vision/api/v3/klines?symbol=${joinSymbol(key.symbol)}&interval=${BINANCE_INTERVAL[key.timeframe]}&limit=${limit}`;
    case 'bybit':
      return `https://api.bybit.com/v5/market/kline?category=spot&symbol=${joinSymbol(key.symbol)}&interval=${BYBIT_INTERVAL[key.timeframe]}&limit=${limit}`;
    case 'okx':
      return `https://www.okx.com/api/v5/market/candles?instId=${toOkxSymbol(key.symbol)}&bar=${OKX_BAR[key.timeframe]}&limit=${limit}`;
    case 'kraken':
      return `https://api.kraken.com/0/public/OHLC?pair=${krakenRestPair(key.symbol)}&interval=${KRAKEN_INTERVAL[key.timeframe]}`;
    case 'coinbase': {
      const granularity = COINBASE_GRANULARITY[key.timeframe];
      return granularity
        ? `https://api.exchange.coinbase.com/products/${pairWith(key.symbol, '-')}/candles?granularity=${granularity}`
        : null;
    }
    case 'gate':
      return `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pairWith(key.symbol, '_')}&interval=${GATE_INTERVAL[key.timeframe]}&limit=${limit}`;
    case 'bitfinex': {
      const interval = BITFINEX_INTERVAL[key.timeframe];
      return interval
        ? `https://api-pub.bitfinex.com/v2/candles/trade:${interval}:${toBitfinexSymbol(key.symbol)}/hist?limit=${limit}`
        : null;
    }
    case 'cryptocom':
      return null; // subscribe response carries the history
    case 'htx':
      return `https://api.huobi.pro/market/history/kline?symbol=${toHtxRestSymbol(key.symbol)}&period=${HTX_PERIOD[key.timeframe]}&size=${limit}`;
    case 'bitget':
      return `https://api.bitget.com/api/v2/spot/market/candles?symbol=${joinSymbol(key.symbol)}&granularity=${BITGET_REST_GRANULARITY[key.timeframe]}&limit=${limit}`;
    case 'kucoin':
      return `https://api.kucoin.com/api/v1/market/candles?type=${KUCOIN_REST_TYPE[key.timeframe]}&symbol=${pairWith(key.symbol, '-')}`;
    case 'coinex':
      return `https://api.coinex.com/v1/market/kline?market=${joinSymbol(key.symbol)}&type=${COINEX_KLINE_TYPE[key.timeframe]}&limit=${limit}`;
  }
}

/**
 * Initial candle history per exchange, fetched once per feed before/while the
 * WebSocket takes over. Goes through the shared 429-aware fetch layer.
 *
 * Row layouts and ordering differ wildly between venues (Binance
 * `[t,o,h,l,c,v]` ascending, Coinbase `[t,low,high,open,close,v]` descending,
 * KuCoin/CoinEx `[t,open,close,high,low,v]`, …) – everything is normalised to
 * ascending open-time here, so `finalise()` sorts instead of trusting docs.
 */
export async function fetchSeed(key: FeedKey): Promise<Candle[]> {
  const url = seedUrl(key);
  if (!url) return [];

  switch (key.exchange) {
    case 'binance':
    case 'bybit':
    case 'okx':
    case 'gate':
    case 'bitget':
      return finalise(key, await rowsOf(key, url, rowPicker(key.exchange)));
    case 'kraken':
      return finalise(key, await krakenRows(key, url));
    case 'coinbase':
      return finalise(key, await coinbaseRows(key, url));
    case 'bitfinex':
      return finalise(key, await bitfinexRows(key, url));
    case 'htx':
      return finalise(key, await htxRows(key, url));
    case 'kucoin':
    case 'coinex':
      return finalise(key, await wrappedRows(key, url, 'data'));
    case 'cryptocom':
      return [];
  }
}

/**
 * Venues whose history endpoints send CORS headers. In Node this list is
 * irrelevant (no CORS), but in a **browser** `fetch` to bybit / kucoin /
 * coinex / bitfinex is rejected outright – such a venue can still stream over
 * WebSocket while its REST API stays invisible to the page. The manager uses
 * this list to seed history from a browser-reachable neighbour venue.
 */
export const CORS_FRIENDLY_SEEDS: ExchangeId[] = ['binance', 'okx', 'kraken', 'gate', 'bitget', 'htx'];

/**
 * Venues whose REST endpoints answer **without** `Access-Control-Allow-Origin`
 * (live-verified per curl am 2026-09-12: bybit, kucoin, bitfinex, coinex).
 * Ein Browser-Fetch dagegen scheitert immer und erzeugt einen nicht
 * unterdrückbaren Konsolen-Eintrag – deshalb überspringt der Browser hier den
 * REST-Versuch komplett (Probe → Socket-Handshake, Seed → Nachbar-Venue,
 * Ratings → Gate-Fallback). In Node (Smoke-Tests) gilt die Liste nicht:
 * ohne CORS existiert das Problem dort nicht.
 */
const CORS_BLIND: ReadonlySet<ExchangeId> = new Set(['bybit', 'kucoin', 'bitfinex', 'coinex']);

/** Darf der aktuelle Kontext REST für diese Venue überhaupt versuchen? */
export function restReachableFromBrowser(exchange: ExchangeId): boolean {
  return typeof window === 'undefined' || !CORS_BLIND.has(exchange);
}

/* ------------------------------ row extraction ----------------------------- */

type RowPicker = (row: unknown[]) => Candle | null;

/** `[tsMs, open, high, low, close, volume]` */
const standardPicker: RowPicker = (row) => {
  const t = num(row[0]);
  const o = num(row[1]);
  const h = num(row[2]);
  const l = num(row[3]);
  const c = num(row[4]);
  const v = num(row[5]);
  if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
  return { t: t > 1e12 ? t : t * 1000, o, h, l, c, v };
};

/** Coinbase: `[ts, low, high, open, close, volume]` in seconds. */
const coinbasePicker: RowPicker = (row) => {
  const t = num(row[0]);
  const l = num(row[1]);
  const h = num(row[2]);
  const o = num(row[3]);
  const c = num(row[4]);
  const v = num(row[5]);
  if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
  return { t: t * 1000, o, h, l, c, v };
};

/** Bitfinex: `[mts, open, close, high, low, volume]`. */
const bitfinexPicker: RowPicker = (row) => {
  const t = num(row[0]);
  const o = num(row[1]);
  const c = num(row[2]);
  const h = num(row[3]);
  const l = num(row[4]);
  const v = num(row[5]);
  if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
  return { t, o, h, l, c, v };
};

/** Gate: `[ts, quoteVol, close, high, low, open, baseVol, closed]` in seconds. */
const gatePicker: RowPicker = (row) => {
  const t = num(row[0]);
  const c = num(row[2]);
  const h = num(row[3]);
  const l = num(row[4]);
  const o = num(row[5]);
  const v = num(row[6]);
  if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
  return { t: t * 1000, o, h, l, c, v };
};

/** KuCoin / CoinEx / HTX-ish: `[ts, open, close, high, low, volume]` in seconds. */
const openClosePicker: RowPicker = (row) => {
  const t = num(row[0]);
  const o = num(row[1]);
  const c = num(row[2]);
  const h = num(row[3]);
  const l = num(row[4]);
  const v = num(row[5]);
  if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
  return { t: t > 1e12 ? t : t * 1000, o, h, l, c, v };
};

function rowPicker(exchange: ExchangeId): RowPicker {
  switch (exchange) {
    case 'coinbase':
      return coinbasePicker;
    case 'bitfinex':
      return bitfinexPicker;
    case 'gate':
      return gatePicker;
    case 'kucoin':
    case 'coinex':
      return openClosePicker;
    default:
      return standardPicker;
  }
}

function toCandles(rows: unknown[], pick: RowPicker): Candle[] {
  const out: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const candle = pick(row);
    if (candle) out.push(candle);
  }
  return out;
}

async function rowsOf(key: FeedKey, url: string, pick: RowPicker): Promise<Candle[]> {
  if (key.exchange === 'binance') {
    const rows = await guarded<unknown[]>(key.exchange, url);
    return toCandles(rows, pick);
  }
  if (key.exchange === 'bybit') {
    const payload = await guarded<{ result?: { list?: unknown[] }; retMsg?: string }>(key.exchange, url);
    return toCandles(payload.result?.list ?? [], pick);
  }
  if (key.exchange === 'okx') {
    const payload = await guarded<{ data?: unknown[]; code?: string; msg?: string }>(key.exchange, url);
    if (payload.code && payload.code !== '0') throw new UnsupportedPairError(key.exchange, key.symbol);
    return toCandles(payload.data ?? [], pick);
  }
  if (key.exchange === 'gate') {
    const rows = await guarded<unknown[]>(key.exchange, url);
    return toCandles(rows, pick);
  }
  // bitget
  const payload = await guarded<{ code?: string; data?: unknown[] }>(key.exchange, url);
  if (payload.code && payload.code !== '00000') throw new UnsupportedPairError(key.exchange, key.symbol);
  return toCandles(payload.data ?? [], pick);
}

async function wrappedRows(key: FeedKey, url: string, field: 'data'): Promise<Candle[]> {
  const payload = await guarded<Record<string, unknown>>(key.exchange, url);
  const code = payload.code;
  if (code !== undefined && String(code) !== '0' && String(code) !== '200000') {
    throw new UnsupportedPairError(key.exchange, key.symbol);
  }
  const rows = payload[field];
  return toCandles(Array.isArray(rows) ? rows : [], rowPicker(key.exchange));
}

async function krakenRows(key: FeedKey, url: string): Promise<Candle[]> {
  const payload = await guarded<{ error?: string[]; result?: Record<string, unknown> }>(key.exchange, url);
  const errors = payload.error ?? [];
  if (errors.length > 0) {
    // "EQuery:Unknown asset pair" ⇒ the venue does not list it.
    throw new UnsupportedPairError(key.exchange, key.symbol);
  }
  const result = payload.result ?? {};
  const rowsKey = Object.keys(result).find((k) => k !== 'last');
  const rows = rowsKey ? result[rowsKey] : null;
  if (!Array.isArray(rows)) return [];
  return toCandles(
    rows,
    // [time, open, high, low, close, vwap, volume, count] – seconds
    (row) => {
      const t = num(row[0]);
      const o = num(row[1]);
      const h = num(row[2]);
      const l = num(row[3]);
      const c = num(row[4]);
      const v = num(row[6]);
      if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
      return { t: t * 1000, o, h, l, c, v };
    },
  );
}

async function coinbaseRows(key: FeedKey, url: string): Promise<Candle[]> {
  const rows = await guarded<unknown[]>(key.exchange, url);
  return toCandles(rows, coinbasePicker);
}

async function bitfinexRows(key: FeedKey, url: string): Promise<Candle[]> {
  const payload = await guarded<unknown>(key.exchange, url);
  if (Array.isArray(payload) && typeof payload[0] === 'string' && payload[0] === 'error') {
    throw new UnsupportedPairError(key.exchange, key.symbol);
  }
  return toCandles(Array.isArray(payload) ? payload : [], bitfinexPicker);
}

async function htxRows(key: FeedKey, url: string): Promise<Candle[]> {
  const payload = await guarded<{ status?: string; 'err-code'?: string; data?: Record<string, unknown>[] }>(
    key.exchange,
    url,
  );
  if (payload.status && payload.status !== 'ok') throw new UnsupportedPairError(key.exchange, key.symbol);
  const rows = payload.data ?? [];
  const candles: Candle[] = [];
  for (const row of rows) {
    const t = num(row.id);
    const o = num(row.open);
    const c = num(row.close);
    const h = num(row.high);
    const l = num(row.low);
    const v = num(row.amount);
    if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
    candles.push({ t: t * 1000, o, h, l, c, v });
  }
  return candles;
}

/* --------------------------------- shared --------------------------------- */

/** Sort ascending, drop duplicates, cap the history. */
function finalise(key: FeedKey, candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) byTime.set(candle.t, candle);
  const sorted = [...byTime.values()].sort((a, b) => a.t - b.t).slice(-SEED_LIMIT);
  if (sorted.length === 0) throw new UnsupportedPairError(key.exchange, key.symbol);
  return sorted;
}

/** Seeds sind historische Kerzen – eine bis zu 24 h alte L2-Kopie schlägt
 *  ein leeres Chart, wenn der Upstream drosselt (429) oder ausfällt. */
const SEED_STALE_MS = 24 * 60 * 60 * 1000;

async function guarded<T>(exchange: ExchangeId, url: string): Promise<T> {
  try {
    return await fetchJson<T>(url, {
      source: exchange,
      retries: 1,
      cacheTtlMs: 15_000,
      persistKey: `seed:${url}`,
      staleTtlMs: SEED_STALE_MS,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      if (isBlockedStatus(error.status)) throw new FeedBlockedError(exchange, error.status);
      // 400/404 on a symbol lookup = the venue does not list this pair.
      if (error.status === 400 || error.status === 404) {
        throw new UnsupportedPairError(exchange, exchangeSymbolOf(url));
      }
    }
    throw error;
  }
}

function exchangeSymbolOf(url: string): string {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get('symbol') ??
      parsed.searchParams.get('pair') ??
      parsed.searchParams.get('currency_pair') ??
      parsed.searchParams.get('market') ??
      parsed.pathname
    );
  } catch {
    return url;
  }
}
