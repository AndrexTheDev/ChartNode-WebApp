// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { Candle, FeedKey, TradeSide } from '../types';

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildCandle(
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number,
  closed?: boolean,
): Candle {
  return { t, o, h, l, c, v, closed };
}

/** `BTCUSDT` -> `BTC/USDT` given a known quote asset. */
export function splitSymbol(exchangeSymbol: string, quotes: string[]): string {
  const upper = exchangeSymbol.toUpperCase();
  for (const quote of quotes) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return `${upper.slice(0, -quote.length)}/${quote}`;
    }
  }
  return upper;
}

export function joinSymbol(symbol: string): string {
  return symbol.replace('/', '').toUpperCase();
}

export function sideFromTakerBuyer(buyerIsMaker: boolean): TradeSide {
  // If the buyer is the maker, the aggressor (taker) sold.
  return buyerIsMaker ? 'sell' : 'buy';
}

export function keyFrom(exchange: FeedKey['exchange'], symbol: string, timeframe: FeedKey['timeframe']): FeedKey {
  return { exchange, symbol, timeframe };
}

/** Common quote assets, ordered longest-first so `SOLUSDC` never splits wrongly. */
export const QUOTES = ['USDC', 'USDT', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'EUR', 'BTC', 'ETH', 'USD'];

/* ------------------------- symbol / pair helpers -------------------------- */

/** `BTC/USDT` → `BTC-USDT` (okx), `BTC_USDT` (gate/cryptocom), `BTCUSDT` (…). */
export function pairWith(symbol: string, separator: string): string {
  return symbol.replace('/', separator).toUpperCase();
}

/** `BTC_USDT` / `BTC-USDT` / `btcusdt` → `BTC/USDT`. */
export function splitPair(exchangeSymbol: string, separator: string, quotes: string[]): string {
  const upper = exchangeSymbol.toUpperCase();
  const index = upper.lastIndexOf(separator);
  if (index > 0) return `${upper.slice(0, index)}/${upper.slice(index + separator.length)}`;
  return splitSymbol(upper, quotes);
}

/** Kraken spells Bitcoin `XBT` and Dogecoin `XDG`. */
export const KRAKEN_BASE: Record<string, string> = { BTC: 'XBT', DOGE: 'XDG' };
export const KRAKEN_BASE_REVERSE: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };

export function toKrakenSymbol(symbol: string): string {
  const [base, quote] = symbol.split('/');
  return `${KRAKEN_BASE[base ?? ''] ?? base ?? ''}/${quote ?? ''}`.toUpperCase();
}

export function fromKrakenSymbol(pair: string): string {
  const [base, quote] = pair.split('/');
  return `${KRAKEN_BASE_REVERSE[base ?? ''] ?? base ?? ''}/${quote ?? ''}`.toUpperCase();
}

/** HTX topics are lowercase and have no separator (`btcusdt`). */
export function toHtxRestSymbol(symbol: string): string {
  return joinSymbol(symbol).toLowerCase();
}

/**
 * Bitfinex prefixes spot instruments with `t` **and spells USDT as `UST`**
 * (`tBTCUST`). `tBTCUSDT` silently returns an empty array, so the mapping is
 * not optional – verified against `/v2/candles/.../hist`.
 */
const BITFINEX_QUOTES = ['UST', 'USDT', 'USDC', 'USD', 'EUR', 'JPY', 'GBP', 'BTC', 'ETH'];
const BITFINEX_QUOTE_OUT: Record<string, string> = { USDT: 'UST' };
const BITFINEX_QUOTE_IN: Record<string, string> = { UST: 'USDT' };

export function toBitfinexSymbol(symbol: string): string {
  const [base, quote] = symbol.toUpperCase().split('/');
  return `t${base ?? ''}${BITFINEX_QUOTE_OUT[quote ?? ''] ?? quote ?? ''}`;
}

export function fromBitfinexSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  const bare = upper.startsWith('T') ? upper.slice(1) : upper;
  for (const quote of BITFINEX_QUOTES) {
    if (bare.endsWith(quote) && bare.length > quote.length) {
      return `${bare.slice(0, -quote.length)}/${BITFINEX_QUOTE_IN[quote] ?? quote}`;
    }
  }
  return bare;
}

export const ALL_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

/**
 * Validates an interval string that arrived from the wire before it is used as
 * a `Timeframe` (map keys, bucket math, feed ids). An unknown interval must
 * drop the event, never poison the store with an out-of-union key.
 */
export function isKnownTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (ALL_TIMEFRAMES as readonly string[]).includes(value);
}

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

/**
 * HTX gzips every frame. `DecompressionStream` is available in all evergreen
 * browsers (Chrome 80+, Safari 16.4+, Firefox 113+) and costs us no dependency.
 */
export async function gunzipJson(raw: ArrayBuffer): Promise<unknown> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text) as unknown;
  } catch {
    // Some frames (e.g. the server `ping`) arrive uncompressed.
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      return null;
    }
  }
}

/** Round a millisecond timestamp down to its candle bucket. */
export function bucketOf(ts: number, timeframe: Timeframe): number {
  const size = TIMEFRAME_MS[timeframe];
  return Math.floor(ts / size) * size;
}
