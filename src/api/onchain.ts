// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * Keyless public on-chain signal sources configured for browser use.
 *
 * Provider schema, CORS, geographic access, quotas and uptime can change; a
 * previous successful observation is not a reachability guarantee. All fetches
 * go through `fetchJson` (timeout, response-size cap, provider-aware retry,
 * TTL cache + dedupe) and parsers preserve missing fields as `null` rather than
 * fabricating clean/zero readings.
 *
 * Sources:
 *   - mempool.space        → BTC mempool congestion, fee estimates, difficulty adjustment
 *   - *.blockscout.com     → ETH/Base/Arbitrum/Polygon gas, utilisation, activity, TVL
 *   - PublicNode EVM RPCs  → `eth_gasPrice` fallback only when Blockscout gas is absent
 *   - solana-rpc.publicnode.com → Solana slot + TPS (batched JSON-RPC)
 *   - api.llama.fi         → total DeFi TVL + 24 h delta + top chains
 *   - stablecoins.llama.fi → global stablecoin supply
 *   - api.geckoterminal.com→ global trending DEX pools (about 10 req/min; budgeted below that)
 *   - api.dexscreener.com  → top boosted tokens (attention signal, 300 req/min)
 *   - api.gopluslabs.io    → token forensics: taxes, holders, top-10 + LP concentration
 */

import { GECKO_NETWORK_TO_CHAIN, GOPLUS_CHAIN_ID, type ChainId } from '@/lib/chains';
import { fetchHoneypotSimulation } from './security';
import { fetchJson } from './http';
import { GECKO_API_HEADERS } from './geckoterminal';

/* ---------------------------------- types --------------------------------- */

