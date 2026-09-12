// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { buildCandle, fromBitfinexSymbol, isRecord, num, str, toBitfinexSymbol } from './shared';

/** Bitfinex candle keys – note there is **no 4h** bucket. */
export const BITFINEX_INTERVAL: Partial<Record<Timeframe, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '1d': '1D',
  '1w': '7D',
};

/** chanId → what that channel carries (filled from `subscribed` acks). */
interface ChanInfo {
  kind: 'candles' | 'trades';
  channel: string;
}
const chanIndex = new Map<number, ChanInfo>();

/**
 * Bitfinex WebSocket v2 (public, no key). Verified live:
 *
 * candles : {"event":"subscribe","channel":"candles","key":"trade:1m:tBTCUSD"}
 *           ack  {"event":"subscribed","channel":"candles","chanId":74,"key":"trade:1m:tBTCUSD"}
 *           snap [74, [[MTS, OPEN, CLOSE, HIGH, LOW, VOLUME], …]]
 *           upd  [74, [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]]
 * trades  : {"event":"subscribe","channel":"trades","symbol":"tBTCUSD"}
 *           snap [15, [[ID, MTS, AMOUNT, PRICE], …]]   (AMOUNT < 0 ⇒ sell)
 *           upd  [15, "te", [ID, MTS, AMOUNT, PRICE]]
 * ping    : {"event":"ping","cid":…} → reply {"event":"pong","cid":…}
 *
 * Payloads are positional arrays addressed by `chanId`, so the adapter keeps a
 * chanId index (one socket per URL, reconnects simply add new ids).
 */
export const bitfinexAdapter: ExchangeAdapter = {
  id: 'bitfinex',
  url: 'wss://api-pub.bitfinex.com/ws/2',
  timeframes: ['1m', '5m', '15m', '1h', '1d', '1w'],

  klineChannel(key: FeedKey) {
    const interval = BITFINEX_INTERVAL[key.timeframe] ?? '1m';
    return `candles|trade:${interval}:${toBitfinexSymbol(key.symbol)}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `trades|${exchangeSymbol}`;
  },
  toExchangeSymbol: toBitfinexSymbol,
  fromExchangeSymbol: fromBitfinexSymbol,

  subscribe(channels) {
    if (channels.length === 0) return null;
    const messages = channels.map((channel) => {
      const [kind, value] = channel.split('|');
      return kind === 'candles'
        ? { event: 'subscribe', channel: 'candles', key: value }
        : { event: 'subscribe', channel: 'trades', symbol: value };
    });
    return messages.length === 1 ? messages[0] : messages;
  },
  unsubscribe(channels) {
    if (channels.length === 0) return null;
    const messages = channels.map((channel) => {
      const [kind, value] = channel.split('|');
      return kind === 'candles'
        ? { event: 'unsubscribe', channel: 'candles', key: value }
        : { event: 'unsubscribe', channel: 'trades', symbol: value };
    });
    return messages.length === 1 ? messages[0] : messages;
  },

  heartbeat: null,

  keepalive(payload, send) {
    if (!isRecord(payload)) return false;
    if (payload.event !== 'ping') return false;
    send({ event: 'pong', cid: payload.cid ?? Date.now() });
    return true;
  },

  parse(message): FeedEvent[] {
    // Control frames: remember which chanId carries what.
    if (isRecord(message)) {
      if (message.event === 'subscribed') {
        const chanId = num(message.chanId);
        const channel = str(message.channel);
        if (chanId !== null && (channel === 'candles' || channel === 'trades')) {
          chanIndex.set(chanId, {
            kind: channel,
            channel: channel === 'candles' ? `candles|${str(message.key) ?? ''}` : `trades|${str(message.symbol) ?? ''}`,
          });
        }
      }
      return [];
    }

    if (!Array.isArray(message)) return [];
    const chanId = num(message[0]);
    if (chanId === null) return [];
    const info = chanIndex.get(chanId);
    if (!info) return [];
    const body = message[1];
    if (body === 'hb' || body === null || body === undefined) return [];

    if (info.kind === 'candles') {
      const rows = Array.isArray(body) && Array.isArray(body[0]) ? body : [body];
      const events: FeedEvent[] = [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        // [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]
        const t = num(row[0]);
        const o = num(row[1]);
        const c = num(row[2]);
        const h = num(row[3]);
        const l = num(row[4]);
        const v = num(row[5]);
        if (t === null || o === null || c === null || h === null || l === null || v === null) continue;
        const parsed = parseCandleKey(info.channel);
        if (!parsed) continue;
        events.push({
          type: 'candle',
          key: { exchange: 'bitfinex', symbol: parsed.symbol, timeframe: parsed.timeframe },
          candle: buildCandle(t, o, h, l, c, v),
        });
      }
      return events;
    }

    // trades: snapshot [[ID, MTS, AMOUNT, PRICE], …] or update "te"/"tu" + row
    const rows: unknown[] = [];
    if (Array.isArray(body) && Array.isArray(body[0])) rows.push(...body);
    else if ((body === 'te' || body === 'tu') && Array.isArray(message[2])) rows.push(message[2]);
    else if (Array.isArray(body)) rows.push(body);

    const symbol = fromBitfinexSymbol(info.channel.split('|')[1] ?? '');
    const events: FeedEvent[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const ts = num(row[1]);
      const amount = num(row[2]);
      const price = num(row[3]);
      if (ts === null || amount === null || price === null || amount === 0) continue;
      events.push({
        type: 'trade',
        trade: {
          exchange: 'bitfinex',
          symbol,
          price,
          qty: Math.abs(amount),
          side: amount > 0 ? 'buy' : 'sell',
          ts,
        },
      });
    }
    return events;
  },
};

/** `candles|trade:1m:tBTCUSD` → { symbol, timeframe } */
function parseCandleKey(channel: string): { symbol: string; timeframe: Timeframe } | null {
  const key = channel.split('|')[1];
  if (!key) return null;
  const parts = key.split(':'); // ['trade', '1m', 'tBTCUSD']
  const interval = parts[1];
  const instrument = parts[2];
  if (!interval || !instrument) return null;
  const timeframe = (Object.keys(BITFINEX_INTERVAL) as Timeframe[]).find((tf) => BITFINEX_INTERVAL[tf] === interval);
  if (!timeframe) return null;
  return { symbol: fromBitfinexSymbol(instrument), timeframe };
}
