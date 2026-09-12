// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { GOPLUS_CHAIN_ID, HONEYPOT_CHAIN_ID, isAuditableChainId, type ChainId } from '@/lib/chains';
import { fetchJson } from './http';
import type { SecurityAudit } from './types';

const AUDIT_TTL_MS = 10 * 60 * 1000;

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

interface GoPlusFlags {
  is_honeypot?: string;
  cannot_buy?: string;
  cannot_sell_all?: string;
  can_take_back_ownership?: string;
  hidden_owner?: string;
  is_mintable?: string;
  is_proxy?: string;
  is_open_source?: string;
  buy_tax?: string;
  sell_tax?: string;
  holder_count?: string;
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
  ['is_open_source', 'not-open-source'],
];

function flagOn(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function taxPercent(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed * 100 : 0;
}

function evaluateGoPlus(chain: ChainId, contract: string, flags: GoPlusFlags): SecurityAudit {
  const dangers: string[] = [];
  const warnings: string[] = [];

  for (const [key, label] of DANGER_FLAGS) if (flagOn(flags[key])) dangers.push(label);
  for (const [key, label] of WARN_FLAGS) if (flagOn(flags[key])) warnings.push(label);

  const buyTax = taxPercent(flags.buy_tax);
  const sellTax = taxPercent(flags.sell_tax);
  if (buyTax > 5 || sellTax > 5) dangers.push(`tax ${Math.max(buyTax, sellTax).toFixed(0)}%`);
  else if (buyTax > 0 || sellTax > 0) warnings.push(`tax ${Math.max(buyTax, sellTax).toFixed(1)}%`);

  const holders = Number(flags.holder_count ?? '0');
  if (Number.isFinite(holders) && holders > 0 && holders < 50) warnings.push('few-holders');

  let verdict: SecurityAudit['verdict'] = 'safe';
  if (dangers.length > 0) verdict = 'danger';
  else if (warnings.length > 0) verdict = 'warn';

  // 0..100 risk score derived from findings.
  const riskScore = Math.min(100, dangers.length * 45 + warnings.length * 15);

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
    const simulation = await fetchHoneypot(chain, contract, signal);
    return simulation ? mergeHoneypot(unknown, simulation) : unknown;
  }

  const audit = evaluateGoPlus(chain, contract, entry);

  // Second opinion only where it adds information: a red flag is worth
  // confirming (fewer false "SCAM" labels) and an unknown verdict can still be
  // resolved by an actual buy/sell simulation. Everything else stays cheap –
  // honeypot.is simulates on-chain transfers, so calls are kept to a minimum.
  if (audit.verdict === 'danger' || audit.verdict === 'unknown') {
    const simulation = await fetchHoneypot(chain, contract, signal);
    if (simulation) return mergeHoneypot(audit, simulation);
  }
  return audit;
}

async function auditEvm(chain: ChainId, contract: string, signal?: AbortSignal) {
  const chainId = GOPLUS_CHAIN_ID[chain];

  if (!chainId) {
    // No GoPlus coverage for this network – fall back to the simulation alone.
    const simulation = await fetchHoneypot(chain, contract, signal);
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

  const payload = await fetchJson<GoPlusResponse>(
    `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${contract.toLowerCase()}`,
    {
      source: 'goplus',
      cacheTtlMs: AUDIT_TTL_MS,
      signal,
      // GoPlus drosselt mit HTTP 200 + code 4029 – darf nie gecacht werden.
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
  return auditFromEntry(chain, contract, entry, signal);
}

/* -------------------------- honeypot.is (simulation) ----------------------- */

interface HoneypotResponse {
  simulationSuccess?: boolean;
  honeypotResult?: { isHoneypot?: boolean; honeypotReason?: string };
  simulationResult?: { buyTax?: number; sellTax?: number; transferTax?: number };
  summary?: { risk?: string; riskLevel?: number; flags?: string[] };
}

/** Free, key-less buy/sell simulation for the biggest EVM chains. */
async function fetchHoneypot(chain: ChainId, contract: string, signal?: AbortSignal): Promise<HoneypotResponse | null> {
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
        // Static data was missing – trust the simulation.
        verdict = hp.summary?.risk === 'low' ? 'safe' : 'warn';
        riskScore = hp.summary?.risk === 'low' ? 5 : 40;
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

async function auditSolana(mint: string, signal?: AbortSignal) {
  const payload = await fetchJson<RugSummary>(
    `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
    { source: 'rugcheck', cacheTtlMs: AUDIT_TTL_MS, signal },
  );

  const score = payload.score_normalised ?? null;
  const risks = payload.risks ?? [];
  const dangers = risks.filter((risk) => risk.level === 'danger').map((risk) => risk.name ?? 'risk');
  const warnings = risks.filter((risk) => risk.level === 'warn').map((risk) => risk.name ?? 'risk');

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

  for (const contract of unique) {
    const key = `${chain}:${contract}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.checkedAt < AUDIT_TTL_MS) {
      out.set(contract, cached);
      continue;
    }
    const running = inFlight.get(key);
    if (running) {
      void running.then((audit) => out.set(contract, audit));
      continue;
    }
    pending.push(contract);
  }

  const chainId = GOPLUS_CHAIN_ID[chain];
  if (pending.length === 0) return Promise.resolve(out);

  if (!chainId || chain === 'solana') {
    // No batching available – per-token auditors (RugCheck / simulation).
    return Promise.all(
      pending.map(async (contract) => {
        const audit = await auditToken(chain, contract, signal);
        out.set(contract, audit);
      }),
    ).then(() => out);
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
        const audits = await Promise.all(
          slice.map(async (contract) => ({
            contract,
            audit: await auditFromEntry(chain, contract, byAddress.get(contract), signal),
          })),
        );
        for (const { contract, audit } of audits) {
          results.set(contract, audit);
          if (audit) {
            pruneAuditCache(Date.now());
            cache.set(`${chain}:${contract}`, audit);
          }
        }
      } catch {
        // Batch failed (429/network) – surface "unaudited" for this slice,
        // never break search. Per-token retry happens on the next query.
        for (const contract of slice) results.set(contract, null);
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

  return batch.then(() => out);
}

export function isAuditableChain(chain: string): boolean {
  return isAuditableChainId(chain);
}