export interface BtcSignals {
  /** Unconfirmed transaction count. */
  unconfirmed: number | null;
  /** Mempool size in virtual bytes. */
  vsize: number | null;
  /** Total fees of the mempool in sats. */
  totalFeeSats: number | null;
  fastestFee: number | null;
  halfHourFee: number | null;
  hourFee: number | null;
  economyFee: number | null;
  /** Estimated difficulty change at the next retarget, percent. */
  difficultyChangePct: number | null;
  remainingBlocks: number | null;
  /** Mempool.space reports average block time in milliseconds. */
  timeAvgMs: number | null;
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
  /** Which configured public source(s) contributed to this row. */
  source: 'blockscout' | 'publicnode' | 'mixed';
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
  totalTvlUsd: number | null;
  /** Approx. 24 h change from the latest two DeFiLlama history points; their spacing can vary. */
  tvlChange24hPct: number | null;
  stablecoinSupplyUsd: number | null;
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
  provider: 'goplus' | 'honeypot';
  holderCount: number | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  /** Combined share of the top 10 holders, percent 0..100. */
  top10Pct: number | null;
  /** Locked share of LP positions, percent 0..100 (max over LP holders). */
  lpLockedPct: number | null;
  isMintable: boolean | null;
  isHoneypot: boolean | null;
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

type BlockstreamFeeEstimates = Record<string, number | string>;

function feeAtTargets(estimates: BlockstreamFeeEstimates | null, targets: number[]): number | null {
  for (const target of targets) {
    const value = num(estimates?.[String(target)]);
    if (value != null) return value;
  }
  return null;
}

export async function fetchBtcSignals(signal?: AbortSignal): Promise<BtcSignals | null> {
  const [mempoolResult, feesResult, difficultyResult] = await Promise.allSettled([
    fetchJson<MempoolRaw>('https://mempool.space/api/mempool', {
      source: 'mempool.space', cacheTtlMs: 25_000, retries: 1, signal,
    }),
    fetchJson<FeesRaw>('https://mempool.space/api/v1/fees/recommended', {
      source: 'mempool.space', cacheTtlMs: 25_000, retries: 1, signal,
    }),
    fetchJson<DifficultyRaw>('https://mempool.space/api/v1/difficulty-adjustment', {
      source: 'mempool.space', cacheTtlMs: 25_000, retries: 1, signal,
    }),
  ]);
  let mempool = mempoolResult.status === 'fulfilled' ? mempoolResult.value : null;
  const fees = feesResult.status === 'fulfilled' ? feesResult.value : null;
  const difficulty = difficultyResult.status === 'fulfilled' ? difficultyResult.value : null;
  let esploraFees: BlockstreamFeeEstimates | null = null;

  // mempool.space explicitly rate-limits its public REST API and may ban
  // repeated overuse; use Blockstream's independent Esplora read API only for
  // missing mempool/fee data. Difficulty adjustment has no direct equivalent
  // in this fallback and therefore stays unknown if its primary request fails.
  const needMempool = num(mempool?.count) == null || num(mempool?.vsize) == null;
  const needFees = num(fees?.fastestFee) == null;
  const [esploraMempoolResult, esploraFeesResult] = await Promise.all([
    needMempool
      ? fetchJson<MempoolRaw>('https://blockstream.info/api/mempool', {
          source: 'blockstream-esplora', cacheTtlMs: 25_000, retries: 1, signal,
        }).then((value) => value).catch(() => null)
      : Promise.resolve(null),
    needFees
      ? fetchJson<BlockstreamFeeEstimates>('https://blockstream.info/api/fee-estimates', {
          source: 'blockstream-esplora', cacheTtlMs: 25_000, retries: 1, signal,
        }).then((value) => value).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (needMempool && esploraMempoolResult) mempool = esploraMempoolResult;
  if (needFees) esploraFees = esploraFeesResult;

  const unconfirmed = num(mempool?.count);
  const vsize = num(mempool?.vsize);
  const fastestFee = num(fees?.fastestFee) ?? feeAtTargets(esploraFees, [1, 2]);
  const halfHourFee = num(fees?.halfHourFee) ?? feeAtTargets(esploraFees, [3, 4, 5]);
  const hourFee = num(fees?.hourFee) ?? feeAtTargets(esploraFees, [6, 8, 12]);
  const economyFee = num(fees?.economyFee) ?? feeAtTargets(esploraFees, [24, 18, 12, 6]);
  const difficultyChangePct = num(difficulty?.difficultyChange);
  const remainingBlocks = num(difficulty?.remainingBlocks);
  const timeAvgMs = num(difficulty?.timeAvg);

  if (
    unconfirmed == null && fastestFee == null && halfHourFee == null && hourFee == null &&
    economyFee == null && difficultyChangePct == null && remainingBlocks == null && timeAvgMs == null
  ) return null;

  return {
    unconfirmed,
    vsize,
    totalFeeSats: num(mempool?.total_fee),
    fastestFee,
    halfHourFee,
    hourFee,
    economyFee,
    difficultyChangePct,
    remainingBlocks,
    timeAvgMs,
  };
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

interface RpcGasPriceResponse {
  result?: string;
  error?: unknown;
}

const PUBLICNODE_EVM_RPC: Record<TrackedEvmChain, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
};

/** Low-cadence, keyless RPC fallback for the average gas-price field only. */
async function fetchRpcGasAverage(chain: TrackedEvmChain, signal?: AbortSignal): Promise<number | null> {
  try {
    const payload = await fetchJson<RpcGasPriceResponse>(PUBLICNODE_EVM_RPC[chain], {
      source: `publicnode-evm:${chain}`,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
      cacheTtlMs: 25_000,
      retries: 1,
      signal,
    });
    if (typeof payload.result !== 'string' || !/^0x[0-9a-f]+$/i.test(payload.result)) return null;
    const gwei = Number(BigInt(payload.result)) / 1_000_000_000;
    return Number.isFinite(gwei) ? gwei : null;
  } catch {
    return null;
  }
}

export async function fetchEvmChainSignals(
  chain: TrackedEvmChain,
  signal?: AbortSignal,
): Promise<EvmChainSignals | null> {
  const stats = await fetchJson<BlockscoutStats>(
    `https://${BLOCKSCOUT_HOST[chain]}/api/v2/stats`,
    { source: `blockscout:${chain}`, cacheTtlMs: 25_000, signal },
  ).catch(() => null);
  const gas = stats?.gas_prices ?? {};
  const blockscoutFields = [
    gas.slow,
    gas.average,
    gas.fast,
    stats?.network_utilization_percentage,
    stats?.transactions_today,
    stats?.average_block_time,
    stats?.coin_price,
    stats?.coin_price_change_percentage,
    stats?.tvl,
  ];
  const hasBlockscout = blockscoutFields.some((value) => num(value) != null);

  // Blockscout is the rich stats source. If it is unavailable or omits its
  // average gas quote, PublicNode can supply only eth_gasPrice; all other
  // missing fields stay unknown instead of being inferred from unrelated data.
  const rpcGasAverage = num(gas.average) == null ? await fetchRpcGasAverage(chain, signal) : null;
  const gasAverage = num(gas.average) ?? rpcGasAverage;
  const hasPublicNode = rpcGasAverage != null;
  if (!hasBlockscout && !hasPublicNode) return null;

  return {
    chain,
    source: hasBlockscout && hasPublicNode ? 'mixed' : hasBlockscout ? 'blockscout' : 'publicnode',
    gasSlow: num(gas.slow),
    gasAverage,
    gasFast: num(gas.fast),
    utilizationPct: num(stats?.network_utilization_percentage),
    txToday: num(stats?.transactions_today),
    blockTimeSec: num(stats?.average_block_time),
    coinPriceUsd: num(stats?.coin_price),
    coinChange24hPct: num(stats?.coin_price_change_percentage),
    tvlUsd: num(stats?.tvl),
  };
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
  id?: number;
  result?: unknown;
  error?: unknown;
}

function parseSolanaSignals(slotValue: unknown, samplesValue: unknown): SolanaSignals | null {
  const slot = num(slotValue);
  const samples = samplesValue as
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
  return counted > 0 ? { slot, tps: total / counted, nonVoteTps: nonVote / counted } : null;
}

export async function fetchSolanaSignals(signal?: AbortSignal): Promise<SolanaSignals | null> {
  const publicNodeUrl = 'https://solana-rpc.publicnode.com';
  const body = JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'getSlot' },
    { jsonrpc: '2.0', id: 2, method: 'getRecentPerformanceSamples', params: [5] },
  ]);
  try {
    const batch = await fetchJson<RpcBatchResult[]>(publicNodeUrl, {
      source: 'solana-rpc', body, cacheTtlMs: 15_000, retries: 1, signal,
    });
    const slotRow = batch.find((entry) => entry.id === 1) ?? batch[0];
    const samplesRow = batch.find((entry) => entry.id === 2) ?? batch[1];
    const parsed = parseSolanaSignals(slotRow?.result, samplesRow?.result);
    if (parsed) return parsed;
  } catch {
    /* The public provider can throttle or disappear; try Solana's own RPC. */
  }

