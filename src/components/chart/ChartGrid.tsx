// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * ChartGrid – the multi-chart workspace (1x1 / 2x1 / 2x2).
 *
 * One `PriceChart` (i.e. one lightweight-charts instance) per pane. Panes are
 * independent components so each can hold its own symbol and – with timeframe
 * sync switched off – its own timeframe, while the sync bus keeps crosshair and
 * zoom aligned across the grid.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Camera, Download, FastForward, Maximize, Pause, Play, Plus, Rewind, Scan, SkipBack, SkipForward, X } from 'lucide-react';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { StatusLed } from '@/components/ui/StatusLed';
import { SEED_TOKENS, TOKEN_INDEX } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { compactUsd, pct } from '@/lib/format';
import { TIMEFRAMES } from '@/store/presets';
import { CHART_LAYOUTS } from '@/store/presets';
import { selectActiveToken, selectChartType, selectLayout, selectPanes, selectTimeframe, useAppStore } from '@/store/useAppStore';
import { selectDexQuote, useMarketStore } from '@/store/useMarketStore';
import { fetchDexCandles } from '@/api/geckoterminal';
import { downloadCsv } from '@/lib/export';
import { CHAIN_LABEL, type ChainId } from '@/lib/chains';
import { EXCHANGE_META } from '@/lib/exchanges';
import {
  selectCompare,
  selectDrawings,
  selectIndicators,
  selectReplayOn,
  selectSyncTimeframe,
  useChartStore,
} from '@/store/useChartStore';
import { isCexExchange, useExchangeSelection } from '@/store/useExchangeSelection';
import { useHydrated } from '@/store/useHydrated';
import { feedId } from '@/websockets/types';
import { aggregateCandles, baseForCustomInterval } from '@/lib/charttypes';
import { detectPatterns } from '@/lib/patterns';
import { offerToast } from '@/lib/ads/smartlinks';
import type { Pane } from '@/store/types';
import type { PriceChartHandle } from './PriceChart';
import { DrawingToolbar } from './DrawingToolbar';
import { IndicatorModal } from './IndicatorModal';

// lightweight-charts needs a real DOM – never render it on the server.
const PriceChart = dynamic(() => import('./PriceChart').then((mod) => mod.PriceChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <span className="font-mono text-2xs uppercase tracking-cyber text-faint">···</span>
    </div>
  ),
});

export function ChartGrid() {
  const replayOn = useChartStore(selectReplayOn);
  const replayPlaying = useChartStore((state) => state.replayPlaying);
  const replaySpeed = useChartStore((state) => state.replaySpeed);

  // Playback engine: advance the visible window until the live edge.
  useEffect(() => {
    if (!replayOn || !replayPlaying) return;
    const id = setInterval(() => {
      const state = useChartStore.getState();
      if (state.replayHidden <= 0) {
        state.setReplayPlaying(false);
        return;
      }
      state.stepReplay(-1);
    }, Math.round(700 / replaySpeed));
    return () => clearInterval(id);
  }, [replayOn, replayPlaying, replaySpeed]);

  const layout = useAppStore(selectLayout);
  const panes = useAppStore(selectPanes);
  const hydrated = useHydrated();
  const preset = CHART_LAYOUTS[layout];

  const visible = useMemo(() => panes.slice(0, preset.panes), [panes, preset.panes]);

  return (
    <div className="relative flex-1">
      <div
        className={cn('grid h-full gap-2 p-2', preset.gridClass)}
        style={{ minHeight: preset.rows * preset.rowMinHeight }}
      >
        {visible.map((pane, index) => (
          <ChartPane key={pane.id} pane={pane} index={index} hydrated={hydrated} />
        ))}
      </div>
      {replayOn && <ReplayBar />}
    </div>
  );
}

/* --------------------------------- pane ----------------------------------- */

