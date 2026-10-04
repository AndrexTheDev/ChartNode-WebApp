// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import {
  fetchBreadth,
  fetchDerivHistory,
  fetchDerivSignals,
  fetchFlowSignals,
  fetchGlobalSignals,
  fetchHeatmap,
  fetchVolSignals,
  type Breadth,
  type DerivHistory,
  type DerivSignals,
  type FlowSignals,
  type GlobalSignals,
  type HeatTile,
  type VolSignals,
} from '@/api/prometrics';
import { tradeBus } from '@/websockets/manager';

/**
 * PRO metrics state (memory-only). Mirrors `useOnChainStore`:
 * the panel's 15 s heartbeat calls `tick(base)`; each group only refetches
 * when its deadline passed and nothing is in flight. Closed panel = no requests.
 *
 * CVD (cumulative volume delta) is different: it accumulates from the live
 * trade bus (the same trades that feed the whale tracker) for the active
 * symbol, so it needs no polling at all – it *is* the tape.
 */

export type ProGroup = 'deriv' | 'flow' | 'global' | 'heat' | 'vol' | 'hist' | 'breadth';

export type ProGroupStatus = 'idle' | 'loading' | 'ok' | 'error';

export const PRO_REFRESH_MS: Record<ProGroup, number> = {
  deriv: 60_000,
  flow: 15_000,
  global: 300_000,
  heat: 300_000,
  vol: 600_000,
  hist: 60_000,
  breadth: 300_000,
};

const PRO_GROUPS: ProGroup[] = ['deriv', 'flow', 'global', 'heat', 'vol', 'hist', 'breadth'];

export interface CvdState {
  /** Session cumulative signed notional (buys − sells), USD. */
  cvdUsd: number;
  /** Signed notional of the last 60 s. */
  delta60sUsd: number;
  trades: number;
  updatedAt: number;
}

interface ProState {
  open: boolean;
  deriv: DerivSignals | null;
  flow: FlowSignals | null;
  global: GlobalSignals | null;
  heat: HeatTile[];
  vol: VolSignals | null;
  /** Derivatives history for the sparklines (5-min stats + 8 h funding). */
  hist: DerivHistory | null;
  /** Advance/decline breadth across all quoted USDT pairs. */
  breadth: Breadth | null;
  status: Record<ProGroup, ProGroupStatus>;
  updatedAt: Record<ProGroup, number>;
  /** Instrument identity attached to the last usable instrument-scoped value. */
  baseContext: { deriv: string | null; flow: string | null; hist: string | null };
  /** Per-symbol CVD accumulators (symbol like `BTC/USDT`). */
  cvd: Record<string, CvdState>;
}

interface ProActions {
  setOpen: (open: boolean) => void;
  toggle: () => void;
  refresh: (group: ProGroup, base: string, force?: boolean) => Promise<void>;
  tick: (base: string) => void;
}

export type ProStore = ProState & ProActions;

const zeroStamps = (): Record<ProGroup, number> =>
  Object.fromEntries(PRO_GROUPS.map((group) => [group, 0])) as Record<ProGroup, number>;
const idleStatus = (): Record<ProGroup, ProGroupStatus> =>
  Object.fromEntries(PRO_GROUPS.map((group) => [group, 'idle'])) as Record<ProGroup, ProGroupStatus>;

const inFlight = new Map<string, AbortController>();
const perBaseUpdatedAt = new Map<string, number>();
const lastRequestedBaseByGroup = new Map<string, string>();
const PRO_ERROR_RETRY_MS = 30_000;

function abortProRequests(): void {
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
}

/** Rolling 60 s window of signed notional per symbol. */
const recentDeltas = new Map<string, { ts: number; usd: number }[]>();

