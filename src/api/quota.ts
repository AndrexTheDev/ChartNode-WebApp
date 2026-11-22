// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.

/**
 * Zentrale Free-Tier-/Quota-Registry (Single Source of Truth).
 *
 * Warum: Keyless-Endpoints sind die einzige knappe Ressource dieser App –
 * CoinGecko, GeckoTerminal, GoPlus, mempool.space und die geteilten RPCs
 * drosseln pro IP. Alles andere (Gate/OKX/Deribit, CEX-WebSockets) ist
 * praktisch unbegrenzt. Diese Tabelle macht die Grenzen explizit, damit
 * `http.ts` sie durchsetzen und die UI sie transparent anzeigen kann.
 *
 * Regeln:
 *  - `windowMs: null` ⇒ keine harte lokale Obergrenze; nur TTL/Min-Abstand.
 *  - `minRetry` senkt den Standard-Retry für teure Quellen auf 1.
 *  - `weightPerCall` modelliert Weight-basierte Provider (Hyperliquid).
 *  - `costClass` steuert die Anzeige: ws = 0 Quota, cheap = großzügig,
 *    budgeted = knapp (sichtbar), expensive = nur mit Bedacht.
 *
 * Die Zahlen sind bewusst konservativ unter den dokumentierten Limits
 * gewählt (Sicherheitsabstand für parallele Tabs, andere Nutzer der
 * gleichen IP und unangekündigte Provider-Änderungen). Sie sind keine
 * Garantie und kein Ersatz für die Provider-AGB.
 */

export type CostClass = 'ws' | 'cheap' | 'budgeted' | 'expensive';

export interface QuotaPolicy {
  /** Anzeigename im UI. */
  label: string;
  /** Quelle des Limits (kurz, für Tooltip/Doku). */
  basis: string;
  costClass: CostClass;
  /** Lokales Budget im Fenster; null = kein hartes Budget. */
  maxRequests: number | null;
  windowMs: number | null;
  /** Mindest-Cache-TTL, die Aufrufer nicht unterschreiten sollten. */
  minCacheTtlMs: number;
  /** Standard-Retry-Versuche für diese Quelle. */
  minRetry: number;
  /** Nur für Weight-Provider: Weight pro Call (Default). */
  weightPerCall?: number;
  /** Pauschal-Hinweis für Doku/UI. */
  note?: string;
}

/**
 * Provider-Schlüssel sind identisch mit `source:` in `fetchJson`-Aufrufen.
 * Neue Quellen müssen hier eingetragen werden – `quotaPolicyFor()` fällt
 * für unbekannte Quellen auf `UNKNOWN_POLICY` zurück (kein Budget, aber
 * bewusst dokumentiert statt stillschweigend unlimitiert zu wirken).
 */
