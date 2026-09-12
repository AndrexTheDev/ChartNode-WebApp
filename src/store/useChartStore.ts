// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage } from './storage';
import {
  INDICATOR_KINDS,
  INDICATOR_LIBRARY,
  SERIES_COLORS,
  clampParams,
  defaultParams,
  type IndicatorKind,
} from '@/lib/indicators';
import { isTimeframe } from './presets';
import type { Timeframe } from './types';

/** One indicator instance – as many as you like per pane. */
export interface IndicatorInstance {
  id: string;
  kind: IndicatorKind;
  params: Record<string, number>;
  visible: boolean;
  /** Wave-5 Script Lab: source of a CUSTOM indicator instance. */
  script?: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  /** `above` = fire when last price >= alert price; `below` = <=. */
  dir: 'above' | 'below';
  fired: boolean;
  createdAt: number;
  /** Wave-4: `price` = level cross, `pct` = ±% move against `base`. */
  kind?: 'price' | 'pct';
  /** Reference price captured at creation (for `pct` alerts). */
  base?: number;
  pct?: number;
  /** Optional second level condition (AND) — multi-condition alerts. */
  cond2?: { dir: 'above' | 'below'; price: number };
  note?: string;
  firedAt?: number;
}

export interface DrawingPoint {
  /** Unix seconds (lightweight-charts `Time`), so drawings survive re-seeds. */
  time: number;
  price: number;
}

export type DrawingToolKind = 'trendline' | 'ray' | 'horizontal' | 'fib' | 'zone';

/** What the cursor currently does on a chart. */
export type ActiveTool = 'none' | DrawingToolKind | 'eraser';

export interface Drawing {
  id: string;
  tool: DrawingToolKind;
  points: [DrawingPoint, DrawingPoint];
  color: string;
  createdAt: number;
}

export const DRAWING_TOOLS: DrawingToolKind[] = ['trendline', 'ray', 'horizontal', 'fib', 'zone'];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

interface ChartUiState {
  /** paneId → indicator instances (unbounded). */
  indicators: Record<string, IndicatorInstance[]>;
  /** paneId → drawings. */
  drawings: Record<string, Drawing[]>;
  /** paneId → timeframe override; `null` = follow the global timeframe. */
  paneTimeframe: Record<string, Timeframe | null>;
  /** paneId → selected drawing id. */
  selected: Record<string, string | null>;

  syncTimeframe: boolean;
  syncCrosshair: boolean;
  syncZoom: boolean;

  tool: ActiveTool;
  volume: boolean;
  /** Volume Profile Visible Range overlay (premium analytics, computed locally). */
  vpOn: boolean;
  /** When armed, the next chart click drops an Anchored-VWAP anchor. */
  avwapArm: boolean;
  /** paneId → anchor candle time (unix s); null = no anchor. */
  avwapAnchor: Record<string, number | null>;
  /** Auto support/resistance price lines (clustered pivots, computed locally). */
  srOn: boolean;
  /** RSI divergence markers on the price chart. */
  divOn: boolean;
  /** Compare overlay: token id whose normalized % line is drawn over the chart. */
  compare: string | null;
  /** When armed, the next chart click creates a price alert at that level. */
  alertArm: boolean;
  /**
   * Price alerts — persisted, never expiring (TradingView sells non-expiring
   * alerts at Premium, multi-condition at Plus). Unlimited here.
   */
  alerts: PriceAlert[];
  /** Wave-4 auto chart-pattern markers on the price chart. */
  patternsOn: boolean;
  /** Custom interval in minutes (null = use the timeframe chips). */
  customAgg: number | null;
  /** Wave-5 Script Lab modal (session UI state). */
  scriptLabOpen: boolean;
  /** Wave-7 Liq Radar liquidation-magnet bands on the price pane. */
  liqMagnetsOn: boolean;
  /** Wave-7 Edge Suite modals (session UI state). */
  edgeLiqOpen: boolean;
  edgeLagOpen: boolean;
  edgeRegimeOpen: boolean;
  edgeClockOpen: boolean;
  /** Wave-7 Lag Oracle leader instrument (session). */
  lagLeaderId: string | null;
  /** Logarithmic price scale. */
  axisLog: boolean;
  /** Percent price scale (relative to the first visible bar). */
  axisPct: boolean;
  /** Bar replay (session-only): candles hidden from the right edge. */
  replayOn: boolean;
  replayHidden: number;
  replayPlaying: boolean;
  replaySpeed: number;
  /** paneId → backtest entry/exit markers drawn on the price chart. */
  btMarkers: Record<string, { time: number; side: 'buy' | 'sell' }[]>;
  /** Touch devices hide the drawing tools until the user forces them on. */
  drawingToolsForced: boolean;
  mobileWarningDismissed: boolean;
}

