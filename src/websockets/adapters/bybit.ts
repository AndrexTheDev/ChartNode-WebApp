// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, isRecord, joinSymbol, num, splitSymbol, str, QUOTES } from './shared';

/** Bybit v5 kline intervals are minutes / D / W. */
export const BYBIT_INTERVAL: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

/**
 * Bybit v5 public spot stream.
 *
 * kline  : topic `kline.{interval}.{SYMBOL}`  data:[{ start, open, high, low, close, volume, confirm }]
 * trades : topic `publicTrade.{SYMBOL}`       data:[{ T, s, S:'Buy'|'Sell', p, v }]
 *
 * Requires an application-level ping every ≤20 s, otherwise the exchange
 * drops the connection silently.
 */
export const bybitAdapter: ExchangeAdapter = {
  id: 'bybit',
  url: 'wss://stream.bybit.com/v5/public/spot',
  timeframes: ALL_TIMEFRAMES,

  klineChannel(key: FeedKey) {
    return `kline.${BYBIT_INTERVAL[key.timeframe]}.${joinSymbol(key.symbol)}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `publicTrade.${exchangeSymbol}`;
  },
  toExchangeSymbol: joinSymbol,
  fromExchangeSymbol: (exchangeSymbol) => splitSymbol(exchangeSymbol, QUOTES),

  subscribe(channels) {
    if (channels.length === 0) return null;
    return { op: 'subscribe', args: channels };
  },
  unsubscribe(channels) {
    if (channels.length === 0) return null;
    return { op: 'unsubscribe', args: channels };
  },

  heartbeat: { intervalMs: 18_000, payload: () => ({ op: 'ping' }) },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    const topic = str(message.topic);
    const data = message.data;
    if (!topic || !Array.isArray(data)) return [];

    if (topic.startsWith('kline.')) {
      const [, intervalRaw, symbolRaw] = topic.split('.');
      const symbol = splitSymbol(symbolRaw ?? '', QUOTES);
      const timeframe = (Object.keys(BYBIT_INTERVAL) as Timeframe[]).find(
        (tf) => BYBIT_INTERVAL[tf] === intervalRaw,
      );
      if (!timeframe) return [];

      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!isRecord(row)) continue;
        const t = num(row.start);
        const o = num(row.open);
        const h = num(row.high);
        const l = num(row.low);
        const c = num(row.close);
        const v = num(row.volume);
        if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
        events.push({
          type: 'candle',
          key: { exchange: 'bybit', symbol, timeframe },
          candle: buildCandle(t, o, h, l, c, v, row.confirm === true),
        });
      }
      return events;
    }

    if (topic.startsWith('publicTrade.')) {
      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!isRecord(row)) continue;
        const price = num(row.p);
        const qty = num(row.v);
        const ts = num(row.T);
        const sideRaw = str(row.S);
        const symbol = splitSymbol(str(row.s) ?? '', QUOTES);
        if (price === null || qty === null || ts === null || (sideRaw !== 'Buy' && sideRaw !== 'Sell')) continue;
        events.push({
          type: 'trade',
          trade: {
            exchange: 'bybit',
            symbol,
            price,
            qty,
            side: sideRaw === 'Buy' ? 'buy' : 'sell',
            ts,
          },
        });
      }
      return events;
    }

    return [];
  },
};
