// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * PRO metrics – derivatives, order flow, global market, heatmap and options
 * intelligence from free, keyless, CORS-enabled sources. These are the numbers
 * paid terminals sell; every endpoint here was live-verified first.
 *
 *   - api.gateio.ws        → funding, mark/index premium, long-short ratios,
 *                           liquidations per interval, open interest, order book
 *   - www.okx.com          → open interest in USD (cross-check / primary OI)
 *   - api.coingecko.com    → global market cap, volume, BTC/ETH dominance
 *   - api.alternative.me   → Fear & Greed index + history
 *   - www.deribit.com      → DVOL implied-vol index, put/call open interest,
 *                           max pain from the full options chain
 *
 * All parsers are defensive (malformed payload → null, never a throw) and all
 * requests inherit timeout + 4 MiB cap + 429 cooldown from `fetchJson`.
 */

import { fetchJson } from './http';

/* ---------------------------------- types --------------------------------- */

export interface DerivSignals {
  symbol: string;
  fundingRate: number | null;
  /** Funding annualised (3×/day), percent. */
  fundingAnnualPct: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  /** (mark − index) / index, percent. */
  premiumPct: number | null;
  openInterestUsd: number | null;
  /** Long/short ratio of all margin accounts (Gate, 5 m). */
  lsrAccounts: number | null;
  /** Long/short ratio of taker volume (Gate, 5 m). */
  lsrTaker: number | null;
  /** Long/short ratio of top traders by position size (Gate, 5 m). */
  topLsr: number | null;
  liqLongUsd: number | null;
  liqShortUsd: number | null;
  /** Current funding settlement timestamp (ms) and the next one. */
  fundingTime: number | null;
  nextFundingTime: number | null;
}

export interface FlowSignals {
  bestBid: number | null;
  bestAsk: number | null;
  spreadAbs: number | null;
  spreadBps: number | null;
  bidNotional: number | null;
  askNotional: number | null;
  /** bids − asks as share of total book (top 50 levels), percent −100..100. */
  imbalancePct: number | null;
  /** Cumulative depth (price, cumulative notional USD) – nearest level first. */
  depthBids: [number, number][];
  depthAsks: [number, number][];
}

export interface GlobalSignals {
  totalMcapUsd: number;
  mcapChange24hPct: number | null;
  totalVolumeUsd: number | null;
  btcDominancePct: number | null;
  ethDominancePct: number | null;
  activeCryptos: number | null;
  fngValue: number | null;
  fngLabel: string | null;
  /** ~2 weeks of history, oldest → newest. */
  fngHistory: number[];
}

export interface HeatTile {
  pair: string;
  changePct: number;
  quoteVolumeUsd: number;
}

export interface SmilePoint {
  /** (strike / spot − 1) × 100. */
  moneynessPct: number;
  /** OI-weighted mark IV, percent. */
  iv: number;
  oi: number;
}
export interface TermPoint {
  daysToExpiry: number;
  /** ATM-band (±15 % moneyness) OI-weighted mark IV, percent. */
  iv: number;
  instruments: number;
}

export interface VolSignals {
  dvolBtc: number | null;
  dvolBtcChange24h: number | null;
  dvolEth: number | null;
  dvolEthChange24h: number | null;
  putCallOi: number | null;
  maxPain: number | null;
  underlying: number | null;
  expiries: number | null;
  /** IV smile of the nearest expiry with ≥ 10 quoted strikes. */
  smile: SmilePoint[];
  /** ATM IV term structure across expiries, nearest first. */
  term: TermPoint[];
}

/* -------------------------------- helpers --------------------------------- */

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/** `BTC/USDT` → `BTC_USDT` (Gate) / `BTC-USDT-SWAP` (OKX). */
export function perpSymbol(base: string): { gate: string; okx: string } {
  const clean = base.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return { gate: `${clean}_USDT`, okx: `${clean}-USDT-SWAP` };
}

/* ------------------------------- derivatives ------------------------------- */

interface GateContract {
  funding_rate?: string;
  funding_rate_indicative?: string;
  index_price?: string;
  mark_price?: string;
}
interface GateStat {
  lsr_taker?: number;
  lsr_account?: number;
  top_lsr_size?: number;
  open_interest?: number;
  long_liq_usd?: number;
  short_liq_usd?: number;
  mark_price?: number;
}
interface OkxOi {
  code?: string;
  data?: { oiUsd?: string }[];
}
interface OkxFunding {
  code?: string;
  data?: { fundingTime?: string; nextFundingTime?: string }[];
}

