// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Anchor,
  BarChart3,
  Calculator,
  FlaskConical,
  Gauge,
  Heart,
  History,
  Network,
  LifeBuoy,
  List,
  Radar,
  Share2,
  Star,
  Table2,
  Terminal,
  Waves,
  Wifi,
  WifiOff,
  Shapes,
  Flame,
  BookOpen,
  Wrench,
  ZoomIn,
  BellRing,
  Code2,
  Sparkles,
  Magnet,
  Compass,
  Clock3,
  SlidersHorizontal,
} from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { ToolMenu, type ToolMenuItem } from '@/components/ui/ToolMenu';
import { ControlSection, MobileActionGrid, TerminalControlsSheet } from './TerminalControlsSheet';
import { TimeframePicker } from './TimeframePicker';
import { AdSlot } from '@/components/ads/AdManager';
import { SmartlinkKit } from '@/components/ads/SmartlinkKit';
import { SidebarBanner } from '@/components/ads/SidebarBanner';
import { OnChainPanel } from '@/components/onchain/OnChainPanel';
import { ProMetricsPanel } from '@/components/pro/ProMetricsPanel';
import { requestPopunder } from '@/lib/ads/adsterra';
import { offerToast, SMARTLINKS_ENABLED } from '@/lib/ads/smartlinks';
import { ExchangePicker } from './ExchangePicker';
import { ThemeSwitcher } from '@/components/layout/ThemeSwitcher';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { ChartGrid } from '@/components/chart/ChartGrid';
import { SEED_TOKENS } from '@/lib/constants';
import { EXCHANGE_META } from '@/lib/exchanges';
import { cn } from '@/lib/cn';
import { compactUsd, pct, usd } from '@/lib/format';
import { realizedVolPct, sessionStats } from '@/lib/premium';
import { CHART_LAYOUTS, CHART_TYPES, LAYOUT_IDS } from '@/store/presets';
import { selectDexQuote, useMarketStore } from '@/store/useMarketStore';
import {
  selectActiveToken,
  selectChartType,
  selectLayout,
  selectTimeframe,
  selectWatchlist,
  useAppStore,
} from '@/store/useAppStore';
import {
  selectAvwapArm,
  selectCompare,
  selectDivOn,
  selectLiqMagnetsOn,
  selectSrOn,
  selectVpOn,
  useChartStore,
} from '@/store/useChartStore';
import { ToastHost } from '@/components/ui/ToastHost';
import { BacktestModal } from '@/components/tools/BacktestModal';
import { RiskModal } from '@/components/tools/RiskModal';
import { ScreenerModal } from '@/components/tools/ScreenerModal';
import { WatchlistPopover } from '@/components/tools/WatchlistPopover';
import { RatingsModal } from '@/components/tools/RatingsModal';
import { HeatmapModal } from '@/components/tools/HeatmapModal';
import { JournalModal } from '@/components/tools/JournalModal';
import { MagnifierModal } from '@/components/tools/MagnifierModal';
import { AlertsPanelModal } from '@/components/tools/AlertsPanelModal';
import { PatternsModal } from '@/components/tools/PatternsModal';
import { ScriptLabModal } from '@/components/tools/ScriptLabModal';
import { EdgeLiqModal, EdgeLagModal, EdgeRegimeModal, EdgeClockModal } from '@/components/tools/EdgeModals';
import { TOKEN_INDEX } from '@/lib/constants';
import type { ExchangeId } from '@/websockets/types';
import { SupportModal } from '@/components/support/SupportModal';
import { SupportNudge } from '@/components/support/SupportNudge';
import { useHydrated } from '@/store/useHydrated';
import { useViralStore } from '@/store/useViralStore';
import { selectOnChainOpen, useOnChainStore } from '@/store/useOnChainStore';
import { selectProOpen, useProStore } from '@/store/useProStore';
import { isCexExchange, useExchangeSelection } from '@/store/useExchangeSelection';
import { selectWhaleEnabled, useWhaleStore } from '@/store/useWhaleStore';
import { feedId, type FeedStatus } from '@/websockets/types';
import type { ChartLayoutId, ChartType } from '@/store/types';

/**
 * Terminal workspace.
 *
 * Part 2 wiring: the first pane renders LIVE candles from `useMarketStore`
 * (WebSocket ticks + REST seed) whenever a CEX feed is available, DEX tokens
 * show the polled DexScreener quote, and every pane header carries the socket
 * status (live / reconnecting / region-blocked). The whale toggle controls the
 * trade channels that feed the bottom ticker.
 */