interface ChartUiActions {
  addIndicator: (paneId: string, kind: IndicatorKind, params?: Record<string, number>, script?: string) => string;
  updateIndicator: (
    paneId: string,
    id: string,
    patch: Partial<Pick<IndicatorInstance, 'params' | 'visible' | 'script'>>,
  ) => void;
  removeIndicator: (paneId: string, id: string) => void;
  clearIndicators: (paneId: string) => void;

  addDrawing: (paneId: string, drawing: Omit<Drawing, 'id' | 'createdAt'>) => string;
  updateDrawing: (paneId: string, id: string, points: [DrawingPoint, DrawingPoint]) => void;
  removeDrawing: (paneId: string, id: string) => void;
  clearDrawings: (paneId: string) => void;
  setSelected: (paneId: string, id: string | null) => void;

  setPaneTimeframe: (paneId: string, timeframe: Timeframe | null) => void;
  setSyncTimeframe: (on: boolean) => void;
  setSyncCrosshair: (on: boolean) => void;
  setSyncZoom: (on: boolean) => void;

  setTool: (tool: ActiveTool) => void;
  toggleVolume: () => void;
  toggleVp: () => void;
  setAvwapArm: (arm: boolean) => void;
  setAvwapAnchor: (paneId: string, time: number | null) => void;
  toggleSr: () => void;
  toggleDiv: () => void;
  toggleAxisLog: () => void;
  toggleAxisPct: () => void;
  startReplay: () => void;
  stopReplay: () => void;
  stepReplay: (delta: number) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: number) => void;
  setBtMarkers: (paneId: string, markers: { time: number; side: 'buy' | 'sell' }[]) => void;
  setCompare: (tokenId: string | null) => void;
  setAlertArm: (arm: boolean) => void;
  addAlertFull: (alert: Omit<PriceAlert, 'id' | 'fired' | 'createdAt'>) => void;
  togglePatterns: () => void;
  setCustomAgg: (minutes: number | null) => void;
  setScriptLabOpen: (open: boolean) => void;
  toggleLiqMagnets: () => void;
  setEdgeLiqOpen: (open: boolean) => void;
  setEdgeLagOpen: (open: boolean) => void;
  setEdgeRegimeOpen: (open: boolean) => void;
  setEdgeClockOpen: (open: boolean) => void;
  setLagLeader: (id: string | null) => void;
  addAlert: (symbol: string, price: number, lastPrice: number) => void;
  removeAlert: (id: string) => void;
  fireAlert: (id: string) => void;
  setDrawingToolsForced: (on: boolean) => void;
  dismissMobileWarning: () => void;
  reset: () => void;
}

export type ChartStore = ChartUiState & ChartUiActions;

let counter = 0;
/** Small, collision-free id (single tab owns the chart state). */
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

const INITIAL: ChartUiState = {
  indicators: {},
  drawings: {},
  paneTimeframe: {},
  selected: {},

  syncTimeframe: true,
  syncCrosshair: true,
  syncZoom: true,

  tool: 'none',
  volume: true,
  vpOn: false,
  avwapArm: false,
  avwapAnchor: {},
  srOn: false,
  divOn: false,
  compare: null,
  alertArm: false,
  alerts: [],
  patternsOn: false,
  customAgg: null,
  scriptLabOpen: false,
  liqMagnetsOn: false,
  edgeLiqOpen: false,
  edgeLagOpen: false,
  edgeRegimeOpen: false,
  edgeClockOpen: false,
  lagLeaderId: null,
  axisLog: false,
  axisPct: false,
  replayOn: false,
  replayHidden: 80,
  replayPlaying: false,
  replaySpeed: 2,
  btMarkers: {},
  drawingToolsForced: false,
  mobileWarningDismissed: false,
};

/**
 * Chart workspace state – indicators, drawings and grid sync.
 *
 * Persisted (localStorage) so a reload keeps your RSI(21) and your trendlines;
 * keyed by pane id so a 2x2 grid keeps four independent charts that still share
 * the sync flags.
 */
