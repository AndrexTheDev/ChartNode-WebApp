// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, fromKrakenSymbol, num, toKrakenSymbol } from './shared';

/** Kraken OHLC intervals are minutes. */
export const KRAKEN_INTERVAL: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

/**
 * Kraken spot WebSocket v1 (public, no key). Verified live:
 *
 * subscribe : {"event":"subscribe","pair":["XBT/USD"],"subscription":{"name":"ohlc","interval":1}}
 * ohlc data : [channelID, [time, etime, open, high, low, close, vwap, volume, count], "ohlc-1", "XBT/USD"]
 * trade data: [channelID, [price, volume, time, side, orderType, misc], "trade", "XBT/USD"]
 * heartbeat : {"event":"heartbeat"}   (server-initiated, no reply needed)
 *
 * Kraken spells Bitcoin `XBT` and Dogecoin `XDG`.
 */
export const krakenAdapter: ExchangeAdapter = {
  id: 'kraken',
  url: 'wss://ws.kraken.com',
  timeframes: ALL_TIMEFRAMES,

  klineChannel(key: FeedKey) {
    return `ohlc-${KRAKEN_INTERVAL[key.timeframe]}|${toKrakenSymbol(key.symbol)}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `trade|${exchangeSymbol}`;
  },
  toExchangeSymbol: toKrakenSymbol,
  fromExchangeSymbol: fromKrakenSymbol,

  // One subscribe message per subscription type, pairs batched together.
  subscribe(channels) {
    if (channels.length === 0) return null;
    const ohlc = new Map<number, string[]>();
    const tradePairs: string[] = [];

    for (const channel of channels) {
      const [head, pair] = channel.split('|');
      if (!head || !pair) continue;
      if (head === 'trade') tradePairs.push(pair);
      else if (head.startsWith('ohlc-')) {
        const interval = Number(head.slice(5));
        if (!Number.isFinite(interval)) continue;
        ohlc.set(interval, [...(ohlc.get(interval) ?? []), pair]);
      }
    }

    const messages: unknown[] = [];
    for (const [interval, pairs] of ohlc) {
      messages.push({ event: 'subscribe', pair: pairs, subscription: { name: 'ohlc', interval } });
    }
    if (tradePairs.length > 0) {
      messages.push({ event: 'subscribe', pair: tradePairs, subscription: { name: 'trade' } });
    }
    return messages.length === 1 ? messages[0] : messages;
  },

  unsubscribe(channels) {
    if (channels.length === 0) return null;
    const ohlc = new Map<number, string[]>();
    const tradePairs: string[] = [];
    for (const channel of channels) {
      const [head, pair] = channel.split('|');
      if (!head || !pair) continue;
      if (head === 'trade') tradePairs.push(pair);
      else if (head.startsWith('ohlc-')) {
        const interval = Number(head.slice(5));
        if (Number.isFinite(interval)) ohlc.set(interval, [...(ohlc.get(interval) ?? []), pair]);
      }
    }
    const messages: unknown[] = [];
    for (const [interval, pairs] of ohlc) {
      messages.push({ event: 'unsubscribe', pair: pairs, subscription: { name: 'ohlc', interval } });
    }
    if (tradePairs.length > 0) {
      messages.push({ event: 'unsubscribe', pair: tradePairs, subscription: { name: 'trade' } });
    }
    return messages.length === 1 ? messages[0] : messages;
  },

  // Kraken sends {"event":"heartbeat"} itself; the connection needs no client ping.
  heartbeat: null,

  parse(message): FeedEvent[] {
    if (!Array.isArray(message)) return [];
    const channelName = message[2];
    const pair = message[3];
    const data = message[1];
    if (typeof channelName !== 'string' || typeof pair !== 'string') return [];
    const symbol = fromKrakenSymbol(pair);

    if (channelName.startsWith('ohlc-')) {
      const interval = Number(channelName.slice(5));
      const timeframe = (Object.keys(KRAKEN_INTERVAL) as Timeframe[]).find(
        (tf) => KRAKEN_INTERVAL[tf] === interval,
      );
      if (!timeframe || !Array.isArray(data)) return [];
      // [time, etime, open, high, low, close, vwap, volume, count]
      const t = num(data[0]);
      const o = num(data[2]);
      const h = num(data[3]);
      const l = num(data[4]);
      const c = num(data[5]);
      const v = num(data[7]);
      if (t === null || o === null || h === null || l === null || c === null || v === null) return [];
      return [
        {
          type: 'candle',
          key: { exchange: 'kraken', symbol, timeframe },
          candle: buildCandle(Math.round(t * 1000), o, h, l, c, v),
        },
      ];
    }

    if (channelName === 'trade') {
      const rows = Array.isArray(data) && Array.isArray(data[0]) ? data : [data];
      const events: FeedEvent[] = [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        // [price, volume, time, side, orderType, misc]
        const price = num(row[0]);
        const qty = num(row[1]);
        const ts = num(row[2]);
        const side = typeof row[3] === 'string' ? row[3] : null;
        if (price === null || qty === null || ts === null) continue;
        events.push({
          type: 'trade',
          trade: {
            exchange: 'kraken',
            symbol,
            price,
            qty,
            side: side === 's' ? 'sell' : 'buy',
            ts: Math.round(ts * 1000),
          },
        });
      }
      return events;
    }

    return [];
  },
};

/** Kraken's REST pair spelling for the candle seed (`BTC/USDT` → `XBTUSDT`). */
export function krakenRestPair(symbol: string): string {
  return toKrakenSymbol(symbol).replace('/', '');
}