/** Turns raw feed notes into localised source/staleness chips. */
function feedNoteLabel(
  note: string | null | undefined,
  tf: (
    key: 'region' | 'unsupported' | 'seedFailed' | 'seedVia' | 'seedStale',
    vars?: { venue: string; age?: string },
  ) => string,
): string {
  if (!note) return '';
  if (note === 'region') return tf('region');
  if (note === 'unsupported') return tf('unsupported');
  if (note.startsWith('seed-via:')) return tf('seedVia', { venue: note.slice('seed-via:'.length) });
  if (note.startsWith('seed-stale:')) {
    const [, venue, rawAge = '0'] = note.split(':');
    const seconds = Math.max(0, Number(rawAge) || 0);
    const age = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : seconds >= 60 ? `${Math.floor(seconds / 60)}m` : `${seconds}s`;
    return tf('seedStale', { venue: venue || '—', age });
  }
  return tf('seedFailed');
}

export function TerminalShell() {
  const t = useTranslations('showcase');
  const router = useRouter();
  const locale = useLocale();
  const tf = useTranslations('feed');
  const tn = useTranslations('nav');
  const tw = useTranslations('whales');
  const ts = useTranslations('share');
  const toc = useTranslations('onchain');
  const tp = useTranslations('pro');
  const t2 = useTranslations('support');
  const hydrated = useHydrated();
  const openShare = useViralStore((s) => s.openShare);
  const onChainOpen = useOnChainStore(selectOnChainOpen);
  const toggleOnChain = useOnChainStore((s) => s.toggle);
  const proOpen = useProStore(selectProOpen);
  const togglePro = useProStore((s) => s.toggle);

  // Shared links carry `?ticker=SOL` – open exactly the chart that was posted.
  // Read from `location.search` at mount (no useSearchParams → no Suspense
  // boundary needed, which kept full reloads of the SSG shell simple).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('ticker')?.toUpperCase();
    if (!wanted) return;
    const token = SEED_TOKENS.find(
      (entry) =>
        entry.symbol.toUpperCase() === wanted || entry.symbol.split('/')[0]?.toUpperCase() === wanted,
    );
    if (token) useAppStore.getState().setActiveToken(token);
  }, []);

  const layout = useAppStore(selectLayout);
  const setLayout = useAppStore((s) => s.setLayout);
  const timeframe = useAppStore(selectTimeframe);
  const chartType = useAppStore(selectChartType);
  const setChartType = useAppStore((s) => s.setChartType);
  const vpOn = useChartStore(selectVpOn);
  const toggleVp = useChartStore((s) => s.toggleVp);
  // wave-7 Edge Suite
  const te = useTranslations('edge');
  const liqMagnetsOn = useChartStore(selectLiqMagnetsOn);
  const edgeLiqOpen = useChartStore((s) => s.edgeLiqOpen);
  const edgeLagOpen = useChartStore((s) => s.edgeLagOpen);
  const edgeRegimeOpen = useChartStore((s) => s.edgeRegimeOpen);
  const edgeClockOpen = useChartStore((s) => s.edgeClockOpen);
  const avwapArm = useChartStore(selectAvwapArm);
  const setAvwapArm = useChartStore((s) => s.setAvwapArm);
  const avwapAnchored = useChartStore((s) => Object.values(s.avwapAnchor).some((value) => value != null));
  const setAvwapAnchorAll = useChartStore((s) => s.setAvwapAnchor);
  const srOn = useChartStore(selectSrOn);
  const toggleSr = useChartStore((s) => s.toggleSr);
  const divOn = useChartStore(selectDivOn);
  const toggleDiv = useChartStore((s) => s.toggleDiv);
  const compare = useChartStore(selectCompare);
  const setCompare = useChartStore((s) => s.setCompare);
  const axisLog = useChartStore((s) => s.axisLog);
  const toggleAxisLog = useChartStore((s) => s.toggleAxisLog);
  const axisPct = useChartStore((s) => s.axisPct);
  const toggleAxisPct = useChartStore((s) => s.toggleAxisPct);
  const replayOn = useChartStore((s) => s.replayOn);
  const startReplay = useChartStore((s) => s.startReplay);
  const stopReplay = useChartStore((s) => s.stopReplay);
  const supporter = useViralStore((s) => s.supporter);
  const openSupport = useViralStore((s) => s.openSupport);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [screenerOpen, setScreenerOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [magnifierOpen, setMagnifierOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  // QA-Hook: ?qa=1 exponiert die Stores für automatisierte Feature-Tests.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('qa=1')) return;
    (window as unknown as Record<string, unknown>).__NC__ = {
      useChartStore,
      useAppStore,
      useWhaleStore,
      useProStore,
      useViralStore,
    };
  }, []);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const scriptLabOpen = useChartStore((state) => state.scriptLabOpen);
  const setScriptLabOpen = useChartStore((state) => state.setScriptLabOpen);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [mobileWatchOpen, setMobileWatchOpen] = useState(false);
  const closeMobileControls = useCallback(() => {
    setMobileControlsOpen(false);
    setMobileWatchOpen(false);
  }, []);
  const activeToken = useAppStore(selectActiveToken);
  const compareToken = useMemo(
    () => (compare ? (TOKEN_INDEX[compare] ?? null) : null),
    [compare],
  );
  const compareItems = useMemo<DropdownItem[]>(
    () => [
      { id: 'none', label: t('compareNone'), selected: !compare, onSelect: () => setCompare(null) },
      ...SEED_TOKENS.filter((token) => token.venue === 'CEX' && token.id !== activeToken.id).map((token) => ({
        id: token.id,
        label: token.symbol,
        hint: EXCHANGE_META[isCexExchange(token.exchange) ? token.exchange : 'binance'].name,
        selected: compare === token.id,
        onSelect: () => setCompare(token.id),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare, activeToken.id, setCompare],
  );
  const watchlist = useAppStore(selectWatchlist);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);

  const whaleEnabled = useWhaleStore(selectWhaleEnabled);
  const setWhaleEnabled = useWhaleStore((s) => s.setEnabled);

  const watched = watchlist.includes(activeToken.id);

  // Region-aware venue choice: manual pick > token venue > best heuristic match.
  const selection = useExchangeSelection(activeToken.symbol, timeframe, activeToken.exchange);
  const activeFeedId = selection
    ? feedId({ exchange: selection.exchange, symbol: activeToken.symbol, timeframe })
    : null;

  const feed = useMarketStore((s) => (activeFeedId ? s.feeds[activeFeedId] : undefined));
  const dexQuote = useMarketStore(selectDexQuote);
  const dexCandles = useMarketStore((s) =>
    activeToken.venue === 'DEX' ? (s.dexCandles[activeToken.id] ?? null) : null,
  );

  // Session analytics: today's OHLC + range position + realized vol, all local.
  const sessionCandles = useMemo(() => feed?.candles ?? dexCandles ?? [], [feed, dexCandles]);
  const customAgg = useChartStore((state) => state.customAgg);
  const patternsOnStore = useChartStore((state) => state.patternsOn);
  const alertsCount = useChartStore((state) => state.alerts.length);
  const TF_MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 };
  const barMs = (customAgg ?? TF_MINUTES[timeframe] ?? 60) * 60_000;
  const pickSymbol = (symbol: string): boolean => {
    const token = Object.values(TOKEN_INDEX).find((entry) => entry.symbol === symbol);
    if (!token) return false;
    useAppStore.getState().setActiveToken(token);
    return true;
  };
  const session = useMemo(() => sessionStats(sessionCandles), [sessionCandles]);
  const realizedVol = useMemo(() => realizedVolPct(sessionCandles), [sessionCandles]);

  const livePrice = feed?.lastPrice ?? (dexQuote?.tokenId === activeToken.id ? dexQuote.priceUsd : null);
  const liveChange = dexQuote?.tokenId === activeToken.id ? dexQuote.change24h : null;
  const status: FeedStatus = feed?.status ?? 'idle';
  const connected = status === 'open';

  const chartTypeItems: DropdownItem[] = CHART_TYPES.map((type) => ({
    id: type,
    label: t(`types.${type}`),
    selected: hydrated && type === chartType,
    onSelect: () => setChartType(type as ChartType),
  }));

  const edgeItems: ToolMenuItem[] = [
    {
      key: 'liq',
      label: te('menuLiq'),
      icon: Magnet,
      active: hydrated && liqMagnetsOn,
      onClick: () => {
        useViralStore.getState().bumpTool();
        useChartStore.getState().setEdgeLiqOpen(true);
      },
    },
    {
      key: 'lag',
      label: te('menuLag'),
      icon: Activity,
      onClick: () => {
        useViralStore.getState().bumpTool();
        useChartStore.getState().setEdgeLagOpen(true);
      },
    },
    {
      key: 'regime',
      label: te('menuRegime'),
      icon: Compass,
      onClick: () => {
        useViralStore.getState().bumpTool();
        useChartStore.getState().setEdgeRegimeOpen(true);
      },
    },
    {
      key: 'clock',
      label: te('menuClock'),
      icon: Clock3,
      onClick: () => {
        useViralStore.getState().bumpTool();
        useChartStore.getState().setEdgeClockOpen(true);
      },
    },
  ];

  const analyseItems: ToolMenuItem[] = [
    { key: 'vp', label: t('vp'), icon: BarChart3, active: hydrated && vpOn, onClick: toggleVp },
    {
      key: 'avwap',
      label: t('avwap'),
      icon: Anchor,
      active: hydrated && (avwapArm || avwapAnchored),
      onClick: () => {
        if (avwapArm) {
          setAvwapArm(false);
        } else if (avwapAnchored) {
          for (const paneId of Object.keys(useChartStore.getState().avwapAnchor)) {
            setAvwapAnchorAll(paneId, null);
          }
        } else {
          setAvwapArm(true);
        }
      },
    },
    { key: 'sr', label: t('sr'), icon: Network, active: hydrated && srOn, onClick: toggleSr },
    { key: 'div', label: t('div'), icon: Activity, active: hydrated && divOn, onClick: toggleDiv },
    {
      key: 'patterns',
      label: t('patterns'),
      icon: Shapes,
      active: hydrated && patternsOnStore,
      onClick: () => {
        setPatternsOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
    {
      key: 'ratings',
      label: t('ratings'),
      icon: Gauge,
      active: hydrated && ratingsOpen,
      onClick: () => {
        setRatingsOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
    {
      key: 'heatmap',
      label: t('heatmap'),
      icon: Flame,
      active: hydrated && heatmapOpen,
      onClick: () => {
        setHeatmapOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
  ];

  const toolsItems: ToolMenuItem[] = [
    {
      key: 'replay',
      label: t('replay'),
      icon: History,
      active: hydrated && replayOn,
      onClick: () => (replayOn ? stopReplay() : startReplay()),
    },
    { key: 'backtest', label: t('backtest'), icon: FlaskConical, active: hydrated && backtestOpen, onClick: () => setBacktestOpen(true) },
    { key: 'screener', label: t('screener'), icon: Table2, active: hydrated && screenerOpen, onClick: () => setScreenerOpen(true) },
    { key: 'risk', label: t('risk'), icon: Calculator, active: hydrated && riskOpen, onClick: () => setRiskOpen(true) },
    {
      key: 'journal',
      label: t('journal'),
      icon: BookOpen,
      active: hydrated && journalOpen,
      onClick: () => {
        setJournalOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
    {
      key: 'magnifier',
      label: t('magnifier'),
      icon: ZoomIn,
      active: hydrated && magnifierOpen,
      onClick: () => {
        setMagnifierOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
    {
      key: 'scripts',
      label: t('scripts'),
      icon: Code2,
      active: hydrated && scriptLabOpen,
      onClick: () => {
        setScriptLabOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
    {
      key: 'alerts-manager',
      label: alertsCount > 0 ? `${t('alerts')} · ${alertsCount}` : t('alerts'),
      icon: BellRing,
      active: hydrated && alertsOpen,
      onClick: () => {
        setAlertsOpen(true);
        useViralStore.getState().bumpTool();
      },
    },
  ];

  const moreItems: ToolMenuItem[] = [
    {
      key: 'share',
      label: ts('button'),
      icon: Share2,
      onClick: () => {
        openShare('chart');
        offerToast('action:share');
      },
    },
    {
      key: 'whale',
      label: tw('title'),
      icon: Waves,
      active: whaleEnabled,
      onClick: () => setWhaleEnabled(!whaleEnabled),
    },
    { key: 'help', label: t('menus.help'), icon: LifeBuoy, onClick: () => router.push('/help', { locale }) },
  ];

  const chooseLayout = (id: ChartLayoutId) => {
    setLayout(id);
    if (id !== '1x1') requestPopunder();
  };

  return (
    <div className="flex min-h-[calc(100dvh-var(--nc-header-h))] flex-col pb-[max(2.5rem,calc(var(--nc-dock-offset,0px)+env(safe-area-inset-bottom)))] xl:flex-row">
      {/* linke Sidebar: Banner 160×600, Desktop only (xl-Row-Layout) */}
      <SidebarBanner />
      <div className="flex min-w-0 flex-1 flex-col">
      {/* sponsored strip (Smartlink-Kit) – Header-Zone über der Toolbar:
          auf Mobile sonst hinter der wrappenden Toolbar im Toast-Bereich */}
      {SMARTLINKS_ENABLED ? (
        <div id="sponsor-strip" className="mx-2 mt-1 flex flex-wrap items-center gap-2 empty:mx-0 empty:hidden" />
      ) : null}

      {/* ------------------------------- toolbar ---------------------------- */}
      <div className="sticky top-header z-40 border-b border-line/80 bg-bg/85 backdrop-blur-xl">
        {/* Compact toolbar for phones and tablets: status, timeframes and one
            predictable entry point for chart setup and less-frequent actions. */}
        <div className="xl:hidden">
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0 font-display text-sm font-extrabold tracking-tight sm:text-base">
                {activeToken.symbol}
              </span>
              <span className={cn('min-w-0 truncate font-mono text-sm tabular-nums', livePrice != null ? 'text-primary' : 'text-faint')}>
                {usd(livePrice)}
              </span>
              {liveChange != null && (
                <span className={cn('shrink-0 font-mono text-2xs tabular-nums', liveChange >= 0 ? 'text-bull' : 'text-bear')}>
                  {pct(liveChange)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => toggleWatchlist(activeToken.id)}
              aria-pressed={watched}
              aria-label={activeToken.symbol}
              title={activeToken.symbol}
              className={cn(
                'nc-clip-sm inline-flex size-9 shrink-0 items-center justify-center border transition-colors',
                watched ? 'border-warning/60 bg-warning/12 text-warning hover:bg-warning/22' : 'border-line bg-surface/70 text-muted hover:border-primary/50 hover:text-fg',
              )}
            >
              <Star className="size-4" fill={watched ? 'currentColor' : 'none'} aria-hidden />
            </button>

            <span
              role="status"
              aria-label={tf(status)}
              title={feed?.note ? feedNoteLabel(feed.note, tf) : tf(status)}
              className={cn(
                'nc-chip inline-flex size-8 shrink-0 items-center justify-center px-0',
                connected && 'border-primary/50 text-primary',
                status === 'error' && 'border-bear/60 text-bear',
                status === 'reconnecting' && 'border-warning/60 text-warning',
              )}
            >
              {connected ? <Wifi className="size-3" aria-hidden /> : <WifiOff className="size-3" aria-hidden />}
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-2 border-t border-line/60 px-3 py-2">
            <TimeframePicker touchTargets className="flex-1" />
            <button
              type="button"
              data-mobile-controls-trigger
              aria-haspopup="dialog"
              aria-expanded={mobileControlsOpen}
              onClick={() => setMobileControlsOpen(true)}
              className="nc-clip-sm inline-flex h-9 shrink-0 items-center gap-1.5 border border-primary/50 bg-primary/10 px-2.5 font-mono text-2xs uppercase tracking-cyber text-primary transition-colors hover:bg-primary/18"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              {t('menus.controls')}
            </button>
          </div>
        </div>

        {/* Full-density workspace toolbar stays available on wide screens. */}
        <div className="hidden xl:block">
          <div className="flex items-center gap-2 overflow-x-auto px-3 py-2.5 [&>*]:shrink-0">
            {/* live symbol + price */}
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-display text-base font-extrabold tracking-tight">
                {activeToken.symbol}
              </span>
              <span className={cn('font-mono text-sm tabular-nums', livePrice != null ? 'text-primary' : 'text-faint')}>
                {usd(livePrice)}
              </span>
              {liveChange != null && (
                <span className={cn('font-mono text-2xs tabular-nums', liveChange >= 0 ? 'text-bull' : 'text-bear')}>
                  {pct(liveChange)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => toggleWatchlist(activeToken.id)}
              aria-pressed={watched}
              className={cn(
                'nc-clip-sm inline-flex size-9 items-center justify-center border transition-colors',
                watched ? 'border-warning/60 bg-warning/12 text-warning hover:bg-warning/22' : 'border-line bg-surface/70 text-muted hover:border-primary/50 hover:text-fg',
              )}
            >
              <Star className="size-4" fill={watched ? 'currentColor' : 'none'} aria-hidden />
              <span className="sr-only">{activeToken.symbol}</span>
            </button>

            {/* feed status */}
            <span
              className={cn(
                'nc-chip shrink-0',
                connected && 'border-primary/50 text-primary',
                status === 'error' && 'border-bear/60 text-bear',
                status === 'reconnecting' && 'border-warning/60 text-warning',
              )}
              title={feed?.note ?? undefined}
            >
              {connected ? <Wifi className="size-3" aria-hidden /> : <WifiOff className="size-3" aria-hidden />}
              {tf(status)}
              {feed?.note ? ` · ${feedNoteLabel(feed.note, tf)}` : ''}
              {status === 'reconnecting' && feed ? ` · ${tf('attempt', { n: feed.attempt })}` : ''}
            </span>

            {/* which venue is feeding this chart – and why */}
            {selection && (
              <ExchangePicker
                symbol={activeToken.symbol}
                timeframe={timeframe}
                selected={selection.exchange}
                rerouted={selection.rerouted}
              />
            )}

            {activeToken.venue === 'DEX' && dexQuote?.tokenId === activeToken.id && (
              <span className="nc-chip hidden shrink-0 md:inline-flex" title={dexQuote.poolName ?? undefined}>
                {dexQuote.chain} · {compactUsd(dexQuote.liquidityUsd)} liq
              </span>
            )}

            <div className="mx-1 hidden h-6 w-px bg-line sm:block" />
            <TimeframePicker />

            {/* panel toggles + layouts */}
            <div role="group" aria-label={tn('layouts')} className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={toggleOnChain}
                aria-pressed={onChainOpen}
                aria-label={toc('button')}
                title={toc('button')}
                data-testid="onchain-toggle"
                className={cn(
                  'nc-clip-sm inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors',
                  onChainOpen
                    ? 'border-primary/60 bg-primary/12 text-primary shadow-[0_0_10px_-2px_hsl(var(--nc-primary)/0.7)] hover:bg-primary/22'
                    : 'border-line bg-surface/50 text-muted hover:border-primary/50 hover:text-fg',
                )}
              >
                <Radar className="size-3" aria-hidden />
                <span className="hidden sm:inline">{toc('button')}</span>
              </button>
              <button
                type="button"
                onClick={togglePro}
                aria-pressed={proOpen}
                aria-label={tp('button')}
                title={tp('button')}
                data-testid="pro-toggle"
                className={cn(
                  'nc-clip-sm inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors',
                  proOpen
                    ? 'border-secondary/60 bg-secondary/12 text-secondary shadow-[0_0_10px_-2px_hsl(var(--nc-secondary)/0.7)] hover:bg-secondary/22'
                    : 'border-line bg-surface/50 text-muted hover:border-secondary/50 hover:text-fg',
                )}
              >
                <Gauge className="size-3" aria-hidden />
                <span className="hidden sm:inline">{tp('button')}</span>
              </button>
              {LAYOUT_IDS.map((id) => (
                <Chip key={id} active={hydrated && id === layout} onClick={() => chooseLayout(id)}>
                  <LayoutMini id={id} />
                  <span className="hidden sm:inline">{id}</span>
                </Chip>
              ))}

              <ToolMenu
                id="more"
                label={t('menus.more')}
                icon={LifeBuoy}
                align="right"
                engaged={whaleEnabled}
                items={moreItems}
              />
            </div>
          </div>

          {/* chart types, analysis and workspace tools */}
          <div className="flex items-center gap-1 overflow-x-auto border-t border-line/60 px-3 py-2 [&>*]:shrink-0">
            <Terminal className="mr-1 size-3.5 text-primary" aria-hidden />
            <div data-testid="chart-type-control">
              <Dropdown
                triggerLabel={t(`types.${chartType}`)}
                triggerText={<span>{t(`types.${chartType}`)}</span>}
                menuLabel={t(`types.${chartType}`)}
                align="start"
                widthClass="w-48"
                items={chartTypeItems}
              />
            </div>

            <span className="mx-1 h-6 w-px bg-line" aria-hidden />

            <ToolMenu
              id="edge"
              label={te('menuLabel')}
              icon={Sparkles}
              engaged={liqMagnetsOn || edgeLiqOpen || edgeLagOpen || edgeRegimeOpen || edgeClockOpen}
              items={edgeItems}
            />
            <ToolMenu
              id="analyse"
              label={t('menus.analyse')}
              icon={BarChart3}
              engaged={vpOn || avwapArm || avwapAnchored || srOn || divOn || patternsOnStore || ratingsOpen || heatmapOpen}
              items={analyseItems}
            />
            <ToolMenu
              id="tools"
              label={t('menus.tools')}
              icon={Wrench}
              engaged={replayOn || backtestOpen || screenerOpen || riskOpen || journalOpen || magnifierOpen || scriptLabOpen || alertsOpen}
              items={toolsItems}
            />
            <div data-testid="compare-control">
              <Dropdown
                items={compareItems}
                align="start"
                widthClass="w-44"
                triggerLabel={t('compare')}
                title={t('compare')}
                triggerText={
                  <span className="font-mono text-2xs uppercase tracking-cyber">
                    {compareToken ? compareToken.base : t('compare')}
                  </span>
                }
              />
            </div>
            <Chip active={hydrated && axisLog} onClick={toggleAxisLog}>
              {t('log')}
            </Chip>
            <Chip active={hydrated && axisPct} onClick={toggleAxisPct}>
              {t('pct')}
            </Chip>
            <span className="relative shrink-0">
              <Chip active={hydrated && watchOpen} onClick={() => setWatchOpen((value) => !value)}>
                <List className="size-3" aria-hidden />
                {t('watch')}
              </Chip>
              <WatchlistPopover open={watchOpen} onClose={() => setWatchOpen(false)} />
            </span>
            <button
              type="button"
              onClick={openSupport}
              title={t2('openTip')}
              aria-label={t2('openTip')}
              className={cn(
                'nc-clip-sm inline-flex h-7 shrink-0 items-center gap-1 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors',
                supporter
                  ? 'border-bull/60 bg-bull/12 text-bull shadow-neon-sm hover:bg-bull/22'
                  : 'border-line bg-surface/50 text-muted hover:border-secondary/60 hover:text-secondary',
              )}
            >
              <Heart className={cn('size-3', supporter && 'fill-current')} aria-hidden />
              {supporter && <span className="hidden lg:inline">{t2('supporter')}</span>}
            </button>
            {session && (
              <span
                className="nc-chip ml-auto hidden shrink-0 lg:inline-flex"
                title={`${t('session.open')} ${usd(session.open)} · ${t('session.high')} ${usd(session.high)} · ${t('session.low')} ${usd(session.low)}`}
              >
                <span className="text-faint">{t('session.title')}</span>
                <span className={session.changePct >= 0 ? 'text-bull' : 'text-bear'}>
                  {pct(session.changePct, 2)}
                </span>
                <span className="text-faint">{t('session.range')}</span>
                <span className="relative inline-block h-1.5 w-12 bg-line/60" aria-hidden>
                  <span
                    className="absolute top-0 h-full w-0.5 bg-secondary"
                    style={{ left: `${Math.min(100, Math.max(0, session.rangePosition * 100)).toFixed(0)}%` }}
                  />
                </span>
                <span className="tabular-nums text-fg">{(session.rangePosition * 100).toFixed(0)}%</span>
                {realizedVol != null && (
                  <>
                    <span className="text-faint">{t('session.rv')}</span>
                    <span className="tabular-nums text-warning">{realizedVol.toFixed(0)}%</span>
                  </>
                )}
              </span>
            )}
            <span className={cn('nc-chip hidden lg:inline-flex', session && 'lg:hidden xl:inline-flex')}>
              {(feed?.candles.length ?? dexCandles?.length ?? 0) > 0
                ? tf('candles', { n: (feed?.candles.length ?? dexCandles?.length) as number })
                : t('waiting')}
            </span>
          </div>
        </div>
      </div>

      <TerminalControlsSheet
        open={mobileControlsOpen}
        onClose={closeMobileControls}
        title={t('menus.controls')}
      >
        <ControlSection title={t('menus.chartSettings')} sectionKey="chart-settings" collapsible defaultOpen>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div data-testid="chart-type-control">
              <p className="mb-1 font-mono text-micro-10 uppercase tracking-cyber text-faint">{t('menus.chartType')}</p>
              <Dropdown
                triggerLabel={t(`types.${chartType}`)}
                triggerText={<span>{t(`types.${chartType}`)}</span>}
                menuLabel={t(`types.${chartType}`)}
                align="start"
                widthClass="w-48"
                items={chartTypeItems}
              />
            </div>
            <div data-testid="compare-control">
              <p className="mb-1 font-mono text-micro-10 uppercase tracking-cyber text-faint">{t('compare')}</p>
              <Dropdown
                items={compareItems}
                align="start"
                widthClass="w-44"
                triggerLabel={t('compare')}
                title={t('compare')}
                triggerText={
                  <span className="font-mono text-2xs uppercase tracking-cyber">
                    {compareToken ? compareToken.base : t('compare')}
                  </span>
                }
              />
            </div>
          </div>

          <div>
            <p className="mb-1 font-mono text-micro-10 uppercase tracking-cyber text-faint">{tn('layouts')}</p>
            <div role="group" aria-label={tn('layouts')} className="flex flex-wrap gap-2">
              {LAYOUT_IDS.map((id) => (
                <Chip key={id} className="h-9 px-3" active={hydrated && id === layout} onClick={() => chooseLayout(id)}>
                  <LayoutMini id={id} />
                  {id}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip className="h-9 px-3" active={hydrated && axisLog} onClick={toggleAxisLog}>{t('log')}</Chip>
            <Chip className="h-9 px-3" active={hydrated && axisPct} onClick={toggleAxisPct}>{t('pct')}</Chip>
          </div>
        </ControlSection>

        <ControlSection title={t('menus.marketPanels')} sectionKey="market-panels" collapsible defaultOpen>
          {selection && (
            <div data-testid="market-data-source" className="rounded-sm border border-line/60 bg-bg/40 p-2">
              <p className="mb-1 font-mono text-micro-10 uppercase tracking-cyber text-faint">{t('menus.dataSource')}</p>
              <ExchangePicker
                symbol={activeToken.symbol}
                timeframe={timeframe}
                selected={selection.exchange}
                rerouted={selection.rerouted}
                className="max-w-full"
              />
            </div>
          )}
          {activeToken.venue === 'DEX' && dexQuote?.tokenId === activeToken.id && (
            <p className="font-mono text-2xs text-muted" title={dexQuote.poolName ?? undefined}>
              {dexQuote.chain} · {compactUsd(dexQuote.liquidityUsd)} liq
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <ControlButton toggle active={onChainOpen} label={toc('button')} onClick={() => { closeMobileControls(); toggleOnChain(); }}>
              <Radar className="size-4 shrink-0" aria-hidden />
            </ControlButton>
            <ControlButton toggle active={proOpen} label={tp('button')} onClick={() => { closeMobileControls(); togglePro(); }}>
              <Gauge className="size-4 shrink-0" aria-hidden />
            </ControlButton>
            <ControlButton toggle active={mobileWatchOpen} label={t('watch')} onClick={() => setMobileWatchOpen((value) => !value)}>
              <List className="size-4 shrink-0" aria-hidden />
              {watchlist.length > 0 && <span className="tabular-nums">{watchlist.length}</span>}
            </ControlButton>
            <ControlButton active={supporter} label={t2('openTip')} onClick={() => { closeMobileControls(); openSupport(); }}>
              <Heart className={cn('size-4 shrink-0', supporter && 'fill-current')} aria-hidden />
            </ControlButton>
          </div>
          <WatchlistPopover
            open={mobileWatchOpen}
            onClose={() => setMobileWatchOpen(false)}
            placement="panel"
          />
        </ControlSection>

        <ControlSection title={te('menuLabel')} sectionKey="edge" collapsible>
          <MobileActionGrid items={edgeItems} onClose={closeMobileControls} />
        </ControlSection>
        <ControlSection title={t('menus.analyse')} sectionKey="analyse" collapsible>
          <MobileActionGrid items={analyseItems} onClose={closeMobileControls} />
        </ControlSection>
        <ControlSection title={t('menus.tools')} sectionKey="tools" collapsible>
          <MobileActionGrid items={toolsItems} onClose={closeMobileControls} />
        </ControlSection>
        <ControlSection title={t('menus.more')} sectionKey="more" collapsible>
          <MobileActionGrid items={moreItems} onClose={closeMobileControls} />
        </ControlSection>
        <ControlSection title={tn('theme')} sectionKey="theme" collapsible>
          <ThemeSwitcher />
        </ControlSection>
        <ControlSection title={tn('language')} sectionKey="language" collapsible>
          <LocaleSwitcher />
        </ControlSection>
      </TerminalControlsSheet>

      {/* mobile ad container (Adsterra native strip) – null without config */}
      <AdSlot variant="mobile" />

      {/* -------------------------------- grid ------------------------------ */}
      <ChartGrid />
      </div>

      {/* live on-chain signals (right dock, fetched only while open) */}
      <OnChainPanel />

      {/* PRO metrics dock (derivatives / flow / global / heat / options) */}
      <ProMetricsPanel />
      <ToastHost />
      <BacktestModal
        paneId="pane-1"
        symbol={activeToken.symbol}
        timeframe={timeframe}
        candles={sessionCandles}
        open={backtestOpen}
        onClose={() => setBacktestOpen(false)}
      />
      <ScreenerModal open={screenerOpen} onClose={() => setScreenerOpen(false)} />
      <RiskModal symbol={activeToken.symbol} lastPrice={livePrice} open={riskOpen} onClose={() => setRiskOpen(false)} />
      <PatternsModal candles={sessionCandles} open={patternsOpen} onClose={() => setPatternsOpen(false)} />
      <RatingsModal
        exchange={(selection?.exchange ?? activeToken.exchange ?? 'binance') as ExchangeId}
        symbol={activeToken.symbol}
        open={ratingsOpen}
        onClose={() => setRatingsOpen(false)}
      />
      <HeatmapModal open={heatmapOpen} onClose={() => setHeatmapOpen(false)} onPick={pickSymbol} />
      <JournalModal symbol={activeToken.symbol} open={journalOpen} onClose={() => setJournalOpen(false)} />
      <MagnifierModal
        symbol={activeToken.symbol}
        barMs={barMs}
        candles={sessionCandles}
        open={magnifierOpen}
        onClose={() => setMagnifierOpen(false)}
      />
      <ScriptLabModal candles={sessionCandles} open={scriptLabOpen} onClose={() => setScriptLabOpen(false)} />
      <EdgeLiqModal candles={sessionCandles} />
      <EdgeLagModal candles={sessionCandles} />
      <EdgeRegimeModal candles={sessionCandles} />
      <EdgeClockModal candles={sessionCandles} />
      <AlertsPanelModal
        symbol={activeToken.symbol}
        lastPrice={livePrice}
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
      />
      <SupportModal />
      <SupportNudge />
      {/* Smartlink-Kit (Terminal): Sponsored-Strip + Post-Action-Offers */}
      <SmartlinkKit surface="app" />

      {/* desktop ad container (Adsterra native rail) – null without config */}
      <AdSlot variant="desktop" />
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'nc-clip-sm inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors duration-150',
        className,
        active
          ? 'border-primary/70 bg-primary/14 text-primary shadow-neon-sm hover:bg-primary/22'
          : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function ControlButton({
  children,
  label,
  active,
  toggle = false,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  toggle?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      title={label}
      className={cn(
        'nc-clip-sm flex min-h-11 min-w-0 items-center gap-2 border px-2.5 py-2 text-left font-mono text-2xs uppercase tracking-cyber transition-colors',
        active
          ? 'border-primary/60 bg-primary/10 text-primary shadow-neon-sm'
          : 'border-line bg-bg/45 text-muted hover:border-primary/40 hover:text-fg',
      )}
    >
      <span className="flex shrink-0 items-center gap-1">{children}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          active ? 'bg-primary shadow-[0_0_8px_hsl(var(--nc-primary)/0.9)]' : 'bg-line',
        )}
      />
    </button>
  );
}

function LayoutMini({ id }: { id: ChartLayoutId }) {
  const cells = CHART_LAYOUTS[id].panes;
  return (
    <span
      aria-hidden
      className={cn('grid size-3 gap-px', cells > 2 ? 'grid-cols-2 grid-rows-2' : cells === 2 ? 'grid-cols-2' : 'grid-cols-1')}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className="bg-current opacity-70" />
      ))}
    </span>
  );
}
