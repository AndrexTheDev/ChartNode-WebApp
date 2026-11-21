// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Candle } from '@/websockets/types';

/**
 * Abgeleitete On-Chain-/Cross-Signale – **rein lokal**, null Requests.
 *
 * Die App lädt bereits Rohdaten (Mempool, Fees, DeFiLlama, Staking-Supply,
 * GoPlus, Börsen-Flows, Kerzen, Funding, OI). Rohzahlen sind aber keine
 * Signale: „12 sat/vB" sagt einem Trader nichts, „Mempool-Stress hoch, weil
 * Gebühren 3× über 7-Tage-Median und Rückstau > 50k tx" schon. Dieses Modul
 * verwandelt vorhandene Reads in interpretierbare, normalisierte Flags, ohne
 * einen einzigen zusätzlichen Netzwerkaufruf. Fehlende Felder bleiben `null`
 * (nie 0 als Scheinsignal).
 */

export type SignalTone = 'bull' | 'bear' | 'neutral' | 'warn';

export interface DerivedSignal {
  /** Stabiler Schlüssel für i18n und Tests. */
  key: string;
  value: number | null;
  /** Was das Signal aussagt, in neutralem Englisch als Fallback-Text. */
  detail: string;
  tone: SignalTone;
  /** 0..1 – wie belastbar das Signal aus den vorhandenen Reads ist. */
  confidence: number;
}

/* ------------------------------- Mempool ---------------------------------- */

export interface MempoolInput {
  unconfirmed: number | null;
  vsize: number | null;
  fastestFee: number | null;
  hourFee: number | null;
  economyFee: number | null;
  totalFeeSats: number | null;
}

/**
 * Mempool-Stress als eine Zahl 0..100 plus Ton. Normalisiert gegen absolute,
 * gut erklärbare Anker (nicht gegen eine gleitende Baseline, weil die App
 * keinen persistenten Mempool-Verlauf führt): Congestion entsteht vor allem
 * durch Rückstau (unconfirmed tx) und Gebühren-Druck (fastest vs. economy).
 */
export function mempoolStress(mempool: MempoolInput | null): DerivedSignal {
  if (!mempool) {
    return { key: 'mempoolStress', value: null, detail: 'No mempool reading yet', tone: 'neutral', confidence: 0 };
  }
  const backlog = mempool.unconfirmed ?? 0;
  const fast = mempool.fastestFee ?? mempool.hourFee;
  const eco = mempool.economyFee ?? mempool.hourFee;
  const feeRatio = fast != null && eco != null && eco > 0 ? fast / eco : null;

  // Zwei unabhängige Achsen, je 0..1, gleich gewichtet.
  const backlogScore = clamp01(backlog / 300_000);
  const feeScore = feeRatio == null ? 0.4 : clamp01((feeRatio - 1) / 4); // 1x=ruhig, 5x+=max
  const value = Math.round((backlogScore * 0.6 + feeScore * 0.4) * 100);

  let tone: SignalTone = 'neutral';
  if (value >= 70) tone = 'warn';
  else if (value >= 45) tone = 'neutral';
  else tone = 'bull';

  const parts: string[] = [];
  if (mempool.unconfirmed != null) parts.push(`${Math.round(backlog).toLocaleString('en-US')} unconfirmed`);
  if (feeRatio != null) parts.push(`${feeRatio.toFixed(1)}× fee multiple`);
  return {
    key: 'mempoolStress',
    value,
    detail: parts.join(' · ') || 'Partial mempool reading',
    tone,
    confidence: mempool.fastestFee != null && mempool.unconfirmed != null ? 0.85 : 0.4,
  };
}

/* ----------------------------- Stablecoin flow ---------------------------- */

export interface StableFlowInput {
  supplyUsd: number | null;
  /** Supply-Änderung über das Fenster in Prozent, wenn berechnet. */
  changePct: number | null;
}

/**
 * Stablecoin-Flow als Liquiditäts-Signal. Growth > 0.25 %/Fenster ist historisch
 * mit risk-on/Inflows assoziiert, eine Kontraktion mit De-Risking. Das ist eine
 * Beschreibung der Kapitalbasis, keine Prognose.
 */
export function stableScore(flow: StableFlowInput | null): DerivedSignal {
  if (!flow || flow.changePct == null) {
    return {
      key: 'stableFlow',
      value: null,
      detail: flow?.supplyUsd != null ? 'Supply known, change window pending' : 'No stablecoin reading yet',
      tone: 'neutral',
      confidence: flow?.supplyUsd != null ? 0.3 : 0,
    };
  }
  const change = flow.changePct;
  const value = Math.round(clamp01((change + 0.5) / 1.0) * 100); // -0.5% → 0, +0.5% → 100
  return {
    key: 'stableFlow',
    value,
    detail: `${change >= 0 ? '+' : ''}${change.toFixed(3)}% supply change`,
    tone: change > 0.1 ? 'bull' : change < -0.1 ? 'bear' : 'neutral',
    confidence: 0.75,
  };
}

