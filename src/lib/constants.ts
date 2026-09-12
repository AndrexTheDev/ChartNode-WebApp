// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Token } from '@/store/types';

export const SITE_NAME = 'NodeChart';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nodechart.cc').replace(/\/$/, '');

/** Slogan – kept in code (not in messages) because it is the brand line. */
export const TAGLINE = 'Decode the Market. Free, Fast, Decentralized.';

export const CONTACT = {
  email: 'hippie.highho@gmail.com',
  handle: 'AndrexTheDev',
  mailto: 'mailto:hippie.highho@gmail.com?subject=NodeChart%20%E2%80%93%20Feedback',
} as const;

export const APP_VERSION = '0.1.0';

/**
 * Seed instruments. Part 2 replaces the *prices* with live WebSocket feeds;
 * the instrument definitions themselves are static config and stay as-is.
 */
export const SEED_TOKENS: Token[] = [
  {
    id: 'cex:binance:BTCUSDT',
    symbol: 'BTC/USDT',
    base: 'BTC',
    quote: 'USDT',
    venue: 'CEX',
    exchange: 'binance',
  },
  {
    id: 'cex:binance:ETHUSDT',
    symbol: 'ETH/USDT',
    base: 'ETH',
    quote: 'USDT',
    venue: 'CEX',
    exchange: 'binance',
  },
  {
    id: 'cex:bybit:SOLUSDT',
    symbol: 'SOL/USDT',
    base: 'SOL',
    quote: 'USDT',
    venue: 'CEX',
    exchange: 'bybit',
  },
  {
    id: 'dex:ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'WBTC/ETH',
    base: 'WBTC',
    quote: 'ETH',
    venue: 'DEX',
    chain: 'ethereum',
    contract: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  },
  {
    id: 'dex:base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    symbol: 'USDC/ETH',
    base: 'USDC',
    quote: 'ETH',
    venue: 'DEX',
    chain: 'base',
    contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  },
];

export const DEFAULT_TOKEN = SEED_TOKENS[0]!;

/** Lookup used by `selectTokenById`. */
export const TOKEN_INDEX: Record<string, Token> = Object.fromEntries(
  SEED_TOKENS.map((token) => [token.id, token]),
);

/**
 * Ticker seed for the landing-page marquee. Purely presentational in Part 1 –
 * the values are deterministic demo data and are replaced by the live feed in
 * Part 2 (`useMarketStore`). Marked so nobody mistakes them for real quotes.
 */
export const TICKER_SEED = [
  { symbol: 'BTC/USDT', venue: 'CEX', change: 2.41 },
  { symbol: 'ETH/USDT', venue: 'CEX', change: -1.08 },
  { symbol: 'SOL/USDT', venue: 'CEX', change: 5.62 },
  { symbol: 'WBTC/ETH', venue: 'DEX', change: 0.34 },
  { symbol: 'ARB/USDT', venue: 'CEX', change: -3.17 },
  { symbol: 'USDC/ETH', venue: 'DEX', change: 1.12 },
  { symbol: 'LINK/USDT', venue: 'CEX', change: 4.05 },
  { symbol: 'MATIC/USDT', venue: 'CEX', change: -0.72 },
  { symbol: 'PEPE/ETH', venue: 'DEX', change: 8.94 },
  { symbol: 'AVAX/USDT', venue: 'CEX', change: -2.23 },
] as const;

/** App-wide routes, locale-relative (pass them to the next-intl `Link`). */
export const ROUTES = {
  home: '/',
  terminal: '/terminal',
  help: '/help',
  terms: '/legal/terms',
  disclaimer: '/legal/disclaimer',
  privacy: '/legal/privacy',
} as const;

export const STORAGE_KEY = 'nodechart:store:v1';