export const useChartStore = create<ChartStore>()(
  persist(
    (set) => ({
      ...INITIAL,

      addIndicator: (paneId, kind, params, script) => {
        const id = nextId(kind.toLowerCase());
        const def = INDICATOR_LIBRARY[kind];
        set((state) => {
          const list = state.indicators[paneId] ?? [];
          // Same kind twice → cycle the neon color so both stay readable.
          const instance: IndicatorInstance = {
            id,
            kind,
            params: clampParams(def, { ...defaultParams(def), ...params }),
            visible: true,
            ...(typeof script === 'string' && script.length <= 4000 ? { script } : {}),
          };
          return { indicators: { ...state.indicators, [paneId]: [...list, instance] } };
        });
        return id;
      },

      updateIndicator: (paneId, id, patch) =>
        set((state) => {
          const list = state.indicators[paneId];
          if (!list) return state;
          return {
            indicators: {
              ...state.indicators,
              [paneId]: list.map((entry) => {
                if (entry.id !== id) return entry;
                const params = patch.params
                  ? clampParams(INDICATOR_LIBRARY[entry.kind], { ...entry.params, ...patch.params })
                  : entry.params;
                return {
                  ...entry,
                  params,
                  visible: patch.visible ?? entry.visible,
                  ...(patch.script !== undefined
                    ? {
                        script:
                          typeof patch.script === 'string' && patch.script.length <= 4000
                            ? patch.script
                            : undefined,
                      }
                    : {}),
                };
              }),
            },
          };
        }),

      removeIndicator: (paneId, id) =>
        set((state) => {
          const list = state.indicators[paneId];
          if (!list) return state;
          return { indicators: { ...state.indicators, [paneId]: list.filter((entry) => entry.id !== id) } };
        }),

      clearIndicators: (paneId) =>
        set((state) => ({ indicators: { ...state.indicators, [paneId]: [] } })),

      addDrawing: (paneId, drawing) => {
        const id = nextId(drawing.tool);
        set((state) => {
          const list = state.drawings[paneId] ?? [];
          const color = drawing.color || (SERIES_COLORS[list.length % SERIES_COLORS.length] ?? SERIES_COLORS[0]!);
          return {
            drawings: { ...state.drawings, [paneId]: [...list, { ...drawing, color, id, createdAt: Date.now() }] },
            selected: { ...state.selected, [paneId]: id },
          };
        });
        return id;
      },

      updateDrawing: (paneId, id, points) =>
        set((state) => {
          const list = state.drawings[paneId];
          if (!list) return state;
          return {
            drawings: {
              ...state.drawings,
              [paneId]: list.map((entry) => (entry.id === id ? { ...entry, points } : entry)),
            },
          };
        }),

      removeDrawing: (paneId, id) =>
        set((state) => {
          const list = state.drawings[paneId];
          if (!list) return state;
          return {
            drawings: { ...state.drawings, [paneId]: list.filter((entry) => entry.id !== id) },
            selected: {
              ...state.selected,
              [paneId]: state.selected[paneId] === id ? null : (state.selected[paneId] ?? null),
            },
          };
        }),

      clearDrawings: (paneId) =>
        set((state) => ({
          drawings: { ...state.drawings, [paneId]: [] },
          selected: { ...state.selected, [paneId]: null },
        })),

      setSelected: (paneId, id) => set((state) => ({ selected: { ...state.selected, [paneId]: id } })),

      setPaneTimeframe: (paneId, timeframe) =>
        set((state) => ({ paneTimeframe: { ...state.paneTimeframe, [paneId]: timeframe } })),

      setSyncTimeframe: (syncTimeframe) => set({ syncTimeframe }),
      setSyncCrosshair: (syncCrosshair) => set({ syncCrosshair }),
      setSyncZoom: (syncZoom) => set({ syncZoom }),

      setTool: (tool) => set({ tool }),
      toggleVolume: () => set((state) => ({ volume: !state.volume })),
      toggleVp: () => set((state) => ({ vpOn: !state.vpOn })),
      setAvwapArm: (avwapArm) => set({ avwapArm }),
      setAvwapAnchor: (paneId, time) =>
        set((state) => ({ avwapAnchor: { ...state.avwapAnchor, [paneId]: time } })),
      toggleSr: () => set((state) => ({ srOn: !state.srOn })),
      toggleDiv: () => set((state) => ({ divOn: !state.divOn })),
      toggleAxisLog: () => set((state) => ({ axisLog: !state.axisLog })),
      toggleAxisPct: () => set((state) => ({ axisPct: !state.axisPct })),
      startReplay: () =>
        set({ replayOn: true, replayHidden: 80, replayPlaying: false }),
      stopReplay: () => set({ replayOn: false, replayPlaying: false, replayHidden: 80 }),
      stepReplay: (delta) =>
        set((state) => ({ replayHidden: Math.max(0, state.replayHidden + delta) })),
      setReplayPlaying: (replayPlaying) => set({ replayPlaying }),
      setReplaySpeed: (replaySpeed) => set({ replaySpeed }),
      setBtMarkers: (paneId, markers) =>
        set((state) => ({ btMarkers: { ...state.btMarkers, [paneId]: markers } })),
      setCompare: (compare) => set({ compare }),
      setAlertArm: (alertArm) => set({ alertArm }),
      addAlert: (symbol, price, lastPrice) => {
        const alert: PriceAlert = {
          id: nextId('alert'),
          symbol,
          price,
          dir: price >= lastPrice ? 'above' : 'below',
          fired: false,
          createdAt: Date.now(),
          kind: 'price',
        };
        set((state) => ({ alerts: [...state.alerts, alert], alertArm: false }));
      },
      addAlertFull: (alert) =>
        set((state) => ({
          alerts: [
            ...state.alerts,
            { ...alert, kind: alert.kind ?? 'price', id: nextId('alert'), fired: false, createdAt: Date.now() },
          ],
        })),
      togglePatterns: () => set((state) => ({ patternsOn: !state.patternsOn })),
      setCustomAgg: (customAgg) => set({ customAgg }),
      setScriptLabOpen: (scriptLabOpen) => set({ scriptLabOpen }),
      toggleLiqMagnets: () => set((state) => ({ liqMagnetsOn: !state.liqMagnetsOn })),
      setEdgeLiqOpen: (edgeLiqOpen) => set({ edgeLiqOpen }),
      setEdgeLagOpen: (edgeLagOpen) => set({ edgeLagOpen }),
      setEdgeRegimeOpen: (edgeRegimeOpen) => set({ edgeRegimeOpen }),
      setEdgeClockOpen: (edgeClockOpen) => set({ edgeClockOpen }),
      setLagLeader: (lagLeaderId) => set({ lagLeaderId }),
      removeAlert: (id) => set((state) => ({ alerts: state.alerts.filter((entry) => entry.id !== id) })),
      fireAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.map((entry) =>
            entry.id === id ? { ...entry, fired: true, firedAt: Date.now() } : entry,
          ),
        })),
      setDrawingToolsForced: (drawingToolsForced) => set({ drawingToolsForced }),
      dismissMobileWarning: () => set({ mobileWarningDismissed: true }),

      reset: () => set({ ...INITIAL }),
    }),
    {
      name: 'nc-chart-v1',
      storage: appStorage,
      partialize: (state) => ({
        indicators: state.indicators,
        drawings: state.drawings,
        paneTimeframe: state.paneTimeframe,
        syncTimeframe: state.syncTimeframe,
        syncCrosshair: state.syncCrosshair,
        syncZoom: state.syncZoom,
        volume: state.volume,
        vpOn: state.vpOn,
        liqMagnetsOn: state.liqMagnetsOn,
        srOn: state.srOn,
        divOn: state.divOn,
        compare: state.compare,
        alerts: state.alerts,
        axisLog: state.axisLog,
        axisPct: state.axisPct,
        drawingToolsForced: state.drawingToolsForced,
        mobileWarningDismissed: state.mobileWarningDismissed,
      }),
      /** Corrupted storage must not crash the chart engine on rehydrate. */
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const bool = (value: unknown, fallback: boolean): boolean =>
          typeof value === 'boolean' ? value : fallback;

        const rawIndicators = (p.indicators ?? {}) as Record<string, unknown>;
        const indicators: ChartStore['indicators'] = {};
        for (const [paneId, list] of Object.entries(rawIndicators)) {
          if (!Array.isArray(list)) continue;
          const clean = list.filter(
            (entry): entry is IndicatorInstance =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as IndicatorInstance).id === 'string' &&
              INDICATOR_KINDS.includes((entry as IndicatorInstance).kind) &&
              typeof (entry as IndicatorInstance).params === 'object' &&
              (entry as IndicatorInstance).params !== null &&
              Object.values((entry as IndicatorInstance).params).every((v) => typeof v === 'number' && Number.isFinite(v)),
          );
          const sane = clean.map((entry) =>
            typeof entry.script === 'string' && entry.script.length <= 4000
              ? entry
              : { ...entry, script: undefined },
          );
          if (sane.length > 0) indicators[paneId] = sane;
        }

        const rawDrawings = (p.drawings ?? {}) as Record<string, unknown>;
        const drawings: ChartStore['drawings'] = {};
        for (const [paneId, list] of Object.entries(rawDrawings)) {
          if (!Array.isArray(list)) continue;
          const clean = list.filter((entry) => {
            const d = entry as Drawing;
            return (
              typeof d === 'object' &&
              d !== null &&
              DRAWING_TOOLS.includes(d.tool) &&
              typeof d.color === 'string' &&
              Number.isFinite(d.createdAt) &&
              Array.isArray(d.points) &&
              d.points.length === 2 &&
              d.points.every(
                (pt) => typeof pt === 'object' && pt !== null && Number.isFinite(pt.time) && Number.isFinite(pt.price),
              )
            );
          });
          if (clean.length > 0) drawings[paneId] = clean as Drawing[];
        }

        const rawPaneTf = (p.paneTimeframe ?? {}) as Record<string, unknown>;
        const paneTimeframe: ChartStore['paneTimeframe'] = {};
        for (const [paneId, tf] of Object.entries(rawPaneTf)) {
          if (isTimeframe(tf)) {
            paneTimeframe[paneId] = tf;
          }
        }

        return {
          ...current,
          indicators,
          drawings,
          paneTimeframe,
          syncTimeframe: bool(p.syncTimeframe, current.syncTimeframe),
          syncCrosshair: bool(p.syncCrosshair, current.syncCrosshair),
          syncZoom: bool(p.syncZoom, current.syncZoom),
          volume: bool(p.volume, current.volume),
          vpOn: bool(p.vpOn, current.vpOn),
          liqMagnetsOn: bool(p.liqMagnetsOn, current.liqMagnetsOn),
          srOn: bool(p.srOn, current.srOn),
          divOn: bool(p.divOn, current.divOn),
          axisLog: bool(p.axisLog, current.axisLog),
          axisPct: bool(p.axisPct, current.axisPct),
          compare: typeof p.compare === 'string' ? p.compare : null,
          alerts: Array.isArray(p.alerts)
            ? (p.alerts as PriceAlert[]).filter(
                (a) =>
                  a &&
                  typeof a.id === 'string' &&
                  typeof a.symbol === 'string' &&
                  Number.isFinite(a.price) &&
                  (a.dir === 'above' || a.dir === 'below'),
              )
            : [],
          drawingToolsForced: bool(p.drawingToolsForced, current.drawingToolsForced),
          mobileWarningDismissed: bool(p.mobileWarningDismissed, current.mobileWarningDismissed),
        };
      },
    },
  ),
);

