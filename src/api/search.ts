// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { classifyQuery, type QueryKind } from '@/lib/address';
import { matchCexUniverse } from '@/lib/cex-universe';
import { dexscreenerByToken, dexscreenerSearch } from './dexscreener';
import { geckoSearchPools } from './geckoterminal';
import type { DexPair, SearchHit } from './types';

export interface SmartSearchResult {
  kind: QueryKind;
  hits: SearchHit[];
  tookMs: number;
}

const DEX_HIT_CAP = 10;

/**
 * One entry point for the Smart Search bar.
 *
 *   text          → CEX universe (sync) + DexScreener, GeckoTerminal only as fallback
 *   EVM/Solana CA → DexScreener token lookup, GeckoTerminal only on a miss
 *
 * Security audits are intentionally NOT awaited here – the dropdown renders
 * immediately and the badges resolve asynchronously (green/red glow).
 */
export async function smartSearch(query: string, signal?: AbortSignal): Promise<SmartSearchResult> {
  const startedAt = performance.now();
  const kind = classifyQuery(query);

  if (kind === 'text') {
    const cexHits: SearchHit[] = matchCexUniverse(query).map((instrument) => ({
      kind: 'cex',
      id: `cex:${instrument.base}${instrument.quote}`,
      symbol: `${instrument.base}/${instrument.quote}`,
      name: instrument.name,
      exchange: instrument.exchanges[0] ?? 'binance',
      exchanges: instrument.exchanges,
    }));

    const dexPairs = await searchDex(query, signal);
    return {
      kind,
      hits: [...cexHits, ...dexPairs.map(toDexHit).slice(0, DEX_HIT_CAP)],
      tookMs: Math.round(performance.now() - startedAt),
    };
  }

  const address = query.trim();
  const pairs: DexPair[] = [];
  try {
    pairs.push(...(await dexscreenerByToken([address], signal)));
  } catch {
    // Try the independent fallback below.
  }

  // If DexScreener is down or has no match, search GeckoTerminal by address
  // instead of returning an empty dropdown. This keeps the common path cheap:
  // the extra global search is only issued when the primary lookup is empty.
  if (pairs.length === 0) {
    try {
      pairs.push(...(await geckoSearchPools(address, signal)));
    } catch {
      // Search remains usable even when both public aggregators are offline.
    }
  }

  // Do not issue a second GeckoTerminal lookup to enrich a successful primary
  // response: the public API is about 10 calls/minute, and the search result
  // already has enough pool data to select and chart the token.

  // A failure with no Gecko result is intentionally represented as no hits,
  // not a rejected promise that can collapse the surrounding search UI.
  return {
    kind,
    hits: dedupePairs(pairs).map(toDexHit).slice(0, DEX_HIT_CAP),
    tookMs: Math.round(performance.now() - startedAt),
  };
}

async function searchDex(query: string, signal?: AbortSignal): Promise<DexPair[]> {
  try {
    const primary = await dexscreenerSearch(query, signal);
    if (primary.length > 0) return dedupePairs(primary);
  } catch {
    if (signal?.aborted) return [];
    // Fall through to the independent index below.
  }

  // GeckoTerminal is deliberately fallback-only. Its public keyless limit is
  // much lower than DexScreener's, so don't spend a request when the primary
  // search already found pools.
  try {
    return dedupePairs(await geckoSearchPools(query, signal));
  } catch {
    return [];
  }
}

/** Same token on the same chain from two providers → keep the deeper pool. */
function dedupePairs(pairs: DexPair[]): DexPair[] {
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    const key = `${pair.chain}:${pair.baseAddress.toLowerCase()}`;
    const existing = best.get(key);
    if (!existing || (pair.liquidityUsd ?? 0) > (existing.liquidityUsd ?? 0)) best.set(key, pair);
  }
  return [...best.values()].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

function toDexHit(pair: DexPair): SearchHit {
  return { kind: 'dex', id: `${pair.source}:${pair.chain}:${pair.pairAddress}`, pair };
}
