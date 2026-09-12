// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isPremiumTheme } from '@/lib/theme';
import { appStorage } from './storage';
import { useAppStore } from './useAppStore';
import type { ThemeId } from './types';

export type ShareReason = 'chart' | 'theme' | null;

interface ViralState {
  /** "I have donated" was declared – the permanent SUPPORTER badge (cosmetic). */
  supporter: boolean;
  /**
   * Self-declared donation (trust-based, no on-chain attribution possible
   * client-side). `lastDonationAt` starts the ask-free grace window:
   * 48 h for any donation, 5 days above DONATION_GRACE_BIG_USD.
   */
  lastDonationAt: number | null;
  lastDonationUsd: number;
  /** Epoch ms of the last "Dismiss" – the wall respawns after 7 days. */
  wallDismissedAt: number | null;
  /** One X/Telegram share unlocks the premium themes, forever. */
  shareUnlocked: boolean;
  shares: number;
  /** UI state (not persisted): the share modal + why it opened. */
  shareOpen: boolean;
  shareReason: ShareReason;
  /** UI state (not persisted): the tip-jar modal. */
  supportOpen: boolean;
  /** Features already celebrated once (persisted) – the ribbon shows once each. */
  celebrated: string[];
  /** Wave-4: tools opened this session (not persisted) – powers the usage nudge. */
  sessionTools: number;
  toolNudgeShown: boolean;
  bumpTool: () => void;

  openShare: (reason?: Exclude<ShareReason, null>) => void;
  closeShare: () => void;
  openSupport: () => void;
  closeSupport: () => void;
  celebrate: (feature: string) => void;
  unlockViaShare: () => void;
  /** Self-declared donation in USD – grants the badge + the grace window. */
  registerDonation: (usd: number) => void;
  dismissWall: () => void;
  /** Applies a theme, or turns a locked premium theme into a share invitation. */
  requestTheme: (theme: ThemeId) => boolean;
}

export const WALL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Donation grace: any declared donation silences every ask for 48 h … */
export const DONATION_GRACE_MS = 48 * 60 * 60 * 1000;
/** … and a donation above this USD amount silences them for 5 days. */
export const DONATION_GRACE_BIG_MS = 5 * 24 * 60 * 60 * 1000;
export const BIG_DONATION_USD = 5;

/**
 * Restliche Gnadenfrist in ms (0 = keine). Jeder Spendenaufruf (Nudge-Toast,
 * Milestone, Tool-Nudge, Ribbon, Ad-Block-Wall) prüft diese eine Funktion –
 * ein Gate für alle Aufrufe, keine verstreuten Sonderregeln.
 */
export function donationGraceMs(state: Pick<ViralState, 'lastDonationAt' | 'lastDonationUsd'>): number {
  const at = state.lastDonationAt;
  if (at === null || !Number.isFinite(at) || at <= 0) return 0;
  const span = state.lastDonationUsd > BIG_DONATION_USD ? DONATION_GRACE_BIG_MS : DONATION_GRACE_MS;
  return Math.max(0, at + span - Date.now());
}

export function donationGraceActive(
  state: Pick<ViralState, 'lastDonationAt' | 'lastDonationUsd'> = useViralStore.getState(),
): boolean {
  return donationGraceMs(state) > 0;
}

/**
 * Monetization & viral-loop state.
 *
 * Persisted: supporter flag, wall cooldown, share unlock (the gamification
 * reward has to survive reloads). Transient: the share modal itself.
 */
export const useViralStore = create<ViralState>()(
  persist(
    (set, get) => ({
      supporter: false,
      lastDonationAt: null,
      lastDonationUsd: 0,
      wallDismissedAt: null,
      shareUnlocked: false,
      shares: 0,
      shareOpen: false,
      shareReason: null,
      supportOpen: false,
      celebrated: [],
      sessionTools: 0,
      toolNudgeShown: false,
      bumpTool: () => set((state) => ({ sessionTools: state.sessionTools + 1 })),

      openShare: (reason = 'chart') => set({ shareOpen: true, shareReason: reason }),
      closeShare: () => set({ shareOpen: false, shareReason: null }),
      openSupport: () => set({ supportOpen: true }),
      closeSupport: () => set({ supportOpen: false }),
      celebrate: (feature) =>
        set((state) =>
          state.celebrated.includes(feature) ? state : { celebrated: [...state.celebrated, feature] },
        ),

      unlockViaShare: () =>
        set((state) => ({ shareUnlocked: true, shares: state.shares + 1 })),

      registerDonation: (usd) =>
        set((state) => ({
          supporter: true,
          lastDonationAt: Date.now(),
          lastDonationUsd:
            Number.isFinite(usd) && usd > 0 ? Math.min(usd, 1_000_000) : state.lastDonationUsd,
        })),
      dismissWall: () => set({ wallDismissedAt: Date.now() }),

      requestTheme: (theme) => {
        if (isPremiumTheme(theme) && !get().shareUnlocked) {
          set({ shareOpen: true, shareReason: 'theme' });
          return false;
        }
        useAppStore.getState().setTheme(theme);
        return true;
      },
    }),
    {
      name: 'nc-viral-v1',
      storage: appStorage,
      partialize: (state) => ({
        supporter: state.supporter,
        lastDonationAt: state.lastDonationAt,
        lastDonationUsd: state.lastDonationUsd,
        wallDismissedAt: state.wallDismissedAt,
        shareUnlocked: state.shareUnlocked,
        shares: state.shares,
        celebrated: state.celebrated,
      }),
      /** Corrupted storage must not resurrect the wall or fake an unlock. */
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const bool = (value: unknown, fallback: boolean): boolean =>
          typeof value === 'boolean' ? value : fallback;
        const supporter = bool(p.supporter, current.supporter);
        const donationAt =
          typeof p.lastDonationAt === 'number' && Number.isFinite(p.lastDonationAt) && p.lastDonationAt > 0
            ? p.lastDonationAt
            : null;
        const donationUsd =
          typeof p.lastDonationUsd === 'number' && Number.isFinite(p.lastDonationUsd) && p.lastDonationUsd >= 0 && p.lastDonationUsd <= 1_000_000
            ? p.lastDonationUsd
            : 0;
        return {
          ...current,
          supporter,
          // Legacy-Migration: Vor der Grace-Ära bedeutete supporter=true
          // „für immer ruhig". Bestehende Supporter bekommen ab dem ersten
          // Rehydrate einmalig 48 h Gnadenfrist (Small-Tier) statt sofort
          // wieder Aufrufe zu sehen.
          lastDonationAt: donationAt ?? (supporter ? Date.now() : current.lastDonationAt),
          lastDonationUsd: donationAt === null && supporter ? 1 : donationUsd,
          wallDismissedAt:
            typeof p.wallDismissedAt === 'number' && Number.isFinite(p.wallDismissedAt)
              ? p.wallDismissedAt
              : current.wallDismissedAt,
          shareUnlocked: bool(p.shareUnlocked, current.shareUnlocked),
          celebrated: Array.isArray(p.celebrated)
            ? (p.celebrated as unknown[]).filter((entry): entry is string => typeof entry === 'string')
            : current.celebrated,
          shares: typeof p.shares === 'number' && Number.isFinite(p.shares) ? p.shares : current.shares,
        };
      },
    },
  ),
);

export const selectShareUnlocked = (s: ViralState): boolean => s.shareUnlocked;
export const selectShareOpen = (s: ViralState): boolean => s.shareOpen;