  // Solana's official shared Mainnet endpoint is explicitly rate-limited and
  // not intended as a production RPC. This low-cadence, read-only fallback is
  // only a best-effort path; keep both readings partial if either method fails.
  const officialUrl = 'https://api.mainnet-beta.solana.com';
  const [slotResult, samplesResult] = await Promise.allSettled([
    fetchJson<RpcBatchResult>(officialUrl, {
      source: 'solana-mainnet-rpc',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
      cacheTtlMs: 15_000,
      retries: 1,
      signal,
    }),
    fetchJson<RpcBatchResult>(officialUrl, {
      source: 'solana-mainnet-rpc',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getRecentPerformanceSamples', params: [5] }),
      cacheTtlMs: 15_000,
      retries: 1,
      signal,
    }),
  ]);
  const slotRow = slotResult.status === 'fulfilled' ? slotResult.value : null;
  const samplesRow = samplesResult.status === 'fulfilled' ? samplesResult.value : null;
  return parseSolanaSignals(slotRow?.result, samplesRow?.result);
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
  const [chainsResult, historyResult, stablesResult] = await Promise.allSettled([
    fetchJson<ChainTvl[]>('https://api.llama.fi/v2/chains', {
      source: 'defillama', cacheTtlMs: 120_000, signal,
    }),
    fetchJson<HistoryPoint[]>('https://api.llama.fi/v2/historicalChainTvl', {
      source: 'defillama', cacheTtlMs: 120_000, signal,
    }),
    fetchJson<{ peggedAssets?: StablecoinAsset[] }>('https://stablecoins.llama.fi/stablecoins?includePrices=false', {
      source: 'defillama', cacheTtlMs: 120_000, signal,
    }),
  ]);
  const chains = chainsResult.status === 'fulfilled' ? chainsResult.value : null;
  const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
  const stables = stablesResult.status === 'fulfilled' ? stablesResult.value : null;

