// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * Free, keyless, CORS-enabled on-chain signal sources.
 *
 * Every endpoint in here was live-verified (schema + `access-control-allow-origin`)
 * before being wired in. All fetches go through `fetchJson` (timeout, 4 MiB cap,
 * 429 cooldown overlay, TTL cache + dedupe) and every parser is defensive:
 * a malformed upstream payload yields `null`, never a thrown field access.
 *
 * Sources:
 *   - mempool.space        → BTC mempool congestion, fee estimates, difficulty adjustment
 *   - *.blockscout.com     → ETH/Base/Arbitrum/Polygon gas, utilisation, activity, TVL
 *   - solana-rpc.publicnode.com → Solana slot + TPS (batched JSON-RPC)
 *   - api.llama.fi         → total DeFi TVL + 24 h delta + top chains
 *   - stablecoins.llama.fi → global stablecoin supply
 *   - api.geckoterminal.com→ trending DEX pools per chain (30 req/min)
 *   - api.dexscreener.com  → top boosted tokens (attention signal, 300 req/min)
 *   - api.gopluslabs.io    → token forensics: taxes, holders, top-10 + LP concentration
 */

import { GOPLUS_CHAIN_ID, type ChainId } from '@/lib/chains';
import { fetchJson } from './http';

/* ---------------------------------- types --------------------------------- */

export interface BtcSignals {
  /** Unconfirmed transaction count. */
  unconfirmed: number;
  /** Mempool size in virtual bytes. */
  vsize: number;
  /** Total fees of the mempool in sats. */
  totalFeeSats: number;
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  /** Estimated difficulty change at the next retarget, percent. */
  difficultyChangePct: number;
  remainingBlocks: number;
  /** Average block time over the epoch so far, seconds. */
  timeAvgSec: number;
}

export type TrackedEvmChain = 'ethereum' | 'base' | 'arbitrum' | 'polygon';

export const TRACKED_EVM_CHAINS: TrackedEvmChain[] = ['ethereum', 'base', 'arbitrum', 'polygon'];

const BLOCKSCOUT_HOST: Record<TrackedEvmChain, string> = {
  ethereum: 'eth.blockscout.com',
  base: 'base.blockscout.com',
  arbitrum: 'arbitrum.blockscout.com',
  polygon: 'polygon.blockscout.com',
};

export interface EvmChainSignals {
  chain: TrackedEvmChain;
  /** Gas prices in gwei (may be partial). */
  gasSlow: number | null;
  gasAverage: number | null;
  gasFast: number | null;
  /** Block gas utilisation, percent 0..100. */
  utilizationPct: number | null;
  /** Transactions so far today (instance-dependent). */
  txToday: number | null;
  /** Average block time in seconds. */
  blockTimeSec: number | null;
  /** Native coin price USD + 24 h change (Blockscout coin ticker). */
  coinPriceUsd: number | null;
  coinChange24hPct: number | null;
  /** Chain TVL when the instance reports one (Base does). */
  tvlUsd: number | null;
}

export interface SolanaSignals {
  slot: number;
  /** Average total TPS over the last performance samples. */
  tps: number;
  /** Average non-vote (user) TPS over the last performance samples. */
  nonVoteTps: number;
}

export interface DefiSignals {
  totalTvlUsd: number;
  /** 24 h change of total TVL, percent. */
  tvlChange24hPct: number | null;
  stablecoinSupplyUsd: number;
  /** Top chains by TVL. */
  topChains: { name: string; tvlUsd: number }[];
}

export interface HotPool {
  chain: string;
  name: string;
  change24hPct: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
}

export interface BoostedToken {
  chainId: string;
  address: string;
  /** Total paid boost amount (attention budget). */
  amount: number;
  description: string;
}

export interface DexHeat {
  pools: HotPool[];
  boosts: BoostedToken[];
}

export interface TokenForensics {
  chain: string;
  contract: string;
  holderCount: number | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  /** Combined share of the top 10 holders, percent 0..100. */
  top10Pct: number | null;
  /** Locked share of LP positions, percent 0..100 (max over LP holders). */
  lpLockedPct: number | null;
  isMintable: boolean;
  isHoneypot: boolean;
}

