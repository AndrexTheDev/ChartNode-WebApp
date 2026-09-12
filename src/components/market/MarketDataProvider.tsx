// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo } from 'react';
import { dexscreenerByToken } from '@/api/dexscreener';
import { TOKEN_INDEX } from '@/lib/constants';
import { baseForCustomInterval } from '@/lib/charttypes';
import { pickExchange } from '@/lib/exchange-select';
import { CHART_LAYOUTS } from '@/store/presets';
import { useMarketStore } from '@/store/useMarketStore';
import {
  selectActiveToken,
  selectLayout,
  selectPanes,
  selectTimeframe,
  selectWatchlist,
  useAppStore,
} from '@/store/useAppStore';
import { selectCompare, useChartStore } from '@/store/useChartStore';
import { useExchangeStore } from '@/store/useExchangeStore';
import {
  isCexExchange,
  resolveExchangeSelection,
  useExchangeSelection,
  useRegionBootstrap,
} from '@/store/useExchangeSelection';
import { selectWhaleEnabled, useWhaleStore } from '@/store/useWhaleStore';
import { cexManager, type WhaleTarget } from '@/websockets/manager';
import type { ExchangeId } from '@/websockets/types';
import type { Timeframe, Token } from '@/store/types';

const MAX_WHALE_SYMBOLS = 5;
const DEX_POLL_MS = 20_000;

/**
 * The single owner of live connections for the current view.
 *
 *  - active CEX token  → kline feed on the *best reachable* venue
 *    (region-aware: measured latency + geo blocks + whether the pair is listed)
 *  - watchlist CEX     → trade channels for the whale stream
 *  - active DEX token  → DexScreener polling (REST aggregator, 20 s cadence)
 *
 * Everything is reference-counted inside CexSocketManager, so navigating
 * around never leaks a socket. Renders nothing.
 */
