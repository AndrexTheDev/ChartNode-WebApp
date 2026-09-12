// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { normaliseDexscreenerChain } from '@/lib/chains';
import { fetchJson } from './http';
import type { DexPair } from './types';

const BASE = 'https://api.dexscreener.com';

interface DsToken {
  address?: string;
  name?: string;
  symbol?: string;
}

interface DsPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: DsToken;
  quoteToken?: DsToken;
  priceUsd?: string | null;
  liquidity?: { usd?: number | null } | null;
  volume?: { h24?: number | null } | null;
  priceChange?: { h24?: number | null } | null;
  url?: string;
}

interface DsResponse {
  pairs?: DsPair[] | null;
}

function toNum(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalise(raw: DsPair): DexPair | null {
  const chain = normaliseDexscreenerChain(raw.chainId ?? '');
  const base = raw.baseToken;
  if (!chain || !base?.address || !raw.pairAddress) return null;

  return {
    source: 'dexscreener',
    chain,
    dex: raw.dexId ?? 'unknown',
    pairAddress: raw.pairAddress,
    baseSymbol: base.symbol ?? '???',
    baseName: base.name ?? base.symbol ?? '???',
    baseAddress: base.address,
    quoteSymbol: raw.quoteToken?.symbol ?? '???',
    priceUsd: toNum(raw.priceUsd),
    liquidityUsd: raw.liquidity?.usd ?? null,
    volume24h: raw.volume?.h24 ?? null,
    change24h: raw.priceChange?.h24 ?? null,
    url: raw.url ?? null,
  };
}

/** Full-text search across every chain DexScreener indexes. ~300 req/min cap. */
export async function dexscreenerSearch(query: string, signal?: AbortSignal): Promise<DexPair[]> {
  const payload = await fetchJson<DsResponse>(
    `${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
    { source: 'dexscreener', cacheTtlMs: 20_000, signal },
  );
  return (payload.pairs ?? []).map(normalise).filter((p): p is DexPair => p !== null);
}

/** Direct lookup by one or more token (mint/contract) addresses. */
export async function dexscreenerByToken(
  addresses: string[],
  signal?: AbortSignal,
): Promise<DexPair[]> {
  if (addresses.length === 0) return [];
  const payload = await fetchJson<DsResponse>(
    `${BASE}/latest/dex/tokens/${addresses.join(',')}`,
    {
      source: 'dexscreener',
      cacheTtlMs: 20_000,
      signal,
      // DEX-Quote/Karten bleiben bei 429 (DexScreener: 300 req/min) lesbar:
      // letzte gute Kopie aus dem L2-Cache statt leerem Panel.
      persistKey: `ds:tokens:${addresses.map((a) => a.toLowerCase()).join(',')}`,
      staleTtlMs: 6 * 60 * 60 * 1000,
    },
  );
  return (payload.pairs ?? []).map(normalise).filter((p): p is DexPair => p !== null);
}