/* -------------------------------- helpers --------------------------------- */

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/* ------------------------------- bitcoin ---------------------------------- */

interface MempoolRaw {
  count?: number;
  vsize?: number;
  total_fee?: number;
}
interface FeesRaw {
  fastestFee?: number;
  halfHourFee?: number;
  hourFee?: number;
  economyFee?: number;
}
interface DifficultyRaw {
  difficultyChange?: number;
  remainingBlocks?: number;
  timeAvg?: number;
}

export async function fetchBtcSignals(signal?: AbortSignal): Promise<BtcSignals | null> {
  try {
    const [mempool, fees, difficulty] = await Promise.all([
      fetchJson<MempoolRaw>('https://mempool.space/api/mempool', {
        source: 'mempool.space',
        cacheTtlMs: 25_000,
        signal,
      }),
      fetchJson<FeesRaw>('https://mempool.space/api/v1/fees/recommended', {
        source: 'mempool.space',
        cacheTtlMs: 25_000,
        signal,
      }),
      fetchJson<DifficultyRaw>('https://mempool.space/api/v1/difficulty-adjustment', {
        source: 'mempool.space',
        cacheTtlMs: 25_000,
        signal,
      }),
    ]);

    const unconfirmed = num(mempool.count);
    const fastest = num(fees.fastestFee);
    if (unconfirmed == null || fastest == null) return null;

    return {
      unconfirmed,
      vsize: num(mempool.vsize) ?? 0,
      totalFeeSats: num(mempool.total_fee) ?? 0,
      fastestFee: fastest,
      halfHourFee: num(fees.halfHourFee) ?? fastest,
      hourFee: num(fees.hourFee) ?? fastest,
      economyFee: num(fees.economyFee) ?? fastest,
      difficultyChangePct: num(difficulty.difficultyChange) ?? 0,
      remainingBlocks: num(difficulty.remainingBlocks) ?? 0,
      timeAvgSec: num(difficulty.timeAvg) ?? 600_000,
    };
  } catch {
    return null;
  }
}

/* ---------------------------- EVM via Blockscout --------------------------- */

interface BlockscoutStats {
  gas_prices?: { slow?: number | string | null; average?: number | string | null; fast?: number | string | null } | null;
  network_utilization_percentage?: number;
  transactions_today?: string;
  average_block_time?: number;
  coin_price?: string;
  coin_price_change_percentage?: number;
  tvl?: string | number | null;
}

export async function fetchEvmChainSignals(
  chain: TrackedEvmChain,
  signal?: AbortSignal,
): Promise<EvmChainSignals | null> {
  try {
    const stats = await fetchJson<BlockscoutStats>(
      `https://${BLOCKSCOUT_HOST[chain]}/api/v2/stats`,
      { source: `blockscout:${chain}`, cacheTtlMs: 25_000, signal },
    );
    const gas = stats.gas_prices ?? {};
    // A response without any recognisable field is treated as a failure.
    if (gas.average == null && stats.network_utilization_percentage == null && stats.coin_price == null) {
      return null;
    }
    return {
      chain,
      gasSlow: num(gas.slow),
      gasAverage: num(gas.average),
      gasFast: num(gas.fast),
      utilizationPct: num(stats.network_utilization_percentage),
      txToday: num(stats.transactions_today),
      blockTimeSec: num(stats.average_block_time),
      coinPriceUsd: num(stats.coin_price),
      coinChange24hPct: num(stats.coin_price_change_percentage),
      tvlUsd: num(stats.tvl),
    };
  } catch {
    return null;
  }
}

export async function fetchEvmSignals(signal?: AbortSignal): Promise<Record<string, EvmChainSignals>> {
  const results = await Promise.all(TRACKED_EVM_CHAINS.map((chain) => fetchEvmChainSignals(chain, signal)));
  const out: Record<string, EvmChainSignals> = {};
  results.forEach((entry) => {
    if (entry) out[entry.chain] = entry;
  });
  return out;
}

/* ----------------------------- solana via RPC ------------------------------ */

interface RpcBatchResult {
  result?: unknown;
  error?: unknown;
}

