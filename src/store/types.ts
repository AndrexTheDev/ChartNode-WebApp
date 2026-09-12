/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Shared domain types for the NodeChart app store.
 * Pure types + no React imports => safe to use in Server Components too.
 */

/** Skin applied to `<html data-theme="…">`. */
export type ThemeId = 'acid' | 'violet' | 'light' | 'matrix' | 'miami';

/** Multi-chart grid presets. `cols x rows`. */
export type ChartLayoutId = '1x1' | '2x1' | '2x2';

export type ChartType = (typeof import('./presets').CHART_TYPES)[number];

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

/** Where the price feed comes from. */
export type VenueKind = 'CEX' | 'DEX';

/**
 * A tradeable instrument. One shape for both worlds:
 *   CEX -> `exchange` + `symbol` (e.g. binance / BTCUSDT)
 *   DEX -> `chain` + `contract` (e.g. ethereum / 0x…)
 */
export interface Token {
  /** Stable internal id: `${venue}:${exchange|chain}:${symbol|contract}` */
  id: string;
  /** Human readable pair, e.g. `BTC/USDT`. */
  symbol: string;
  base: string;
  quote: string;
  venue: VenueKind;
  /** CEX only – normalised exchange id (`binance`, `bybit`, `kraken`, …). */
  exchange?: string;
  /** DEX only – chain id (`ethereum`, `base`, `solana`, …). */
  chain?: string;
  /** DEX only – token contract address. */
  contract?: string;
  /** Logo/emoji hint used by the UI; optional so feeds can stay lean. */
  icon?: string;
}

/** What a single grid cell renders. */
export type PaneKind = 'chart' | 'depth' | 'volume' | 'trades' | 'empty';

export interface Pane {
  id: string;
  kind: PaneKind;
  /** `null` => the pane follows `activeToken`. */
  tokenId: string | null;
}

export interface UiState {
  theme: ThemeId;
  /** Mirrors the active next-intl locale. Routing stays the source of truth. */
  locale: string;
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  bannerDismissed: boolean;
}

export interface ChartState {
  layout: ChartLayoutId;
  chartType: ChartType;
  timeframe: Timeframe;
  panes: Pane[];
}

export interface MarketState {
  activeToken: Token;
  watchlist: string[];
}

export interface AppActions {
  setTheme: (theme: ThemeId) => void;
  cycleTheme: () => void;
  setLocale: (locale: string) => void;
  toggleSidebar: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  dismissBanner: () => void;

  setLayout: (layout: ChartLayoutId) => void;
  setChartType: (type: ChartType) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setPaneToken: (paneId: string, tokenId: string | null) => void;
  setPaneKind: (paneId: string, kind: PaneKind) => void;
  resetPanes: () => void;

  setActiveToken: (token: Token) => void;
  selectTokenById: (id: string) => void;
  toggleWatchlist: (tokenId: string) => void;

  reset: () => void;
}

export type AppStore = UiState & ChartState & MarketState & AppActions;