  const usableHistory = (Array.isArray(history) ? history : []).filter((point) => num(point?.tvl) != null);
  const latest = usableHistory[usableHistory.length - 1];
  const previous = usableHistory[usableHistory.length - 2];
  const totalTvlUsd = num(latest?.tvl);
  const prevTvl = num(previous?.tvl);
  const change = totalTvlUsd != null && prevTvl != null && prevTvl > 0
    ? ((totalTvlUsd - prevTvl) / prevTvl) * 100
    : null;

  const topChains = (Array.isArray(chains) ? chains : [])
    .map((entry) => ({ name: entry?.name ?? '?', tvlUsd: num(entry?.tvl) ?? 0 }))
    .filter((entry) => entry.tvlUsd > 0)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, 6);

  const assets = stables?.peggedAssets;
  const knownStableAmounts = Array.isArray(assets)
    ? assets.map((asset) => num(asset?.circulating?.peggedUSD)).filter((value): value is number => value != null)
    : [];
  const stablecoinSupplyUsd = knownStableAmounts.length > 0
    ? knownStableAmounts.reduce((sum, value) => sum + value, 0)
    : null;
  if (totalTvlUsd == null && topChains.length === 0 && stablecoinSupplyUsd == null) return null;

  // One DeFiLlama endpoint failing must not hide the still-usable datasets.
  // Missing figures stay null (not zero) so the UI cannot imply a clean reading.
  return { totalTvlUsd, tvlChange24hPct: change, stablecoinSupplyUsd, topChains };
}

/* ------------------------------ DEX heat ----------------------------------- */

interface TrendingPoolAttr {
  name?: string;
  price_change_percentage?: { h24?: string | number };
  volume_usd?: { h24?: string | number };
  base_token_price_usd?: string | number;
}
interface TrendingResponse {
  data?: {
    attributes?: TrendingPoolAttr;
    relationships?: { network?: { data?: { id?: string } } };
  }[];
}
interface BoostEntry {
  chainId?: string;
  tokenAddress?: string;
  totalAmount?: number;
  description?: string;
}

