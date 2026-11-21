// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { fetchJson } from './http';

/**
 * Hyperliquid `/info` – das günstigste echte On-Chain-Derivate-Signal, das
 * ohne Account erreichbar ist.
 *
 * Warum genau dieser Provider:
 *  - `metaAndAssetCtxs` liefert **alle** Perp-Märkte (Mark, Oracle/Mid,
 *    Funding, Open Interest, 24 h-Volumen, Premium) in **einem** Request.
 *    Damit bekommt die App einen vollständigen On-Chain-Perp-Kontext, ohne pro
 *    Symbol zu pollen (Gate/OKX brauchen dafür mehrere Calls je Coin).
 *  - `l2Book` (Weight 2) liefert echte Orderbuch-Wände → daraus werden
 *    Liquiditäts-Cluster berechnet, also ein *on-chain* gemessenes Gegenstück
 *    zum lokalen Liq-Radar (das nur aus Kerzen schätzt).
 *  - `fundingHistory` liefert die abgerechneten Raten als Verlauf.
 *
 * Limits: 1 200 Weight/min/IP; Info-Calls wiegen i. d. R. 20, `l2Book` 2.
 * Beide Pfade laufen durch `fetchJson` und damit durch das lokale
 * Hyperliquid-Budget (`src/api/quota.ts`), plus In-Flight-Dedupe und TTL.
 * Fehlende Felder bleiben `null` – nie 0 aus Bequemlichkeit.
 */

/* ---------------------------------- types --------------------------------- */

export interface HlAssetCtx {
  /** Coin-Symbol, z. B. `BTC`. */
  coin: string;
  markPrice: number | null;
  /** Oracle-Preis (Index); Hyperliquid nennt ihn `oraclePx`. */
  oraclePrice: number | null;
  /** (mark − oracle) / oracle, Prozent. */
  premiumPct: number | null;
  /** Stündlich abgerechnete Funding-Rate als Dezimalzahl (0.0000125 = 0.00125 %). */
  fundingRate: number | null;
  /** Einfache Annualisierung über Hyperliquid-Intervall (1 h), Prozent. */
  fundingAnnualPct: number | null;
  openInterestUsd: number | null;
  volume24hUsd: number | null;
  /** Max. Hebel des Marktes (nützlich für die Liq-Radar-Kalibrierung). */
  maxLeverage: number | null;
}

export interface HlPerpContext {
  /** Alle Perps, sortiert nach 24 h-Volumen absteigend. */
  markets: HlAssetCtx[];
  /** Markt, der zur aktiven Basis gehört (null, wenn nicht gelistet). */
  active: HlAssetCtx | null;
  /** Aggregat über alle Perps. */
  totalOpenInterestUsd: number | null;
  totalVolume24hUsd: number | null;
  /** Volumengewichteter Funding-Satz aller Perps, Dezimal je Stunde. */
  fundingWeighted: number | null;
  /** Anteil der Märkte mit positivem Funding, Prozent 0..100. */
  positiveFundingPct: number | null;
  fetchedAt: number;
}

export interface HlBookLevel {
  price: number;
  size: number;
  notionalUsd: number;
}

export interface HlBook {
  coin: string;
  bids: HlBookLevel[];
  asks: HlBookLevel[];
  mid: number | null;
  spreadBps: number | null;
  /** bids − asks über die abgerufenen Level, Prozent −100..100. */
  imbalancePct: number | null;
  fetchedAt: number;
}

export interface HlLiqWall {
  price: number;
  side: 'long' | 'short';
  /** Notional in USD, der eine Kaskade auslösen müsste. */
  notionalUsd: number;
  /** 0..1 relativ zur stärksten Wand. */
  intensity: number;
  distancePct: number;
}

export interface HlLiqMap {
  coin: string;
  spot: number;
  walls: HlLiqWall[];
  /** Nächste große Wand je Seite (nächster echter Liquiditäts-Level). */
  nearestSupport: HlLiqWall | null;
  nearestResistance: HlLiqWall | null;
  fetchedAt: number;
}