export const useProStore = create<ProStore>()((set, get) => ({
  open: false,
  deriv: null,
  flow: null,
  global: null,
  heat: [],
  vol: null,
  hist: null,
  breadth: null,
  status: idleStatus(),
  updatedAt: zeroStamps(),
  baseContext: { deriv: null, flow: null, hist: null },
  cvd: {},

  setOpen: (open) => {
    if (!open) abortProRequests();
    set({ open });
  },
  toggle: () => {
    const open = !get().open;
    if (!open) abortProRequests();
    set({ open });
  },

  refresh: async (group, base, force) => {
    const state = get();
    if (!state.open && !force) return;
    const baseScoped = group === 'deriv' || group === 'flow' || group === 'hist';
    const normalizedBase = base.toUpperCase();
    const flightKey = baseScoped ? `${group}:${normalizedBase}` : group;
    const elapsed = Date.now() - (baseScoped ? (perBaseUpdatedAt.get(flightKey) ?? 0) : state.updatedAt[group]);
    const refreshInterval = state.status[group] === 'error'
      ? Math.min(PRO_REFRESH_MS[group], PRO_ERROR_RETRY_MS)
      : PRO_REFRESH_MS[group];
    const baseChanged = baseScoped && lastRequestedBaseByGroup.get(group) !== normalizedBase;
    if (!(force ?? false) && !baseChanged && elapsed < refreshInterval) return;
    if (baseScoped) {
      // Do not let a slow response for the previous symbol overwrite the new
      // active instrument's panel; cancel its request when the symbol changes.
      for (const [key, active] of inFlight) {
        if (key.startsWith(`${group}:`) && key !== flightKey) {
          active.abort();
          inFlight.delete(key);
        }
      }
    }
    if (inFlight.has(flightKey)) return;
    const controller = new AbortController();
    inFlight.set(flightKey, controller);
    set((prev) => ({
      status: { ...prev.status, [group]: baseChanged || prev.updatedAt[group] === 0 ? 'loading' : prev.status[group] },
    }));
    try {
      switch (group) {
        case 'deriv': {
          const deriv = await fetchDerivSignals(base, controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            deriv: deriv ?? prev.deriv,
            baseContext: deriv ? { ...prev.baseContext, deriv: normalizedBase } : prev.baseContext,
            status: { ...prev.status, deriv: deriv ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, deriv: Date.now() },
          }));
          break;
        }
        case 'flow': {
          const flow = await fetchFlowSignals(base, controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            flow: flow ?? prev.flow,
            baseContext: flow ? { ...prev.baseContext, flow: normalizedBase } : prev.baseContext,
            status: { ...prev.status, flow: flow ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, flow: Date.now() },
          }));
          break;
        }
        case 'global': {
          const global = await fetchGlobalSignals(controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            global: global ?? prev.global,
            status: { ...prev.status, global: global ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, global: Date.now() },
          }));
          break;
        }
        case 'heat': {
          const heat = await fetchHeatmap(controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            heat: heat.length > 0 ? heat : prev.heat,
            status: { ...prev.status, heat: heat.length > 0 ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, heat: Date.now() },
          }));
          break;
        }
        case 'vol': {
          const vol = await fetchVolSignals(controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            vol: vol ?? prev.vol,
            status: { ...prev.status, vol: vol ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, vol: Date.now() },
          }));
          break;
        }
        case 'hist': {
          const hist = await fetchDerivHistory(base, controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            hist: hist ?? prev.hist,
            baseContext: hist ? { ...prev.baseContext, hist: normalizedBase } : prev.baseContext,
            status: { ...prev.status, hist: hist ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, hist: Date.now() },
          }));
          break;
        }
        case 'breadth': {
          const breadth = await fetchBreadth(controller.signal);
          if (controller.signal.aborted) break;
          set((prev) => ({
            breadth: breadth ?? prev.breadth,
            status: { ...prev.status, breadth: breadth ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, breadth: Date.now() },
          }));
          break;
        }
      }
      if (!controller.signal.aborted && baseScoped) {
        perBaseUpdatedAt.set(flightKey, Date.now());
        lastRequestedBaseByGroup.set(group, normalizedBase);
      }
    } catch {
      if (!controller.signal.aborted) {
        const failedAt = Date.now();
        if (baseScoped) {
          perBaseUpdatedAt.set(flightKey, failedAt);
          lastRequestedBaseByGroup.set(group, normalizedBase);
        }
        set((prev) => ({
          status: { ...prev.status, [group]: 'error' },
          updatedAt: { ...prev.updatedAt, [group]: failedAt },
        }));
      }
    } finally {
      if (inFlight.get(flightKey) === controller) inFlight.delete(flightKey);
    }
  },

  tick: (base) => {
    for (const group of PRO_GROUPS) void get().refresh(group, base);
  },
}));

export const selectProOpen = (s: ProStore) => s.open;