export async function fetchSolanaSignals(signal?: AbortSignal): Promise<SolanaSignals | null> {
  try {
    const body = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'getSlot' },
      { jsonrpc: '2.0', id: 2, method: 'getRecentPerformanceSamples', params: [5] },
    ]);
    const batch = await fetchJson<RpcBatchResult[]>('https://solana-rpc.publicnode.com', {
      source: 'solana-rpc',
      body,
      cacheTtlMs: 15_000,
      signal,
    });
    const slot = num(batch?.[0]?.result);
    const samples = batch?.[1]?.result as
      | { numTransactions?: number; numNonVoteTransactions?: number; samplePeriodSecs?: number }[]
      | undefined;
    if (slot == null || !Array.isArray(samples) || samples.length === 0) return null;

    let total = 0;
    let nonVote = 0;
    let counted = 0;
    for (const sample of samples) {
      const secs = num(sample.samplePeriodSecs);
      const tx = num(sample.numTransactions);
      const nonVoteTx = num(sample.numNonVoteTransactions);
      if (secs && secs > 0 && tx != null && nonVoteTx != null) {
        total += tx / secs;
        nonVote += nonVoteTx / secs;
        counted += 1;
      }
    }
    if (counted === 0) return null;
    return { slot, tps: total / counted, nonVoteTps: nonVote / counted };
  } catch {
    return null;
  }
}

/* ------------------------------- DeFiLlama --------------------------------- */

interface ChainTvl {
  name?: string;
  tvl?: number;
}
interface HistoryPoint {
  date?: number;
  tvl?: number;
}
interface StablecoinAsset {
  circulating?: { peggedUSD?: number };
}

export async function fetchDefiSignals(signal?: AbortSignal): Promise<DefiSignals | null> {
  try {
    const [chains, history, stables] = await Promise.all([
      fetchJson<ChainTvl[]>('https://api.llama.fi/v2/chains', {
        source: 'defillama',
        cacheTtlMs: 120_000,
        signal,
      }),
      fetchJson<HistoryPoint[]>('https://api.llama.fi/v2/historicalChainTvl', {
        source: 'defillama',
        cacheTtlMs: 120_000,
        signal,
      }),
      fetchJson<{ peggedAssets?: StablecoinAsset[] }>('https://stablecoins.llama.fi/stablecoins?includePrices=false', {
        source: 'defillama',
        cacheTtlMs: 120_000,
        signal,
      }),
    ]);

    const usableHistory = (Array.isArray(history) ? history : []).filter(
      (point) => num(point.tvl) != null,
    );
    const latest = usableHistory[usableHistory.length - 1];
    const previous = usableHistory[usableHistory.length - 2];
    const totalTvlUsd = num(latest?.tvl);
    if (totalTvlUsd == null) return null;

    const prevTvl = num(previous?.tvl);
    const change = prevTvl != null && prevTvl > 0 ? ((totalTvlUsd - prevTvl) / prevTvl) * 100 : null;

    const topChains = (Array.isArray(chains) ? chains : [])
      .map((entry) => ({ name: entry.name ?? '?', tvlUsd: num(entry.tvl) ?? 0 }))
      .filter((entry) => entry.tvlUsd > 0)
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, 6);

    const stablecoinSupplyUsd = (stables?.peggedAssets ?? []).reduce(
      (sum, asset) => sum + (num(asset.circulating?.peggedUSD) ?? 0),
      0,
    );

    return { totalTvlUsd, tvlChange24hPct: change, stablecoinSupplyUsd, topChains };
  } catch {
    return null;
  }
}

/* ------------------------------ DEX heat ----------------------------------- */

const TRENDING_NETWORKS = ['eth', 'solana', 'base', 'bsc'] as const;

interface TrendingPoolAttr {
  name?: string;
  price_change_percentage?: { h24?: string | number };
  volume_usd?: { h24?: string | number };
  base_token_price_usd?: string | number;
}
interface TrendingResponse {
  data?: { attributes?: TrendingPoolAttr }[];
}
interface BoostEntry {
  chainId?: string;
  tokenAddress?: string;
  totalAmount?: number;
  description?: string;
}