/* ----------------------------- Funding × Preis ---------------------------- */

export interface FundingDivergenceInput {
  /** Annualisiertes Funding in Prozent (Perp) oder null. */
  fundingAnnualPct: number | null;
  /** Preisänderung über das gewählte Fenster in Prozent. */
  priceChangePct: number | null;
  /** Open-Interest in USD (Perp). */
  openInterestUsd: number | null;
}

/**
 * Klassische Squeeze-Vorbereitung:
 *  - Funding hoch + Preis fällt ⇒ Longs zahlen für einen fallenden Markt =
 *    Positionen werden schmerzhaft, Long-Liquidationen wahrscheinlich.
 *  - Funding tief/negativ + Preis steigt ⇒ Shorts zahlen im Aufwärtstrend =
 *    Short-Squeeze-Treibstoff.
 * Ohne Funding oder Preisänderung bleibt das Signal `null` (unbekannt).
 */
export function fundingDivergence(input: FundingDivergenceInput | null): DerivedSignal {
  if (!input || input.fundingAnnualPct == null || input.priceChangePct == null) {
    return { key: 'fundingDivergence', value: null, detail: 'Needs funding + price move', tone: 'neutral', confidence: 0 };
  }
  const funding = input.fundingAnnualPct;
  const price = input.priceChangePct;
  const fundingSign = Math.sign(funding);
  const priceSign = Math.sign(price);
  if (Math.abs(funding) < 5 || Math.abs(price) < 0.1) {
    return {
      key: 'fundingDivergence',
      value: 0,
      detail: 'Funding and price aligned',
      tone: 'neutral',
      confidence: 0.6,
    };
  }
  if (fundingSign > 0 && priceSign < 0) {
    return {
      key: 'fundingDivergence',
      value: -Math.round(clamp01(Math.abs(funding) / 120) * 100),
      detail: 'Longs pay while price falls — long-squeeze risk',
      tone: 'bear',
      confidence: 0.7,
    };
  }
  if (fundingSign < 0 && priceSign > 0) {
    return {
      key: 'fundingDivergence',
      value: Math.round(clamp01(Math.abs(funding) / 120) * 100),
      detail: 'Shorts pay while price rises — short-squeeze fuel',
      tone: 'bull',
      confidence: 0.7,
    };
  }
  return { key: 'fundingDivergence', value: 0, detail: 'Funding and price aligned', tone: 'neutral', confidence: 0.6 };
}

/* ---------------------------- OI × Preis-Regime --------------------------- */

export interface OiRegimeInput {
  /** OI-Veränderung in Prozent über das Fenster. */
  openInterestChangePct: number | null;
  priceChangePct: number | null;
}

/** Vier Quadranten: neues Geld long/short vs. Position-Abbau. */
export function oiRegime(input: OiRegimeInput | null): DerivedSignal {
  if (!input || input.openInterestChangePct == null || input.priceChangePct == null) {
    return { key: 'oiRegime', value: null, detail: 'Needs OI + price change', tone: 'neutral', confidence: 0 };
  }
  const oi = input.openInterestChangePct;
  const price = input.priceChangePct;
  if (Math.abs(oi) < 1) {
    return { key: 'oiRegime', value: 0, detail: 'Flat OI — positions unchanged', tone: 'neutral', confidence: 0.55 };
  }
  if (oi > 0 && price > 0) return { key: 'oiRegime', value: 100, detail: 'New longs — trend continuation fuel', tone: 'bull', confidence: 0.7 };
  if (oi > 0 && price < 0) return { key: 'oiRegime', value: -100, detail: 'New shorts — downside pressure building', tone: 'bear', confidence: 0.7 };
  if (oi < 0 && price > 0) return { key: 'oiRegime', value: 60, detail: 'Shorts closing — squeeze rally', tone: 'bull', confidence: 0.65 };
  return { key: 'oiRegime', value: -60, detail: 'Longs closing — deleveraging', tone: 'bear', confidence: 0.65 };
}

/* ------------------------------ Realized vol ------------------------------ */

export interface VolRegimeInput {
  candles: Candle[];
  /** Annualisierte realisierte Volatilität in Prozent (z. B. aus premium.ts). */
  realizedVolPct: number | null;
}

