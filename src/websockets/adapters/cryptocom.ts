// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, isRecord, num, pairWith, splitPair, str } from './shared';

/** Crypto.com candle intervals. */
export const CRYPTOCOM_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D',
  '1w': '7D',
};

const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];

let requestId = 0;

/**
 * Crypto.com Exchange market stream (public, no key). Verified live:
 *
 * subscribe : {"id":1,"method":"subscribe","params":{"channels":["candlestick.1m.BTC_USDT","trade.BTC_USDT"]}}
 * candles   : {"result":{"channel":"candlestick","interval":"1m","instrument_name":"BTC_USDT",
 *              "data":[{"t":1788975000000,"o":"…","h":"…","l":"…","c":"…","v":"…"}, …]}}
 * trades    : {"result":{"channel":"trade","instrument_name":"BTC_USDT",
 *              "data":[{"d":"…","t":1788992950319,"p":"78033.56","q":"0.00002","s":"SELL","i":"BTC_USDT"}]}}
 *
 * The subscribe response already contains candle history, so no REST seed is
 * needed (`seedsViaSocket`) – which is convenient, because `rest.crypto.com`
 * is blocked in several regions while the stream is not.
 */
export const cryptocomAdapter: ExchangeAdapter = {
  id: 'cryptocom',
  url: 'wss://stream.crypto.com/exchange/v1/market',
  timeframes: ALL_TIMEFRAMES,
  seedsViaSocket: true,

  klineChannel(key: FeedKey) {
    return `candlestick.${CRYPTOCOM_INTERVAL[key.timeframe]}.${pairWith(key.symbol, '_')}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `trade.${exchangeSymbol}`;
  },
  toExchangeSymbol: (symbol) => pairWith(symbol, '_'),
  fromExchangeSymbol: (exchangeSymbol) => splitPair(exchangeSymbol, '_', QUOTES),

  subscribe(channels) {
    if (channels.length === 0) return null;
    requestId += 1;
    return { id: requestId, method: 'subscribe', params: { channels } };
  },
  unsubscribe(channels) {
    if (channels.length === 0) return null;
    requestId += 1;
    return { id: requestId, method: 'unsubscribe', params: { channels } };
  },

  heartbeat: { intervalMs: 25_000, payload: () => ({ id: (requestId += 1), method: 'heartbeat' }) },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    const result = message.result;
    if (!isRecord(result)) return [];
    const channel = str(result.channel);
    const instrument = str(result.instrument_name);
    const data = result.data;
    if (!channel || !instrument || !Array.isArray(data)) return [];
    const symbol = splitPair(instrument, '_', QUOTES);

    if (channel === 'candlestick') {
      const interval = str(result.interval);
      const timeframe = (Object.keys(CRYPTOCOM_INTERVAL) as Timeframe[]).find(
        (tf) => CRYPTOCOM_INTERVAL[tf] === interval,
      );
      if (!timeframe) return [];
      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!isRecord(row)) continue;
        const t = num(row.t);
        const o = num(row.o);
        const h = num(row.h);
        const l = num(row.l);
        const c = num(row.c);
        const v = num(row.v);
        if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
        events.push({
          type: 'candle',
          key: { exchange: 'cryptocom', symbol, timeframe } satisfies FeedKey,
          candle: buildCandle(t, o, h, l, c, v),
        });
      }
      return events;
    }

    if (channel === 'trade') {
      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!isRecord(row)) continue;
        const price = num(row.p);
        const qty = num(row.q);
        const ts = num(row.t);
        const side = str(row.s)?.toUpperCase();
        if (price === null || qty === null || ts === null || (side !== 'BUY' && side !== 'SELL')) continue;
        events.push({
          type: 'trade',
          trade: { exchange: 'cryptocom', symbol, price, qty, side: side === 'BUY' ? 'buy' : 'sell', ts },
        });
      }
      return events;
    }

    return [];
  },
};
