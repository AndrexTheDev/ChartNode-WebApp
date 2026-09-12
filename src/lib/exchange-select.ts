// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import { ADAPTERS, EXCHANGE_PREFERENCE } from '@/websockets/registry';
import type { ExchangeId } from '@/websockets/types';
import { isRestrictedIn } from './region';
import { isFresh, type ExchangeReach } from '@/store/useExchangeStore';

export interface RankedExchange {
  id: ExchangeId;
  /** Venue can chart this timeframe at all. */
  supportedTimeframe: boolean;
  /** Venue demonstrably does not list the pair. */
  listsPair: boolean;
  reach: ExchangeReach | null;
  restricted: boolean;
  /** Lower is better. */
  score: number;
}

export interface SelectionInput {
  symbol: string;
  timeframe: Timeframe;
  country: string | null;
  reach: Record<string, ExchangeReach>;
  unsupported: Record<string, string[]>;
  preferred: Record<string, ExchangeId>;
}

const LATENCY_CAP_MS = 1500;
/** Max latency contribution – stays below the gap between reachability classes. */
const LATENCY_WEIGHT = 0.4;
/**
 * One step down the liquidity preference list costs 0.05, i.e. a venue must be
 * ~190 ms faster to outrank the next-deeper one. Deep books chart better, so
 * speed only wins when the difference is actually noticeable.
 */
const PREFERENCE_STEP = 0.05;

/**
 * Reachability class: 0 = measured reachable, 0.5 = slow, 1 = unknown/stale,
 * 2 = measured unreachable. Restricted venues get +1 (they usually still serve
 * public data, so this only re-orders – it never hides an exchange).
 *
 * Measured latency adds up to `LATENCY_WEIGHT`, which is smaller than the gap
 * between any two classes: a venue that answers in 40 ms beats one that needs
 * 900 ms, but a blocked venue never wins on speed alone.
 */
function scoreOf(reach: ExchangeReach | undefined, restricted: boolean): number {
  let score: number;
  if (!isFresh(reach)) score = 1;
  else if (reach?.status === 'ok' || reach?.status === 'slow') score = reach.status === 'slow' ? 0.5 : 0;
  else if (reach?.status === 'blocked' || reach?.status === 'error') score = 2;
  else score = 1;

  const ms = isFresh(reach) ? reach?.ms : null;
  if (ms != null) score += (Math.min(ms, LATENCY_CAP_MS) / LATENCY_CAP_MS) * LATENCY_WEIGHT;
  return score + (restricted ? 1 : 0);
}

/** All venues, best-first for this symbol/timeframe/region. */
export function rankExchanges(input: SelectionInput): RankedExchange[] {
  const ranked = EXCHANGE_PREFERENCE.map<RankedExchange>((id, index) => {
    const adapter = ADAPTERS[id];
    const supportedTimeframe = adapter.timeframes.includes(input.timeframe);
    const listsPair = !(input.unsupported[id] ?? []).includes(input.symbol);
    const reach = input.reach[id] ?? null;
    const restricted = isRestrictedIn(id, input.country);
    return {
      id,
      supportedTimeframe,
      listsPair,
      reach,
      restricted,
      // Preference order breaks remaining ties deterministically.
      score: scoreOf(reach ?? undefined, restricted) + index * PREFERENCE_STEP,
    };
  });

  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aMs = a.reach?.ms ?? Number.POSITIVE_INFINITY;
    const bMs = b.reach?.ms ?? Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });

  return ranked;
}

/** The venue to use right now: manual choice first, otherwise the best match. */
export function pickExchange(input: SelectionInput): ExchangeId {
  const ranked = rankExchanges(input);

  const manual = input.preferred[input.symbol];
  if (manual) {
    const entry = ranked.find((r) => r.id === manual);
    if (entry?.supportedTimeframe && entry.listsPair && (entry.reach?.status ?? 'unknown') !== 'blocked') {
      return manual;
    }
  }

  const usable = ranked.find((r) => r.supportedTimeframe && r.listsPair);
  if (usable) return usable.id;
  // Nothing verified yet – fall back to anything that can chart the timeframe.
  return ranked.find((r) => r.supportedTimeframe)?.id ?? EXCHANGE_PREFERENCE[0] ?? 'binance';
}
