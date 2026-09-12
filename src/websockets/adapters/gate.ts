// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, isRecord, num, pairWith, splitPair, str } from './shared';

/** Gate.io spot candle intervals. */
export const GATE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '7d',
};

/**
 * Gate.io WebSocket v4 (public, no key). Verified live:
 *
 * candles : {"channel":"spot.candlesticks","event":"subscribe","payload":["1m","BTC_USDT"]}
 *           → {"channel":"spot.candlesticks","event":"update",
 *              "result":{"t":"1788992940","o":"…","h":"…","l":"…","c":"…","a":"0.77965","v":"60840.98","n":"1m_BTC_USDT","w":false}}
 * trades  : {"channel":"spot.trades","event":"subscribe","payload":["BTC_USDT"]}
 *           → {"channel":"spot.trades","event":"update",
 *              "result":{"id":…,"create_time_ms":"…","side":"sell","currency_pair":"BTC_USDT","amount":"…","price":"…"}}
 * ping    : {"time":…,"channel":"spot.ping"} → reply {"time":…,"channel":"spot.pong"}
 *
 * `w` marks a *closed* window, `a` is base volume and `v` quote volume.
 */
export const gateAdapter: ExchangeAdapter = {
  id: 'gate',
  url: 'wss://api.gateio.ws/ws/v4/',
  timeframes: ALL_TIMEFRAMES,

  klineChannel(key: FeedKey) {
    return `spot.candlesticks|${GATE_INTERVAL[key.timeframe]}|${pairWith(key.symbol, '_')}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `spot.trades|${exchangeSymbol}`;
  },
  toExchangeSymbol: (symbol) => pairWith(symbol, '_'),
  fromExchangeSymbol: (exchangeSymbol) => splitPair(exchangeSymbol, '_', ['USDT', 'USDC', 'USD', 'BTC', 'ETH']),

  subscribe(channels) {
    return gateMessages(channels, 'subscribe');
  },
  unsubscribe(channels) {
    return gateMessages(channels, 'unsubscribe');
  },

  // Gate pings us; no client heartbeat required.
  heartbeat: null,

  keepalive(payload, send) {
    if (!isRecord(payload)) return false;
    if (payload.channel !== 'spot.ping') return false;
    send({ time: num(payload.time) ?? Math.floor(Date.now() / 1000), channel: 'spot.pong' });
    return true;
  },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    if (message.event !== 'update') return [];
    const channel = str(message.channel);
    const result = message.result;
    if (!channel) return [];

    if (channel === 'spot.candlesticks') {
      if (!isRecord(result)) return [];
      const name = str(result.n); // "1m_BTC_USDT"
      if (!name) return [];
      const firstUnderscore = name.indexOf('_');
      const interval = name.slice(0, firstUnderscore);
      const pair = name.slice(firstUnderscore + 1);
      const timeframe = (Object.keys(GATE_INTERVAL) as Timeframe[]).find((tf) => GATE_INTERVAL[tf] === interval);
      if (!timeframe || !pair) return [];

      const t = num(result.t);
      const o = num(result.o);
      const h = num(result.h);
      const l = num(result.l);
      const c = num(result.c);
      const v = num(result.a); // base volume
      if (t === null || o === null || h === null || l === null || c === null || v === null) return [];

      return [
        {
          type: 'candle',
          key: { exchange: 'gate', symbol: splitPair(pair, '_', ['USDT', 'USDC', 'USD', 'BTC', 'ETH']), timeframe },
          candle: buildCandle(t * 1000, o, h, l, c, v, result.w === true || result.w === 'true'),
        },
      ];
    }

    if (channel === 'spot.trades') {
      const rows = Array.isArray(result) ? result : isRecord(result) ? [result] : [];
      const events: FeedEvent[] = [];
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const price = num(row.price);
        const qty = num(row.amount);
        const tsMs = num(row.create_time_ms);
        const tsSec = num(row.create_time);
        const rawTs = tsMs ?? (tsSec !== null ? tsSec * 1000 : null);
        // Gate sends microsecond precision ("1788992597936.382000").
        const ts = rawTs === null ? null : Math.round(rawTs);
        const side = str(row.side);
        const pair = str(row.currency_pair);
        if (price === null || qty === null || ts === null || !pair || (side !== 'buy' && side !== 'sell')) continue;
        events.push({
          type: 'trade',
          trade: {
            exchange: 'gate',
            symbol: splitPair(pair, '_', ['USDT', 'USDC', 'USD', 'BTC', 'ETH']),
            price,
            qty,
            side,
            ts,
          },
        });
      }
      return events;
    }

    return [];
  },
};

/**
 * Gate subscription shapes (verified live):
 *   spot.candlesticks → payload is a flat `[interval, pair]`, one message each
 *   spot.trades       → payload is a list of pairs, batched into one message
 * Sending `[["1m","BTC_USDT"]]` for candlesticks connects but never pushes data.
 */
function gateMessages(channels: string[], event: 'subscribe' | 'unsubscribe'): unknown {
  if (channels.length === 0) return null;
  const candleSpecs: [string, string][] = []; // [interval, pair]
  const tradePairs: string[] = [];

  for (const channel of channels) {
    const [head, a, b] = channel.split('|');
    if (head === 'spot.candlesticks' && a && b) candleSpecs.push([a, b]);
    else if (head === 'spot.trades' && a) tradePairs.push(a);
  }

  const time = Math.floor(Date.now() / 1000);
  const messages: unknown[] = candleSpecs.map(([interval, pair]) => ({
    time,
    channel: 'spot.candlesticks',
    event,
    payload: [interval, pair],
  }));
  if (tradePairs.length > 0) {
    messages.push({ time, channel: 'spot.trades', event, payload: tradePairs });
  }
  if (messages.length === 0) return null;
  return messages.length === 1 ? messages[0] : messages;
}
