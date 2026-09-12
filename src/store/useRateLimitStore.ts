// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';

export interface RateLimitState {
  /** Overlay visible right now. */
  active: boolean;
  /** Which upstream triggered it (`dexscreener`, `goplus`, …). */
  source: string | null;
  /** Epoch ms when the cooldown ends – the overlay counts down to it. */
  deadline: number;
  /** How many 429s accumulated in this cooldown window. */
  hits: number;
}

interface RateLimitActions {
  begin: (source: string, ms: number) => void;
  bump: (source: string) => void;
  end: () => void;
}

export type RateLimitStore = RateLimitState & RateLimitActions;

/**
 * Deliberately tiny: the overlay is a global, modal-ish signal and only one
 * cooldown can run at a time. Kept separate from `useAppStore` so a 429 never
 * invalidates unrelated selectors.
 */
export const useRateLimitStore = create<RateLimitStore>()((set, get) => ({
  active: false,
  source: null,
  deadline: 0,
  hits: 0,

  begin: (source, ms) =>
    set({
      active: true,
      source,
      deadline: Date.now() + ms,
      hits: get().hits + 1,
    }),

  bump: (source) => set({ source, hits: get().hits + 1 }),

  end: () => set({ active: false, source: null, deadline: 0, hits: 0 }),
}));

export const selectRateLimitActive = (s: RateLimitStore) => s.active;
