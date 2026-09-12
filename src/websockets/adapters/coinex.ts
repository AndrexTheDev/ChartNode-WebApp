// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, isRecord, joinSymbol, num, splitSymbol, str, QUOTES } from './shared';

let requestId = 0;

/** CoinEx v1 kline types (used by the REST seed). */
export const COINEX_KLINE_TYPE: Record<Timeframe, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1hour',
  '4h': '4hour',
  '1d': '1day',
  '1w': '1week',
};

/**
 * CoinEx spot WebSocket v1 (public, no key). Verified live:
 *
 * subscribe : {"method":"deals.subscribe","params":["BTCUSDT"],"id":1}
 * ack       : {"error":null,"result":{"status":"success"},"id":1}
 * trades    : {"method":"deals.update","params":["BTCUSDT",
 *              [{"id":7297160255,"time":1788992959.88,"type":"buy","price":"78014","amount":"0.000114"}]]}
 * keepalive : {"method":"server.ping","params":[],"id":n}
 *
 * The v1 socket has no usable public kline push (`kline.subscribe` stays
 * silent, the v2 host does not resolve), so candles are derived from the deal
 * stream on top of the REST history – which is fast and complete for CoinEx.
 */
export const coinexAdapter: ExchangeAdapter = {
  id: 'coinex',
  url: 'wss://socket.coinex.com/',
  timeframes: ALL_TIMEFRAMES,
  derivesCandles: true,

  klineChannel(key: FeedKey) {
    return `deals|${joinSymbol(key.symbol)}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `deals|${exchangeSymbol}`;
  },
  toExchangeSymbol: joinSymbol,
  fromExchangeSymbol: (exchangeSymbol) => splitSymbol(exchangeSymbol, QUOTES),

  subscribe(channels) {
    if (channels.length === 0) return null;
    const markets = channels.map((channel) => channel.split('|')[1]).filter((m): m is string => Boolean(m));
    requestId += 1;
    return { method: 'deals.subscribe', params: [...new Set(markets)], id: requestId };
  },
  unsubscribe(channels) {
    if (channels.length === 0) return null;
    const markets = channels.map((channel) => channel.split('|')[1]).filter((m): m is string => Boolean(m));
    requestId += 1;
    return { method: 'deals.unsubscribe', params: [...new Set(markets)], id: requestId };
  },

  heartbeat: {
    intervalMs: 15_000,
    payload: () => {
      requestId += 1;
      return { method: 'server.ping', params: [], id: requestId };
    },
  },

  keepalive(payload) {
    if (!isRecord(payload)) return false;
    const method = str(payload.method);
    if (method !== null) return method === 'server.pong';
    // subscription acks: {"error":null,"result":{"status":"success"},"id":n}
    return isRecord(payload.result) && str(payload.result.status) === 'success';
  },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    if (str(message.method) !== 'deals.update') return [];
    const params = message.params;
    if (!Array.isArray(params)) return [];

    const market = str(params[0]);
    const deals = params[1];
    if (!market || !Array.isArray(deals)) return [];
    const symbol = splitSymbol(market, QUOTES);

    const events: FeedEvent[] = [];
    for (const deal of deals) {
      if (!isRecord(deal)) continue;
      const price = num(deal.price);
      const qty = num(deal.amount);
      const time = num(deal.time);
      const side = str(deal.type);
      if (price === null || qty === null || time === null || (side !== 'buy' && side !== 'sell')) continue;
      events.push({
        type: 'trade',
        trade: { exchange: 'coinex', symbol, price, qty, side, ts: Math.round(time * 1000) },
      });
    }
    return events;
  },
};

/** Referenced by the seed layer to prove the mapping is exhaustive. */
export const COINEX_TIMEFRAMES: Timeframe[] = Object.keys(COINEX_KLINE_TYPE) as Timeframe[];
