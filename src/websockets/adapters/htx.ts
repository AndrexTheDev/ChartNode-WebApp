// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, gunzipJson, isRecord, num, splitSymbol, str, toHtxRestSymbol, QUOTES } from './shared';

/** HTX kline periods. */
export const HTX_PERIOD: Record<Timeframe, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '60min',
  '4h': '4hour',
  '1d': '1day',
  '1w': '1week',
};

let subId = 0;

/** `BTC/USDT` → `btcusdt` (HTX topics are lowercase, no separator). */
const toHtxSymbol = toHtxRestSymbol;

/**
 * HTX (Huobi) spot stream – public, no key. Verified live.
 *
 * ⚠️ Every frame is **gzip-compressed binary**, and the server pings with
 * `{"ping":<ts>}` expecting `{"pong":<ts>}` back, otherwise it drops the
 * connection after ~20 s.
 *
 * kline : {"sub":"market.btcusdt.kline.1min","id":"1"}
 *         → {"ch":"market.btcusdt.kline.1min","ts":…,"tick":{"id":<sec>,"open":…,"close":…,"low":…,"high":…,"amount":…,"vol":…,"count":n}}
 * trades: {"sub":"market.btcusdt.trade.detail","id":"1"}
 *         → {"ch":"market.btcusdt.trade.detail","tick":{"data":[{"ts":<ms>,"amount":…,"price":…,"direction":"buy"}]}}
 */
export const htxAdapter: ExchangeAdapter = {
  id: 'htx',
  url: 'wss://api.huobi.pro/ws',
  timeframes: ALL_TIMEFRAMES,
  binary: true,

  decode: (raw, send) =>
    gunzipJson(raw).then((payload) => {
      // Server ping → pong, otherwise the caller parses the payload.
      if (isRecord(payload) && typeof payload.ping === 'number') {
        send({ pong: payload.ping });
        return null;
      }
      return payload;
    }),

  // Topics are already unique strings, so they double as channel ids.
  klineChannel(key: FeedKey) {
    return `market.${toHtxSymbol(key.symbol)}.kline.${HTX_PERIOD[key.timeframe]}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `market.${exchangeSymbol}.trade.detail`;
  },
  toExchangeSymbol: toHtxSymbol,
  fromExchangeSymbol: (exchangeSymbol) => splitSymbol(exchangeSymbol.toUpperCase(), QUOTES),

  subscribe(channels) {
    if (channels.length === 0) return null;
    return channels.map((channel) => {
      subId += 1;
      return { sub: channel, id: String(subId) };
    });
  },
  unsubscribe() {
    // HTX has no unsubscribe for market topics; the socket is closed instead.
    return null;
  },

  heartbeat: null,

  keepalive(payload) {
    // Already answered inside `decode` (needs the raw ping value).
    return isRecord(payload) && ('ping' in payload || 'pong' in payload || 'subbed' in payload || 'status' in payload);
  },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    const ch = str(message.ch);
    if (!ch) return [];
    const tick = message.tick;
    if (!isRecord(tick)) return [];

    // market.btcusdt.kline.1min
    const klineMatch = /^market\.(.+)\.kline\.(.+)$/.exec(ch);
    if (klineMatch) {
      const symbol = splitSymbol((klineMatch[1] ?? '').toUpperCase(), QUOTES);
      const period = klineMatch[2] ?? '';
      const timeframe = (Object.keys(HTX_PERIOD) as Timeframe[]).find((tf) => HTX_PERIOD[tf] === period);
      if (!timeframe) return [];
      const t = num(tick.id);
      const o = num(tick.open);
      const c = num(tick.close);
      const h = num(tick.high);
      const l = num(tick.low);
      const v = num(tick.amount);
      if (t === null || o === null || c === null || h === null || l === null || v === null) return [];
      return [
        {
          type: 'candle',
          key: { exchange: 'htx', symbol, timeframe } satisfies FeedKey,
          candle: buildCandle(t * 1000, o, h, l, c, v),
        },
      ];
    }

    // market.btcusdt.trade.detail
    const tradeMatch = /^market\.(.+)\.trade\.detail$/.exec(ch);
    if (tradeMatch && Array.isArray(tick.data)) {
      const symbol = splitSymbol((tradeMatch[1] ?? '').toUpperCase(), QUOTES);
      const events: FeedEvent[] = [];
      for (const row of tick.data) {
        if (!isRecord(row)) continue;
        const price = num(row.price);
        const qty = num(row.amount);
        const ts = num(row.ts);
        const direction = str(row.direction);
        if (price === null || qty === null || ts === null || (direction !== 'buy' && direction !== 'sell')) continue;
        events.push({ type: 'trade', trade: { exchange: 'htx', symbol, price, qty, side: direction, ts } });
      }
      return events;
    }

    return [];
  },
};