function ChartPane({ pane, index, hydrated }: { pane: Pane; index: number; hydrated: boolean }) {
  const t = useTranslations('chart');
  const tf = useTranslations('feed');

  const activeToken = useAppStore(selectActiveToken);
  const setActiveToken = useAppStore((s) => s.setActiveToken);
  const setPaneToken = useAppStore((s) => s.setPaneToken);
  const globalTimeframe = useAppStore(selectTimeframe);
  const setGlobalTimeframe = useAppStore((s) => s.setTimeframe);
  const chartType = useAppStore(selectChartType);

  const syncTimeframe = useChartStore(selectSyncTimeframe);
  const paneTimeframe = useChartStore((s) => s.paneTimeframe[pane.id] ?? null);
  const setPaneTimeframe = useChartStore((s) => s.setPaneTimeframe);
  const indicators = useChartStore(selectIndicators(pane.id));
  const drawings = useChartStore(selectDrawings(pane.id));
  const clearDrawings = useChartStore((s) => s.clearDrawings);

  const [modalOpen, setModalOpen] = useState(false);
  const chartHandle = useRef<PriceChartHandle>(null);

  const token = useMemo(
    () => (pane.tokenId ? (TOKEN_INDEX[pane.tokenId] ?? activeToken) : activeToken),
    [pane.tokenId, activeToken],
  );

  const timeframe = syncTimeframe ? globalTimeframe : (paneTimeframe ?? globalTimeframe);
  // Wave-4 custom intervals (TV: Essential+): subscribe the largest native
  // timeframe that divides N and aggregate client-side.
  const customAgg = useChartStore((state) => state.customAgg);
  const aggPlan = customAgg ? baseForCustomInterval(customAgg) : null;
  const feedTimeframe = aggPlan ? aggPlan.timeframe : timeframe;
  const selection = useExchangeSelection(token.symbol, feedTimeframe, token.exchange);
  const id = selection
    ? feedId({ exchange: selection.exchange, symbol: token.symbol, timeframe: feedTimeframe })
    : null;
  const feed = useMarketStore((s) => (id ? s.feeds[id] : undefined));
  const dexQuote = useMarketStore(selectDexQuote);

  const isCex = token.venue === 'CEX';
  const dexCandles = useMarketStore((s) => (isCex ? undefined : s.dexCandles[token.id]));

  // Compare overlay: another token's candles as a normalized % line.
  const compareId = useChartStore(selectCompare);
  const compareToken = compareId && compareId !== token.id ? TOKEN_INDEX[compareId] : undefined;
  const compareSelection = useExchangeSelection(
    compareToken?.venue === 'CEX' ? compareToken.symbol : '',
    timeframe,
    compareToken?.exchange,
  );
  const compareFeedId =
    compareToken && compareSelection
      ? feedId({ exchange: compareSelection.exchange, symbol: compareToken.symbol, timeframe })
      : null;
  const compareCandles = useMarketStore((s) => (compareFeedId ? s.feeds[compareFeedId]?.candles : undefined));
  const rawFeed = isCex ? (feed?.candles ?? []) : (dexCandles ?? []);
  const rawCandles = aggPlan && aggPlan.factor > 1 ? aggregateCandles(rawFeed, aggPlan.factor) : rawFeed;
  // Bar replay: hide `replayHidden` candles from the right edge – every
  // indicator, the volume profile and S/R recompute on the sliced buffer.
  const replayOn = useChartStore(selectReplayOn);
  const replayHidden = useChartStore((state) => state.replayHidden);
  const candles = replayOn ? rawCandles.slice(0, Math.max(30, rawCandles.length - replayHidden)) : rawCandles;
  // Wave-4 auto chart patterns (TV: Ultimate-only) over the visible buffer.
  const patternsOn = useChartStore((state) => state.patternsOn);
  const patterns = useMemo(() => (patternsOn ? detectPatterns(candles) : []), [patternsOn, candles]);
  const hasData = candles.length > 1;
  const isDexQuote = !isCex && dexQuote?.tokenId === token.id;
  const status = feed?.status ?? (isDexQuote ? 'open' : 'idle');

  // DEX tokens: pull real OHLCV history (and refresh it) from GeckoTerminal.
  // Public rate limits on shared IPs can bite – a failed load retries after
  // 15 s (backoff) instead of waiting for the 60 s refresh tick.
  useEffect(() => {
    if (isCex || !token.chain || !token.contract) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const chain = token.chain;
    const contract = token.contract;
    const scheduleRetry = () => {
      if (!alive || retry) return;
      retry = setTimeout(load, 15_000);
    };
    function load() {
      retry = null;
      fetchDexCandles(chain as ChainId, contract, timeframe)
        .then((history) => {
          if (!alive) return;
          if (history) useMarketStore.getState().setDexCandles(token.id, history);
          else scheduleRetry();
        })
        .catch(() => scheduleRetry());
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      clearInterval(interval);
    };
  }, [isCex, token.chain, token.contract, token.id, timeframe]);

  const ticker = `$${token.base}`;
  const venue = isCex ? (selection?.exchange ?? '—') : (dexQuote?.chain ?? token.chain ?? 'dex');
  // Klartext-Name der Datenquelle: Händler müssen auf einen Blick sehen,
  // welche Börse/Chain das Pane speist (TradingView-Standard: Exchange-Label)
  const dexChain = dexQuote?.chain ?? token.chain;
  const venueName = isCex
    ? (EXCHANGE_META[selection?.exchange ?? 'binance']?.name ?? venue)
    : (CHAIN_LABEL[dexChain as ChainId] ?? venue);

  function chooseToken(tokenId: string): void {
    if (index === 0) {
      const next = TOKEN_INDEX[tokenId];
      if (next) setActiveToken(next);
      setPaneToken(pane.id, null);
      return;
    }
    setPaneToken(pane.id, tokenId);
  }

  function exportCsv(): void {
    if (candles.length === 0) return;
    downloadCsv(
      `nodechart-${token.symbol.replace('/', '-')}-${timeframe}.csv`,
      ['time', 'open', 'high', 'low', 'close', 'volume'],
      candles.map((candle) => [
        new Date(candle.t).toISOString(),
        candle.o,
        candle.h,
        candle.l,
        candle.c,
        candle.v ?? 0,
      ]),
    );
    // Post-Action-Offer: Export läuft zuerst, Toast verzögert + gedeckelt.
    offerToast('action:export-csv');
  }

  function exportPng(): void {
    const url = chartHandle.current?.toPng();
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `nodechart-${token.symbol.replace('/', '')}-${timeframe}.png`;
    link.click();
    offerToast('action:export-png');
  }

  const tokenItems: DropdownItem[] = SEED_TOKENS.map((entry) => ({
    id: entry.id,
    label: entry.symbol,
    hint:
      entry.venue === 'CEX'
        ? EXCHANGE_META[isCexExchange(entry.exchange) ? entry.exchange : 'binance'].name
        : (CHAIN_LABEL[entry.chain as ChainId] ?? entry.venue),
    selected: entry.id === token.id,
    onSelect: () => chooseToken(entry.id),
  }));

  const timeframeItems: DropdownItem[] = TIMEFRAMES.map((value) => ({
    id: value,
    label: value,
    selected: value === timeframe,
    onSelect: () => {
      if (syncTimeframe) setGlobalTimeframe(value);
      else setPaneTimeframe(pane.id, value);
    },
  }));

  return (
    <>
      <NeonPanel
        glow="sm"
        titleTag="h2"
        scan={status === 'open'}
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusLed tone={status === 'open' ? 'ok' : status === 'reconnecting' ? 'warn' : 'idle'} />
            <span className="truncate">{token.symbol}</span>
            <span
              className="nc-chip shrink-0 border-line/70 px-1 py-0 text-micro-9 uppercase tracking-cyber text-faint"
              title={t('pane.venueHint', { venue: venueName })}
            >
              {venueName}
            </span>
            <span className="min-w-0 truncate font-mono text-micro-9 uppercase tracking-cyber text-faint">
              {index === 0 ? t('pane.primary') : t('pane.index', { n: index + 1 })}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-1">
            <Dropdown
              items={timeframeItems}
              triggerLabel={t('pane.timeframe')}
              triggerText={<span className="font-mono text-2xs">{timeframe}</span>}
              widthClass="w-28"
            />
            <Dropdown
              items={tokenItems}
              triggerLabel={t('pane.symbol')}
              triggerText={<span className="max-w-24 truncate font-mono text-2xs">{token.symbol}</span>}
              widthClass="w-52"
            />
            <PaneButton
              label={t('toolbar.indicators', { n: indicators.length })}
              active={indicators.length > 0}
              onClick={() => setModalOpen(true)}
            >
              <Plus className="size-3.5" aria-hidden />
              <span className="hidden font-mono text-2xs tabular-nums sm:inline">{indicators.length}</span>
            </PaneButton>
            <PaneButton label={t('toolbar.fit')} onClick={() => chartHandle.current?.fit()}>
              <Maximize className="size-3.5" aria-hidden />
            </PaneButton>
            <PaneButton label={t('toolbar.screenshot')} onClick={exportPng} disabled={!hasData}>
              <Camera className="size-3.5" aria-hidden />
            </PaneButton>
            <PaneButton label={t('toolbar.csv')} onClick={exportCsv} disabled={!hasData}>
              <Download className="size-3.5" aria-hidden />
            </PaneButton>
          </div>
        }
        className="min-h-[240px] bg-bg/60"
        bodyClassName="flex h-full flex-col"
      >
        <div className="border-b border-line/60 px-2 py-1.5">
          <DrawingToolbar paneId={pane.id} drawingCount={drawings.length} onClearDrawings={() => clearDrawings(pane.id)} />
        </div>

        {/*
          Absolute inset instead of `h-full`: lightweight-charts measures its
          container with a ResizeObserver, and a content-sized parent turns that
          into a growth loop (the canvas pushed the pane to 4500 px in testing).
          An absolutely positioned box has a definite size, so `autoSize` is stable.
        */}
        <div className="relative min-h-[260px] flex-1">
          {hasData ? (
            <div className="absolute inset-0">
            <PriceChart
              ref={chartHandle}
              paneId={pane.id}
              chartId={`${pane.id}-${token.id}`}
              symbol={token.symbol}
              ticker={ticker}
              venue={venue}
              timeframe={timeframe}
              candles={candles}
              patterns={patterns}
              intervalLabel={customAgg ? `${customAgg}m` : null}
              chartType={chartType}
              status={status}
              compareCandles={isCex ? compareCandles : undefined}
              compareTicker={isCex && compareCandles && compareCandles.length > 1 ? compareToken?.base : undefined}
            />
            </div>
          ) : (
            <PanePlaceholder
              symbol={token.symbol}
              status={status}
              label={
                isDexQuote
                  ? t('pane.dexWaiting')
                  : status === 'reconnecting'
                    ? tf('reconnecting')
                    : status === 'error'
                      ? tf(feed?.note === 'region' ? 'region' : 'closed')
                      : t('pane.waiting')
              }
              price={isDexQuote ? dexQuote?.priceUsd ?? null : feed?.lastPrice ?? null}
              change={isDexQuote ? dexQuote.change24h : null}
              liquidity={isDexQuote ? dexQuote.liquidityUsd : null}
            />
          )}
        </div>

        <p className="flex flex-wrap items-center gap-x-2 border-t border-line/60 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-faint">
          <span>{chartType}</span>
          <span aria-hidden>·</span>
          <span className={cn(hydrated && status === 'open' ? 'text-primary' : undefined)}>
            {status === 'open' ? tf('open') : tf(status === 'error' ? 'error' : 'idle')}
          </span>
          {selection?.rerouted && (
            <>
              <span aria-hidden>·</span>
              <span className="text-warning">{t('pane.rerouted')}</span>
            </>
          )}
          {candles.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{tf('candles', { n: candles.length })}</span>
            </>
          )}
        </p>
      </NeonPanel>

      <IndicatorModal paneId={pane.id} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