export interface HlFundingPoint {
  /** Unix ms. */
  t: number;
  /** Dezimal pro Intervall. */
  rate: number;
}

/* -------------------------------- parsing --------------------------------- */

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

interface HlUniverseEntry {
  name?: string;
  szDecimals?: number;
  maxLeverage?: number;
}
interface HlAssetCtxRaw {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  premium?: string;
  oraclePx?: string;
  markPx?: string;
  midPx?: string | null;
}

/** Hyperliquid rechnet Funding stündlich ab. */
const HL_FUNDING_HOURS = 1;

/**
 * `metaAndAssetCtxs` → [meta, ctxs]. Beide Arrays sind index-parallel, aber
 * Länge/Reihenfolge sind Provider-Detail: wir filtern defensiv auf
 * vollständige Einträge statt zu unterstellen, dass alles passt.
 */
export function parseMetaAndAssetCtxs(payload: unknown): HlPerpContext | null {
  if (!Array.isArray(payload) || payload.length < 2) return null;
  const meta = payload[0] as { universe?: HlUniverseEntry[] } | null;
  const ctxs = payload[1];
  const universe = meta?.universe;
  if (!Array.isArray(universe) || !Array.isArray(ctxs)) return null;

  const markets: HlAssetCtx[] = [];
  for (let index = 0; index < universe.length; index += 1) {
    const info = universe[index];
    const ctx = ctxs[index] as HlAssetCtxRaw | undefined;
    const coin = info?.name;
    if (!coin || !ctx) continue;
    const markPrice = num(ctx.markPx);
    const oraclePrice = num(ctx.oraclePx);
    const fundingRate = num(ctx.funding);
    const openInterest = num(ctx.openInterest);
    const openInterestUsd =
      openInterest != null && markPrice != null && markPrice > 0 ? openInterest * markPrice : null;
    markets.push({
      coin,
      markPrice,
      oraclePrice,
      premiumPct:
        markPrice != null && oraclePrice != null && oraclePrice > 0
          ? ((markPrice - oraclePrice) / oraclePrice) * 100
          : num(ctx.premium) != null
            ? (num(ctx.premium) as number) * 100
            : null,
      fundingRate,
      fundingAnnualPct: fundingRate != null ? fundingRate * (24 / HL_FUNDING_HOURS) * 365 * 100 : null,
      openInterestUsd,
      volume24hUsd: num(ctx.dayNtlVlm),
      maxLeverage: num(info?.maxLeverage),
    });
  }
  if (markets.length === 0) return null;

  const sorted = [...markets].sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  const withFunding = sorted.filter((market) => market.fundingRate != null);
  const fundingWeight = withFunding.reduce((sum, market) => sum + (market.volume24hUsd ?? 0), 0);
  const fundingWeighted =
    fundingWeight > 0
      ? withFunding.reduce((sum, market) => sum + (market.fundingRate ?? 0) * (market.volume24hUsd ?? 0), 0) /
        fundingWeight
      : null;

  return {
    markets: sorted,
    active: null,
    totalOpenInterestUsd: sumOrNull(sorted.map((market) => market.openInterestUsd)),
    totalVolume24hUsd: sumOrNull(sorted.map((market) => market.volume24hUsd)),
    fundingWeighted,
    positiveFundingPct:
      withFunding.length > 0
        ? (withFunding.filter((market) => (market.fundingRate ?? 0) > 0).length / withFunding.length) * 100
        : null,
    fetchedAt: Date.now(),
  };
}

