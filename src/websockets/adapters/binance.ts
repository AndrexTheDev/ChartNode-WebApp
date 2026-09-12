// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, isKnownTimeframe, isRecord, joinSymbol, num, sideFromTakerBuyer, splitSymbol, str, QUOTES } from './shared';

export const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

let subscribeId = 0;

/**
 * Binance Spot public stream.
 * Single `/ws` connection + SUBSCRIBE/UNSUBSCRIBE control messages, so the
 * channel set can change at runtime without reconnecting.
 *
 * kline event : { e:'kline', s:'BTCUSDT', k:{ t, i, o, h, l, c, v, x } }
 * aggTrade    : { e:'aggTrade', s:'BTCUSDT', p, q, m, T }   (m = buyer is maker)
 *
 * We deliberately use **data-stream.binance.vision**, Binance's public
 * market-data mirror: `stream.binance.com` answers HTTP 451 ("service
 * unavailable from a restricted location") for whole countries, while the
 * mirror serves the exact same payload everywhere. Verified live from a
 * region where `api.binance.com` is blocked.
 */
export const BINANCE_WS = 'wss://data-stream.binance.vision/ws';
export const BINANCE_WS_PRIMARY = 'wss://stream.binance.com:9443/ws';

export const binanceAdapter: ExchangeAdapter = {
  id: 'binance',
  url: BINANCE_WS,
  timeframes: ALL_TIMEFRAMES,

  klineChannel(key: FeedKey) {
    return `${joinSymbol(key.symbol).toLowerCase()}@kline_${BINANCE_INTERVAL[key.timeframe]}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `${exchangeSymbol.toLowerCase()}@aggTrade`;
  },
  toExchangeSymbol: joinSymbol,
  fromExchangeSymbol: (exchangeSymbol) => splitSymbol(exchangeSymbol, QUOTES),

  subscribe(channels) {
    if (channels.length === 0) return null;
    subscribeId += 1;
    return { method: 'SUBSCRIBE', params: channels, id: subscribeId };
  },
  unsubscribe(channels) {
    if (channels.length === 0) return null;
    subscribeId += 1;
    return { method: 'UNSUBSCRIBE', params: channels, id: subscribeId };
  },

  // Binance keeps the connection alive with protocol-level ping frames.
  heartbeat: null,

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    const event = str(message.e);
    const rawSymbol = str(message.s);
    if (!event || !rawSymbol) return [];
    const symbol = splitSymbol(rawSymbol, QUOTES);

    if (event === 'kline') {
      const k = message.k;
      if (!isRecord(k)) return [];
      const t = num(k.t);
      const o = num(k.o);
      const h = num(k.h);
      const l = num(k.l);
      const c = num(k.c);
      const v = num(k.v);
      const interval = str(k.i);
      if (t === null || o === null || h === null || l === null || c === null || v === null || !isKnownTimeframe(interval)) {
        return [];
      }
      const key: FeedKey = { exchange: 'binance', symbol, timeframe: interval };
      return [{ type: 'candle', key, candle: buildCandle(t, o, h, l, c, v, k.x === true) }];
    }

    if (event === 'aggTrade') {
      const price = num(message.p);
      const qty = num(message.q);
      const ts = num(message.T);
      if (price === null || qty === null || ts === null) return [];
      return [
        {
          type: 'trade',
          trade: {
            exchange: 'binance',
            symbol,
            price,
            qty,
            side: sideFromTakerBuyer(message.m === true),
            ts,
          },
        },
      ];
    }

    return [];
  },
};
