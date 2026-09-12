// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import type { Candle, FeedStatus } from '@/websockets/types';

/** Hard cap per feed – enough history to render, small enough to stay cheap. */
const MAX_CANDLES = 500;

export interface FeedSlice {
  status: FeedStatus;
  attempt: number;
  note: string | null;
  candles: Candle[];
  lastPrice: number | null;
  /** 24 h change in percent when the upstream provides it. */
  changePct: number | null;
  updatedAt: number | null;
  /** True once REST history has been loaded for this feed. */
  seeded: boolean;
}

export interface DexQuote {
  tokenId: string;
  priceUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  poolName: string | null;
  chain: string | null;
  dex: string | null;
  updatedAt: number;
}

interface MarketState {
  /** DEX candle history per token id (GeckoTerminal OHLCV). */
  dexCandles: Record<string, Candle[]>;
  feeds: Record<string, FeedSlice>;
  dexQuote: DexQuote | null;
}

interface MarketActions {
  setFeedStatus: (id: string, status: FeedStatus, extra?: { attempt?: number; note?: string | null }) => void;
  seedCandles: (id: string, candles: Candle[]) => void;
  upsertCandle: (id: string, candle: Candle) => void;
  setFeedMeta: (id: string, meta: Partial<Pick<FeedSlice, 'changePct'>>) => void;
  setDexQuote: (quote: DexQuote | null) => void;
  setDexCandles: (tokenId: string, candles: Candle[]) => void;
  /**
   * Feed hat seinen letzten Konsumenten verloren (TF-/Token-/Venue-Wechsel).
   * Der Slice bleibt als Warm-Cache erhalten – zurückwechseln zeigt sofort die
   * alten Kerzen – und wird erst per LRU verdrängt, wenn mehr als
   * RELEASED_FEED_CACHE freigegebene Feeds liegen. Ohne diese Grenze wächst
   * `feeds` pro besuchter Kombination für die ganze Session (Speicherleck).
   */
  markFeedReleased: (id: string) => void;
  dropFeed: (id: string) => void;
}

export type MarketStore = MarketState & MarketActions;

/** LRU der freigegebenen Feeds (Insertionsreihenfolge, älteste zuerst). */
const RELEASED_FEED_CACHE = 16;
const releasedLru: string[] = [];

function unmarkReleased(id: string): void {
  const pos = releasedLru.indexOf(id);
  if (pos >= 0) releasedLru.splice(pos, 1);
}

const EMPTY_FEED: FeedSlice = {
  status: 'idle',
  attempt: 0,
  note: null,
  candles: [],
  lastPrice: null,
  changePct: null,
  updatedAt: null,
  seeded: false,
};

/**
 * High-frequency market state.
 *
 * Separated from `useAppStore` on purpose: candle ticks arrive ~1×/s per feed
 * and must never invalidate UI-only selectors (theme, layout, …). Components
 * subscribe per feed id, so a BTC tick re-renders exactly the pane showing BTC.
 */
export const useMarketStore = create<MarketStore>()((set) => ({
  feeds: {},
  dexQuote: null,
  dexCandles: {},

  setFeedStatus: (id, status, extra) =>
    set((state) => {
      unmarkReleased(id); // Feed wird (wieder) aktiv versorgt
      const current = state.feeds[id] ?? EMPTY_FEED;
      return {
        feeds: {
          ...state.feeds,
          [id]: {
            ...current,
            status,
            attempt: extra?.attempt ?? (status === 'open' ? 0 : current.attempt),
            note:
              extra?.note !== undefined
                ? extra.note
                : // A reconnect clears stale error notes, but never the
                  // informational "history came from a neighbour venue" marker.
                  status === 'open' && !current.note?.startsWith('seed-via:')
                  ? null
                  : current.note,
          },
        },
      };
    }),

  seedCandles: (id, candles) =>
    set((state) => {
      unmarkReleased(id);
      const current = state.feeds[id] ?? EMPTY_FEED;
      const last = candles[candles.length - 1];
      return {
        feeds: {
          ...state.feeds,
          [id]: {
            ...current,
            candles: candles.slice(-MAX_CANDLES),
            lastPrice: last ? last.c : current.lastPrice,
            seeded: true,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  upsertCandle: (id, candle) =>
    set((state) => {
      unmarkReleased(id);
      const current = state.feeds[id] ?? EMPTY_FEED;
      const candles = current.candles.slice();
      const lastIndex = candles.length - 1;
      const last = lastIndex >= 0 ? candles[lastIndex] : undefined;

      if (last && last.t === candle.t) {
        // Identischer Tick (Börsen pushen Kline-Frames redundant): keine neue
        // Array-Identität ⇒ keine Recompute-Kaskade in den Charts. `closed`
        // muss mitverglichen werden – der Final-Push einer Kerze trägt x=true.
        if (
          last.o === candle.o &&
          last.h === candle.h &&
          last.l === candle.l &&
          last.c === candle.c &&
          last.v === candle.v &&
          last.closed === candle.closed
        ) {
          return state;
        }
        candles[lastIndex] = candle;
      } else if (!last || candle.t > last.t) {
        candles.push(candle);
        if (candles.length > MAX_CANDLES) candles.shift();
      } else {
        // Out-of-order older candle (late REST seed vs. live tick): ignore.
        return state;
      }

      return {
        feeds: {
          ...state.feeds,
          [id]: { ...current, candles, lastPrice: candle.c, updatedAt: Date.now() },
        },
      };
    }),

  setFeedMeta: (id, meta) =>
    set((state) => {
      const current = state.feeds[id];
      if (!current) return state;
      return { feeds: { ...state.feeds, [id]: { ...current, ...meta } } };
    }),

  setDexQuote: (dexQuote) => set({ dexQuote }),
  setDexCandles: (tokenId, candles) => set((state) => ({ dexCandles: { ...state.dexCandles, [tokenId]: candles } })),

  markFeedReleased: (id) =>
    set((state) => {
      if (!(id in state.feeds)) return state;
      unmarkReleased(id);
      releasedLru.push(id);

      let feeds = state.feeds;
      while (releasedLru.length > RELEASED_FEED_CACHE) {
        const oldest = releasedLru.shift();
        if (oldest === undefined) break;
        if (oldest in feeds) {
          if (feeds === state.feeds) feeds = { ...feeds };
          delete feeds[oldest];
        }
      }
      return feeds === state.feeds ? state : { feeds };
    }),

  dropFeed: (id) =>
    set((state) => {
      unmarkReleased(id);
      if (!(id in state.feeds)) return state;
      const feeds = { ...state.feeds };
      delete feeds[id];
      return { feeds };
    }),
}));

/* ------------------------------ selectors ------------------------------ */

export const selectFeed = (id: string) => (s: MarketStore) => s.feeds[id];
export const selectDexQuote = (s: MarketStore) => s.dexQuote;

/** Stable snapshot for components that need "some price" for a token. */
export function readPrice(state: MarketStore, feedIds: string[]): number | null {
  for (const id of feedIds) {
    const feed = state.feeds[id];
    if (feed?.lastPrice != null) return feed.lastPrice;
  }
  return state.dexQuote?.priceUsd ?? null;
}
