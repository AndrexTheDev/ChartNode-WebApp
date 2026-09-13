// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { classifyQuery, type QueryKind } from '@/lib/address';
import { matchCexUniverse } from '@/lib/cex-universe';
import { dexscreenerByToken, dexscreenerSearch } from './dexscreener';
import { geckoPoolsByToken, geckoSearchPools } from './geckoterminal';
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
 *   text          → CEX universe (sync) ∥ DexScreener ∥ GeckoTerminal
 *   EVM/Solana CA → DexScreener token lookup ∥ GeckoTerminal pools (known chain)
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
  const pairs = await dexscreenerByToken([address], signal);

  // GeckoTerminal needs a network: reuse whatever chain DexScreener detected.
  const chains = [...new Set(pairs.map((pair) => pair.chain))].slice(0, 2);
  const geckoExtra = await Promise.allSettled(
    chains.map((chain) => geckoPoolsByToken(chain, address, signal)),
  );
  for (const result of geckoExtra) {
    if (result.status === 'fulfilled') pairs.push(...result.value);
  }

  return {
    kind,
    hits: dedupePairs(pairs).map(toDexHit).slice(0, DEX_HIT_CAP),
    tookMs: Math.round(performance.now() - startedAt),
  };
}

async function searchDex(query: string, signal?: AbortSignal): Promise<DexPair[]> {
  const results = await Promise.allSettled([
    dexscreenerSearch(query, signal),
    geckoSearchPools(query, signal),
  ]);

  const pairs: DexPair[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') pairs.push(...result.value);
  }
  return dedupePairs(pairs);
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