/* -------------------------------- pieces ---------------------------------- */

function PaneButton({
  children,
  label,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'nc-clip-sm inline-flex h-7 items-center gap-1 border px-1.5 transition-colors duration-150',
        active
          ? 'border-primary/70 bg-primary/14 text-primary hover:bg-primary/22'
          : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:text-fg',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function PanePlaceholder({
  symbol,
  label,
  price,
  change,
  liquidity,
}: {
  symbol: string;
  status: string;
  label: string;
  price: number | null;
  change: number | null;
  liquidity: number | null;
}) {
  const t = useTranslations('chart');
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center">
      <Scan className="size-5 animate-pulse text-primary/50" aria-hidden />
      <p className="font-display text-sm font-bold text-fg">{symbol}</p>
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
      {price != null && (
        <p className="mt-1 font-mono text-xs tabular-nums text-primary">
          {price.toFixed(price < 1 ? 8 : 2)}
          {change != null && <span className={cn('ml-2', change >= 0 ? 'text-bull' : 'text-bear')}>{pct(change)}</span>}
        </p>
      )}
      {liquidity != null && (
        <p className="font-mono text-micro-10 text-muted">
          {t('pane.liquidity', { amount: compactUsd(liquidity) })}
        </p>
      )}
    </div>
  );
}