export const QUOTA_REGISTRY: Record<string, QuotaPolicy> = {
  /* ------------------------- keyless, eng begrenzt ------------------------- */
  geckoterminal: {
    label: 'GeckoTerminal',
    basis: '~10 req/min keyless, 1-min-Upstream-Cache',
    costClass: 'budgeted',
    maxRequests: 8,
    windowMs: 60_000,
    minCacheTtlMs: 60_000,
    minRetry: 1,
    note: 'DEX-OHLCV & Fallback-Suche; auf dem kritischsten Pfad.',
  },
  coingecko: {
    label: 'CoinGecko',
    basis: 'keyless Burst ~10–30 req/min, kein SLA',
    costClass: 'budgeted',
    maxRequests: 6,
    windowMs: 60_000,
    minCacheTtlMs: 120_000,
    minRetry: 1,
    note: 'Nur globale Marktlage; FNG separat gecacht.',
  },
  goplus: {
    label: 'GoPlus',
    basis: '30 req/min, 20 Adressen/Call',
    costClass: 'budgeted',
    maxRequests: 12,
    windowMs: 60_000,
    minCacheTtlMs: 600_000,
    minRetry: 1,
    note: 'Token-Forensik; immer batchen (20/Call).',
  },
  'mempool.space': {
    label: 'mempool.space',
    basis: 'kein offizieller Cap, Drosselung/Bans dokumentiert',
    costClass: 'budgeted',
    maxRequests: 18,
    windowMs: 60_000,
    minCacheTtlMs: 25_000,
    minRetry: 1,
  },
  /* --------------------------- keyless, großzügig ------------------------- */
  dexscreener: {
    label: 'DexScreener',
    basis: '300 req/min (core)',
    costClass: 'cheap',
    maxRequests: 60,
    windowMs: 60_000,
    minCacheTtlMs: 20_000,
    minRetry: 1,
  },
  defillama: {
    label: 'DeFiLlama',
    basis: 'Fair use (~300 req/5 min)',
    costClass: 'cheap',
    maxRequests: 30,
    windowMs: 60_000,
    minCacheTtlMs: 120_000,
    minRetry: 1,
  },
  'alternative.me': {
    label: 'Alternative.me',
    basis: '60 req/min',
    costClass: 'cheap',
    maxRequests: 20,
    windowMs: 60_000,
    minCacheTtlMs: 120_000,
    minRetry: 1,
  },
  deribit: {
    label: 'Deribit',
    basis: 'credit-basiert, per IP',
    costClass: 'cheap',
    maxRequests: 12,
    windowMs: 60_000,
    minCacheTtlMs: 300_000,
    minRetry: 1,
  },
  /* ---------------------- shared Infrastruktur / RPCs --------------------- */
  'solana-rpc': {
    label: 'Solana RPC (PublicNode)',
    basis: 'shared, aggressiv gedrosselt',
    costClass: 'expensive',
    maxRequests: 6,
    windowMs: 60_000,
    minCacheTtlMs: 15_000,
    minRetry: 1,
  },
  'solana-mainnet-rpc': {
    label: 'Solana RPC (official)',
    basis: 'shared public endpoint, ausdrücklich nicht für Produktion',
    costClass: 'expensive',
    maxRequests: 4,
    windowMs: 60_000,
    minCacheTtlMs: 15_000,
    minRetry: 1,
  },
  blockscout: {
    label: 'Blockscout',
    basis: 'instanzabhängig, geteilte öffentliche Instanzen',
    costClass: 'expensive',
    maxRequests: 20,
    windowMs: 60_000,
    minCacheTtlMs: 25_000,
    minRetry: 1,
  },
  'publicnode-evm': {
    label: 'PublicNode EVM RPC',
    basis: 'shared public RPC',
    costClass: 'expensive',
    maxRequests: 12,
    windowMs: 60_000,
    minCacheTtlMs: 25_000,
    minRetry: 1,
  },
  'blockstream-esplora': {
    label: 'Blockstream Esplora',
    basis: 'shared public API',
    costClass: 'expensive',
    maxRequests: 12,
    windowMs: 60_000,
    minCacheTtlMs: 25_000,
    minRetry: 1,
  },
  rugcheck: {
    label: 'RugCheck',
    basis: 'öffentliche API, kein numerisches Limit dokumentiert',
    costClass: 'expensive',
    maxRequests: 10,
    windowMs: 60_000,
    minCacheTtlMs: 600_000,
    minRetry: 1,
  },
  honeypot: {
    label: 'honeypot.is',
    basis: 'öffentliche Simulation, kein numerisches Limit dokumentiert',
    costClass: 'expensive',
    maxRequests: 10,
    windowMs: 60_000,
    minCacheTtlMs: 600_000,
    minRetry: 1,
  },
  /* ------------------------ Hyperliquid (Weight-basiert) ------------------ */
  hyperliquid: {
    label: 'Hyperliquid /info',
    basis: '1 200 Weight/min/IP; Info-Calls i. d. R. 20 Weight',
    costClass: 'cheap',
    maxRequests: 60,
    windowMs: 60_000,
    minCacheTtlMs: 20_000,
    minRetry: 1,
    weightPerCall: 20,
    note: 'metaAndAssetCtxs bündelt alle Perps in einem Call.',
  },
  'hyperliquid-book': {
    label: 'Hyperliquid l2Book',
    basis: 'Weight 2 pro Request',
    costClass: 'cheap',
    maxRequests: 90,
    windowMs: 60_000,
    minCacheTtlMs: 10_000,
    minRetry: 1,
    weightPerCall: 2,
  },
  /* ----------------------- CEX REST (großzügig, TTL) --------------------- */
  gate: {
    label: 'Gate.io',
    basis: 'endpoint-spezifisch (z. B. 200 req/10 s)',
    costClass: 'cheap',
    maxRequests: 120,
    windowMs: 60_000,
    minCacheTtlMs: 8_000,
    minRetry: 1,
  },
  okx: {
    label: 'OKX',
    basis: 'endpoint-spezifisch',
    costClass: 'cheap',
    maxRequests: 120,
    windowMs: 60_000,
    minCacheTtlMs: 8_000,
    minRetry: 1,
  },
  binance: {
    label: 'Binance',
    basis: '1 200 req/min, Weight-basiert',
    costClass: 'cheap',
    maxRequests: 120,
    windowMs: 60_000,
    minCacheTtlMs: 15_000,
    minRetry: 1,
  },
  'binance-futures': {
    label: 'Binance Futures',
    basis: '1 000 req/5 min/IP für futures/data/*',
    costClass: 'cheap',
    maxRequests: 60,
    windowMs: 60_000,
    minCacheTtlMs: 30_000,
    minRetry: 1,
  },
};

