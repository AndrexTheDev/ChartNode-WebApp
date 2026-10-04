// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { fetchJson } from '@/api/http';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, isRecord, num, pairWith, splitPair, str } from './shared';

const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
const TOKEN_ENDPOINT = '/api/kucoin/public-token';
const CLIENT_TOKEN_CACHE_MS = 12 * 60_000;

let messageId = 0;
let cached: { url: string; fetchedAt: number } | null = null;

interface KucoinTokenResponse {
  token?: string;
  endpoint?: string;
}

/**
 * KuCoin requires a public token before opening its socket. Its public token
 * endpoint omits browser CORS headers, so this adapter uses our narrow,
 * same-origin `/api/kucoin/public-token` handler. That handler is a fixed
 * upstream request with isolate caching; it is not a user-controlled proxy.
 */
async function resolveKucoinUrl(signal?: AbortSignal): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < CLIENT_TOKEN_CACHE_MS) return cached.url;

  const payload = await fetchJson<KucoinTokenResponse>(TOKEN_ENDPOINT, {
    source: 'kucoin-token',
    retries: 1,
    timeoutMs: 10_000,
    dedupe: true,
    signal,
  });
  const endpoint = payload.endpoint;
  const token = payload.token;
  if (!endpoint || !token || token.length > 4_096) throw new Error('KuCoin token route returned an invalid token');

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('KuCoin token route returned an invalid WebSocket endpoint');
  }
  if (url.protocol !== 'wss:' || !(url.hostname === 'kucoin.com' || url.hostname.endsWith('.kucoin.com'))) {
    throw new Error('KuCoin token route returned an untrusted WebSocket endpoint');
  }
  url.searchParams.set('token', token);
  cached = { url: url.toString(), fetchedAt: Date.now() };
  return cached.url;
}

/**
 * KuCoin spot public stream. Protocol example; current reachability is not guaranteed:
 *
 * subscribe : {"id":"1","type":"subscribe","topic":"/market/match:BTC-USDT"}
 * trade     : {"topic":"/market/match:BTC-USDT","type":"message","subject":"trade.l3match",
 *              "data":{"price":"78010.2","size":"0.00001341","side":"buy","symbol":"BTC-USDT","time":"1788993048567000000"}}
 * keepalive : {"id":"n","type":"ping"} every ~18 s (server `pingInterval`)
 *
 * ⚠️ KuCoin's spot endpoint has **no public kline topic** (`/market/candle:*`
 * and `/spotMarket/*Kline:*` both answer `404 topic does not exist`), so
 * candles are derived from the match stream on top of the REST history.
 * `time` is in nanoseconds.
 */
export const kucoinAdapter: ExchangeAdapter = {
  id: 'kucoin',
  url: 'wss://ws-api-spot.kucoin.com/',
  resolveUrl: resolveKucoinUrl,
  timeframes: ALL_TIMEFRAMES,
  derivesCandles: true,

  // No candle topic – the trade topic is the kline channel.
  klineChannel(key: FeedKey) {
    return `/market/match:${pairWith(key.symbol, '-')}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `/market/match:${exchangeSymbol}`;
  },
  toExchangeSymbol: (symbol) => pairWith(symbol, '-'),
  fromExchangeSymbol: (exchangeSymbol) => splitPair(exchangeSymbol, '-', QUOTES),

  subscribe(channels) {
    if (channels.length === 0) return null;
    return channels.map((topic) => {
      messageId += 1;
      return { id: String(messageId), type: 'subscribe', topic, privateChannel: false, response: false };
    });
  },
  unsubscribe(channels) {
    if (channels.length === 0) return null;
    return channels.map((topic) => {
      messageId += 1;
      return { id: String(messageId), type: 'unsubscribe', topic };
    });
  },

  heartbeat: {
    intervalMs: 18_000,
    payload: () => {
      messageId += 1;
      return { id: String(messageId), type: 'ping' };
    },
  },

  keepalive(payload) {
    if (!isRecord(payload)) return false;
    const type = str(payload.type);
    return type === 'welcome' || type === 'pong' || type === 'ack';
  },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    if (str(message.type) !== 'message') return [];
    const topic = str(message.topic);
    const data = message.data;
    if (!topic?.startsWith('/market/match:') || !isRecord(data)) return [];

    const symbol = splitPair(str(data.symbol) ?? topic.slice('/market/match:'.length), '-', QUOTES);
    const price = num(data.price);
    const qty = num(data.size);
    const side = str(data.side);
    const timeNs = num(data.time);
    if (price === null || qty === null || timeNs === null || (side !== 'buy' && side !== 'sell')) return [];

    return [
      {
        type: 'trade',
        trade: { exchange: 'kucoin', symbol, price, qty, side, ts: Math.round(timeNs / 1_000_000) },
      },
    ];
  },
};
