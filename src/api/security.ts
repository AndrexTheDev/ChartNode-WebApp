// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { GOPLUS_CHAIN_ID, HONEYPOT_CHAIN_ID, isAuditableChainId, type ChainId } from '@/lib/chains';
import { fetchJson } from './http';
import type { SecurityAudit } from './types';

const AUDIT_TTL_MS = 10 * 60 * 1000;

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

const cache = new Map<string, SecurityAudit>();
const inFlight = new Map<string, Promise<SecurityAudit | null>>();

/**
 * Audits are keyed by contract address, so a long session of token research
 * would grow this map without bound. Prune on write: expired first, then
 * insertion-oldest – no background timer needed.
 */
const AUDIT_CACHE_MAX = 512;
function pruneAuditCache(now: number): void {
  for (const [key, audit] of cache) if (now - audit.checkedAt >= AUDIT_TTL_MS) cache.delete(key);
  while (cache.size > AUDIT_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/* ------------------------------- GoPlus (EVM) ------------------------------ */

type GoPlusScalar = string | number | boolean;

interface GoPlusFlags {
  is_honeypot?: GoPlusScalar;
  cannot_buy?: GoPlusScalar;
  cannot_sell_all?: GoPlusScalar;
  can_take_back_ownership?: GoPlusScalar;
  hidden_owner?: GoPlusScalar;
  is_mintable?: GoPlusScalar;
  is_proxy?: GoPlusScalar;
  is_open_source?: GoPlusScalar;
  buy_tax?: GoPlusScalar;
  sell_tax?: GoPlusScalar;
  holder_count?: GoPlusScalar;
}

interface GoPlusResponse {
  code?: number;
  result?: Record<string, GoPlusFlags | undefined>;
}

const DANGER_FLAGS: [keyof GoPlusFlags, string][] = [
  ['is_honeypot', 'honeypot'],
  ['cannot_buy', 'buy-blocked'],
  ['cannot_sell_all', 'sell-blocked'],
  ['can_take_back_ownership', 'ownership-reclaim'],
  ['hidden_owner', 'hidden-owner'],
];

const WARN_FLAGS: [keyof GoPlusFlags, string][] = [
  ['is_mintable', 'mintable'],
  ['is_proxy', 'proxy-contract'],
];

function flagOn(value: GoPlusScalar | undefined): boolean {
  return value === '1' || value === 1 || value === true || value === 'true';
}

function flagOff(value: GoPlusScalar | undefined): boolean {
  return value === '0' || value === 0 || value === false || value === 'false';
}

function flagKnown(value: GoPlusScalar | undefined): boolean {
  return flagOn(value) || flagOff(value);
}

function numericKnown(value: GoPlusScalar | undefined): boolean {
  return value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function taxPercent(value: GoPlusScalar | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed * 100 : 0;
}

function evaluateGoPlus(chain: ChainId, contract: string, flags: GoPlusFlags): SecurityAudit {
  const dangers: string[] = [];
  const warnings: string[] = [];

  for (const [key, label] of DANGER_FLAGS) if (flagOn(flags[key])) dangers.push(label);
  for (const [key, label] of WARN_FLAGS) if (flagOn(flags[key])) warnings.push(label);
  // GoPlus defines is_open_source="1" as open source and "0" as closed
  // source. Closed source is the risky case; treating a positive value as a
  // warning would invert the provider's documented meaning.
  if (flagOff(flags.is_open_source)) warnings.push('not-open-source');

  const buyTax = taxPercent(flags.buy_tax);
  const sellTax = taxPercent(flags.sell_tax);
  if (buyTax > 5 || sellTax > 5) dangers.push(`tax ${Math.max(buyTax, sellTax).toFixed(0)}%`);
  else if (buyTax > 0 || sellTax > 0) warnings.push(`tax ${Math.max(buyTax, sellTax).toFixed(1)}%`);

  const holders = Number(flags.holder_count ?? '0');
  if (Number.isFinite(holders) && holders > 0 && holders < 50) warnings.push('few-holders');

  // A sparse/partially parsed provider row is not a clean bill of health.
  // Require the core booleans and both tax fields before returning the
  // no-configured-flags verdict; positive findings still remain actionable.
  const requiredFlags = [
    ...DANGER_FLAGS.map(([key]) => key),
    ...WARN_FLAGS.map(([key]) => key),
    'is_open_source' as const,
  ];
  const complete = requiredFlags.every((key) => flagKnown(flags[key])) &&
    numericKnown(flags.buy_tax) && numericKnown(flags.sell_tax);

  let verdict: SecurityAudit['verdict'] = 'unknown';
  if (dangers.length > 0) verdict = 'danger';
  else if (warnings.length > 0) verdict = 'warn';
  else if (complete) verdict = 'safe';
  if (!complete) warnings.push('partial-goplus-data');

  // 0..100 derived score is withheld when provider coverage is incomplete.
  const riskScore = verdict === 'unknown' ? null : Math.min(100, dangers.length * 45 + warnings.length * 15);

  return {
    provider: 'goplus',
    chain,
    contract,
    verdict,
    riskScore,
    flags: [...dangers, ...warnings],
    checkedAt: Date.now(),
  };
}

/** Turn one GoPlus result entry into the final audit (incl. honeypot 2nd opinion). */
async function auditFromEntry(
  chain: ChainId,
  contract: string,
  entry: GoPlusFlags | undefined,
  signal?: AbortSignal,
): Promise<SecurityAudit> {
  if (!entry) {
    const unknown = {
      provider: 'goplus',
      chain,
      contract,
      verdict: 'unknown',
      riskScore: null,
      flags: ['no-data'],
      checkedAt: Date.now(),
    } satisfies SecurityAudit;
    const simulation = await fetchHoneypotSimulation(chain, contract, signal);
    return simulation ? mergeHoneypot(unknown, simulation) : unknown;
  }

  const audit = evaluateGoPlus(chain, contract, entry);

  // Second opinion only where it adds information: a red flag is worth
  // checking against an actual buy/sell simulation, and a partial static row
  // may gain a narrow extra signal. The simulation does not make missing
  // holder/ownership data complete. Everything else stays cheap –
  // honeypot.is simulates on-chain transfers, so calls are kept to a minimum.
  if (audit.verdict === 'danger' || audit.verdict === 'unknown') {
    const simulation = await fetchHoneypotSimulation(chain, contract, signal);
    if (simulation) return mergeHoneypot(audit, simulation);
  }
  return audit;
}

async function auditEvm(chain: ChainId, contract: string, signal?: AbortSignal) {
  const chainId = GOPLUS_CHAIN_ID[chain];

  if (!chainId) {
    // No GoPlus coverage for this network – fall back to the simulation alone.
    const simulation = await fetchHoneypotSimulation(chain, contract, signal);
    if (!simulation) return null;
    return mergeHoneypot(
      {
        provider: 'honeypot',
        chain,
        contract,
        verdict: 'unknown',
        riskScore: null,
        flags: [],
        checkedAt: Date.now(),
      },
      simulation,
    );
  }

  let payload: GoPlusResponse;
  try {
    payload = await fetchJson<GoPlusResponse>(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${contract.toLowerCase()}`,
      {
        source: 'goplus',
        cacheTtlMs: AUDIT_TTL_MS,
        retries: 1,
        signal,
        // GoPlus drosselt mit HTTP 200 + code 4029 – darf nie gecacht werden.
        inspectBody: (value) => {
          const code = (value as { code?: number } | null)?.code;
          if (code == null || code === 1) return null;
          return code === 4029 ? 'rate-limit' : 'invalid';
        },
      },
    );
  } catch {
    if (signal?.aborted) return null;
    // GoPlus may be rate-limited or region-blocked. On the five supported
    // networks, a real buy/sell simulation is a useful *partial* replacement;
    // never infer that missing static flags are clean.
    const simulation = await fetchHoneypotSimulation(chain, contract, signal);
    if (!simulation) return null;
    return mergeHoneypot(
      {
        provider: 'honeypot',
        chain,
        contract,
        verdict: 'unknown',
        riskScore: null,
        flags: ['goplus-unavailable'],
        checkedAt: Date.now(),
      },
      simulation,
    );
  }

  const entry = Object.entries(payload.result ?? {}).find(
    ([address]) => address.toLowerCase() === contract.toLowerCase(),
  )?.[1];
  return auditFromEntry(chain, contract, entry, signal);
}

/* -------------------------- honeypot.is (simulation) ----------------------- */

export interface HoneypotResponse {
  simulationSuccess?: boolean;
  honeypotResult?: { isHoneypot?: boolean; honeypotReason?: string };
  simulationResult?: { buyTax?: number; sellTax?: number; transferTax?: number };
  summary?: { risk?: string; riskLevel?: number; flags?: string[] };
}

/** Free, key-less buy/sell simulation for the biggest EVM chains. */
export async function fetchHoneypotSimulation(
  chain: ChainId,
  contract: string,
  signal?: AbortSignal,
): Promise<HoneypotResponse | null> {
  const chainId = HONEYPOT_CHAIN_ID[chain];
  if (!chainId) return null;
  try {
    return await fetchJson<HoneypotResponse>(
      `https://api.honeypot.is/v2/IsHoneypot?address=${contract.toLowerCase()}&chainID=${chainId}`,
      { source: 'honeypot', cacheTtlMs: AUDIT_TTL_MS, retries: 1, signal },
    );
  } catch {
    return null; // a failed simulation must never break search
  }
}

/** Worst-of merge: a honeypot simulation always wins over a static flag list. */
function mergeHoneypot(base: SecurityAudit, hp: HoneypotResponse): SecurityAudit {
  const flags = new Set(base.flags);
  let verdict = base.verdict;
  let riskScore = base.riskScore;
  let provider = base.provider;

  const buyTax = hp.simulationResult?.buyTax ?? 0;
  const sellTax = hp.simulationResult?.sellTax ?? 0;
  const worstTax = Math.max(buyTax, sellTax, hp.simulationResult?.transferTax ?? 0);

  if (hp.honeypotResult?.isHoneypot) {
    verdict = 'danger';
    riskScore = 100;
    provider = 'honeypot';
    flags.add('honeypot-simulated');
    if (hp.honeypotResult.honeypotReason) flags.add(hp.honeypotResult.honeypotReason.toLowerCase().replace(/\s+/g, '-'));
  } else if (hp.simulationSuccess) {
    provider = provider === 'goplus' ? provider : 'honeypot';
    if (worstTax > 5) {
      verdict = 'danger';
      riskScore = Math.max(riskScore ?? 0, 90);
      flags.add(`simulated-tax ${Math.round(worstTax)}%`);
    } else {
      flags.add('simulation-passed');
      if (worstTax > 0) flags.add(`simulated-tax ${worstTax.toFixed(1)}%`);
      if (verdict === 'unknown') {
        // A passed buy/sell simulation is only one narrow signal. If static
        // coverage is missing, keep the overall verdict unknown instead of
        // presenting a partial check as a clean token audit.
        const summaryRisk = hp.summary?.risk?.toLowerCase();
        verdict = summaryRisk && summaryRisk !== 'low' ? 'warn' : 'unknown';
        riskScore = verdict === 'warn' ? 40 : null;
        provider = 'honeypot';
      }
    }
  }

  return { ...base, provider, verdict, riskScore, flags: [...flags], checkedAt: Date.now() };
}

/* ------------------------------ RugCheck (Solana) -------------------------- */

interface RugRisk {
  name?: string;
  level?: string;
  score?: number;
}

interface RugSummary {
  score?: number;
  score_normalised?: number;
  risks?: RugRisk[];
}

interface SolanaMintResponse {
  result?: {
    value?: {
      owner?: string;
      data?: [string, string] | string;
    } | null;
  };
}

const SOLANA_TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

async function fetchSolanaRpcAudit(mint: string, signal?: AbortSignal): Promise<SecurityAudit | null> {
  const requestMint = async (url: string, source: string): Promise<SolanaMintResponse['result'] | null> => {
    const payload = await fetchJson<SolanaMintResponse>(
      url,
      {
        source,
        cacheTtlMs: AUDIT_TTL_MS,
        retries: 1,
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [mint, { encoding: 'base64', commitment: 'confirmed' }],
        }),
      },
    );
    return payload.result ?? null;
  };

  let result: SolanaMintResponse['result'] | null = null;
  try {
    result = await requestMint('https://solana-rpc.publicnode.com', 'solana-rpc');
  } catch {
    if (signal?.aborted) return null;
  }
  if (!result?.value) {
    try {
      // The official public RPC is rate-limited and not a production SLA; use
      // it only as a low-volume last attempt for basic mint-account fields.
      result = await requestMint('https://api.mainnet-beta.solana.com', 'solana-mainnet-rpc');
    } catch {
      return null;
    }
  }

  const value = result?.value;
  const data = value?.data;
  const encoded = Array.isArray(data) ? data[0] : typeof data === 'string' ? data : null;
  if (!value || !SOLANA_TOKEN_PROGRAMS.has(value.owner ?? '') || !encoded || typeof atob !== 'function') return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength < 82) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // SPL Token and Token-2022 share the 82-byte mint prefix. Only inspect the
    // explicit authority option tags; this does not assess holders, pools,
    // transfer hooks, liquidity, or overall rug risk.
    const mintAuthorityActive = view.getUint32(0, true) !== 0;
    const freezeAuthorityActive = view.getUint32(46, true) !== 0;
    const flags = [
      mintAuthorityActive ? 'mint-authority-active' : 'mint-authority-revoked',
      freezeAuthorityActive ? 'freeze-authority-active' : 'freeze-authority-revoked',
    ];
    return {
      provider: 'solana-rpc',
      chain: 'solana',
      contract: mint,
      verdict: mintAuthorityActive || freezeAuthorityActive ? 'warn' : 'unknown',
      riskScore: null,
      flags,
      checkedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function auditSolana(mint: string, signal?: AbortSignal) {
  let payload: RugSummary;
  try {
    payload = await fetchJson<RugSummary>(
      `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
      { source: 'rugcheck', cacheTtlMs: AUDIT_TTL_MS, retries: 1, signal },
    );
  } catch {
    return signal?.aborted ? null : fetchSolanaRpcAudit(mint, signal);
  }

  const score = num(payload.score_normalised);
  const risks = Array.isArray(payload.risks) ? payload.risks : [];
  // An HTTP 200 with an empty/malformed body is not a clean audit.
  if (score == null && risks.length === 0) {
    return (await fetchSolanaRpcAudit(mint, signal)) ?? {
      provider: 'rugcheck',
      chain: 'solana',
      contract: mint,
      verdict: 'unknown',
      riskScore: null,
      flags: ['no-audit-data'],
      checkedAt: Date.now(),
    } satisfies SecurityAudit;
  }

  const dangers = risks.filter((risk) => risk?.level === 'danger').map((risk) => risk.name ?? 'risk');
  const warnings = risks.filter((risk) => risk?.level === 'warn').map((risk) => risk.name ?? 'risk');

  let verdict: SecurityAudit['verdict'];
  if (dangers.length > 0 || (score ?? 0) > 60) verdict = 'danger';
  else if (warnings.length > 0 || (score ?? 0) > 25) verdict = 'warn';
  else verdict = 'safe';

  return {
    provider: 'rugcheck',
    chain: 'solana',
    contract: mint,
    verdict,
    riskScore: score,
    flags: [...dangers, ...warnings],
    checkedAt: Date.now(),
  } satisfies SecurityAudit;
}

/* --------------------------------- public API ------------------------------ */

/**
 * Runs the right auditor for the chain: GoPlus on EVM, RugCheck on Solana.
 * Results are cached for 10 min and concurrent duplicates are deduped, so a
 * search burst can never burn through the public rate limits.
 */
export function auditToken(
  chain: ChainId,
  contract: string,
  signal?: AbortSignal,
): Promise<SecurityAudit | null> {
  const key = `${chain}:${contract.toLowerCase()}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.checkedAt < AUDIT_TTL_MS) return Promise.resolve(cached);

  const running = inFlight.get(key);
  if (running) return running;

  const promise = (async () => {
    try {
      const audit =
        chain === 'solana' ? await auditSolana(contract, signal) : await auditEvm(chain, contract, signal);
      if (audit) {
        pruneAuditCache(Date.now());
        cache.set(key, audit);
      }
      return audit;
    } catch {
      // A failed audit must never break search – surface "unaudited" instead.
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Max addresses per GoPlus batch call – the endpoint accepts comma lists. */
const GOPLUS_BATCH_MAX = 20;
/** The APIs do not publish a stable shared quota for every visitor; bound fallback fan-out. */
const AUDIT_CONCURRENCY = 2;

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

/**
 * Batched audit for search result bursts: one GoPlus call per chain instead of
 * one per token (10 hits ⇒ 1 request, not 10). This is the difference between
 * staying under the public rate limit and throttling the whole page – a 429
 * storm here parks every downstream signal (forensics included) in cooldown.
 * Cached/in-flight contracts are served without any network call; Solana and
 * chains without GoPlus coverage fan out to the per-token auditors.
 */
export function auditTokens(
  chain: ChainId,
  contracts: string[],
  signal?: AbortSignal,
): Promise<Map<string, SecurityAudit | null>> {
  const unique = [...new Set(contracts.map((c) => c.toLowerCase()))];
  const out = new Map<string, SecurityAudit | null>();
  const pending: string[] = [];
  const sharedResults: Promise<void>[] = [];

  for (const contract of unique) {
    const key = `${chain}:${contract}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.checkedAt < AUDIT_TTL_MS) {
      out.set(contract, cached);
      continue;
    }
    const running = inFlight.get(key);
    if (running) {
      sharedResults.push(
        running.then((audit) => { out.set(contract, audit); }).catch(() => { out.set(contract, null); }),
      );
      continue;
    }
    pending.push(contract);
  }

  const chainId = GOPLUS_CHAIN_ID[chain];
  if (pending.length === 0) return Promise.all(sharedResults).then(() => out);

  if (!chainId || chain === 'solana') {
    // RugCheck / simulations have no batch endpoint; bound the concurrent
    // request fan-out instead of launching every search hit at once.
    return mapLimit(pending, AUDIT_CONCURRENCY, async (contract) => {
      const audit = await auditToken(chain, contract, signal);
      out.set(contract, audit);
    }).then(() => Promise.all(sharedResults)).then(() => out);
  }

  const batch = (async () => {
    const results = new Map<string, SecurityAudit | null>();
    for (let i = 0; i < pending.length; i += GOPLUS_BATCH_MAX) {
      const slice = pending.slice(i, i + GOPLUS_BATCH_MAX);
      try {
        const payload = await fetchJson<GoPlusResponse>(
          `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${slice.join(',')}`,
          {
            source: 'goplus',
            cacheTtlMs: AUDIT_TTL_MS,
            signal,
            inspectBody: (value) => {
              const code = (value as { code?: number } | null)?.code;
              if (code == null || code === 1) return null;
              return code === 4029 ? 'rate-limit' : 'invalid';
            },
          },
        );
        const byAddress = new Map(
          Object.entries(payload.result ?? {}).map(([address, entry]) => [address.toLowerCase(), entry]),
        );
        const audits = await mapLimit(slice, AUDIT_CONCURRENCY, async (contract) => ({
          contract,
          audit: await auditFromEntry(chain, contract, byAddress.get(contract), signal),
        }));
        for (const { contract, audit } of audits) {
          results.set(contract, audit);
          if (audit) {
            pruneAuditCache(Date.now());
            cache.set(`${chain}:${contract}`, audit);
          }
        }
      } catch {
        // If the batched static provider is unavailable, try the independent
        // simulation service at a bounded concurrency. This is intentionally a
        // partial verdict; missing GoPlus flags stay missing, never "safe" by
        // implication.
        const fallback = await mapLimit(slice, AUDIT_CONCURRENCY, async (contract) => {
          const simulation = await fetchHoneypotSimulation(chain, contract, signal);
          if (!simulation) return { contract, audit: null as SecurityAudit | null };
          const audit = mergeHoneypot(
            {
              provider: 'honeypot',
              chain,
              contract,
              verdict: 'unknown',
              riskScore: null,
              flags: ['goplus-unavailable'],
              checkedAt: Date.now(),
            },
            simulation,
          );
          pruneAuditCache(Date.now());
          cache.set(`${chain}:${contract}`, audit);
          return { contract, audit };
        });
        for (const { contract, audit } of fallback) results.set(contract, audit);
      }
    }
    return results;
  })();

  // Register the shared batch promise per key so concurrent single audits dedupe.
  for (const contract of pending) {
    const key = `${chain}:${contract}`;
    const perKey = batch.then((m) => m.get(contract) ?? null);
    inFlight.set(key, perKey);
    void perKey.finally(() => {
      if (inFlight.get(key) === perKey) inFlight.delete(key);
    });
    void perKey.then((audit) => out.set(contract, audit));
  }

  return batch.then(() => Promise.all(sharedResults)).then(() => out);
}

export function isAuditableChain(chain: string): boolean {
  return isAuditableChainId(chain);
}