/** Fallback für Quellen ohne Eintrag – bewusst ohne hartes Budget. */
export const UNKNOWN_POLICY: QuotaPolicy = {
  label: 'Unbekannte Quelle',
  basis: 'nicht registriert',
  costClass: 'expensive',
  maxRequests: null,
  windowMs: null,
  minCacheTtlMs: 0,
  minRetry: 1,
};

/**
 * Quellen mit eigenem `<source>:<suffix>`-Muster (z. B. `blockscout:base`,
 * `publicnode-evm:ethereum`, `solana-rpc:*`) nutzen die Basis-Policy.
 */
export function quotaPolicyFor(source: string): { key: string; policy: QuotaPolicy } {
  const direct = QUOTA_REGISTRY[source];
  if (direct) return { key: source, policy: direct };
  const prefix = source.split(':')[0] ?? source;
  const policy = QUOTA_REGISTRY[prefix];
  if (policy) return { key: prefix, policy };
  return { key: source, policy: UNKNOWN_POLICY };
}

/* ------------------------------- Snapshot -------------------------------- */

export interface QuotaStamp {
  at: number;
  weight?: number;
}

/** Was `http.ts` für die UI bereitstellt (nur Zähler, keine Provider-Daten). */
export interface QuotaUsage {
  key: string;
  label: string;
  costClass: CostClass;
  used: number;
  /** null = unbegrenzt lokal. */
  max: number | null;
  windowMs: number | null;
  /** Millisekunden bis das älteste Stamp im Fenster verfällt. */
  resetInMs: number | null;
  /** Verbrauchtes Weight im Fenster (nur Weight-Provider). */
  weightUsed?: number;
  weightMax?: number;
}

/**
 * Wie viele Requests dürfen in dieser Minute noch raus? Reine Rechnung über
 * die Stamps; wird vom Transport und vom UI gleichermaßen genutzt.
 */
export function effectiveBudget(policy: QuotaPolicy): {
  maxRequests: number | null;
  windowMs: number | null;
  /** Weight-Kosten eines Calls – 1 wenn nicht Weight-basiert. */
  cost: number;
} {
  return {
    maxRequests: policy.maxRequests,
    windowMs: policy.windowMs,
    cost: policy.weightPerCall ?? 1,
  };
}

export function usageFromStamps(
  key: string,
  policy: QuotaPolicy,
  stamps: QuotaStamp[],
  now: number,
): QuotaUsage {
  const windowMs = policy.windowMs;
  const active = windowMs == null ? stamps : stamps.filter((stamp) => stamp.at > now - windowMs);
  const oldest = active.reduce<number | null>(
    (min, stamp) => (min == null || stamp.at < min ? stamp.at : min),
    null,
  );
  const weightUsed = policy.weightPerCall
    ? active.reduce((sum, stamp) => sum + (stamp.weight ?? policy.weightPerCall ?? 1), 0)
    : undefined;
  return {
    key,
    label: policy.label,
    costClass: policy.costClass,
    used: active.length,
    max: policy.maxRequests,
    windowMs,
    resetInMs: windowMs != null && oldest != null ? Math.max(0, oldest + windowMs - now) : null,
    ...(weightUsed != null
      ? { weightUsed, weightMax: policy.maxRequests != null ? policy.maxRequests * (policy.weightPerCall ?? 1) : undefined }
      : {}),
  };
}
