// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import {
  fetchBtcSignals,
  fetchDefiSignals,
  fetchDexHeat,
  fetchEvmSignals,
  fetchSolanaSignals,
  fetchTokenForensics,
  type BtcSignals,
  type DefiSignals,
  type DexHeat,
  type EvmChainSignals,
  type SolanaSignals,
  type TokenForensics,
} from '@/api/onchain';

/**
 * Live on-chain signal state (memory-only – these are ephemeral readings,
 * nothing worth persisting into localStorage).
 *
 * Refresh orchestration lives in `tick()`: the panel calls it on mount and on
 * an interval; each signal group is only re-fetched when its own deadline has
 * passed and no fetch for that group is in flight. Closing the panel stops the
 * interval, so a hidden panel costs zero requests.
 */

export type SignalGroup = 'btc' | 'evm' | 'solana' | 'defi' | 'dex' | 'forensics';

export type GroupStatus = 'idle' | 'loading' | 'ok' | 'error';

/**
 * A group whose last fetch errored retries after this much shorter interval –
 * a transient provider hiccup (GoPlus 429, slow RPC) must not park the signal
 * for the full TTL. Manual refresh (`force`) still bypasses everything.
 */
export const ERROR_RETRY_MS = 30_000;

/** Per-group refresh deadlines – tuned to each provider's public rate limit. */
export const REFRESH_MS: Record<SignalGroup, number> = {
  btc: 60_000,
  evm: 60_000,
  solana: 45_000,
  defi: 300_000,
  dex: 120_000,
  forensics: 600_000,
};

interface OnChainState {
  /** Panel visibility (controls whether anything is fetched at all). */
  open: boolean;
  btc: BtcSignals | null;
  evm: Record<string, EvmChainSignals>;
  solana: SolanaSignals | null;
  defi: DefiSignals | null;
  dex: DexHeat | null;
  forensics: TokenForensics | null;
  /** `${chain}:${contract}` the current forensics belong to. */
  forensicsKey: string | null;
  status: Record<SignalGroup, GroupStatus>;
  updatedAt: Record<SignalGroup, number>;
}

interface OnChainActions {
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Refresh one group when its deadline passed (or immediately with `force`). */
  refresh: (group: SignalGroup, opts?: { force?: boolean; token?: { chain?: string; contract?: string } }) => Promise<void>;
  /** Refresh every due group. Called by the panel interval. */
  tick: (activeToken?: { chain?: string; contract?: string }) => void;
}

export type OnChainStore = OnChainState & OnChainActions;

const GROUPS: SignalGroup[] = ['btc', 'evm', 'solana', 'defi', 'dex', 'forensics'];

const zeroTimestamps = (): Record<SignalGroup, number> =>
  Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<SignalGroup, number>;

const idleStatuses = (): Record<SignalGroup, GroupStatus> =>
  Object.fromEntries(GROUPS.map((group) => [group, 'idle'])) as Record<SignalGroup, GroupStatus>;

const inFlight = new Set<SignalGroup>();

export const useOnChainStore = create<OnChainStore>()((set, get) => ({
  open: false,
  btc: null,
  evm: {},
  solana: null,
  defi: null,
  dex: null,
  forensics: null,
  forensicsKey: null,
  status: idleStatuses(),
  updatedAt: zeroTimestamps(),

  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),

  refresh: async (group, opts) => {
    const state = get();
    if (inFlight.has(group)) return;
    const elapsed = Date.now() - state.updatedAt[group];
    const interval = state.status[group] === 'error' ? Math.min(REFRESH_MS[group], ERROR_RETRY_MS) : REFRESH_MS[group];
    const due = (opts?.force ?? false) || elapsed >= interval;
    // forensics also refresh when the inspected token changed
    const tokenKey = opts?.token?.chain && opts?.token?.contract ? `${opts.token.chain}:${opts.token.contract}` : null;
    const tokenChanged = group === 'forensics' && tokenKey != null && tokenKey !== state.forensicsKey;
    if (!due && !tokenChanged) return;

    inFlight.add(group);
    set((prev) => ({ status: { ...prev.status, [group]: prev.updatedAt[group] === 0 ? 'loading' : prev.status[group] } }));
    try {
      switch (group) {
        case 'btc': {
          const btc = await fetchBtcSignals();
          set((prev) => ({
            btc: btc ?? prev.btc,
            status: { ...prev.status, btc: btc ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, btc: Date.now() },
          }));
          break;
        }
        case 'evm': {
          const evm = await fetchEvmSignals();
          set((prev) => ({
            evm: Object.keys(evm).length > 0 ? evm : prev.evm,
            status: { ...prev.status, evm: Object.keys(evm).length > 0 ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, evm: Date.now() },
          }));
          break;
        }
        case 'solana': {
          const solana = await fetchSolanaSignals();
          set((prev) => ({
            solana: solana ?? prev.solana,
            status: { ...prev.status, solana: solana ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, solana: Date.now() },
          }));
          break;
        }
        case 'defi': {
          const defi = await fetchDefiSignals();
          set((prev) => ({
            defi: defi ?? prev.defi,
            status: { ...prev.status, defi: defi ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, defi: Date.now() },
          }));
          break;
        }
        case 'dex': {
          const dex = await fetchDexHeat();
          const usable = dex.pools.length > 0 || dex.boosts.length > 0;
          set((prev) => ({
            dex: usable ? dex : prev.dex,
            status: { ...prev.status, dex: usable ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, dex: Date.now() },
          }));
          break;
        }
        case 'forensics': {
          if (!opts?.token?.chain || !opts?.token?.contract) {
            set((prev) => ({ forensics: null, forensicsKey: null, status: { ...prev.status, forensics: 'idle' } }));
            break;
          }
          const key = `${opts.token.chain}:${opts.token.contract}`;
          const forensics = await fetchTokenForensics(opts.token.chain, opts.token.contract);
          set((prev) => ({
            forensics: forensics ?? (prev.forensicsKey === key ? prev.forensics : null),
            forensicsKey: key,
            status: { ...prev.status, forensics: forensics ? 'ok' : 'error' },
            updatedAt: { ...prev.updatedAt, forensics: Date.now() },
          }));
          break;
        }
      }
    } catch {
      set((prev) => ({ status: { ...prev.status, [group]: 'error' } }));
    } finally {
      inFlight.delete(group);
    }
  },

  tick: (activeToken) => {
    for (const group of GROUPS) {
      void get().refresh(group, { token: activeToken });
    }
  },
}));

export const selectOnChainOpen = (s: OnChainStore) => s.open;