/* --------------------------------- bar replay ------------------------------- */

/**
 * Bar replay transport (TradingView gates intraday replay behind paid plans;
 * here every timeframe replays with all indicators recomputing live).
 */
function ReplayBar() {
  const t = useTranslations('chart');
  const hidden = useChartStore((state) => state.replayHidden);
  const playing = useChartStore((state) => state.replayPlaying);
  const speed = useChartStore((state) => state.replaySpeed);
  const step = useChartStore((state) => state.stepReplay);
  const setPlaying = useChartStore((state) => state.setReplayPlaying);
  const setSpeed = useChartStore((state) => state.setReplaySpeed);
  const stop = useChartStore((state) => state.stopReplay);

  const barButton = 'nc-clip-sm inline-flex size-7 items-center justify-center border border-line bg-surface/80 text-muted transition-colors hover:border-secondary/60 hover:text-secondary';

  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
      <div className="nc-clip flex items-center gap-1.5 border border-secondary/50 bg-bg/95 px-2.5 py-1.5 shadow-volt backdrop-blur-md">
        <span className="mr-1 font-mono text-2xs uppercase tracking-cyber text-secondary">{t('replay.title')}</span>
        <button type="button" className={barButton} aria-label={t('replay.back10')} title={t('replay.back10')} onClick={() => step(10)}>
          <SkipBack className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={barButton} aria-label={t('replay.back1')} title={t('replay.back1')} onClick={() => step(1)}>
          <Rewind className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={cn(barButton, playing && 'border-secondary/70 text-secondary')}
          aria-label={playing ? t('replay.pause') : t('replay.play')}
          title={playing ? t('replay.pause') : t('replay.play')}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        </button>
        <button type="button" className={barButton} aria-label={t('replay.fwd1')} title={t('replay.fwd1')} onClick={() => step(-1)}>
          <FastForward className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={barButton} aria-label={t('replay.fwd10')} title={t('replay.fwd10')} onClick={() => step(-10)}>
          <SkipForward className="size-3.5" aria-hidden />
        </button>
        <select
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          aria-label={t('replay.speed')}
          className="cursor-pointer border border-line bg-surface/80 px-1 font-mono text-2xs text-muted outline-none"
        >
          {[1, 2, 5, 10].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <span className="ml-1 font-mono text-2xs tabular-nums text-faint">−{hidden}</span>
        <button
          type="button"
          onClick={stop}
          className="nc-clip-sm ml-1 inline-flex h-7 items-center gap-1 border border-bull/50 bg-bull/10 px-2 font-mono text-2xs uppercase tracking-cyber text-bull transition-colors hover:bg-bull/20"
        >
          <X className="size-3" aria-hidden />
          {t('replay.live')}
        </button>
      </div>
    </div>
  );
}
