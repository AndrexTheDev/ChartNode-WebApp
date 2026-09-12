// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { CHAIN_TO_GECKO_NETWORK, GECKO_NETWORK_TO_CHAIN, type ChainId } from '@/lib/chains';
import { fetchJson } from './http';
import type { Candle } from '@/websockets/types';
import type { DexPair } from './types';

const BASE = 'https://api.geckoterminal.com/api/v2';

interface GtAttributes {
  name?: string;
  address?: string;
  base_token_price_usd?: string | null;
  reserve_in_usd?: string | null;
  volume_usd?: { h24?: string | number | null } | null;
  price_change_percentage?: { h24?: string | number | null } | null;
}

interface GtRelationshipRef {
  id?: string;
}

interface GtPool {
  id?: string;
  attributes?: GtAttributes;
  relationships?: {
    base_token?: { data?: GtRelationshipRef };
    network?: { data?: GtRelationshipRef };
    dex?: { data?: GtRelationshipRef };
  };
}

interface GtResponse {
  data?: GtPool[];
}

function toNum(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `uniswap_v2` → `Uniswap V2`, `raydium_clmm` → `Raydium Clmm`. */
function prettyDex(id: string | undefined): string {
  if (!id) return 'GeckoTerminal';
  return id
    .split('_')
    .map((part) => (/^v\d+$/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** `eth_0xabc…` → { chain, address } */
function splitRef(ref: string | undefined): { chain: ChainId | null; address: string | null } {
  if (!ref) return { chain: null, address: null };
  const index = ref.indexOf('_');
  if (index < 0) return { chain: null, address: ref };
  const network = ref.slice(0, index);
  return { chain: GECKO_NETWORK_TO_CHAIN[network] ?? null, address: ref.slice(index + 1) };
}

function normalise(pool: GtPool): DexPair | null {
  const attributes = pool.attributes;
  const id = pool.id;
  if (!attributes?.address || !id) return null;

  const networkFromId = GECKO_NETWORK_TO_CHAIN[id.split('_')[0] ?? ''] ?? null;
  const networkRel = splitRef(pool.relationships?.network?.data?.id).chain;
  const chain = networkRel ?? networkFromId;
  if (!chain) return null;

  const base = splitRef(pool.relationships?.base_token?.data?.id);
  const name = attributes.name ?? '';
  const [baseSymbol = '???', quoteSymbol = '???'] = name.split('/').map((part) => part.trim());

  return {
    source: 'geckoterminal',
    chain,
    dex: prettyDex(pool.relationships?.dex?.data?.id),
    pairAddress: attributes.address,
    baseSymbol: baseSymbol ?? '???',
    baseName: baseSymbol ?? '???',
    baseAddress: base.address ?? attributes.address,
    quoteSymbol: quoteSymbol ?? '???',
    priceUsd: toNum(attributes.base_token_price_usd),
    liquidityUsd: toNum(attributes.reserve_in_usd),
    volume24h: toNum(attributes.volume_usd?.h24),
    change24h: toNum(attributes.price_change_percentage?.h24),
    url: `https://www.geckoterminal.com/${CHAIN_TO_GECKO_NETWORK[chain]}/pools/${attributes.address}`,
  };
}

/** Pool search. Free tier: 30 calls/min – cached + deduped in http layer. */
export async function geckoSearchPools(query: string, signal?: AbortSignal): Promise<DexPair[]> {
  const payload = await fetchJson<GtResponse>(
    `${BASE}/search/pools?query=${encodeURIComponent(query)}&page=1`,
    { source: 'geckoterminal', cacheTtlMs: 20_000, signal },
  );
  return (payload.data ?? []).map(normalise).filter((p): p is DexPair => p !== null);
}

/** Pools for a token address on a specific network. */
export async function geckoPoolsByToken(
  chain: ChainId,
  tokenAddress: string,
  signal?: AbortSignal,
): Promise<DexPair[]> {
  const network = CHAIN_TO_GECKO_NETWORK[chain];
  const payload = await fetchJson<GtResponse>(
    `${BASE}/networks/${network}/tokens/${tokenAddress}/pools?page=1`,
    {
      source: 'geckoterminal',
      cacheTtlMs: 20_000,
      signal,
      // GeckoTerminal free tier: 30 req/min – L2-Fallback hält das DEX-Chart
      // bei einem 429-Sturm am Leben (letzte gute Pool-Liste, 6 h).
      persistKey: `gt:pools:${chain}:${tokenAddress.toLowerCase()}`,
      staleTtlMs: 6 * 60 * 60 * 1000,
    },
  );
  return (payload.data ?? []).map(normalise).filter((p): p is DexPair => p !== null);
}

/* --------------------------------- OHLCV ------------------------------------ */

/** timeframe → (GeckoTerminal unit, aggregate) */
const OHLCV_TF: Record<string, [string, number]> = {
  '1m': ['minute', 1],
  '5m': ['minute', 5],
  '15m': ['minute', 15],
  '1h': ['hour', 1],
  '4h': ['hour', 4],
  '1d': ['day', 1],
  '1w': ['day', 7],
};

/**
 * Real candle history for DEX tokens – the top pool of the token on its chain,
 * straight from GeckoTerminal OHLCV (free, 30 req/min). This is what turns a
 * DEX quote card into a full chart.
 */
export async function fetchDexCandles(
  chain: ChainId,
  tokenAddress: string,
  timeframe: string,
  signal?: AbortSignal,
): Promise<Candle[] | null> {
  const tf = OHLCV_TF[timeframe];
  const network = CHAIN_TO_GECKO_NETWORK[chain];
  if (!tf || !network) return null;

  const pools = await geckoPoolsByToken(chain, tokenAddress, signal);
  const pool = pools[0];
  if (!pool) return null;

  const payload = await fetchJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
    `${BASE}/networks/${network}/pools/${pool.pairAddress}/ohlcv/${tf[0]}?aggregate=${tf[1]}&limit=300&currency=usd`,
    {
      source: 'geckoterminal',
      cacheTtlMs: 30_000,
      signal,
      // Historische DEX-Kerzen: bis zu 12 h alte Kopie schlägt leeres Chart.
      persistKey: `gt:ohlcv:${network}:${pool.pairAddress.toLowerCase()}:${timeframe}`,
      staleTtlMs: 12 * 60 * 60 * 1000,
    },
  );

  const rows = payload.data?.attributes?.ohlcv_list ?? [];
  const candles: Candle[] = [];
  for (const row of rows) {
    const t = (row[0] ?? 0) * 1000;
    const [o, h, l, c] = [row[1], row[2], row[3], row[4]];
    const v = row[5] ?? 0;
    if ([t, o, h, l, c].every((value) => Number.isFinite(value))) {
      candles.push({ t, o: o as number, h: h as number, l: l as number, c: c as number, v });
    }
  }
  candles.sort((a, b) => a.t - b.t);
  return candles.length > 1 ? candles : null;
}