/**
 * Volatilitäts-Regime als 0..100-Score: realisierte Vol relativ zur eigenen
 * Verteilung über die verfügbaren Candles (Perzentil-Rang der letzten
 * Fenstervolatilität gegen alle rollierenden Fenster desselben Buffers).
 * Damit ist der Score selbst-normalisierend und vergleichbar über Assets.
 */
export function volRegime(input: VolRegimeInput | null): DerivedSignal {
  if (!input || input.candles.length < 60 || input.realizedVolPct == null) {
    return { key: 'volRegime', value: null, detail: 'Not enough history', tone: 'neutral', confidence: 0 };
  }
  const closes = input.candles.map((candle) => candle.c);
  const window = 20;
  const volSeries: number[] = [];
  for (let i = window; i < closes.length; i += 1) {
    const slice = closes.slice(i - window, i + 1);
    const returns: number[] = [];
    for (let k = 1; k < slice.length; k += 1) {
      const prev = slice[k - 1] as number;
      const curr = slice[k] as number;
      if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
    }
    if (returns.length >= 5) {
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
      volSeries.push(Math.sqrt(variance));
    }
  }
  if (volSeries.length < 10) {
    return { key: 'volRegime', value: null, detail: 'Not enough windows', tone: 'neutral', confidence: 0.2 };
  }
  const latestVol = volSeries[volSeries.length - 1] as number;
  const below = volSeries.filter((value) => value <= latestVol).length;
  const percentile = Math.round((below / volSeries.length) * 100);
  return {
    key: 'volRegime',
    value: percentile,
    detail: `${percentile}th percentile of 20-bar volatility`,
    tone: percentile >= 85 ? 'warn' : percentile <= 20 ? 'neutral' : 'neutral',
    confidence: 0.8,
  };
}

/* --------------------------- Exchange netflow proxy ----------------------- */

export interface NetflowProxyInput {
  /** On-chain token holders count delta (GoPlus) if re-read later. */
  holdersDeltaPct: number | null;
  /** Exchange inflow proxy: whale sells vs buys from the live trade bus. */
  whaleSellSharePct: number | null;
}

/**
 * Es gibt keinen keyless Exchange-Netflow-Endpunkt, den die App ohne API-Key
 * und ohne neue Quota-Klasse nutzen könnte. Statt einen zu erfinden, wird der
 * vorhandene Live-Whale-Flow als **Proxy** ausgewiesen (Anteil aggressiver
 * Verkäufe an allen ≥-Schwellen-Trades) – transparent als Proxy markiert.
 */
export function netflowProxy(input: NetflowProxyInput | null): DerivedSignal {
  if (!input || input.whaleSellSharePct == null) {
    return { key: 'netflowProxy', value: null, detail: 'No whale-flow sample yet', tone: 'neutral', confidence: 0 };
  }
  const sellShare = input.whaleSellSharePct;
  return {
    key: 'netflowProxy',
    value: Math.round(sellShare),
    detail: `${sellShare.toFixed(0)}% of whale flow is sell-side (live tape proxy)`,
    tone: sellShare > 60 ? 'bear' : sellShare < 40 ? 'bull' : 'neutral',
    confidence: 0.5,
  };
}

/* ------------------------------- Aggregation ------------------------------ */

export interface SignalBundle {
  signals: DerivedSignal[];
  /** −100..100: Summe der gewichteten, belastbaren Signale. */
  composite: number;
  bullCount: number;
  bearCount: number;
}

/**
 * Fasst alle abgeleiteten Signale zusammen. Jedes Signal trägt sein Vorzeichen
 * bereits in `value`/`tone`; `confidence` gewichtet. Signale ohne Daten werden
 * gezählt, aber nicht in den Composite eingerechnet – fehlende Reads sollen
 * das Bild nicht künstlich neutralisieren.
 */
export function bundleSignals(signals: DerivedSignal[]): SignalBundle {
  let weighted = 0;
  let weight = 0;
  let bull = 0;
  let bear = 0;
  for (const signal of signals) {
    if (signal.value == null) continue;
    const directional =
      signal.tone === 'bull' ? signal.value : signal.tone === 'bear' ? -Math.abs(signal.value) : signal.value;
    weighted += directional * signal.confidence;
    weight += signal.confidence;
    if (signal.tone === 'bull') bull += 1;
    if (signal.tone === 'bear') bear += 1;
  }
  return {
    signals,
    composite: weight > 0 ? Math.round(Math.max(-100, Math.min(100, weighted / weight))) : 0,
    bullCount: bull,
    bearCount: bear,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
