// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage } from './storage';
import type { ExchangeId } from '@/websockets/types';

export type Reachability = 'unknown' | 'probing' | 'ok' | 'slow' | 'blocked' | 'error';

export interface ExchangeReach {
  status: Reachability;
  /** Round-trip time of the last successful probe. */
  ms: number | null;
  note: string | null;
  checkedAt: number;
}

/** Reachability results older than this are treated as "unknown" again. */
export const REACH_TTL_MS = 6 * 60 * 60 * 1000;
/** Latency above this still works, but is ranked behind faster venues. */
export const SLOW_MS = 1200;

export const EMPTY_REACH: ExchangeReach = { status: 'unknown', ms: null, note: null, checkedAt: 0 };

interface ExchangeState {
  /** ISO-3166 alpha-2 of the visitor (edge cookie or timezone heuristic). */
  country: string | null;
  countrySource: 'edge' | 'timezone' | null;
  /** Last reachability probe per exchange. */
  reach: Record<string, ExchangeReach>;
  /** Pairs a venue demonstrably does not list (exchange → symbols). */
  unsupported: Record<string, string[]>;
  /** Manual per-symbol venue choice (symbol → exchange). */
  preferred: Record<string, ExchangeId>;
  /** True while a probe run is in flight. */
  probing: boolean;
  lastProbeAt: number | null;
}

interface ExchangeActions {
  setRegion: (country: string | null, source: 'edge' | 'timezone' | null) => void;
  setReach: (exchange: ExchangeId, reach: Omit<ExchangeReach, 'checkedAt'>) => void;
  setProbing: (probing: boolean) => void;
  markUnsupported: (exchange: ExchangeId, symbol: string) => void;
  clearUnsupported: (exchange: ExchangeId, symbol: string) => void;
  setPreferred: (symbol: string, exchange: ExchangeId | null) => void;
  resetProbes: () => void;
}

export type ExchangeStore = ExchangeState & ExchangeActions;

/**
 * Region- and availability-aware venue selection state.
 *
 * NodeChart cannot know in advance which exchange a visitor can reach: public
 * APIs are geo-blocked per country (Binance 451, Bybit 403, …) and those lists
 * change without notice. So the app *measures* it once per session and persists
 * the result for 6 h – the UI then adapts to the visitor instead of failing.
 */
export const useExchangeStore = create<ExchangeStore>()(
  persist(
    (set) => ({
      country: null,
      countrySource: null,
      reach: {},
      unsupported: {},
      preferred: {},
      probing: false,
      lastProbeAt: null,

      setRegion: (country, countrySource) => set({ country, countrySource }),

      setReach: (exchange, reach) =>
        set((state) => ({
          reach: { ...state.reach, [exchange]: { ...reach, checkedAt: Date.now() } },
          lastProbeAt: Date.now(),
        })),

      setProbing: (probing) => set({ probing }),

      markUnsupported: (exchange, symbol) =>
        set((state) => {
          const current = state.unsupported[exchange] ?? [];
          if (current.includes(symbol)) return state;
          return { unsupported: { ...state.unsupported, [exchange]: [...current, symbol] } };
        }),

      clearUnsupported: (exchange, symbol) =>
        set((state) => {
          const current = state.unsupported[exchange] ?? [];
          if (!current.includes(symbol)) return state;
          return { unsupported: { ...state.unsupported, [exchange]: current.filter((s) => s !== symbol) } };
        }),

      setPreferred: (symbol, exchange) =>
        set((state) => {
          const preferred = { ...state.preferred };
          if (exchange === null) delete preferred[symbol];
          else preferred[symbol] = exchange;
          return { preferred };
        }),

      resetProbes: () => set({ reach: {}, lastProbeAt: null }),
    }),
    {
      name: 'nodechart.exchanges.v1',
      storage: appStorage,
      // `probing` is runtime-only – never persist a spinner.
      partialize: (state) => ({
        country: state.country,
        countrySource: state.countrySource,
        reach: state.reach,
        unsupported: state.unsupported,
        preferred: state.preferred,
        lastProbeAt: state.lastProbeAt,
      }),
    },
  ),
);

/* -------------------------------- selectors ------------------------------- */

export const selectCountry = (s: ExchangeStore) => s.country;
export const selectProbing = (s: ExchangeStore) => s.probing;
export const selectPreferred = (s: ExchangeStore) => s.preferred;

export function selectReach(exchange: ExchangeId) {
  return (s: ExchangeStore): ExchangeReach => s.reach[exchange] ?? EMPTY_REACH;
}

export function isFresh(reach: ExchangeReach | undefined, now = Date.now()): boolean {
  return Boolean(reach && reach.checkedAt > 0 && now - reach.checkedAt < REACH_TTL_MS);
}