function sumOrNull(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

/** `l2Book` → normalisiertes Buch mit Notional pro Level. */
export function parseL2Book(payload: unknown, coin: string): HlBook | null {
  const data = payload as { levels?: [{ px?: string; sz?: string }[], { px?: string; sz?: string }[]] } | null;
  const levels = data?.levels;
  if (!Array.isArray(levels) || levels.length < 2) return null;
  const parseSide = (rows: { px?: string; sz?: string }[] | undefined): HlBookLevel[] =>
    (Array.isArray(rows) ? rows : []).flatMap((row) => {
      const price = num(row?.px);
      const size = num(row?.sz);
      if (price == null || size == null || price <= 0 || size <= 0) return [];
      return [{ price, size, notionalUsd: price * size }];
    });
  const bids = parseSide(levels[0]);
  const asks = parseSide(levels[1]);
  if (bids.length === 0 || asks.length === 0) return null;

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const bidNotional = bids.reduce((sum, level) => sum + level.notionalUsd, 0);
  const askNotional = asks.reduce((sum, level) => sum + level.notionalUsd, 0);
  return {
    coin,
    bids,
    asks,
    mid,
    spreadBps: mid != null && bestBid != null && bestAsk != null && mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null,
    imbalancePct:
      bidNotional + askNotional > 0 ? ((bidNotional - askNotional) / (bidNotional + askNotional)) * 100 : null,
    fetchedAt: Date.now(),
  };
}

/**
 * Orderbuch → Liquiditätswände.
 *
 * Methodik (bewusst als Schätzung deklariert): Ein 25x-Long, der bei `p`
 * eröffnet wurde, wird bei ≈ p·(1 − 1/25) zwangsliquidiert. Der Level, an dem
 * eine Kaskade *Halt* findet, ist der Preis, unter dem das Orderbuch dünn wird.
 * Wir suchen deshalb die größten kumulierten Notional-Sprünge unterhalb bzw.
 * oberhalb des Mids und markieren sie als Support/Resistance-Wand. Das ist
 * echte On-Chain-Orderbuch-Tiefe (Hyperliquid läuft komplett on-chain), keine
 * Exchange-Positionsdaten und keine Prognose.
 */
export function bookToLiqMap(book: HlBook, maxWalls = 6): HlLiqMap | null {
  const spot = book.mid;
  if (spot == null || spot <= 0) return null;

  type Raw = { price: number; side: 'long' | 'short'; notionalUsd: number };
  const raw: Raw[] = [];

  // Bids stützen den Preis (long-Liquidität darunter), Asks deckeln ihn.
  let bidCum = 0;
  for (const level of book.bids) {
    bidCum += level.notionalUsd;
    raw.push({ price: level.price, side: 'long', notionalUsd: bidCum });
  }
  let askCum = 0;
  for (const level of book.asks) {
    askCum += level.notionalUsd;
    raw.push({ price: level.price, side: 'short', notionalUsd: askCum });
  }
  if (raw.length === 0) return null;

  // Nur Level in einem sinnvollen Band (±8 %) – entfernte Wände sind für
  // Intraday-Risiko irrelevant und würden die Intensität verzerren.
  const band = raw.filter((level) => Math.abs(level.price / spot - 1) <= 0.08);
  const maxNotional = band.reduce((max, level) => Math.max(max, level.notionalUsd), 0);
  if (maxNotional <= 0) return null;

  const walls: HlLiqWall[] = band
    .map((level) => ({
      price: level.price,
      side: level.side,
      notionalUsd: level.notionalUsd,
      intensity: level.notionalUsd / maxNotional,
      distancePct: (level.price / spot - 1) * 100,
    }))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, maxWalls)
    .sort((a, b) => b.price - a.price);

  const supports = walls.filter((wall) => wall.price < spot);
  const resistances = walls.filter((wall) => wall.price > spot);

  return {
    coin: book.coin,
    spot,
    walls,
    nearestSupport: supports.length > 0 ? supports.reduce((a, b) => (a.price > b.price ? a : b)) : null,
    nearestResistance:
      resistances.length > 0 ? resistances.reduce((a, b) => (a.price < b.price ? a : b)) : null,
    fetchedAt: Date.now(),
  };
}

/** `fundingHistory` → Zeitreihe (API liefert Strings, `time` in ms). */
export function parseFundingHistory(payload: unknown): HlFundingPoint[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => {
      const row = entry as { time?: number; fundingRate?: string };
      const t = num(row?.time);
      const rate = num(row?.fundingRate);
      return t != null && rate != null ? { t, rate } : null;
    })
    .filter((point): point is HlFundingPoint => point != null)
    .sort((a, b) => a.t - b.t);
}

