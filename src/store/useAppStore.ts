// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { DEFAULT_TOKEN, SEED_TOKENS, STORAGE_KEY, TOKEN_INDEX } from '@/lib/constants';
import { CHART_LAYOUTS, THEMES, buildPanes, isChartLayoutId, isChartType, isTimeframe } from './presets';
import { appStorage } from './storage';
import { isThemeId } from '@/lib/theme';
import type {
  AppStore,
  ChartLayoutId,
  ChartType,
  Pane,
  PaneKind,
  ThemeId,
  Timeframe,
  Token,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Defaults                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_WATCHLIST = SEED_TOKENS.slice(0, 4).map((token) => token.id);

/** Everything the store starts with. Also the target of `reset()`. */
export const INITIAL_STATE = {
  // UI
  theme: 'acid' as ThemeId,
  locale: 'en',
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  bannerDismissed: false,

  // Chart layout
  layout: '1x1' as ChartLayoutId,
  chartType: 'candles' as ChartType,
  timeframe: '1h' as Timeframe,
  panes: buildPanes('1x1'),

  // Market
  activeToken: DEFAULT_TOKEN,
  watchlist: DEFAULT_WATCHLIST,
};

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Global app store.
 *
 * Why Zustand: subscriptions are selector-scoped, so a timeframe change never
 * re-renders the header, and a theme change never re-renders the chart grid.
 * `subscribeWithSelector` additionally lets non-React code (the Part-2 socket
 * layer) observe state without pulling in React.
 *
 * `skipHydration: true` is mandatory for SSG/SSR: without it, localStorage is
 * read during the first client render and React throws a hydration mismatch.
 * `<StoreBridge />` calls `useAppStore.persist.rehydrate()` after mount.
 */
export const useAppStore = create<AppStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...INITIAL_STATE,

        /* ------------------------------ UI ------------------------------ */
        setTheme: (theme) => set({ theme }),

        cycleTheme: () => {
          const index = THEMES.indexOf(get().theme);
          const next = THEMES[(index + 1) % THEMES.length] ?? 'acid';
          set({ theme: next });
        },

        setLocale: (locale) => set({ locale }),

        toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

        setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

        dismissBanner: () => set({ bannerDismissed: true }),

        /* --------------------------- Chart layout ----------------------- */
        setLayout: (layout) => {
          if (!CHART_LAYOUTS[layout]) return;
          set((s) => ({ layout, panes: buildPanes(layout, s.panes) }));
        },

        setChartType: (chartType) => set({ chartType }),

        setTimeframe: (timeframe) => set({ timeframe }),

        setPaneToken: (paneId, tokenId) =>
          set((s) => ({
            panes: s.panes.map((pane) => (pane.id === paneId ? { ...pane, tokenId } : pane)),
          })),

        setPaneKind: (paneId, kind) =>
          set((s) => ({
            panes: s.panes.map((pane) =>
              pane.id === paneId ? { ...pane, kind: kind as PaneKind } : pane,
            ),
          })),

        resetPanes: () => set((s) => ({ panes: buildPanes(s.layout) })),

        /* ----------------------------- Market --------------------------- */
        setActiveToken: (token) => set({ activeToken: token }),

        selectTokenById: (id) => {
          const token = TOKEN_INDEX[id];
          if (token) set({ activeToken: token });
        },

        toggleWatchlist: (tokenId) =>
          set((s) => ({
            watchlist: s.watchlist.includes(tokenId)
              ? s.watchlist.filter((entry) => entry !== tokenId)
              : [...s.watchlist, tokenId],
          })),

        /* ------------------------------ Misc ---------------------------- */
        reset: () => set({ ...INITIAL_STATE, panes: buildPanes(INITIAL_STATE.layout) }),
      }),
      {
        name: STORAGE_KEY,
        version: 1,
        storage: appStorage,
        skipHydration: true,
        /**
         * Pre-v1 localStorage blobs (early deployments wrote unversioned
         * state) would otherwise be DISCARDED with a console error on the
         * next visit. The `merge` below re-validates every field anyway, so
         * handing the raw payload through is safe and preserves user
         * settings across the upgrade.
         */
        migrate: (state) => state as AppStore,
        /**
         * Transient state is deliberately excluded: a persisted open command
         * palette or dismissed banner would leak across sessions.
         * `locale` is excluded too – next-intl routing owns it.
         */
        partialize: (state) => ({
          theme: state.theme,
          sidebarCollapsed: state.sidebarCollapsed,
          layout: state.layout,
          chartType: state.chartType,
          timeframe: state.timeframe,
          panes: state.panes,
          activeToken: state.activeToken,
          watchlist: state.watchlist,
        }),
        /**
         * Corrupted or version-drifted localStorage must never blank the
         * terminal: every persisted field is re-validated on rehydrate and
         * falls back to the initial state otherwise.
         */
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Record<string, unknown>;
          const panes = Array.isArray(p.panes)
            ? (p.panes as unknown[]).filter(
                (pane): pane is Pane =>
                  typeof pane === 'object' &&
                  pane !== null &&
                  typeof (pane as Pane).id === 'string' &&
                  ((pane as Pane).tokenId === null || TOKEN_INDEX[(pane as Pane).tokenId as string] !== undefined),
              )
            : current.panes;
          return {
            ...current,
            theme: isThemeId(p.theme) ? p.theme : current.theme,
            sidebarCollapsed: typeof p.sidebarCollapsed === 'boolean' ? p.sidebarCollapsed : current.sidebarCollapsed,
            layout: isChartLayoutId(p.layout) ? p.layout : current.layout,
            chartType: isChartType(p.chartType) ? p.chartType : current.chartType,
            timeframe: isTimeframe(p.timeframe) ? p.timeframe : current.timeframe,
            panes: panes.length > 0 ? panes : current.panes,
            activeToken: TOKEN_INDEX[(p.activeToken as Token | undefined)?.id ?? '']
              ? (p.activeToken as Token)
              : current.activeToken,
            watchlist: Array.isArray(p.watchlist)
              ? (p.watchlist as unknown[]).filter((id): id is string => typeof id === 'string' && Boolean(TOKEN_INDEX[id]))
              : current.watchlist,
          };
        },
      },
    ),
  ),
);