export async function fetchDexHeat(signal?: AbortSignal): Promise<DexHeat> {
  const [poolResults, boosts] = await Promise.all([
    Promise.all(
      TRENDING_NETWORKS.map(async (network): Promise<HotPool[]> => {
        try {
          const response = await fetchJson<TrendingResponse>(
            `https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools?page=1`,
            { source: 'geckoterminal', cacheTtlMs: 60_000, signal },
          );
          return (response.data ?? []).slice(0, 3).map((pool) => {
            const attr = pool.attributes ?? {};
            return {
              chain: network,
              name: attr.name ?? '?',
              change24hPct: num(attr.price_change_percentage?.h24),
              volume24hUsd: num(attr.volume_usd?.h24),
              priceUsd: num(attr.base_token_price_usd),
            };
          });
        } catch {
          return [];
        }
      }),
    ),
    (async (): Promise<BoostedToken[]> => {
      try {
        const entries = await fetchJson<BoostEntry[]>('https://api.dexscreener.com/token-boosts/top/v1', {
          source: 'dexscreener',
          cacheTtlMs: 60_000,
          signal,
        });
        return (Array.isArray(entries) ? entries : [])
          .filter((entry) => entry.tokenAddress && entry.chainId)
          .slice(0, 6)
          .map((entry) => ({
            chainId: entry.chainId as string,
            address: entry.tokenAddress as string,
            amount: num(entry.totalAmount) ?? 0,
            description: (entry.description ?? '').slice(0, 120),
          }));
      } catch {
        return [];
      }
    })(),
  ]);

  return { pools: poolResults.flat(), boosts };
}

/* ------------------------- token forensics (GoPlus) ------------------------- */

interface GoPlusHolder {
  percent?: number | string;
  is_locked?: number | string;
}
interface GoPlusTokenSecurity {
  code?: number;
  result?: Record<
    string,
    | {
        holder_count?: string;
        buy_tax?: string;
        sell_tax?: string;
        is_mintable?: string;
        is_honeypot?: string;
        holders?: GoPlusHolder[];
        lp_holders?: GoPlusHolder[];
      }
    | undefined
  >;
}

export async function fetchTokenForensics(
  chain: string,
  contract: string,
  signal?: AbortSignal,
): Promise<TokenForensics | null> {
  const chainId = GOPLUS_CHAIN_ID[chain as ChainId];
  if (!chainId || !contract) return null;
  try {
    const payload = await fetchJson<GoPlusTokenSecurity>(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(contract.toLowerCase())}`,
      {
        source: 'goplus',
        cacheTtlMs: 600_000,
        signal,
        // GoPlus drosselt mit HTTP 200 + code 4029 – ohne diese Prüfung wird
        // die Drossel-Antwort 10 Minuten gecacht und die Forensik bleibt OFFLINE.
        inspectBody: (value) => {
          const code = (value as { code?: number } | null)?.code;
          if (code == null || code === 1) return null;
          return code === 4029 ? 'rate-limit' : 'invalid';
        },
      },
    );
    const entry = Object.entries(payload.result ?? {}).find(
      ([address]) => address.toLowerCase() === contract.toLowerCase(),
    )?.[1];
    if (!entry) return null;

    const holders = (entry.holders ?? []).filter((holder) => num(holder.percent) != null);
    const top10Shares = holders
      .map((holder) => (num(holder.percent) ?? 0) * 100)
      .sort((a, b) => b - a)
      .slice(0, 10);
    const top10 = top10Shares.length > 0 ? top10Shares.reduce((sum, value) => sum + value, 0) : null;

    const lpLocked = (entry.lp_holders ?? []).reduce((max, lp) => {
      const locked = lp.is_locked === 1 || lp.is_locked === '1';
      const percent = num(lp.percent) ?? 0;
      return locked ? Math.max(max, percent * 100) : max;
    }, 0);

    return {
      chain,
      contract,
      holderCount: num(entry.holder_count),
      buyTaxPct: num(entry.buy_tax) != null ? (num(entry.buy_tax) as number) * 100 : null,
      sellTaxPct: num(entry.sell_tax) != null ? (num(entry.sell_tax) as number) * 100 : null,
      top10Pct: top10,
      lpLockedPct: lpLocked > 0 ? lpLocked : null,
      isMintable: entry.is_mintable === '1',
      isHoneypot: entry.is_honeypot === '1',
    };
  } catch {
    return null;
  }
}
