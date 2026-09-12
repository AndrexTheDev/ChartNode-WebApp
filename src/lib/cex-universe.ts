// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Token } from '@/store/types';
import type { ExchangeId } from '@/websockets/types';

export interface CexInstrument {
  base: string;
  quote: string;
  name: string;
  /**
   * Venues that are *expected* to list this pair. This is only a starting hint
   * for search ranking and the first venue choice: real support is discovered
   * at runtime (a 400/404 seed or a subscribe error marks the pair unsupported
   * in `useExchangeStore` and the picker moves on to the next venue).
   */
  exchanges: ExchangeId[];
}

/** Every venue we can stream from, best-first. */
const ALL: ExchangeId[] = [
  'binance',
  'okx',
  'bybit',
  'coinbase',
  'kraken',
  'gate',
  'bitget',
  'kucoin',
  'cryptocom',
  'htx',
  'bitfinex',
  'coinex',
];

/** Newer alts: on the offshore venues, not on Coinbase/Kraken/Bitfinex. */
const ALTS: ExchangeId[] = ['binance', 'okx', 'bybit', 'gate', 'bitget', 'kucoin', 'htx', 'coinex', 'cryptocom'];

/**
 * Curated CEX symbol universe for instant, offline-capable name search.
 *
 * Deliberate choice: the full instrument lists of twelve exchanges are
 * megabytes each and several endpoints are region-blocked, so fetching them on
 * every keystroke would be slow and flaky. The universe covers the liquid names;
 * anything exotic resolves through the DEX aggregators instead. Extend freely –
 * search is a pure filter over this list.
 */