/* -------------------------------------------------------------------------- */
/*  Selectors – import these, never select whole objects                      */
/* -------------------------------------------------------------------------- */

export const selectTheme = (s: AppStore) => s.theme;
export const selectLocale = (s: AppStore) => s.locale;
export const selectLayout = (s: AppStore) => s.layout;
export const selectPanes = (s: AppStore) => s.panes;
export const selectChartType = (s: AppStore) => s.chartType;
export const selectTimeframe = (s: AppStore) => s.timeframe;
export const selectActiveToken = (s: AppStore) => s.activeToken;
export const selectWatchlist = (s: AppStore) => s.watchlist;
export const selectSidebarCollapsed = (s: AppStore) => s.sidebarCollapsed;
export const selectCommandPaletteOpen = (s: AppStore) => s.commandPaletteOpen;
export const selectBannerDismissed = (s: AppStore) => s.bannerDismissed;

/* -------------------------------------------------------------------------- */
/*  Actions (stable references – safe to use in effect deps)                  */
/* -------------------------------------------------------------------------- */

export const appActions = {
  setTheme: (theme: ThemeId) => useAppStore.setState({ theme }),
  cycleTheme: () => useAppStore.getState().cycleTheme(),
  setLayout: (layout: ChartLayoutId) => useAppStore.getState().setLayout(layout),
  setChartType: (chartType: ChartType) => useAppStore.setState({ chartType }),
  setTimeframe: (timeframe: Timeframe) => useAppStore.setState({ timeframe }),
  setActiveToken: (token: AppStore['activeToken']) => useAppStore.setState({ activeToken: token }),
  selectTokenById: (id: string) => useAppStore.getState().selectTokenById(id),
  toggleWatchlist: (id: string) => useAppStore.getState().toggleWatchlist(id),
  setCommandPaletteOpen: (open: boolean) => useAppStore.setState({ commandPaletteOpen: open }),
  toggleSidebar: () => useAppStore.getState().toggleSidebar(),
  dismissBanner: () => useAppStore.getState().dismissBanner(),
  reset: () => useAppStore.getState().reset(),
};

export type { Token, ThemeId, ChartLayoutId, ChartType, Timeframe, PaneKind } from './types';