export async function fetchDerivSignals(base: string, signal?: AbortSignal): Promise<DerivSignals | null> {
  const { gate, okx } = perpSymbol(base);
  try {
    const [contract, stats, okxOi, okxFundingResp] = await Promise.all([
      fetchJson<GateContract>(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${gate}`, {
        source: 'gate',
        cacheTtlMs: 20_000,
        signal,
      }),
      fetchJson<GateStat[]>(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${gate}&interval=5m&limit=1`, {
        source: 'gate',
        cacheTtlMs: 20_000,
        signal,
      }),
      fetchJson<OkxOi>(`https://www.okx.com/api/v5/public/open-interest?instId=${okx}`, {
        source: 'okx',
        cacheTtlMs: 20_000,
        signal,
      }).catch(() => null),
      fetchJson<OkxFunding>(`https://www.okx.com/api/v5/public/funding-rate?instId=${okx}`, {
        source: 'okx',
        cacheTtlMs: 20_000,
        signal,
      }).catch(() => null),
    ]);
    const okxFunding = okxFundingResp?.data?.[0];

    const stat = Array.isArray(stats) ? stats[0] : undefined;
    const mark = num(contract.mark_price) ?? num(stat?.mark_price);
    const index = num(contract.index_price);
    const funding = num(contract.funding_rate) ?? num(contract.funding_rate_indicative);
    if (mark == null && index == null && funding == null && !stat) return null;

    const gateOiContracts = num(stat?.open_interest);
    const openInterestUsd =
      num(okxOi?.data?.[0]?.oiUsd) ?? (gateOiContracts != null && mark != null ? gateOiContracts * mark : null);

    return {
      symbol: gate,
      fundingRate: funding,
      fundingAnnualPct: funding != null ? funding * 3 * 365 * 100 : null,
      markPrice: mark,
      indexPrice: index,
      premiumPct: mark != null && index != null && index > 0 ? ((mark - index) / index) * 100 : null,
      openInterestUsd,
      lsrAccounts: num(stat?.lsr_account),
      lsrTaker: num(stat?.lsr_taker),
      topLsr: num(stat?.top_lsr_size),
      liqLongUsd: num(stat?.long_liq_usd),
      liqShortUsd: num(stat?.short_liq_usd),
      fundingTime: num(okxFunding?.fundingTime),
      nextFundingTime: num(okxFunding?.nextFundingTime),
    };
  } catch {
    return null;
  }
}

/* -------------------------------- order flow ------------------------------- */

/** Running sum of price × amount per level → [price, cumNotionalUsd]. */
function cumulative(levels: readonly (readonly [number | null, number | null])[]): [number, number][] {
  let sum = 0;
  const out: [number, number][] = [];
  for (const [price, amount] of levels) {
    if (price == null || amount == null) continue;
    sum += price * amount;
    out.push([price, sum]);
  }
  return out;
}

interface GateBook {
  bids?: [string, string][];
  asks?: [string, string][];
}

export async function fetchFlowSignals(base: string, signal?: AbortSignal): Promise<FlowSignals | null> {
  const clean = base.toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    const book = await fetchJson<GateBook>(
      `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${clean}_USDT&limit=50`,
      { source: 'gate', cacheTtlMs: 8_000, signal },
    );
    const bids = (book.bids ?? []).map(([price, amount]) => [num(price), num(amount)] as const);
    const asks = (book.asks ?? []).map(([price, amount]) => [num(price), num(amount)] as const);
    const bestBid = bids[0]?.[0] ?? null;
    const bestAsk = asks[0]?.[0] ?? null;
    if (bestBid == null || bestAsk == null) return null;

    const bidNotional = bids.reduce((sum, [price, amount]) => sum + (price ?? 0) * (amount ?? 0), 0);
    const askNotional = asks.reduce((sum, [price, amount]) => sum + (price ?? 0) * (amount ?? 0), 0);
    const mid = (bestBid + bestAsk) / 2;

    return {
      bestBid,
      bestAsk,
      spreadAbs: bestAsk - bestBid,
      spreadBps: mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null,
      bidNotional,
      askNotional,
      imbalancePct:
        bidNotional + askNotional > 0 ? ((bidNotional - askNotional) / (bidNotional + askNotional)) * 100 : null,
      depthBids: cumulative(bids),
      depthAsks: cumulative(asks),
    };
  } catch {
    return null;
  }
}