export function MarketDataProvider() {
  const activeToken = useAppStore(selectActiveToken);
  const timeframe = useAppStore(selectTimeframe);
  const watchlist = useAppStore(selectWatchlist);
  const whaleEnabled = useWhaleStore(selectWhaleEnabled);

  const isCex = activeToken.venue === 'CEX';
  useRegionBootstrap(isCex);
  const selection = useExchangeSelection(activeToken.symbol, timeframe, activeToken.exchange);
  const exchange = selection?.exchange;

  // Re-runs the whale routing when a probe finishes or a pair turns out unsupported.
  const reach = useExchangeStore((s) => s.reach);
  const unsupported = useExchangeStore((s) => s.unsupported);
  const preferred = useExchangeStore((s) => s.preferred);
  const country = useExchangeStore((s) => s.country);

  /* --------------------------- CEX kline feeds (grid) ------------------------- */
  const panes = useAppStore(selectPanes);
  const layout = useAppStore(selectLayout);
  const paneTimeframes = useChartStore((s) => s.paneTimeframe);
  const syncTimeframe = useChartStore((s) => s.syncTimeframe);
  const compareId = useChartStore(selectCompare);
  const customAgg = useChartStore((s) => s.customAgg);
  // Wave-7 Lag Oracle: subscribe the leader instrument while the oracle is open.
  const lagOpen = useChartStore((s) => s.edgeLagOpen);
  const lagLeaderId = useChartStore((s) => s.lagLeaderId);

  /**
   * Every visible pane resolves its own venue + timeframe (that is what the pane
   * component will read from `useMarketStore`), so the provider has to mount
   * exactly that set – the active token is always included for the toolbar.
   */
  const wantedFeeds = useMemo(() => {
    const state = { country, reach, unsupported, preferred };
    const wanted: { exchange: ExchangeId; symbol: string; timeframe: Timeframe }[] = [];
    // Wave-4 custom intervals: subscribe the native base timeframe and let
    // ChartGrid aggregate – the manager only knows native intervals.
    const withAgg = (tf: Timeframe): Timeframe =>
      customAgg != null ? baseForCustomInterval(customAgg).timeframe : tf;
    const seen = new Set<string>();

    const push = (token: Token, tf: Timeframe) => {
      if (token.venue !== 'CEX') return;
      const selection = resolveExchangeSelection(token.symbol, tf, token.exchange, state);
      if (!selection) return;
      const key = `${selection.exchange}|${token.symbol}|${tf}`;
      if (seen.has(key)) return;
      seen.add(key);
      wanted.push({ exchange: selection.exchange, symbol: token.symbol, timeframe: tf });
    };

    push(activeToken, withAgg(timeframe));
    // Compare overlay feed (CEX only, same timeframe as the toolbar).
    if (activeToken.venue === 'CEX' && compareId && compareId !== activeToken.id) {
      const compareToken = TOKEN_INDEX[compareId];
      if (compareToken?.venue === 'CEX') push(compareToken, timeframe);
    }
    // Lag Oracle leader feed (only while the oracle modal is open).
    if (lagOpen && lagLeaderId && lagLeaderId !== activeToken.id) {
      const leaderToken = TOKEN_INDEX[lagLeaderId];
      if (leaderToken?.venue === 'CEX') push(leaderToken, withAgg(timeframe));
    }
    for (const pane of panes.slice(0, CHART_LAYOUTS[layout].panes)) {
      const token = pane.tokenId ? (TOKEN_INDEX[pane.tokenId] ?? activeToken) : activeToken;
      const tf = syncTimeframe ? timeframe : (paneTimeframes[pane.id] ?? timeframe);
      push(token, withAgg(tf));
    }
    return wanted;
  }, [activeToken, timeframe, panes, layout, syncTimeframe, paneTimeframes, compareId, country, reach, unsupported, preferred, customAgg, lagOpen, lagLeaderId]);

  const wantedSignature = wantedFeeds.map((key) => `${key.exchange}|${key.symbol}|${key.timeframe}`).join(',');

  useEffect(() => {
    // Diff-basiert statt ensure+cleanup: Ein Cleanup, das zuerst released,
    // ließ die Referenzzählung bei jedem TF-/Token-Wechsel kurz auf 0 kippen
    // → Stream-Shutdown → sofortiger Reconnect (Churn + Reseed). setFeeds
    // addiert neue Kanäle, BEVOR es alte freigibt; der Socket bleibt offen.
    // Entmount deckt der releaseAll-Teardown unten ab.
    cexManager.setFeeds(wantedFeeds);
    // Re-running on the signature (not the array identity) keeps the reference
    // counting exact: same set ⇒ no reconnect churn while the user pans/zooms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedSignature]);

  /* --------------------- Wake-up nach Tab-Blende / Offline -------------------- */
  useEffect(() => {
    // Hintergrund-Tabs drosseln Timer (Heartbeat stoppt, Reconnect-Timer auf
    // ≥1/min) → der Server trennt die Sockets. Statt bis zu 45 s auf den
    // Watchdog zu warten, beim Aufwachen sofort wiederverbinden.
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      if (navigator.onLine === false) return;
      cexManager.resumeAll();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, []);

  /* ------------------------------- whale targets ----------------------------- */
  useEffect(() => {
    if (!whaleEnabled) {
      cexManager.setWhaleTargets([]);
      return;
    }

    const state = { country, reach, unsupported, preferred };
    const targets: WhaleTarget[] = [];
    const seen = new Set<string>();

    const push = (tokenExchange: string | undefined, symbol: string) => {
      // Prefer the venue we already have a socket for, else the best reachable one.
      const venue: ExchangeId | null =
        exchange && symbol === activeToken.symbol
          ? exchange
          : isCexExchange(tokenExchange) && !unsupported[tokenExchange]?.includes(symbol)
            ? tokenExchange
            : pickExchange({
                symbol,
                timeframe: '1m',
                country: state.country,
                reach: state.reach,
                unsupported: state.unsupported,
                preferred: state.preferred,
              });
      if (!venue) return;
      const key = `${venue}:${symbol}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({ exchange: venue, symbol });
    };

    if (activeToken.venue === 'CEX') push(activeToken.exchange, activeToken.symbol);
    for (const id of watchlist) {
      if (targets.length >= MAX_WHALE_SYMBOLS) break;
      const token = TOKEN_INDEX[id];
      if (token && token.venue === 'CEX') push(token.exchange, token.symbol);
    }

    // Kein Cleanup hier: setWhaleTargets diffed selbst gegen den Vorzustand.
    // Ein zusätzliches setWhaleTargets([]) bei jedem Dep-Wechsel (Probe-
    // Updates, Watchlist-Edits) hätte alle Trade-Kanäle freigegeben → Stream
    // leer → Socket-Close → sofortiger Reconnect. Disable-Zweig (oben) und
    // der releaseAll-Teardown (unten) decken beide echten Abbau-Pfade ab.
    cexManager.setWhaleTargets(targets);
  }, [
    whaleEnabled,
    exchange,
    activeToken.id,
    activeToken.venue,
    activeToken.exchange,
    activeToken.symbol,
    watchlist,
    reach,
    unsupported,
    preferred,
    country,
  ]);

  /* -------------------------------- DEX polling ------------------------------ */
  const contract = activeToken.venue === 'DEX' ? activeToken.contract : undefined;
  const chain = activeToken.venue === 'DEX' ? activeToken.chain : undefined;

  useEffect(() => {
    if (!contract || !chain) {
      useMarketStore.getState().setDexQuote(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const pairs = await dexscreenerByToken([contract], controller.signal);
        if (cancelled) return;
        const onChain = pairs.filter((pair) => pair.chain === chain);
        const best =
          (onChain.length > 0 ? onChain : pairs).sort(
            (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
          )[0] ?? null;
        if (!best) return;
        useMarketStore.getState().setDexQuote({
          tokenId: activeToken.id,
          priceUsd: best.priceUsd,
          change24h: best.change24h,
          volume24h: best.volume24h,
          liquidityUsd: best.liquidityUsd,
          poolName: `${best.baseSymbol}/${best.quoteSymbol}`,
          chain: best.chain,
          dex: best.dex,
          updatedAt: Date.now(),
        });
      } catch {
        // 429s are handled globally (overlay + retry); transient errors just
        // keep the previous quote on screen.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), DEX_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      controller.abort();
    };
  }, [contract, chain, activeToken.id]);

  /* --------------------------------- teardown -------------------------------- */
  useEffect(() => () => cexManager.releaseAll(), []);

  return null;
}
