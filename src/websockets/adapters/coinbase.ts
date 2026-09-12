// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent, FeedKey } from '../types';
import { isRecord, num, pairWith, splitPair, str } from './shared';

/** Coinbase Exchange REST candle granularities (seconds). */
export const COINBASE_GRANULARITY: Partial<Record<Timeframe, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
};

/**
 * Coinbase Exchange feed (public, no key). Verified live:
 *
 * subscribe : {"type":"subscribe","product_ids":["BTC-USDT"],"channels":["matches"]}
 * trade     : {"type":"match","trade_id":…,"side":"buy","size":"…","price":"…","product_id":"BTC-USDT","time":"2026-…Z"}
 *
 * ⚠️ `side` is the **maker** order side – the aggressor (taker) is the opposite,
 * which is what a whale tape has to show.
 *
 * There is no candle channel, so the manager derives candles from `matches`
 * on top of the REST history (`derivesCandles`). 4h/1w are not offered: the
 * REST granularities stop at one day.
 */
export const coinbaseAdapter: ExchangeAdapter = {
  id: 'coinbase',
  url: 'wss://ws-feed.exchange.coinbase.com',
  timeframes: ['1m', '5m', '15m', '1h', '1d'],
  derivesCandles: true,

  // No candle channel – the trade channel *is* the kline channel here.
  klineChannel(key: FeedKey) {
    return `matches|${pairWith(key.symbol, '-')}`;
  },
  tradeChannel(exchangeSymbol: string) {
    return `matches|${exchangeSymbol}`;
  },
  toExchangeSymbol: (symbol) => pairWith(symbol, '-'),
  fromExchangeSymbol: (exchangeSymbol) => splitPair(exchangeSymbol, '-', ['USDT', 'USD', 'USDC', 'EUR', 'GBP', 'BTC']),

  subscribe(channels) {
    const products = channels.map((channel) => channel.split('|')[1]).filter((p): p is string => Boolean(p));
    if (products.length === 0) return null;
    return { type: 'subscribe', product_ids: [...new Set(products)], channels: ['matches'] };
  },
  unsubscribe(channels) {
    const products = channels.map((channel) => channel.split('|')[1]).filter((p): p is string => Boolean(p));
    if (products.length === 0) return null;
    return { type: 'unsubscribe', product_ids: [...new Set(products)], channels: ['matches'] };
  },

  heartbeat: null,

  parse(message): FeedEvent[] {
    if (!isRecord(message)) return [];
    if (message.type !== 'match') return []; // ignore subscriptions/last_match/heartbeat

    const productId = str(message.product_id);
    const price = num(message.price);
    const qty = num(message.size);
    const time = str(message.time);
    const makerSide = str(message.side);
    if (!productId || price === null || qty === null || !time || (makerSide !== 'buy' && makerSide !== 'sell')) {
      return [];
    }

    const ts = Date.parse(time);
    if (!Number.isFinite(ts)) return [];

    return [
      {
        type: 'trade',
        trade: {
          exchange: 'coinbase',
          symbol: splitPair(productId, '-', ['USDT', 'USD', 'USDC', 'EUR', 'GBP', 'BTC']),
          price,
          qty,
          // maker bought ⇒ taker sold
          side: makerSide === 'buy' ? 'sell' : 'buy',
          ts,
        },
      },
    ];
  },
};

/** Candle seed URL (needs a User-Agent – browsers always send one). */
export function coinbaseCandlesUrl(symbol: string, timeframe: Timeframe, limit: number): string | null {
  const granularity = COINBASE_GRANULARITY[timeframe];
  if (!granularity) return null;
  return `https://api.exchange.coinbase.com/products/${pairWith(symbol, '-')}/candles?granularity=${granularity}&limit=${limit}`;
}