/* ----------------------------- global + sentiment --------------------------- */

interface CoinGeckoGlobal {
  data?: {
    total_market_cap?: { usd?: number };
    total_volume?: { usd?: number };
    market_cap_percentage?: { btc?: number; eth?: number };
    active_cryptocurrencies?: number;
    market_cap_change_percentage_24h_usd?: number;
  };
}
interface FngResponse {
  data?: { value?: string; value_classification?: string }[];
}

export async function fetchGlobalSignals(signal?: AbortSignal): Promise<GlobalSignals | null> {
  try {
    const [global, fng] = await Promise.all([
      fetchJson<CoinGeckoGlobal>('https://api.coingecko.com/api/v3/global', {
        source: 'coingecko',
        cacheTtlMs: 120_000,
        signal,
      }),
      fetchJson<FngResponse>('https://api.alternative.me/fng/?limit=14', {
        source: 'alternative.me',
        cacheTtlMs: 120_000,
        signal,
      }),
    ]);
    const data = global.data;
    const totalMcapUsd = num(data?.total_market_cap?.usd);
    if (totalMcapUsd == null) return null;
    // alternative.me returns newest first
    const history = (fng.data ?? [])
      .map((entry) => num(entry.value))
      .filter((value): value is number => value != null)
      .reverse();

    return {
      totalMcapUsd,
      mcapChange24hPct: num(data?.market_cap_change_percentage_24h_usd),
      totalVolumeUsd: num(data?.total_volume?.usd),
      btcDominancePct: num(data?.market_cap_percentage?.btc),
      ethDominancePct: num(data?.market_cap_percentage?.eth),
      activeCryptos: num(data?.active_cryptocurrencies),
      fngValue: history.length > 0 ? (history[history.length - 1] ?? null) : null,
      fngLabel: fng.data?.[0]?.value_classification ?? null,
      fngHistory: history,
    };
  } catch {
    return null;
  }
}

/* --------------------------------- heatmap --------------------------------- */

interface GateTicker {
  currency_pair?: string;
  last?: string;
  change_percentage?: string;
  quote_volume?: string;
}

interface OkxTicker {
  instId?: string;
  last?: string;
  open24h?: string;
  volCcy24h?: string;
}

/**
 * Spot ticker rows for heatmap/breadth: Gate first, OKX as the regional
 * fallback (some networks block one of the two). 120 s cached per source.
 */
async function spotTickerRows(signal?: AbortSignal): Promise<HeatTile[]> {
  try {
    const tickers = await fetchJson<GateTicker[]>('https://api.gateio.ws/api/v4/spot/tickers', {
      source: 'gate',
      cacheTtlMs: 120_000,
      signal,
    });
    const rows = (Array.isArray(tickers) ? tickers : [])
      .filter((entry) => entry.currency_pair?.endsWith('_USDT'))
      .map((entry) => ({
        pair: (entry.currency_pair ?? '').replace('_USDT', '').replace('_', '/'),
        changePct: num(entry.change_percentage) ?? 0,
        quoteVolumeUsd: num(entry.quote_volume) ?? 0,
      }))
      .filter((entry) => entry.pair && entry.quoteVolumeUsd > 0);
    if (rows.length > 0) return rows;
  } catch {
    /* region-blocked or rate-limited – fall through to OKX */
  }
  const payload = await fetchJson<{ data?: OkxTicker[] }>('https://www.okx.com/api/v5/market/tickers?instType=SPOT', {
    source: 'okx-heat',
    cacheTtlMs: 120_000,
    signal,
  });
  const tickers = payload?.data ?? [];
  return (Array.isArray(tickers) ? tickers : [])
    .filter((entry) => entry.instId?.endsWith('-USDT'))
    .map((entry) => {
      const last = num(entry.last) ?? 0;
      const open = num(entry.open24h) ?? 0;
      return {
        pair: (entry.instId ?? '').replace('-USDT', '').replace('-', '/'),
        changePct: open > 0 ? ((last - open) / open) * 100 : 0,
        quoteVolumeUsd: num(entry.volCcy24h) ?? 0,
      };
    })
    .filter((entry) => entry.pair && entry.quoteVolumeUsd > 0);
}