export async function fetchDexHeat(signal?: AbortSignal): Promise<DexHeat> {
  const [pools, boosts] = await Promise.all([
    (async (): Promise<HotPool[]> => {
      try {
        // One global endpoint replaces four concurrent per-network requests.
        // GeckoTerminal documents the all-network route and caches every
        // endpoint for one minute; the shared transport keeps extra margin
        // below its approximate 10-request/minute keyless limit.
        const response = await fetchJson<TrendingResponse>(
          'https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1',
          { source: 'geckoterminal', cacheTtlMs: 60_000, retries: 1, headers: GECKO_API_HEADERS, signal },
        );
        return (response.data ?? []).flatMap((pool) => {
          const network = pool.relationships?.network?.data?.id;
          if (!network) return [];
          const attr = pool.attributes ?? {};
          return [{
            chain: GECKO_NETWORK_TO_CHAIN[network] ?? network,
            name: attr.name ?? '?',
            change24hPct: num(attr.price_change_percentage?.h24),
            volume24hUsd: num(attr.volume_usd?.h24),
            priceUsd: num(attr.base_token_price_usd),
          }];
        });
      } catch {
        // Preserve the previous in-memory snapshot in the store; DexScreener
        // boosts still load independently and can populate the card meanwhile.
        return [];
      }
    })(),
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

  return { pools, boosts };
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

function binaryFlag(value: unknown): boolean | null {
  if (value === '1' || value === 1 || value === true) return true;
  if (value === '0' || value === 0 || value === false) return false;
  return null;
}

async function fetchHoneypotForensics(chain: string, contract: string, signal?: AbortSignal): Promise<TokenForensics | null> {
  const simulation = await fetchHoneypotSimulation(chain as ChainId, contract, signal);
  if (!simulation) return null;
  const hasAnyData =
    simulation.simulationSuccess === true ||
    typeof simulation.honeypotResult?.isHoneypot === 'boolean' ||
    num(simulation.simulationResult?.buyTax) != null ||
    num(simulation.simulationResult?.sellTax) != null;
  if (!hasAnyData) return null;

  return {
    chain,
    contract,
    provider: 'honeypot',
    holderCount: null,
    buyTaxPct: num(simulation.simulationResult?.buyTax),
    sellTaxPct: num(simulation.simulationResult?.sellTax),
    top10Pct: null,
    lpLockedPct: null,
    isMintable: null,
    isHoneypot: typeof simulation.honeypotResult?.isHoneypot === 'boolean'
      ? simulation.honeypotResult.isHoneypot
      : null,
  };
}

export async function fetchTokenForensics(
  chain: string,
  contract: string,
  signal?: AbortSignal,
): Promise<TokenForensics | null> {
  const chainId = GOPLUS_CHAIN_ID[chain as ChainId];
  if (!contract) return null;
  if (!chainId) return fetchHoneypotForensics(chain, contract, signal);

  try {
    const payload = await fetchJson<GoPlusTokenSecurity>(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(contract.toLowerCase())}`,
      {
        source: 'goplus',
        cacheTtlMs: 600_000,
        retries: 1,
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
    if (!entry || Object.keys(entry).length === 0) return fetchHoneypotForensics(chain, contract, signal);

    const holders = (entry.holders ?? []).filter((holder) => num(holder.percent) != null);
    const top10Shares = holders
      .map((holder) => (num(holder.percent) ?? 0) * 100)
      .sort((a, b) => b - a)
      .slice(0, 10);
    const top10 = top10Shares.length > 0 ? top10Shares.reduce((sum, value) => sum + value, 0) : null;

    const lpHolders = Array.isArray(entry.lp_holders) ? entry.lp_holders : [];
    const lpLocked = lpHolders.reduce((max, lp) => {
      const locked = lp.is_locked === 1 || lp.is_locked === '1';
      const percent = num(lp.percent) ?? 0;
      return locked ? Math.max(max, percent * 100) : max;
    }, 0);

    return {
      chain,
      contract,
      provider: 'goplus',
      holderCount: num(entry.holder_count),
      buyTaxPct: num(entry.buy_tax) != null ? (num(entry.buy_tax) as number) * 100 : null,
      sellTaxPct: num(entry.sell_tax) != null ? (num(entry.sell_tax) as number) * 100 : null,
      top10Pct: top10,
      lpLockedPct: lpHolders.length > 0 ? lpLocked : null,
      isMintable: binaryFlag(entry.is_mintable),
      isHoneypot: binaryFlag(entry.is_honeypot),
    };
  } catch {
    if (signal?.aborted) return null;
    // Honeypot simulation can fill the buy/sell-risk fields, but it does not
    // replace GoPlus holder concentration, LP-lock, or mint-authority data.
    return fetchHoneypotForensics(chain, contract, signal);
  }
}
