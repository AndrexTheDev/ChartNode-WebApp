// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, isRecord, joinSymbol, num, splitSymbol, str, QUOTES } from './shared';

/** Bitget v2 spot candle granularities. */
export const BITGET_GRANULARITY: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

/**
 * Bitget WebSocket v2 public spot. Verified live:
 *
 * subscribe : {"op":"subscribe","args":[{"instType":"SPOT","channel":"candle1m","instId":"BTCUSDT"}]}
 * candles   : {"action":"snapshot"|"update","arg":{…},"data":[[ts,o,h,l,c,baseVol,quoteVol,usdtVol]]}
 * trades    : {"action":"snapshot"|"update","arg":{"channel":"trade",…},
 *              "data":[{"ts":"…","price":"…","size":"…","side":"sell","tradeId":"…"}]}
 * heartbeat : send the literal string "ping" every ~30 s, server replies "pong".
 *
 * `instType` is **SPOT** in v2 (the old v1 value `SPBL` answers 30016 Param error).
 */
export const bitgetAdapter: ExchangeAdapter = {
  id: 'bitget',
  url: 'wss://ws.bitget.com/v2/ws/public',
  timeframes: ALL_TIMEFRAMES,

  klineChannel(key: FeedKey) {
    return `SPOT|candle${BITGET_GRANULARITY[key.timeframe]}|${joinSymbol(key.symbol)}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `SPOT|trade|${exchangeSymbol}`;
  },
  toExchangeSymbol: joinSymbol,
  fromExchangeSymbol: (exchangeSymbol) => splitSymbol(exchangeSymbol, QUOTES),

  subscribe(channels) {
    const args = decode(channels);
    if (args.length === 0) return null;
    return { op: 'subscribe', args };
  },
  unsubscribe(channels) {
    const args = decode(channels);
    if (args.length === 0) return null;
    return { op: 'unsubscribe', args };
  },

  heartbeat: { intervalMs: 25_000, payload: () => 'ping' },

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    const arg = message.arg;
    const data = message.data;
    if (!isRecord(arg) || !Array.isArray(data)) return [];

    const channel = str(arg.channel);
    const instId = str(arg.instId);
    if (!channel || !instId) return [];
    const symbol = splitSymbol(instId, QUOTES);

    if (channel.startsWith('candle')) {
      const granularity = channel.replace('candle', '');
      const timeframe = (Object.keys(BITGET_GRANULARITY) as Timeframe[]).find(
        (tf) => BITGET_GRANULARITY[tf] === granularity,
      );
      if (!timeframe) return [];
      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!Array.isArray(row)) continue;
        // [ts, o, h, l, c, baseVol, quoteVol, usdtVol]
        const t = num(row[0]);
        const o = num(row[1]);
        const h = num(row[2]);
        const l = num(row[3]);
        const c = num(row[4]);
        const v = num(row[5]);
        if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
        events.push({
          type: 'candle',
          key: { exchange: 'bitget', symbol, timeframe },
          candle: buildCandle(t, o, h, l, c, v),
        });
      }
      return events;
    }

    if (channel === 'trade') {
      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!isRecord(row)) continue;
        const price = num(row.price);
        const qty = num(row.size);
        const ts = num(row.ts);
        const side = str(row.side);
        if (price === null || qty === null || ts === null || (side !== 'buy' && side !== 'sell')) continue;
        events.push({ type: 'trade', trade: { exchange: 'bitget', symbol, price, qty, side, ts } });
      }
      return events;
    }

    return [];
  },
};

function decode(channels: string[]): { instType: string; channel: string; instId: string }[] {
  const out: { instType: string; channel: string; instId: string }[] = [];
  for (const entry of channels) {
    const [instType, channel, instId] = entry.split('|');
    if (instType && channel && instId) out.push({ instType, channel, instId });
  }
  return out;
}