/* -------------------------------- selectors -------------------------------- */

const NO_INDICATORS: IndicatorInstance[] = [];
const NO_DRAWINGS: Drawing[] = [];

/** Stable empty arrays keep `useSyncExternalStore` from re-rendering forever. */
export const selectIndicators = (paneId: string) => (s: ChartStore) => s.indicators[paneId] ?? NO_INDICATORS;
export const selectDrawings = (paneId: string) => (s: ChartStore) => s.drawings[paneId] ?? NO_DRAWINGS;

export const selectTool = (s: ChartStore) => s.tool;
export const selectSyncTimeframe = (s: ChartStore) => s.syncTimeframe;
export const selectSyncCrosshair = (s: ChartStore) => s.syncCrosshair;
export const selectSyncZoom = (s: ChartStore) => s.syncZoom;
export const selectVpOn = (s: ChartStore) => s.vpOn;
export const selectLiqMagnetsOn = (s: ChartStore) => s.liqMagnetsOn;
export const selectAvwapArm = (s: ChartStore) => s.avwapArm;
export const selectSrOn = (s: ChartStore) => s.srOn;
export const selectDivOn = (s: ChartStore) => s.divOn;
export const selectCompare = (s: ChartStore) => s.compare;
export const selectAlertArm = (s: ChartStore) => s.alertArm;
export const selectAlerts = (s: ChartStore) => s.alerts;
export const selectAxisLog = (s: ChartStore) => s.axisLog;
export const selectAxisPct = (s: ChartStore) => s.axisPct;
export const selectReplayOn = (s: ChartStore) => s.replayOn;
export const selectBtMarkers = (paneId: string) => (s: ChartStore) => s.btMarkers[paneId] ?? null;
export const selectAvwapAnchor = (paneId: string) => (s: ChartStore) => s.avwapAnchor[paneId] ?? null;
export const selectVolume = (s: ChartStore) => s.volume;
export const selectDrawingToolsForced = (s: ChartStore) => s.drawingToolsForced;

/**
 * Effective timeframe of a pane.
 *
 * With `syncTimeframe` on (default) every pane follows the global toolbar
 * timeframe – that is the "synchronise timeframes across the grid" behaviour.
 * With it off, a pane keeps its own override so you can compare 1m vs 4h.
 */
export function effectiveTimeframe(
  state: ChartStore,
  paneId: string,
  global: Timeframe,
): Timeframe {
  if (state.syncTimeframe) return global;
  return state.paneTimeframe[paneId] ?? global;
}