export const CEX_UNIVERSE: CexInstrument[] = [
  { base: 'BTC', quote: 'USDT', name: 'Bitcoin', exchanges: ALL },
  { base: 'ETH', quote: 'USDT', name: 'Ethereum', exchanges: ALL },
  { base: 'SOL', quote: 'USDT', name: 'Solana', exchanges: ALL },
  { base: 'XRP', quote: 'USDT', name: 'XRP', exchanges: ALL },
  { base: 'DOGE', quote: 'USDT', name: 'Dogecoin', exchanges: ALL },
  { base: 'ADA', quote: 'USDT', name: 'Cardano', exchanges: ALL },
  { base: 'BNB', quote: 'USDT', name: 'BNB', exchanges: ['binance', 'okx', 'bybit', 'gate', 'kucoin', 'htx', 'bitget', 'coinex'] },
  { base: 'AVAX', quote: 'USDT', name: 'Avalanche', exchanges: ALL },
  { base: 'LINK', quote: 'USDT', name: 'Chainlink', exchanges: ALL },
  { base: 'DOT', quote: 'USDT', name: 'Polkadot', exchanges: ALL },
  { base: 'TRX', quote: 'USDT', name: 'TRON', exchanges: ALL },
  { base: 'MATIC', quote: 'USDT', name: 'Polygon (MATIC)', exchanges: ALL },
  { base: 'POL', quote: 'USDT', name: 'Polygon (POL)', exchanges: ALL },
  { base: 'LTC', quote: 'USDT', name: 'Litecoin', exchanges: ALL },
  { base: 'BCH', quote: 'USDT', name: 'Bitcoin Cash', exchanges: ALL },
  { base: 'ETC', quote: 'USDT', name: 'Ethereum Classic', exchanges: ALL },
  { base: 'XLM', quote: 'USDT', name: 'Stellar', exchanges: ALL },
  { base: 'ATOM', quote: 'USDT', name: 'Cosmos Hub', exchanges: ALL },
  { base: 'NEAR', quote: 'USDT', name: 'NEAR Protocol', exchanges: ALL },
  { base: 'FIL', quote: 'USDT', name: 'Filecoin', exchanges: ALL },
  { base: 'APT', quote: 'USDT', name: 'Aptos', exchanges: ALL },
  { base: 'SUI', quote: 'USDT', name: 'Sui', exchanges: ALL },
  { base: 'TON', quote: 'USDT', name: 'Toncoin', exchanges: ALL },
  { base: 'SEI', quote: 'USDT', name: 'Sei', exchanges: ALTS },
  { base: 'TIA', quote: 'USDT', name: 'Celestia', exchanges: ALL },
  { base: 'INJ', quote: 'USDT', name: 'Injective', exchanges: ALL },
  { base: 'ALGO', quote: 'USDT', name: 'Algorand', exchanges: ALL },
  { base: 'VET', quote: 'USDT', name: 'VeChain', exchanges: ALL },
  { base: 'ICP', quote: 'USDT', name: 'Internet Computer', exchanges: ALL },
  { base: 'STX', quote: 'USDT', name: 'Stacks', exchanges: ALTS },
  { base: 'KAS', quote: 'USDT', name: 'Kaspa', exchanges: ALTS },
  { base: 'HBAR', quote: 'USDT', name: 'Hedera', exchanges: ALL },
  { base: 'UNI', quote: 'USDT', name: 'Uniswap', exchanges: ALL },
  { base: 'AAVE', quote: 'USDT', name: 'Aave', exchanges: ALL },
  { base: 'ARB', quote: 'USDT', name: 'Arbitrum', exchanges: ALL },
  { base: 'OP', quote: 'USDT', name: 'Optimism', exchanges: ALL },
  { base: 'FET', quote: 'USDT', name: 'Artificial Superintelligence Alliance', exchanges: ALL },
  { base: 'RENDER', quote: 'USDT', name: 'Render', exchanges: ALTS },
  { base: 'TAO', quote: 'USDT', name: 'Bittensor', exchanges: ALTS },
  { base: 'JUP', quote: 'USDT', name: 'Jupiter', exchanges: ALTS },
  { base: 'PYTH', quote: 'USDT', name: 'Pyth Network', exchanges: ALTS },
  { base: 'ONDO', quote: 'USDT', name: 'Ondo', exchanges: ALTS },
  { base: 'ENA', quote: 'USDT', name: 'Ethena', exchanges: ALTS },
  { base: 'WLD', quote: 'USDT', name: 'Worldcoin', exchanges: ALL },
  { base: 'PEPE', quote: 'USDT', name: 'Pepe', exchanges: ALL },
  { base: 'SHIB', quote: 'USDT', name: 'Shiba Inu', exchanges: ALL },
  { base: 'FLOKI', quote: 'USDT', name: 'Floki', exchanges: ALTS },
  { base: 'BONK', quote: 'USDT', name: 'Bonk', exchanges: ALTS },
  { base: 'WIF', quote: 'USDT', name: 'dogwifhat', exchanges: ALTS },
  { base: 'ETH', quote: 'BTC', name: 'Ethereum / Bitcoin', exchanges: ALL },
];

export function cexToToken(instrument: CexInstrument, exchange: ExchangeId): Token {
  return {
    id: `cex:${exchange}:${instrument.base}${instrument.quote}`,
    symbol: `${instrument.base}/${instrument.quote}`,
    base: instrument.base,
    quote: instrument.quote,
    venue: 'CEX',
    exchange,
  };
}

/** Prefix/substring match on symbol and name – sync, so the CEX group is instant. */
export function matchCexUniverse(query: string, limit = 6): CexInstrument[] {
  const q = query.trim().toLowerCase().replace('/', '');
  if (q.length < 2) return [];
  const scored = CEX_UNIVERSE.map((instrument) => {
    const pair = `${instrument.base}${instrument.quote}`.toLowerCase();
    const pairSlashed = `${instrument.base}/${instrument.quote}`.toLowerCase();
    const name = instrument.name.toLowerCase();
    let score = -1;
    if (pair === q || pairSlashed === q) score = 0;
    else if (pair.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (pair.includes(q) || name.includes(q)) score = 3;
    return { instrument, score };
  }).filter((entry) => entry.score >= 0);

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry) => entry.instrument);
}
