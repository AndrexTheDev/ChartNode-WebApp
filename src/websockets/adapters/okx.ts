// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { ALL_TIMEFRAMES, buildCandle, isRecord, num, str } from './shared';

export const OKX_BAR: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
};

/** `BTC/USDT` -> `BTC-USDT` */
export function toOkxSymbol(symbol: string): string {
  return symbol.replace('/', '-').toUpperCase();
}

/** `BTC-USDT` -> `BTC/USDT` */
export function fromOkxSymbol(instId: string): string {
  return instId.replace('-', '/').toUpperCase();
}

/** OKX splits its stream: candles live on `business`, trades on `public`. */
export const OKX_WS_PUBLIC = 'wss://ws.okx.com:8443/ws/v5/public';
export const OKX_WS_BUSINESS = 'wss://ws.okx.com:8443/ws/v5/business';

/**
 * OKX v5 stream (both endpoints share the same protocol).
 *
 * candles : arg.channel `candle{bar}`, data: [[ts, o, h, l, c, vol, volCcy, volQuote, confirm]]
 * trades  : arg.channel `trades`,      data: [{ instId, px, sz, side:'buy'|'sell', ts }]
 *
 * Keepalive: send the literal string "ping"; the server replies "pong"
 * (handled in ManagedSocket). Subscribing to a `candle*` channel on the public
 * endpoint answers with error 60018 – hence `urlFor`.
 */
export const okxAdapter: ExchangeAdapter = {
  id: 'okx',
  url: OKX_WS_PUBLIC,
  timeframes: ALL_TIMEFRAMES,

  // `candle*` channels return error 60018 on the public endpoint.
  urlFor(channel) {
    return channel.startsWith('candle') ? OKX_WS_BUSINESS : OKX_WS_PUBLIC;
  },

  klineChannel(key: FeedKey) {
    return encodeOkxChannel(`candle${OKX_BAR[key.timeframe]}`, toOkxSymbol(key.symbol));
  },
  tradeChannel(exchangeSymbol: string) {
    return encodeOkxChannel('trades', exchangeSymbol);
  },
  toExchangeSymbol: toOkxSymbol,
  fromExchangeSymbol: fromOkxSymbol,

  // OKX channels are objects, not strings – encode as `channel|instId`.
  subscribe(channels) {
    const args = decodeChannels(channels);
    if (args.length === 0) return null;
    return { op: 'subscribe', args };
  },
  unsubscribe(channels) {
    const args = decodeChannels(channels);
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
    const symbol = fromOkxSymbol(instId);

    if (channel.startsWith('candle')) {
      const bar = channel.replace('candle', '');
      const timeframe = (Object.keys(OKX_BAR) as Timeframe[]).find((tf) => OKX_BAR[tf] === bar);
      if (!timeframe) return [];

      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const t = num(row[0]);
        const o = num(row[1]);
        const h = num(row[2]);
        const l = num(row[3]);
        const c = num(row[4]);
        const v = num(row[5]);
        const confirm = row[8];
        if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
        events.push({
          type: 'candle',
          key: { exchange: 'okx', symbol, timeframe },
          candle: buildCandle(t, o, h, l, c, v, confirm === '1' || confirm === 1),
        });
      }
      return events;
    }

    if (channel === 'trades') {
      const events: FeedEvent[] = [];
      for (const row of data) {
        if (!isRecord(row)) continue;
        const price = num(row.px);
        const qty = num(row.sz);
        const ts = num(row.ts);
        const side = str(row.side);
        if (price === null || qty === null || ts === null || (side !== 'buy' && side !== 'sell')) continue;
        events.push({
          type: 'trade',
          trade: { exchange: 'okx', symbol, price, qty, side, ts },
        });
      }
      return events;
    }

    return [];
  },
};

/**
 * The manager addresses channels as flat strings; OKX needs {channel, instId}.
 * Encoding: `candle1H|BTC-USDT` or `trades|BTC-USDT`.
 */
export function encodeOkxChannel(channel: string, instId: string): string {
  return `${channel}|${instId}`;
}

function decodeChannels(channels: string[]): { channel: string; instId: string }[] {
  const out: { channel: string; instId: string }[] = [];
  for (const entry of channels) {
    const [channel, instId] = entry.split('|');
    if (channel && instId) out.push({ channel, instId });
  }
  return out;
}