/* ------------------------- CVD from the live tape --------------------------- */

/**
 * Trades arrive at tape speed – accumulating straight into the store would
 * re-render the panel dozens of times per second. Instead the bus feeds two
 * module-local maps and a 600 ms flusher mirrors them into the store.
 */
const sessionCvd = new Map<string, { cvdUsd: number; trades: number }>();
/** Harte Obergrenze – der Trade-Bus läuft app-weit und kennt kein Unmount. */
const MAX_CVD_SYMBOLS = 64;


/**
 * CVD tick – adaptive lifecycle instead of an always-on 600 ms interval:
 *
 *   1. The timer starts lazily on the FIRST trade, so an idle page (no socket
 *      traffic, PRO panel closed) never wakes up on a timer at all.
 *   2. It stops itself once every rolling 60 s window has drained and no
 *      trade arrived for 65 s – session counters stay in `sessionCvd`, the
 *      next trade simply restarts the loop.
 *   3. `computeCvd` keeps the PREVIOUS object reference per symbol when the
 *      values did not change, and skips `setState` entirely when nothing
 *      changed. Zustand v5 compares selector output, so subscribers like
 *      `useProStore((s) => s.cvd[sym])` no longer re-render on unchanged
 *      ticks – referential stability instead of a 600 ms render pulse.
 */
let cvdTimer: ReturnType<typeof setInterval> | null = null;
let lastTradeAt = 0;

function computeCvd(): { next: Record<string, CvdState>; changed: boolean } {
  const prev = useProStore.getState().cvd;
  const now = Date.now();
  const next: Record<string, CvdState> = {};
  let changed = false;
  for (const [symbol, acc] of sessionCvd) {
    const ring = recentDeltas.get(symbol) ?? [];
    while (ring.length > 0 && now - (ring[0]?.ts ?? now) > 60_000) ring.shift();
    const delta60sUsd = ring.reduce((sum, entry) => sum + entry.usd, 0);
    const old = prev[symbol];
    if (old && old.cvdUsd === acc.cvdUsd && old.trades === acc.trades && old.delta60sUsd === delta60sUsd) {
      next[symbol] = old; // identical values -> identical reference -> no re-render
    } else {
      next[symbol] = { cvdUsd: acc.cvdUsd, delta60sUsd, trades: acc.trades, updatedAt: now };
      changed = true;
    }
  }
  if (!changed && Object.keys(next).length !== Object.keys(prev).length) changed = true;
  return { next, changed };
}

function stopCvdTimer(): void {
  if (cvdTimer != null) {
    clearInterval(cvdTimer);
    cvdTimer = null;
  }
}

function tickCvd(): void {
  const { next, changed } = computeCvd();
  if (changed) useProStore.setState({ cvd: next });
  const drained = [...recentDeltas.values()].every((ring) => ring.length === 0);
  if (drained && Date.now() - lastTradeAt > 65_000) {
    recentDeltas.clear(); // leere Rings nicht als Map-Einträge horten
    stopCvdTimer();
  }
}

tradeBus.add((trade) => {
  const signed = (trade.side === 'buy' ? 1 : -1) * trade.price * trade.qty;
  const now = Date.now();
  const ring = recentDeltas.get(trade.symbol) ?? [];
  ring.push({ ts: now, usd: signed });
  while (ring.length > 0 && now - (ring[0]?.ts ?? now) > 60_000) ring.shift();
  recentDeltas.set(trade.symbol, ring);

  const acc = sessionCvd.get(trade.symbol) ?? { cvdUsd: 0, trades: 0 };
  sessionCvd.set(trade.symbol, { cvdUsd: acc.cvdUsd + signed, trades: acc.trades + 1 });
  // Bounded: lange Sessions handeln viele Symbole – älteste Einträge
  // (Insertionsreihenfolge) fliegen raus, der Bus bleibt speicherstabil.
  if (sessionCvd.size > MAX_CVD_SYMBOLS) {
    const oldest = sessionCvd.keys().next();
    if (!oldest.done && oldest.value !== trade.symbol) {
      sessionCvd.delete(oldest.value);
      recentDeltas.delete(oldest.value);
    }
  }

  lastTradeAt = now;
  if (typeof globalThis.window !== 'undefined' && cvdTimer == null) {
    cvdTimer = setInterval(tickCvd, 600);
  }
});
