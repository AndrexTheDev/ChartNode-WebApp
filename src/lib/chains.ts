/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Canonical chain ids used across DEX + security providers.
 *
 * All mappings below were verified against the live provider responses
 * (`/api/v2/networks`, `/api/v1/supported_chains`, DexScreener `chainId`s),
 * not copied from documentation – the three services spell the same network
 * differently (`avax` vs `avalanche`, `polygon_pos` vs `polygon`, `xdai` vs
 * `gnosis`, `sei-network` vs `seiv2`).
 */
export type ChainId =
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'polygon'
  | 'bsc'
  | 'avalanche'
  | 'optimism'
  | 'solana'
  | 'fantom'
  | 'gnosis'
  | 'celo'
  | 'cronos'
  | 'kava'
  | 'metis'
  | 'mantle'
  | 'manta'
  | 'zksync'
  | 'linea'
  | 'scroll'
  | 'blast'
  | 'mode'
  | 'berachain'
  | 'sonic'
  | 'sei'
  | 'sui'
  | 'aptos'
  | 'ton'
  | 'tron'
  | 'pulsechain'
  | 'unichain'
  | 'worldchain'
  | 'hyperevm'
  | 'core';

export const CHAIN_IDS: ChainId[] = [
  'ethereum',
  'base',
  'arbitrum',
  'polygon',
  'bsc',
  'avalanche',
  'optimism',
  'solana',
  'fantom',
  'gnosis',
  'celo',
  'cronos',
  'kava',
  'metis',
  'mantle',
  'manta',
  'zksync',
  'linea',
  'scroll',
  'blast',
  'mode',
  'berachain',
  'sonic',
  'sei',
  'sui',
  'aptos',
  'ton',
  'tron',
  'pulsechain',
  'unichain',
  'worldchain',
  'hyperevm',
  'core',
];

/** GeckoTerminal network slug → canonical chain. */
export const GECKO_NETWORK_TO_CHAIN: Record<string, ChainId> = {
  eth: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  arbitrum_nova: 'arbitrum',
  polygon_pos: 'polygon',
  bsc: 'bsc',
  avax: 'avalanche',
  optimism: 'optimism',
  solana: 'solana',
  ftm: 'fantom',
  xdai: 'gnosis',
  celo: 'celo',
  cro: 'cronos',
  kava: 'kava',
  metis: 'metis',
  mantle: 'mantle',
  'manta-pacific': 'manta',
  zksync: 'zksync',
  linea: 'linea',
  scroll: 'scroll',
  blast: 'blast',
  mode: 'mode',
  berachain: 'berachain',
  sonic: 'sonic',
  'sei-network': 'sei',
  'sui-network': 'sui',
  aptos: 'aptos',
  ton: 'ton',
  tron: 'tron',
  pulsechain: 'pulsechain',
  unichain: 'unichain',
  'world-chain': 'worldchain',
  hyperevm: 'hyperevm',
  core: 'core',
};

export const CHAIN_TO_GECKO_NETWORK: Record<ChainId, string> = {
  ethereum: 'eth',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  bsc: 'bsc',
  avalanche: 'avax',
  optimism: 'optimism',
  solana: 'solana',
  fantom: 'ftm',
  gnosis: 'xdai',
  celo: 'celo',
  cronos: 'cro',
  kava: 'kava',
  metis: 'metis',
  mantle: 'mantle',
  manta: 'manta-pacific',
  zksync: 'zksync',
  linea: 'linea',
  scroll: 'scroll',
  blast: 'blast',
  mode: 'mode',
  berachain: 'berachain',
  sonic: 'sonic',
  sei: 'sei-network',
  sui: 'sui-network',
  aptos: 'aptos',
  ton: 'ton',
  tron: 'tron',
  pulsechain: 'pulsechain',
  unichain: 'unichain',
  worldchain: 'world-chain',
  hyperevm: 'hyperevm',
  core: 'core',
};

/**
 * GoPlus `token_security/{chainId}` path segment.
 * Taken from GoPlus' own `/api/v1/supported_chains` response – networks missing
 * there are audited by RugCheck (Solana) or reported as `unknown`.
 */
export const GOPLUS_CHAIN_ID: Partial<Record<ChainId, string>> = {
  ethereum: '1',
  bsc: '56',
  arbitrum: '42161',
  polygon: '137',
  base: '8453',
  mantle: '5000',
  unichain: '130',
  scroll: '534352',
  optimism: '10',
  avalanche: '43114',
  cronos: '25',
  gnosis: '100',
  zksync: '324',
  linea: '59144',
  sonic: '146',
  berachain: '80094',
  worldchain: '480',
  manta: '169',
  blast: '81457',
};

/** honeypot.is simulation chain ids (second opinion for the biggest EVM chains). */
export const HONEYPOT_CHAIN_ID: Partial<Record<ChainId, number>> = {
  ethereum: 1,
  bsc: 56,
  base: 8453,
  arbitrum: 42161,
  blast: 81457,
};

/** DexScreener `chainId` → canonical chain. */
const DEXSCREENER_TO_CHAIN: Record<string, ChainId> = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon',
  bsc: 'bsc',
  avalanche: 'avalanche',
  optimism: 'optimism',
  solana: 'solana',
  fantom: 'fantom',
  gnosis: 'gnosis',
  celo: 'celo',
  cronos: 'cronos',
  kava: 'kava',
  metis: 'metis',
  mantle: 'mantle',
  manta: 'manta',
  zksync: 'zksync',
  linea: 'linea',
  scroll: 'scroll',
  blast: 'blast',
  mode: 'mode',
  berachain: 'berachain',
  sonic: 'sonic',
  // DexScreener reports Sei as `seiv2`
  seiv2: 'sei',
  sei: 'sei',
  sui: 'sui',
  aptos: 'aptos',
  ton: 'ton',
  tron: 'tron',
  pulsechain: 'pulsechain',
  unichain: 'unichain',
  worldchain: 'worldchain',
  hyperevm: 'hyperevm',
  core: 'core',
};

export function normaliseDexscreenerChain(chainId: string): ChainId | null {
  return DEXSCREENER_TO_CHAIN[chainId] ?? null;
}

export const EVM_CHAINS: ChainId[] = CHAIN_IDS.filter(
  (chain) => chain !== 'solana' && chain !== 'sui' && chain !== 'aptos' && chain !== 'ton' && chain !== 'tron',
);

export function isEvmChain(chain: string): boolean {
  return (EVM_CHAINS as string[]).includes(chain);
}

/** Chains we can actually audit (GoPlus, honeypot.is or RugCheck). */
export function isAuditableChainId(chain: string): boolean {
  return chain === 'solana' || chain in GOPLUS_CHAIN_ID || chain in HONEYPOT_CHAIN_ID;
}