export async function fetchHeatmap(signal?: AbortSignal): Promise<HeatTile[]> {
  try {
    return (await spotTickerRows(signal)).sort((a, b) => b.quoteVolumeUsd - a.quoteVolumeUsd).slice(0, 28);
  } catch {
    return [];
  }
}

/* ------------------------- options / implied volatility --------------------- */

interface DvolResponse {
  result?: { data?: [number, number, number, number, number][] };
}
interface BookSummaryEntry {
  instrument_name?: string;
  open_interest?: number;
  estimated_delivery_price?: number;
  underlying_price?: number;
  mark_iv?: number;
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** `BTC-25SEP26-155000-P` → expiry ms + strike; null when unparseable. */
function parseInstrument(name: string): { expiryMs: number; strike: number } | null {
  const parts = name.split('-');
  if (parts.length < 3) return null;
  const datePart = parts[1] ?? '';
  const strike = num(parts[2]);
  const day = Number(datePart.slice(0, 2));
  const mon = MONTHS[datePart.slice(2, 5).toUpperCase()];
  const year = Number(datePart.slice(5, 7));
  if (!Number.isFinite(day) || mon == null || !Number.isFinite(year) || strike == null) return null;
  return { expiryMs: Date.UTC(2000 + year, mon, day, 8, 0, 0), strike };
}

/** OI-weighted IV over a list of entries; null when no data. */
function weightedIv(rows: { iv: number; oi: number }[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const row of rows) {
    const w = Math.max(row.oi, 0.01);
    sum += row.iv * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

async function fetchDvol(currency: 'BTC' | 'ETH', signal?: AbortSignal) {
  const now = Date.now();
  const start = now - 36 * 3600 * 1000;
  const payload = await fetchJson<DvolResponse>(
    `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}&resolution=3600&start_timestamp=${start}&end_timestamp=${now}`,
    { source: 'deribit', cacheTtlMs: 300_000, signal },
  );
  const rows = payload.result?.data ?? [];
  const closes = rows.map((row) => row[4]).filter((value): value is number => Number.isFinite(value));
  const last = closes[closes.length - 1] ?? null;
  const dayAgo = closes[Math.max(0, closes.length - 25)] ?? null;
  return { last, change: last != null && dayAgo != null && dayAgo > 0 ? ((last - dayAgo) / dayAgo) * 100 : null };
}

export async function fetchVolSignals(signal?: AbortSignal): Promise<VolSignals | null> {
  try {
    const [btc, eth, chain] = await Promise.all([
      fetchDvol('BTC', signal).catch(() => ({ last: null, change: null })),
      fetchDvol('ETH', signal).catch(() => ({ last: null, change: null })),
      fetchJson<{ result?: BookSummaryEntry[] }>(
        'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
        { source: 'deribit', cacheTtlMs: 300_000, signal },
      ).catch(() => null),
    ]);

    let putCallOi: number | null = null;
    let maxPain: number | null = null;
    let underlying: number | null = null;
    let smile: SmilePoint[] = [];
    let term: TermPoint[] = [];
    const entries = chain?.result ?? [];
    if (entries.length > 0) {
      let putOi = 0;
      let callOi = 0;
      const oiByStrike = new Map<number, { put: number; call: number }>();
      for (const entry of entries) {
        const name = entry.instrument_name ?? '';
        // e.g. BTC-25SEP26-80000-P
        const parts = name.split('-');
        const isPut = parts[parts.length - 1] === 'P';
        const isCall = parts[parts.length - 1] === 'C';
        const strike = num(parts[parts.length - 2]);
        const oi = num(entry.open_interest) ?? 0;
        underlying = underlying ?? num(entry.underlying_price) ?? num(entry.estimated_delivery_price);
        if (strike == null || (!isPut && !isCall)) continue;
        if (isPut) putOi += oi;
        else callOi += oi;
        const bucket = oiByStrike.get(strike) ?? { put: 0, call: 0 };
        if (isPut) bucket.put += oi;
        else bucket.call += oi;
        oiByStrike.set(strike, bucket);
      }
      putCallOi = putOi > 0 ? callOi / putOi : null;


      // Max pain: the strike where the aggregate option payout is minimal.
      const spot = underlying;
      if (spot != null && oiByStrike.size > 0) {
        let bestPain = Number.POSITIVE_INFINITY;
        for (const candidate of oiByStrike.keys()) {
          let pain = 0;
          for (const [strike, bucket] of oiByStrike) {
            pain += bucket.call * Math.max(0, candidate - strike);
            pain += bucket.put * Math.max(0, strike - candidate);
          }
          if (pain < bestPain) {
            bestPain = pain;
            maxPain = candidate;
          }
        }

      // ---- IV smile (nearest expiry with ≥ 10 strikes) & term structure ----
      if (spot != null) {
        const parsed = entries
          .map((entry) => {
            const info = parseInstrument(entry.instrument_name ?? '');
            const iv = num(entry.mark_iv);
            const oi = num(entry.open_interest) ?? 0;
            return info && iv != null && iv > 0 && iv < 500 ? { ...info, iv, oi } : null;
          })
          .filter((row): row is NonNullable<typeof row> => row != null);

        const byExpiry = new Map<number, typeof parsed>();
        for (const row of parsed) {
          const list = byExpiry.get(row.expiryMs) ?? [];
          list.push(row);
          byExpiry.set(row.expiryMs, list);
        }

        const expiriesSorted = [...byExpiry.keys()].sort((a, b) => a - b);
        const nearest = expiriesSorted.find((key) => (byExpiry.get(key)?.length ?? 0) >= 10);
        if (nearest != null) {
          const buckets = new Map<number, { iv: number; oi: number }[]>();
          for (const row of byExpiry.get(nearest) ?? []) {
            const moneyness = (row.strike / spot - 1) * 100;
            if (Math.abs(moneyness) > 120) continue;
            const bucket = Math.round(moneyness / 10) * 10;
            const list = buckets.get(bucket) ?? [];
            list.push({ iv: row.iv, oi: row.oi });
            buckets.set(bucket, list);
          }
          smile = [...buckets.entries()]
            .map(([moneynessPct, rows]) => {
              const iv = weightedIv(rows);
              const oi = rows.reduce((sum, row) => sum + row.oi, 0);
              return iv == null ? null : { moneynessPct, iv, oi };
            })
            .filter((row): row is SmilePoint => row != null)
            .sort((a, b) => a.moneynessPct - b.moneynessPct);
        }

        const now = Date.now();
        term = expiriesSorted
          .map((expiryMs) => {
            const rows = (byExpiry.get(expiryMs) ?? [])
              .filter((row) => Math.abs(row.strike / spot - 1) <= 0.15)
              .map((row) => ({ iv: row.iv, oi: row.oi }));
            const iv = rows.length >= 3 ? weightedIv(rows) : null;
            return iv == null
              ? null
              : { daysToExpiry: Math.max(0, (expiryMs - now) / 86_400_000), iv, instruments: rows.length };
          })
          .filter((row): row is TermPoint => row != null)
          .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
          .slice(0, 10);
      }
      }
    }

    if (btc.last == null && eth.last == null && putCallOi == null) return null;
    return {
      dvolBtc: btc.last,
      dvolBtcChange24h: btc.change,
      dvolEth: eth.last,
      dvolEthChange24h: eth.change,
      putCallOi,
      maxPain,
      underlying,
      expiries: entries.length,
      smile,
      term,
    };
  } catch {
    return null;
  }
}

/* ------------------------- derivatives history (sparklines) ---------------- */

export interface DerivHistory {
  /** Unix ms per point, oldest → newest. */
  times: number[];
  /** 5-min open interest in USD (Gate). */
  oiUsd: (number | null)[];
  /** Taker long/short ratio (Gate). */
  lsrTaker: (number | null)[];
  /** Account long/short ratio (Gate). */
  lsrAccounts: (number | null)[];
  /** Liquidated notional per 5-min bucket, USD. */
  liqLongUsd: (number | null)[];
  liqShortUsd: (number | null)[];
  /** Settled funding rate every 8 h, oldest → newest (last ~24 points). */
  fundingHistory: number[];
}

interface GateStatRow {
  time?: number;
  open_interest_usd?: number;
  lsr_taker?: number;
  lsr_account?: number;
  long_liq_usd?: number;
  short_liq_usd?: number;
}
interface GateFundingRow {
  r?: string;
  /** Unix seconds. */
  t?: number;
}

/** 2.5 h of 5-min stats + ~8 days of settled funding for the sparklines. */
export async function fetchDerivHistory(base: string, signal?: AbortSignal): Promise<DerivHistory | null> {
  const { gate } = perpSymbol(base);
  try {
    const [stats, funding] = await Promise.all([
      fetchJson<GateStatRow[]>(
        `https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${gate}&interval=5m&limit=30`,
        { source: 'gate', cacheTtlMs: 60_000, signal },
      ).catch(() => null),
      fetchJson<GateFundingRow[]>(
        `https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=${gate}&limit=24`,
        { source: 'gate', cacheTtlMs: 300_000, signal },
      ).catch(() => null),
    ]);

    const rows = (Array.isArray(stats) ? stats : []).slice().reverse(); // newest first → oldest first
    const times = rows
      .map((row) => (typeof row.time === 'number' ? row.time * 1000 : null))
      .filter((value): value is number => value != null);
    if (times.length === 0 && !(Array.isArray(funding) && funding.length > 0)) return null;

    const fundingHistory = (Array.isArray(funding) ? funding : [])
      .slice()
      .reverse()
      .map((row) => num(row.r))
      .filter((value): value is number => value != null);

    return {
      times,
      oiUsd: rows.map((row) => num(row.open_interest_usd)),
      lsrTaker: rows.map((row) => num(row.lsr_taker)),
      lsrAccounts: rows.map((row) => num(row.lsr_account)),
      liqLongUsd: rows.map((row) => num(row.long_liq_usd)),
      liqShortUsd: rows.map((row) => num(row.short_liq_usd)),
      fundingHistory,
    };
  } catch {
    return null;
  }
}

/* ------------------------------- market breadth ---------------------------- */

export interface Breadth {
  advancers: number;
  decliners: number;
  total: number;
  /** advancers / (advancers + decliners), percent 0..100. */
  advPct: number | null;
  /** Median 24 h change across all quoted USDT pairs, percent. */
  medianChangePct: number | null;
}

/**
 * Advance/decline breadth across every quoted Gate USDT pair. Shares the
 * 120 s cached tickers response with the heatmap, so it costs no extra calls.
 */
export async function fetchBreadth(signal?: AbortSignal): Promise<Breadth | null> {
  try {
    const rows = (await spotTickerRows(signal)).map((entry) => entry.changePct);
    if (rows.length === 0) return null;
    const advancers = rows.filter((value) => value > 0.01).length;
    const decliners = rows.filter((value) => value < -0.01).length;
    const sorted = [...rows].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? (sorted[mid] ?? null) : (((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
    return {
      advancers,
      decliners,
      total: rows.length,
      advPct: advancers + decliners > 0 ? (advancers / (advancers + decliners)) * 100 : null,
      medianChangePct: median,
    };
  } catch {
    return null;
  }
}

/* ---------------------------------- screener ------------------------------- */

export interface ScreenerRow {
  pair: string;
  base: string;
  last: number;
  changePct: number;
  quoteVolumeUsd: number;
  high24h: number | null;
  low24h: number | null;
  /** Position of `last` inside the 24 h range, 0..1. */
  rangePos: number | null;
}

/**
 * Every quoted Gate USDT pair (~2 000 rows) for the screener – same cached
 * tickers response as heatmap/breadth, so the screener costs zero extra calls.
 */
export async function fetchScreenerRows(signal?: AbortSignal): Promise<ScreenerRow[]> {
  try {
    const tickers = await fetchJson<GateTickerFull[]>('https://api.gateio.ws/api/v4/spot/tickers', {
      source: 'gate',
      cacheTtlMs: 120_000,
      signal,
    });
    return (Array.isArray(tickers) ? tickers : [])
      .filter((entry) => entry.currency_pair?.endsWith('_USDT'))
      .map((entry) => {
        const last = num(entry.last);
        const high = num(entry.high_24h);
        const low = num(entry.low_24h);
        const span = high != null && low != null ? high - low : 0;
        return {
          pair: (entry.currency_pair ?? '').replace('_USDT', '').replace('_', '/'),
          base: (entry.currency_pair ?? '').split('_')[0] ?? '',
          last: last ?? 0,
          changePct: num(entry.change_percentage) ?? 0,
          quoteVolumeUsd: num(entry.quote_volume) ?? 0,
          high24h: high,
          low24h: low,
          rangePos: last != null && span > 0 && low != null ? (last - low) / span : null,
        };
      })
      .filter((row) => row.pair && row.last > 0 && row.quoteVolumeUsd > 0);
  } catch {
    return [];
  }
}

interface GateTickerFull {
  currency_pair?: string;
  last?: string;
  change_percentage?: string;
  quote_volume?: string;
  high_24h?: string;
  low_24h?: string;
}
