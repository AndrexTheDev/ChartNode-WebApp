// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { timeoutSignal } from '@/lib/abort';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, isRecord, num, pairWith, splitPair, str } from './shared';

const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
const BULLET_URL = 'https://api.kucoin.com/api/v1/bullet-public';

let messageId = 0;
let cached: { url: string; fetchedAt: number } | null = null;
// bullet-public antwortet ohne ACAO-Header (live verifiziert) – im Browser
// schlägt der Fetch also garantiert fehl. Nach dem ersten CORS-Treffer keine
// weiteren Versuche (jeder würde einen nicht unterdrückbaren Konsolen-Error
// loggen); der Reconnect-Backoff läuft dann zügig in 'max-attempts'.
let browserCorsBlocked = false;

/**
 * KuCoin needs a short-lived public token before the socket can connect –
 * still 100 % free and key-less. The token is cached for 30 min and re-fetched
 * on every reconnect.
 */
async function resolveKucoinUrl(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < 30 * 60_000) return cached.url;
  if (browserCorsBlocked) throw new Error('kucoin bullet-public: CORS-blocked in browser');

  try {
    const response = await fetch(BULLET_URL, { method: 'POST', signal: timeoutSignal(10_000) });
    if (!response.ok) throw new Error(`kucoin bullet-public HTTP ${response.status}`);
    const payload = (await response.json()) as {
      data?: { token?: string; instanceServers?: { endpoint?: string }[] } | undefined;
    };
    const endpoint = payload.data?.instanceServers?.[0]?.endpoint;
    const token = payload.data?.token;
    if (!endpoint || !token) throw new Error('kucoin bullet-public: no endpoint/token');

    const url = `${endpoint}${endpoint.endsWith('/') ? '' : '/'}?token=${token}`;
    cached = { url, fetchedAt: Date.now() };
    return url;
  } catch (error) {
    // Fetch-CORS-Rejections werfen einen nackten TypeError (nicht von HTTP-
    // Status unterscheidbar) – einmal gemerkt, wird nie wieder gefetcht.
    if (typeof window !== 'undefined' && error instanceof TypeError) browserCorsBlocked = true;
    throw error;
  }
}

/**
 * KuCoin spot public stream. Verified live:
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
