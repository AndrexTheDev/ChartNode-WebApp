// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { binanceAdapter } from './adapters/binance';
import { bitfinexAdapter } from './adapters/bitfinex';
import { bitgetAdapter } from './adapters/bitget';
import { bybitAdapter } from './adapters/bybit';
import { coinbaseAdapter } from './adapters/coinbase';
import { coinexAdapter } from './adapters/coinex';
import { cryptocomAdapter } from './adapters/cryptocom';
import { gateAdapter } from './adapters/gate';
import { htxAdapter } from './adapters/htx';
import { krakenAdapter } from './adapters/kraken';
import { kucoinAdapter } from './adapters/kucoin';
import { okxAdapter } from './adapters/okx';
import type { ExchangeAdapter, ExchangeId } from './types';

/** Every adapter, keyed by exchange id. */
export const ADAPTERS: Record<ExchangeId, ExchangeAdapter> = {
  binance: binanceAdapter,
  bybit: bybitAdapter,
  okx: okxAdapter,
  kraken: krakenAdapter,
  coinbase: coinbaseAdapter,
  gate: gateAdapter,
  bitget: bitgetAdapter,
  kucoin: kucoinAdapter,
  bitfinex: bitfinexAdapter,
  cryptocom: cryptocomAdapter,
  htx: htxAdapter,
  coinex: coinexAdapter,
};

/**
 * Fallback preference when nothing has been probed yet: deepest liquidity and
 * the most reliable public streams first.
 */
export const EXCHANGE_PREFERENCE: ExchangeId[] = [
  'binance',
  'okx',
  'bybit',
  'coinbase',
  'kraken',
  'gate',
  'bitget',
  'kucoin',
  'bitfinex',
  'cryptocom',
  'htx',
  'coinex',
];

export function adapterFor(exchange: ExchangeId): ExchangeAdapter {
  return ADAPTERS[exchange];
}

/** Exchanges that can chart this timeframe at all. */
export function exchangesForTimeframe(timeframe: ExchangeAdapter['timeframes'][number]): ExchangeId[] {
  return EXCHANGE_PREFERENCE.filter((id) => ADAPTERS[id].timeframes.includes(timeframe));
}
