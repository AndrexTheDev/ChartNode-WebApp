// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import type { ExchangeId } from '@/websockets/types';

export interface WhaleTrade {
  id: string;
  exchange: ExchangeId;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  ts: number;
}

const MAX_WHALES = 48;

interface WhaleState {
  trades: WhaleTrade[];
  count: number;
  totalNotional: number;
  /** Stream on/off – controls whether trade channels are subscribed. */
  enabled: boolean;
  /** Minimum notional in USD to count as a whale. */
  thresholdUsd: number;
}

interface WhaleActions {
  pushMany: (trades: WhaleTrade[]) => void;
  setEnabled: (enabled: boolean) => void;
  setThreshold: (thresholdUsd: number) => void;
  clear: () => void;
}

export type WhaleStore = WhaleState & WhaleActions;

export const useWhaleStore = create<WhaleStore>()((set) => ({
  trades: [],
  count: 0,
  totalNotional: 0,
  enabled: true,
  thresholdUsd: 10_000,

  pushMany: (incoming) =>
    set((state) => {
      if (incoming.length === 0) return state;
      const trades = [...incoming, ...state.trades].slice(0, MAX_WHALES);
      return {
        trades,
        count: state.count + incoming.length,
        totalNotional: state.totalNotional + incoming.reduce((sum, t) => sum + t.notional, 0),
      };
    }),

  setEnabled: (enabled) => set({ enabled }),
  setThreshold: (thresholdUsd) => set({ thresholdUsd }),
  clear: () => set({ trades: [], count: 0, totalNotional: 0 }),
}));

export const selectWhaleTrades = (s: WhaleStore) => s.trades;
export const selectWhaleEnabled = (s: WhaleStore) => s.enabled;
export const selectWhaleThreshold = (s: WhaleStore) => s.thresholdUsd;
