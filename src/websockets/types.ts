// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';

/**
 * Every exchange NodeChart can stream from – all public, all key-less, all free.
 *
 * Verified live against production (see `npm run ws:smoke`): payloads, channel
 * names and endpoints in `src/websockets/adapters/` are captured from real
 * server responses, not from documentation alone.
 */
export type ExchangeId =
  | 'binance'
  | 'bybit'
  | 'okx'
  | 'kraken'
  | 'coinbase'
  | 'gate'
  | 'bitfinex'
  | 'cryptocom'
  | 'htx'
  | 'bitget'
  | 'kucoin'
  | 'coinex';

export const EXCHANGES: ExchangeId[] = [
  'binance',
  'bybit',
  'okx',
  'kraken',
  'coinbase',
  'gate',
  'bitfinex',
  'cryptocom',
  'htx',
  'bitget',
  'kucoin',
  'coinex',
];

/** Normalised OHLCV candle. `t` = open time in ms (UTC). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** True once the exchange closed the interval. */
  closed?: boolean;
}

export type TradeSide = 'buy' | 'sell';

export interface RawTrade {
  exchange: ExchangeId;
  /** Normalised pair symbol, e.g. `BTC/USDT`. */
  symbol: string;
  price: number;
  qty: number;
  side: TradeSide;
  ts: number;
}

export type FeedStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

export interface FeedKey {
  exchange: ExchangeId;
  /** Normalised symbol `BTC/USDT`. */
  symbol: string;
  timeframe: Timeframe;
}

export function feedId(key: FeedKey): string {
  return `${key.exchange}:${key.symbol}:${key.timeframe}`;
}

export function tradeKey(exchange: ExchangeId, symbol: string): string {
  return `${exchange}:${symbol}`;
}

/** Events emitted by every exchange adapter into the manager. */
export type FeedEvent =
  | { type: 'candle'; key: FeedKey; candle: Candle }
  | { type: 'trade'; trade: RawTrade };

export interface ExchangeAdapter {
  id: ExchangeId;
  /** Default endpoint (trades). */
  url: string;
  /**
   * Optional per-channel endpoint override. OKX splits its stream in two:
   * candles live on `/ws/v5/business`, trades on `/ws/v5/public`. The manager
   * opens one socket per distinct URL, so this stays transparent everywhere else.
   */
  urlFor?(channel: string): string;
  /**
   * Async endpoint resolution – KuCoin hands out a short-lived public token via
   * REST before the socket can connect. Re-evaluated on every (re)connect.
   */
  resolveUrl?(): Promise<string>;
  /** Server pushes binary frames (HTX gzips every message). */
  binary?: boolean;
  /** Turn a binary frame into a parsed payload. May be async (DecompressionStream). */
  decode?(raw: ArrayBuffer, send: (payload: unknown) => void): unknown | Promise<unknown>;
  /**
   * Server-initiated control frames (HTX `{"ping":…}`, Bitfinex `event:ping`,
   * Gate `spot.ping`). Return true when the frame was consumed.
   */
  keepalive?(payload: unknown, send: (payload: unknown) => void): boolean;
  /**
   * Timeframes this exchange can chart. Anything missing is offered by another
   * exchange instead (Bitfinex has no 4h candle, Coinbase has no candle channel
   * at all, …) – see `EXCHANGE_META` in `src/lib/exchanges.ts`.
   */
  timeframes: Timeframe[];
  /**
   * No native candle channel: the manager builds candles from the trade stream
   * on top of the REST history (`derivesCandles`).
   */
  derivesCandles?: boolean;
  /** The subscribe response already carries history, so no REST seed is needed. */
  seedsViaSocket?: boolean;
  /** Per-exchange wire formats. */
  klineChannel(key: FeedKey): string;
  tradeChannel(exchangeSymbol: string): string;
  toExchangeSymbol(symbol: string): string;
  fromExchangeSymbol(exchangeSymbol: string): string;
  subscribe(channels: string[]): unknown | null;
  unsubscribe(channels: string[]): unknown | null;
  heartbeat: { intervalMs: number; payload: () => unknown | null } | null;
  parse(message: unknown): FeedEvent[];
}

/** Thrown when an exchange refuses us for regional/legal reasons (451/403). */
export class FeedBlockedError extends Error {
  readonly status: number;
  constructor(
    readonly exchange: ExchangeId,
    status: number,
  ) {
    super(`${exchange} rejected the request (HTTP ${status}) – likely region-blocked`);
    this.name = 'FeedBlockedError';
    this.status = status;
  }
}