/* -------------------------------- fetching -------------------------------- */

const INFO_URL = 'https://api.hyperliquid.xyz/info';

async function info<T>(body: Record<string, unknown>, signal: AbortSignal | undefined, cacheTtlMs: number, source = 'hyperliquid'): Promise<T> {
  return fetchJson<T>(INFO_URL, {
    source,
    body: JSON.stringify(body),
    cacheTtlMs,
    retries: 1,
    timeoutMs: 10_000,
    signal,
  });
}

/**
 * Ein Call für den gesamten Perp-Kontext. `activeBase` markiert nur, welcher
 * Markt zur aktuell geöffneten Chart-Basis gehört – es wird kein zweiter
 * Request dafür gemacht.
 */
export async function fetchHlPerpContext(
  activeBase?: string,
  signal?: AbortSignal,
): Promise<HlPerpContext | null> {
  try {
    const payload = await info<unknown>({ type: 'metaAndAssetCtxs' }, signal, 20_000);
    const context = parseMetaAndAssetCtxs(payload);
    if (!context) return null;
    if (activeBase) {
      const wanted = normalizeHlCoin(activeBase);
      context.active = context.markets.find((market) => market.coin === wanted) ?? null;
    }
    return context;
  } catch {
    return null;
  }
}

/** Hyperliquid-Spot-Namen enden teils auf `USDC`; Perp-Coins sind die Basis. */
export function normalizeHlCoin(base: string): string {
  const clean = base.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const suffix of ['USDT', 'USDC', 'USD']) {
    if (clean.endsWith(suffix) && clean.length > suffix.length) return clean.slice(0, -suffix.length);
  }
  return clean;
}

export async function fetchHlBook(coin: string, signal?: AbortSignal): Promise<HlBook | null> {
  try {
    const payload = await info<unknown>({ type: 'l2Book', coin: normalizeHlCoin(coin) }, signal, 10_000, 'hyperliquid-book');
    return parseL2Book(payload, normalizeHlCoin(coin));
  } catch {
    return null;
  }
}

export async function fetchHlFundingHistory(
  coin: string,
  signal?: AbortSignal,
): Promise<HlFundingPoint[]> {
  const startTime = Date.now() - 7 * 24 * 3600 * 1000;
  try {
    const payload = await info<unknown>(
      { type: 'fundingHistory', coin: normalizeHlCoin(coin), startTime },
      signal,
      120_000,
    );
    return parseFundingHistory(payload);
  } catch {
    return [];
  }
}

/* ------------------------------ derived signal ---------------------------- */

export interface HlSignalFlags {
  /** Funding über +0.01 %/h annualisiert ≈ +87 %/Jahr. */
  fundingCrowded: boolean;
  /** Open Interest hoch UND Preis unter 24 h-Eröffnung: Short-Squeeze-Material. */
  oiDivergence: 'long-heavy' | 'short-heavy' | null;
  /** Premium deutlich positiv (Perp teurer als Oracle) = gehebelte Long-Nachfrage. */
  premiumStretch: 'high' | 'low' | null;
}

/**
 * Reine Ableitung, keine Requests: liest nur den bereits geladenen Kontext.
 * Schwellen sind konservativ und werden in der UI erklärt, nicht als Signal
 * „verkauft".
 */
export function hlSignalFlags(market: HlAssetCtx | null): HlSignalFlags {
  if (!market) return { fundingCrowded: false, oiDivergence: null, premiumStretch: null };
  const fundingHourly = market.fundingRate ?? 0;
  const fundingCrowded = Math.abs(fundingHourly) >= 0.0001;
  const premium = market.premiumPct;
  const premiumStretch = premium == null ? null : premium > 0.1 ? 'high' : premium < -0.1 ? 'low' : null;
  return { fundingCrowded, oiDivergence: null, premiumStretch };
}
