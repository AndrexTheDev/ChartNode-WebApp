// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect } from 'react';
import { needsProbe, probeAllExchanges } from '@/api/exchangeProbe';
import { pickExchange } from '@/lib/exchange-select';
import { detectRegion } from '@/lib/region';
import { ADAPTERS } from '@/websockets/registry';
import type { ExchangeId } from '@/websockets/types';
import type { Timeframe } from './types';
import { useExchangeStore, type ExchangeReach } from './useExchangeStore';

/** Type guard for "is this string one of our twelve venues?". */
export function isCexExchange(value: string | undefined | null): value is ExchangeId {
  return typeof value === 'string' && value in ADAPTERS;
}

/**
 * Region bootstrap: detects the visitor's country (edge cookie → timezone) and
 * measures which venues are reachable from here. Runs once per session – the
 * probe results are persisted for 6 h.
 */
export function useRegionBootstrap(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const region = detectRegion();
    const store = useExchangeStore.getState();
    if (region.country && region.country !== store.country) {
      store.setRegion(region.country, region.source);
    }
    if (needsProbe(useExchangeStore.getState())) void probeAllExchanges();
  }, [enabled]);
}

export interface ExchangeSelection {
  /** Venue the chart should use right now. */
  exchange: ExchangeId;
  /** True when the token's own venue could not be used (region/pair). */
  rerouted: boolean;
}

/**
 * Resolves which venue serves `symbol` for this visitor:
 *   1. a manual choice for that symbol (`preferred`)
 *   2. the venue the token came with, if it is reachable and lists the pair
 *   3. the best measured alternative (latency, region, timeframe support)
 */
export interface SelectionState {
  country: string | null;
  reach: Record<string, ExchangeReach>;
  unsupported: Record<string, string[]>;
  preferred: Record<string, ExchangeId>;
}

/**
 * Pure venue resolution – shared by the hook (per pane) and `MarketDataProvider`
 * (which has to mount exactly the feeds the panes will read).
 */
export function resolveExchangeSelection(
  symbol: string,
  timeframe: Timeframe,
  tokenExchange: string | undefined,
  state: SelectionState,
): ExchangeSelection | null {
  const { country, reach, unsupported, preferred } = state;
  if (!isCexExchange(tokenExchange) && !preferred[symbol]) return null;

  const effectivePreferred =
    isCexExchange(tokenExchange) && !preferred[symbol]
      ? { ...preferred, [symbol]: tokenExchange as ExchangeId }
      : preferred;

  const exchange = pickExchange({ symbol, timeframe, country, reach, unsupported, preferred: effectivePreferred });
  const wanted = preferred[symbol] ?? (isCexExchange(tokenExchange) ? tokenExchange : null);
  return { exchange, rerouted: Boolean(wanted && wanted !== exchange) };
}

export function useExchangeSelection(
  symbol: string,
  timeframe: Timeframe,
  tokenExchange?: string,
): ExchangeSelection | null {
  const country = useExchangeStore((s) => s.country);
  const reach = useExchangeStore((s) => s.reach);
  const unsupported = useExchangeStore((s) => s.unsupported);
  const preferred = useExchangeStore((s) => s.preferred);

  return resolveExchangeSelection(symbol, timeframe, tokenExchange, {
    country,
    reach,
    unsupported,
    preferred,
  });
}
