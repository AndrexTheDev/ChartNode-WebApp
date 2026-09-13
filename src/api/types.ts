// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ChainId } from '@/lib/chains';

/** Normalised liquidity pool / pair from any DEX aggregator. */
export interface DexPair {
  source: 'dexscreener' | 'geckoterminal';
  chain: ChainId;
  dex: string;
  pairAddress: string;
  baseSymbol: string;
  baseName: string;
  baseAddress: string;
  quoteSymbol: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  change24h: number | null;
  url: string | null;
}

export type AuditProvider = 'goplus' | 'rugcheck' | 'honeypot';

export type AuditVerdict = 'safe' | 'warn' | 'danger' | 'unknown';

export interface SecurityAudit {
  provider: AuditProvider;
  chain: ChainId;
  contract: string;
  verdict: AuditVerdict;
  /** 0 = clean … 100 = worst (RugCheck normalised score; GoPlus derived). */
  riskScore: number | null;
  flags: string[];
  checkedAt: number;
}

export type SearchHit =
  | { kind: 'cex'; id: string; symbol: string; name: string; exchange: string; exchanges: string[] }
  | { kind: 'dex'; id: string; pair: DexPair };
