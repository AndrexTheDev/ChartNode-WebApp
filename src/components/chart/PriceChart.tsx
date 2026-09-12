// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * PriceChart – one lightweight-charts instance per grid pane.
 *
 * What lives in here:
 *   • main series (candles / bars / line / area / Heikin-Ashi) + volume overlay
 *   • unlimited indicator series – overlays in pane 0, oscillators each in their
 *     own pane (`addSeries(def, opts, paneIndex)`), computed by `lib/indicators`
 *   • the NodeChart watermark (`www.NodeChart.cc`) painted into the canvas below
 *     the series, so it is part of `takeScreenshot()` and cannot be cropped
 *   • drawing tools + the mirrored crosshair, both as canvas primitives
 *   • grid sync: publishes/accepts the visible logical range and the crosshair
 *
 * Client-only; loaded through `next/dynamic` (`ssr: false`) because
 * lightweight-charts needs a real DOM.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type LogicalRange,
  type HistogramData,
  type LineData,
  type SeriesDataItemTypeMap,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { RSI as RsiCalc } from 'technicalindicators';
import { readChartTheme, withAlpha, type ChartTheme } from '@/lib/chart-theme';
import { crosshairBus, rangeBus, rangesEqual } from '@/lib/chart-sync';
import { hitTestDrawings, type XY } from '@/lib/drawings';
import { cn } from '@/lib/cn';
import { minMoveFor, pricePrecision } from '@/lib/format';
import {
  INDICATOR_LIBRARY,
  SERIES_COLORS,
  computeIndicator,
  heikinAshi,
  indicatorTitle,
  lastValue,
  type IndicatorValues,
} from '@/lib/indicators';
import {
  selectDrawings,
  selectIndicators,
  selectAlertArm,
  selectAlerts,
  selectAvwapAnchor,
  selectAvwapArm,
  selectAxisLog,
  selectAxisPct,
  selectBtMarkers,
  selectDivOn,
  selectSrOn,
  selectSyncCrosshair,
  selectSyncZoom,
  selectTool,
  selectVolume,
  selectVpOn,
  selectLiqMagnetsOn,
  useChartStore,
  type DrawingPoint,
} from '@/store/useChartStore';
import { useToastStore } from '@/store/useToastStore';
import { selectTheme, useAppStore } from '@/store/useAppStore';
import type { ChartType, Timeframe } from '@/store/types';
import { transformExotic, type ExoticType } from '@/lib/charttypes';
import { notifyAlert, beepAlert } from '@/lib/notifications';

const EXOTIC_TYPES: ChartType[] = ['renko', 'lineBreak', 'kagi', 'pnf'];
const PATTERN_TAG: Record<string, string> = {
  doubleTop: 'DT',
  doubleBottom: 'DB',
  headShoulders: 'H&S',
  invHeadShoulders: 'H&S+',
  triAsc: 'TRI+',
  triDesc: 'TRI-',
  flagBull: 'FLG+',
  flagBear: 'FLG-',
};
import type { Candle } from '@/websockets/types';
import {
  CrosshairPrimitive,
  DrawingPrimitive,
  VolumeProfilePrimitive,
  LiqMagnetPrimitive,
  WatermarkPrimitive,
  type CrosshairSource,
  type DraftShape,
} from './primitives';
import { anchoredVwap, divergences, supportResistance, volumeProfile } from '@/lib/premium';
import { buildLiqMap } from '@/lib/liqradar';

type AnySeries = ISeriesApi<SeriesType, Time>;

export interface PriceChartHandle {
  /** PNG data URL of the canvas – watermark, drawings and crosshair included. */
  toPng: () => string | null;
  fit: () => void;
}

export interface PatternMark {
  time: number;
  price: number;
  kind: string;
  bias: 'bull' | 'bear';
  confidence: number;
}

export interface PriceChartProps {
  paneId: string;
  /** Unique per mounted chart – suppresses sync echoes. */
  chartId: string;
  symbol: string;
  /** Watermark ticker, e.g. `$SOL`. */
  ticker: string;
  venue: string;
  timeframe: Timeframe;
  candles: Candle[];
  chartType: ChartType;
  status: string;
  /** Wave-4 auto pattern marks (unix-ms times), drawn as bias arrows. */
  patterns?: PatternMark[];
  /** Override for the legend interval chip (custom intervals). */
  intervalLabel?: string | null;
  /** Optional compare overlay: normalized % line of another symbol. */
  compareCandles?: Candle[];
  compareTicker?: string;
  ref?: React.Ref<PriceChartHandle>;
}

interface ComputedIndicator {
  id: string;
  kind: keyof typeof INDICATOR_LIBRARY;
  title: string;
  values: IndicatorValues | null;
  /** CUSTOM scripts may choose the price pane instead of their own. */
  overlay?: boolean;
  colorIndex: number;
}

/** Bars shown when a fresh symbol/timeframe is loaded. */
const DEFAULT_VISIBLE_BARS = 140;

/* ------------------------- incremental series updates ----------------------- */

interface AppliedBars {
  /** Identity of what the painted bars belong to (feed, type, palette, …). */
  scope: string;
  len: number;
  lastT: number;
}

/*
 * Transport-Typ fuer Balkenpunkte: der volle Daten-Union von lightweight-charts
 * (Candlestick | Bar | Line | Area | Histogram | …). Frueher war das eine lose
 * Form (`{ time: number } & Record<string, unknown>`), die `as unknown as`-
 * Casts an jeder Series-Grenze erzwang. Mit dem echten Union typen
 * `update()`/`setData()` direkt durch – ohne Cast, ohne `any`.
 */
type BarPoint = SeriesDataItemTypeMap<Time>[SeriesType];

/**
 * 60 fps tail-apply for live feeds.
 *
 * A WebSocket tick mutates exactly one bar (the forming one) or appends one.
 * `ISeriesApi.update()` replaces/appends that single bar in O(1), while
 * `setData()` rebuilds the series' whole plot list and invalidates the entire
 * pane – with 4 panes × (candles + volume + N indicators) at several ticks per
 * second that is the difference between smooth and janky.
 *
 * Falls back to a full `setData()` whenever the structure genuinely changed:
 * new feed/symbol/timeframe, palette flip, shrunken history (Renko repaint,
 * re-seed) or a time gap between the old tail and the new prefix.
 */
function applyBars(
  series: AnySeries,
  points: BarPoint[],
  applied: AppliedBars | null,
  scope: string,
): AppliedBars | null {
  const last = points[points.length - 1];
  const lastT = last ? Number(last.time) : 0;
  const next: AppliedBars | null = points.length > 0 ? { scope, len: points.length, lastT } : null;

  const tailUsable =
    applied !== null &&
    applied.scope === scope &&
    points.length >= applied.len &&
    (applied.len === 0 || Number(points[applied.len - 1]?.time) === applied.lastT);

  if (tailUsable && applied) {
    // Equal length + equal tail time ⇒ the forming bar ticked: rewrite it.
    const start = points.length === applied.len && lastT === applied.lastT ? applied.len - 1 : applied.len;
    for (let i = Math.max(0, start); i < points.length; i += 1) {
      const point = points[i];
      if (point) series.update(point);
    }
    return next;
  }

  series.setData(points);
  return next;
}

/** Timeframe → milliseconds, for the bar-close countdown. */
const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

/** Alert ids already toasted in this page session – panes share alerts. */
const announcedAlerts = new Set<string>();

export function PriceChart({
  paneId,
  chartId,
  symbol,
  timeframe,
  candles,
  chartType,
  patterns,
  intervalLabel,
  status,
  compareCandles,
  compareTicker,
  ref,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<AnySeries | null>(null);
  const volumeRef = useRef<AnySeries | null>(null);
  const indicatorSeriesRef = useRef<Map<string, AnySeries>>(new Map());
  const drawingPrimRef = useRef<DrawingPrimitive | null>(null);
  const crosshairPrimRef = useRef<CrosshairPrimitive | null>(null);
  const watermarkPrimRef = useRef<WatermarkPrimitive | null>(null);
  const vpPrimRef = useRef<VolumeProfilePrimitive | null>(null);
  const liqPrimRef = useRef<LiqMagnetPrimitive | null>(null);
  const avwapRef = useRef<AnySeries | null>(null);
  const compareRef = useRef<AnySeries | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const srLinesRef = useRef<IPriceLine[]>([]);
  const alertLinesRef = useRef<IPriceLine[]>([]);
  const applyingRemoteRange = useRef(false);
  const rangedFor = useRef<string | null>(null);
  // Tail-apply bookkeeping (see `applyBars`): what each series currently paints.
  const mainAppliedRef = useRef<AppliedBars | null>(null);
  const volumeAppliedRef = useRef<AppliedBars | null>(null);
  const indicatorAppliedRef = useRef<Map<string, AppliedBars | null>>(new Map());
  const avwapAppliedRef = useRef<AppliedBars | null>(null);
  const compareAppliedRef = useRef<AppliedBars | null>(null);
  // Signatur-Guards: identische Analyse-Ergebnisse dürfen keine Series-API
  // aufrufen (createPriceLine/setMarkers invalidieren den Chart jedes Mal).
  const srSigRef = useRef<string | null>(null);
  const markerSigRef = useRef<string | null>(null);
  const baselineBaseRef = useRef<number | null>(null);
  // Timestamps der aktuell in der Main-Serie liegenden Bars (Sekunden). Marker
  // müssen exakt mit einem Datenpunkt zusammenfallen, sonst wirft
  // lightweight-charts bzw. zeichnet ins Leere.
  const seriesTimesRef = useRef<Set<number> | null>(null);

  const themeId = useAppStore(selectTheme);
  const chartTheme = useMemo(() => readChartTheme(themeId), [themeId]);

  /*
   * rAF-coalesced Analyse-Snapshot.
   *
   * WS-Ticks kommen bei BTC & Co. mehrfach pro Sekunde an; jeder erzeugt eine
   * neue `candles`-Identität. Die Haupt-/Volumen-Serien hängen direkt an
   * `candles` (O(1)-Tail-Update über `applyBars`, sofort sichtbar), aber alle
   * ABGELEITETEN Analysen (Indikatoren, Volume Profile, Liq Radar, S/R,
   * Divergenzen, aVWAP) rechnen auf diesem Snapshot: höchstens einmal pro
   * Frame, gebündelt über requestAnimationFrame – der 60-fps-Deckel für die
   * Mathe-Pipeline. Mehrere Ticks innerhalb eines Frames kosten so genau
   * einen Recompute.
   */
  const [analysisCandles, setAnalysisCandles] = useState(candles);
  useEffect(() => {
    if (candles === analysisCandles) return;
    const raf = requestAnimationFrame(() => setAnalysisCandles(candles));
    return () => cancelAnimationFrame(raf);
    // analysisCandles absichtlich nicht in den Deps: Der Effekt koalesziert
    // nur die eingehenden Prop-Wechsel (Standard-rAF-Throttle-Pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  const indicators = useChartStore(selectIndicators(paneId));
  const drawings = useChartStore(selectDrawings(paneId));
  const tool = useChartStore(selectTool);
  const volumeOn = useChartStore(selectVolume);
  const vpOn = useChartStore(selectVpOn);
  const liqOn = useChartStore(selectLiqMagnetsOn);
  const avwapArm = useChartStore(selectAvwapArm);
  const avwapAnchor = useChartStore(selectAvwapAnchor(paneId));
  const setAvwapArm = useChartStore((s) => s.setAvwapArm);
  const setAvwapAnchor = useChartStore((s) => s.setAvwapAnchor);
  const srOn = useChartStore(selectSrOn);
  const divOn = useChartStore(selectDivOn);
  const axisLog = useChartStore(selectAxisLog);
  const axisPct = useChartStore(selectAxisPct);
  const btMarkers = useChartStore(selectBtMarkers(paneId));
  const alertArm = useChartStore(selectAlertArm);
  const alerts = useChartStore(selectAlerts);
  const addAlert = useChartStore((s) => s.addAlert);
  const fireAlert = useChartStore((s) => s.fireAlert);
  const syncCrosshair = useChartStore(selectSyncCrosshair);
  const syncZoom = useChartStore(selectSyncZoom);
  const selectedId = useChartStore((s) => s.selected[paneId] ?? null);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const setSelected = useChartStore((s) => s.setSelected);
  const setTool = useChartStore((s) => s.setTool);

  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [remote, setRemote] = useState<{ time: number | null; price: number | null; symbol: string }>({
    time: null,
    price: null,
    symbol: '',
  });

  const dragRef = useRef<{
    mode: 'create' | 'move' | null;
    start: XY | null;
    drawingId: string | null;
    origin: [DrawingPoint, DrawingPoint] | null;
  }>({ mode: null, start: null, drawingId: null, origin: null });

  // Live values for callbacks registered once (avoids re-creating the chart).
  // Written from an effect – React forbids ref mutation during render.
  const candlesRef = useRef(candles);
  const symbolRef = useRef(symbol);
  const syncZoomRef = useRef(syncZoom);
  const feedKeyRef = useRef('');
  const feedKey = `${symbol}:${timeframe}`;

  useEffect(() => {
    candlesRef.current = candles;
    symbolRef.current = symbol;
    syncZoomRef.current = syncZoom;
    feedKeyRef.current = feedKey;
  });

  const digits = useMemo(() => pricePrecision(candles[candles.length - 1]?.c ?? null), [candles]);
  const lastCandle = candles[candles.length - 1] ?? null;
  const shown = hover ?? lastCandle;

  // TradingView-style countdown to the bar close (basic there, polished here).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const barCountdown = useMemo(() => {
    if (!lastCandle) return null;
    const span = TF_MS[timeframe];
    if (!span) return null;
    const left = Math.max(0, lastCandle.t + span - nowMs);
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const sec = Math.floor((left % 60_000) / 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }, [lastCandle, nowMs, timeframe]);

  /* ---------------------------- indicator maths ---------------------------- */

  const computed = useMemo<ComputedIndicator[]>(() => {
    const counts = new Map<string, number>();
    return indicators
      .filter((entry) => entry.visible)
      .map((entry) => {
        const index = counts.get(entry.kind) ?? 0;
        counts.set(entry.kind, index + 1);
        return {
          id: entry.id,
          kind: entry.kind,
          title: indicatorTitle(entry.kind, entry.params),
          values: computeIndicator(entry.kind, analysisCandles, entry.params, entry.script),
          overlay: entry.kind === 'CUSTOM' && entry.params.overlay === 1,
          colorIndex: index,
        };
      });
  }, [indicators, analysisCandles]);

  /** Changing this string means series have to be created/removed. */
  const structureKey = useMemo(
    () =>
      indicators
        .filter((entry) => entry.visible)
        .map((entry) => `${entry.id}:${entry.kind}:${JSON.stringify(entry.params)}`)
        .join('|'),
    [indicators],
  );

  /* --------------------------------- mount --------------------------------- */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const previousRange = chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
    const indicatorSeries = indicatorSeriesRef.current;
    rangedFor.current = null;

    const appliedMap = indicatorAppliedRef.current;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.bg },
        textColor: chartTheme.muted,
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      grid: {
        vertLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
        horzLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: chartTheme.accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: chartTheme.accent },
        horzLine: { color: chartTheme.accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: chartTheme.accent },
      },
      rightPriceScale: { borderColor: chartTheme.border, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: chartTheme.border, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });

    chartRef.current = chart;
    mainRef.current = createMainSeries(chart, chartType, chartTheme, digits, candlesRef.current[0]?.c ?? 1);

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'nc-volume',
      lastValueVisible: false,
      priceLineVisible: false,
    }) as AnySeries;
    chart.priceScale('nc-volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeRef.current = volume;

    /* ------------------------------- primitives ------------------------------ */
    const main = mainRef.current;

    const watermark = new WatermarkPrimitive();
    main.attachPrimitive(watermark);
    watermarkPrimRef.current = watermark;

    const drawingPrim = new DrawingPrimitive();
    main.attachPrimitive(drawingPrim);
    drawingPrimRef.current = drawingPrim;

    const crosshairPrim = new CrosshairPrimitive();
    main.attachPrimitive(crosshairPrim);
    crosshairPrimRef.current = crosshairPrim;

    // Volume Profile Visible Range – premium analytics, painted in-canvas.
    const vpPrim = new VolumeProfilePrimitive();
    main.attachPrimitive(vpPrim);
    vpPrimRef.current = vpPrim;

    // Wave-7 Liq Radar – liquidation-magnet bands, painted in-canvas.
    const liqPrim = new LiqMagnetPrimitive();
    main.attachPrimitive(liqPrim);
    liqPrimRef.current = liqPrim;

    /* --------------------------------- syncing ------------------------------- */
    const timeScale = chart.timeScale();

    timeScale.subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
      if (!range || applyingRemoteRange.current || !syncZoomRef.current) return;
      rangeBus.publish({ source: chartId, range: { from: range.from, to: range.to } });
    });

    chart.subscribeCrosshairMove((param) => {
      const logical = param.logical != null ? Number(param.logical) : null;
      const list = candlesRef.current;
      setHover(logical !== null && logical >= 0 && logical < list.length ? (list[logical] ?? null) : null);

      const price =
        param.point && mainRef.current ? Number(mainRef.current.coordinateToPrice(param.point.y)) : Number.NaN;
      crosshairBus.publish({
        source: chartId,
        time: param.time != null ? Number(param.time) : null,
        logical,
        price: Number.isFinite(price) ? price : null,
        paneIndex: param.paneIndex ?? 0,
        symbol: symbolRef.current,
      });
    });

    const offRange = rangeBus.subscribe((message) => {
      if (message.source === chartId || !syncZoomRef.current) return;
      const current = chart.timeScale().getVisibleLogicalRange();
      if (rangesEqual(current, message.range)) return;
      applyingRemoteRange.current = true;
      chart.timeScale().setVisibleLogicalRange({ from: message.range.from, to: message.range.to });
      applyingRemoteRange.current = false;
    });

    const offCrosshair = crosshairBus.subscribe((message) => {
      if (message.source === chartId) return;
      // In einem 2x2-Grid feuert jede Mausbewegung in EINEM Pane drei Bus-
      // Messages; identische Werte dürfen keinen Re-Render auslösen.
      setRemote((prev) =>
        prev.time === message.time && prev.price === message.price && prev.symbol === message.symbol
          ? prev
          : { time: message.time, price: message.price, symbol: message.symbol },
      );
    });

    // A chart mounted into an already-synced grid adopts the current view.
    if (previousRange) {
      timeScale.setVisibleLogicalRange(previousRange);
      rangedFor.current = feedKeyRef.current;
    } else {
      rangeBus.replay((message) => {
        if (message.source === chartId) return;
        applyingRemoteRange.current = true;
        timeScale.setVisibleLogicalRange({ from: message.range.from, to: message.range.to });
        applyingRemoteRange.current = false;
        rangedFor.current = feedKeyRef.current;
      }, chartId);
    }

    return () => {
      offRange();
      offCrosshair();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volumeRef.current = null;
      indicatorSeries.clear();
      drawingPrimRef.current = null;
      crosshairPrimRef.current = null;
      watermarkPrimRef.current = null;
      vpPrimRef.current = null;
      liqPrimRef.current = null;
      avwapRef.current = null;
      compareRef.current = null;
      markersRef.current = null;
      srLinesRef.current = [];
      alertLinesRef.current = [];
      // Fresh series ⇒ forget what was painted, so the next effect re-seeds
      // with a full setData instead of tail-updating a dead series.
      mainAppliedRef.current = null;
      volumeAppliedRef.current = null;
      appliedMap.clear();
      avwapAppliedRef.current = null;
      compareAppliedRef.current = null;
      srSigRef.current = null;
      markerSigRef.current = null;
      baselineBaseRef.current = null;
    };
    // Rebuilt only when the series *type* changes – everything else is applied
    // incrementally below, so candle ticks never recreate the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, chartId]);

  /* --------------------------------- data ---------------------------------- */

  useEffect(() => {
    const main = mainRef.current;
    const chart = chartRef.current;
    if (!main || !chart) return;

    const source =
      chartType === 'heikinAshi'
        ? heikinAshi(candles)
        : EXOTIC_TYPES.includes(chartType)
          ? transformExotic(chartType as ExoticType, candles)
          : candles;
    const { bull, bear } = chartTheme;

    // Scope identity: any structural change (feed, chart type, palette flip)
    // forces a full repaint; plain ticks take the O(1) tail path.
    const scope = `${chartId}|${feedKey}|${chartType}|${bull}|${bear}`;

    if (chartType === 'line' || chartType === 'area' || chartType === 'baseline') {
      mainAppliedRef.current = applyBars(
        main,
        source.map((c) => ({ time: (c.t / 1000) as UTCTimestamp, value: c.c })),
        mainAppliedRef.current,
        scope,
      );
    } else {
      mainAppliedRef.current = applyBars(
        main,
        source.map((c) => ({
          time: (c.t / 1000) as UTCTimestamp,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
          color: c.c >= c.o ? bull : bear,
        })),
        mainAppliedRef.current,
        scope,
      );
    }

    const times = new Set<number>(source.map((c) => c.t / 1000));
    seriesTimesRef.current = times;

    if (volumeRef.current) {
      volumeAppliedRef.current = applyBars(
        volumeRef.current,
        volumeOn
          ? (source.map((c) => ({
              time: (c.t / 1000) as UTCTimestamp,
              value: c.v,
              color: withAlpha(c.c >= c.o ? bull : bear, 0.35),
            })))
          : [],
        volumeAppliedRef.current,
        `${scope}|vol:${volumeOn ? 1 : 0}`,
      );
    } else {
      volumeAppliedRef.current = null;
    }

    // First paint of a new symbol/timeframe → show the most recent N bars.
    if (source.length > 0 && rangedFor.current !== feedKey) {
      rangedFor.current = feedKey;
      const to = source.length + 6;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, to - DEFAULT_VISIBLE_BARS), to });
    }
  }, [candles, chartType, chartTheme, volumeOn, feedKey, chartId]);

  /* ------------------------- indicator series structure ---------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of indicatorSeriesRef.current.values()) {
      try {
        chart.removeSeries(series);
      } catch {
        // pane already gone
      }
    }
    indicatorSeriesRef.current.clear();
    for (let i = chart.panes().length - 1; i >= 1; i -= 1) chart.removePane(i);

    let paneCursor = 1;
    const paneOf = new Map<string, number>();

    for (const entry of computed) {
      const def = INDICATOR_LIBRARY[entry.kind];
      if (!def) continue;

      let paneIndex = 0;
      if (!entry.overlay && def.placement === 'pane') {
        const existing = paneOf.get(entry.id);
        if (existing === undefined) {
          paneOf.set(entry.id, paneCursor);
          paneIndex = paneCursor;
          paneCursor += 1;
        } else {
          paneIndex = existing;
        }
      }

      def.outputs.forEach((output, outputIndex) => {
        const color = SERIES_COLORS[(entry.colorIndex + outputIndex) % SERIES_COLORS.length] ?? output.color;
        const series =
          output.style === 'histogram'
            ? (chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, color }, paneIndex) as AnySeries)
            : (chart.addSeries(
                LineSeries,
                {
                  color,
                  lineWidth: (output.width ?? 1) as 1 | 2 | 3 | 4,
                  lineStyle: output.dashed ? LineStyle.Dashed : LineStyle.Solid,
                  crosshairMarkerVisible: false,
                  lastValueVisible: false,
                  priceLineVisible: false,
                },
                paneIndex,
              ) as AnySeries);

        indicatorSeriesRef.current.set(`${entry.id}:${output.key}`, series);

        if (def.placement === 'pane') {
          const pane = chart.panes()[paneIndex];
          pane?.setHeight(def.paneHeight ?? 130);
          if (def.scale) {
            const range = def.scale;
            series.applyOptions({
              autoscaleInfoProvider: () => ({ priceRange: { minValue: range.min, maxValue: range.max } }),
            });
          }
          for (const level of def.levels ?? []) {
            series.createPriceLine({
              price: level,
              color: withAlpha(chartTheme.faint, 0.7),
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: '',
            });
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, chartType, chartId]);

  /* --------------------------- indicator series data ------------------------- */

  useEffect(() => {
    for (const entry of computed) {
      const def = INDICATOR_LIBRARY[entry.kind];
      if (!def || !entry.values) continue;
      def.outputs.forEach((output, outputIndex) => {
        const series = indicatorSeriesRef.current.get(`${entry.id}:${output.key}`);
        const values = entry.values?.[output.key];
        if (!series || !values) return;
        const color = SERIES_COLORS[(entry.colorIndex + outputIndex) % SERIES_COLORS.length] ?? output.color;
        const seriesKey = `${entry.id}:${output.key}`;
        indicatorAppliedRef.current.set(
          seriesKey,
          applyBars(
            series,
            mapSeries(analysisCandles, values, output.style, color),
            indicatorAppliedRef.current.get(seriesKey) ?? null,
            `${chartId}|${feedKey}|${seriesKey}|${color}`,
          ),
        );
      });
    }
  }, [computed, analysisCandles, chartId, feedKey]);

  /* ------------------------------ drawing source ---------------------------- */

  useEffect(() => {
    drawingPrimRef.current?.setSource({
      drawings,
      draft,
      selectedId: tool === 'none' ? selectedId : null,
      theme: chartTheme,
      digits,
    });
  }, [drawings, draft, selectedId, tool, chartTheme, digits]);

  /* --------------------- volume profile + anchored VWAP --------------------- */

  useEffect(() => {
    const prim = vpPrimRef.current;
    if (!prim) return;
    if (!vpOn) {
      prim.setSource(null);
      return;
    }
    const profile = volumeProfile(analysisCandles);
    if (!profile) {
      prim.setSource(null);
      return;
    }
    prim.setSource({
      ...profile,
      area: withAlpha(chartTheme.accent, 0.34),
      outside: withAlpha(chartTheme.secondary, 0.16),
      level: withAlpha(chartTheme.accent, 0.85),
    });
  }, [vpOn, analysisCandles, chartTheme]);

  /* ------------------------- wave-7: liquidation magnets ------------------- */

  useEffect(() => {
    const prim = liqPrimRef.current;
    if (!prim) return;
    if (!liqOn) {
      prim.setSource(null);
      return;
    }
    const map = buildLiqMap(analysisCandles);
    if (!map) {
      prim.setSource(null);
      return;
    }
    prim.setSource({
      buckets: map.buckets,
      halfPct: 0.0012,
      longBase: chartTheme.bull,
      shortBase: chartTheme.bear,
      label: withAlpha(chartTheme.text, 0.72),
    });
  }, [liqOn, analysisCandles, chartTheme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (avwapAnchor == null) {
      if (avwapRef.current) {
        chart.removeSeries(avwapRef.current);
        avwapRef.current = null;
      }
      avwapAppliedRef.current = null;
      return;
    }
    if (!avwapRef.current) {
      avwapRef.current = chart.addSeries(LineSeries, {
        color: '#ffb020',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'aVWAP',
      }) as AnySeries;
    }
    const points = anchoredVwap(analysisCandles, avwapAnchor);
    avwapAppliedRef.current = applyBars(
      avwapRef.current,
      points.map((point) => ({ time: (point.time / 1000) as UTCTimestamp, value: point.value })),
      avwapAppliedRef.current,
      `${chartId}|${feedKey}|avwap:${avwapAnchor}`,
    );
  }, [avwapAnchor, analysisCandles, chartId, feedKey]);

  /* ------------------------- axis modes + bar countdown ---------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({
      // v5: percent axis is a scale MODE, not a flag – pct wins over log.
      mode: axisPct ? PriceScaleMode.Percentage : axisLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [axisLog, axisPct]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || chartType !== 'baseline') {
      baselineBaseRef.current = null;
      return;
    }
    const base = analysisCandles[0]?.c;
    // applyOptions invalidiert den Chart – nur bei echter Änderung aufrufen,
    // nicht pro Tick (der Basispreis ist die erste Kerze des Buffers).
    if (base != null && base > 0 && base !== baselineBaseRef.current) {
      baselineBaseRef.current = base;
      main.applyOptions({ baseValue: { type: 'price', price: base } } as never);
    }
  }, [chartType, analysisCandles]);

  /* -------------- auto support/resistance · divergences · alerts -------------- */

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const levels = srOn ? supportResistance(analysisCandles) : [];
    // createPriceLine/removePriceLine invalidieren den Chart – bei jedem Tick
    // den ganzen Satz neu zu bauen kostet Frames, obwohl sich S/R-Level nur
    // alle paar Kerzen ändern. Signatur-Vergleich first, API call second.
    const signature = levels.map((l) => `${l.kind}:${l.price.toFixed(6)}:${l.touches}`).join('|');
    if (signature === srSigRef.current) return;
    srSigRef.current = signature;

    for (const line of srLinesRef.current) main.removePriceLine(line);
    srLinesRef.current = [];
    for (const level of levels) {
      srLinesRef.current.push(
        main.createPriceLine({
          price: level.price,
          color: level.kind === 'support' ? chartTheme.bull : chartTheme.bear,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${level.kind === 'support' ? 'S' : 'R'}×${level.touches}`,
        }),
      );
    }
  }, [srOn, analysisCandles, chartTheme]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (!markersRef.current) markersRef.current = createSeriesMarkers(main, []);

    const markers: SeriesMarker<Time>[] = [];

    // Divergenzen sind das einzige Marker-Signal hinter dem Divergenz-Toggle.
    // Patterns und Backtest-Fills gehören nicht dazu – die wurden bisher
    // mitgeklemmt, wenn `divOn` aus war.
    if (divOn && analysisCandles.length >= 30) {
      const rsiValues = RsiCalc.calculate({
        period: 14,
        values: analysisCandles.map((candle) => candle.c),
      });
      const offset = analysisCandles.length - rsiValues.length;
      const rsi: (number | undefined)[] = new Array(analysisCandles.length).fill(undefined);
      rsiValues.forEach((value, index) => {
        rsi[index + offset] = value;
      });
      const found = divergences(analysisCandles, rsi);
      for (const div of found) {
        markers.push({
          time: (analysisCandles[div.index]!.t / 1000) as UTCTimestamp,
          position: div.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: div.type === 'bullish' ? chartTheme.bull : chartTheme.bear,
          shape: div.type === 'bullish' ? 'arrowUp' : 'arrowDown',
          text: div.type === 'bullish' ? 'DIV+' : 'DIV−',
        });
      }
    }

    for (const pat of patterns ?? []) {
      markers.push({
        time: (pat.time / 1000) as UTCTimestamp,
        position: pat.bias === 'bull' ? 'belowBar' : 'aboveBar',
        color: pat.bias === 'bull' ? chartTheme.bull : chartTheme.bear,
        shape: pat.bias === 'bull' ? 'arrowUp' : 'arrowDown',
        text: PATTERN_TAG[pat.kind] ?? 'PAT',
      });
    }
    for (const mark of btMarkers ?? []) {
      markers.push({
        time: (mark.time / 1000) as UTCTimestamp,
        position: mark.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: mark.side === 'buy' ? chartTheme.bull : '#ffb020',
        shape: mark.side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: mark.side === 'buy' ? 'LONG' : 'EXIT',
      });
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    const times = seriesTimesRef.current;
    const usable = times ? markers.filter((m) => times.has(m.time as number)) : markers;

    // setMarkers() erzwingt einen vollen Marker-Repaint – identischer Inhalt
    // pro Tick war einer der größten vermeidbaren Costs im Live-Betrieb.
    const signature = usable.map((m) => `${m.time}:${m.position}:${m.text}:${m.color}`).join('|');
    if (signature === markerSigRef.current) return;
    markerSigRef.current = signature;
    markersRef.current.setMarkers(usable);
  }, [divOn, btMarkers, patterns, analysisCandles, chartTheme, chartType]);

  const myAlerts = useMemo(() => alerts.filter((alert) => alert.symbol === symbol), [alerts, symbol]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    for (const line of alertLinesRef.current) main.removePriceLine(line);
    alertLinesRef.current = [];
    for (const alert of myAlerts) {
      if (alert.fired) continue;
      alertLinesRef.current.push(
        main.createPriceLine({
          price: alert.price,
          color: '#ffb020',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'ALERT',
        }),
      );
    }
  }, [myAlerts]);

  useEffect(() => {
    const last = candles[candles.length - 1]?.c;
    if (last == null) return;
    for (const alert of myAlerts) {
      if (alert.fired || announcedAlerts.has(alert.id)) continue;
      const c1 = alert.dir === 'above' ? last >= alert.price : last <= alert.price;
      const c2 =
        !alert.cond2 || (alert.cond2.dir === 'above' ? last >= alert.cond2.price : last <= alert.cond2.price);
      if (!(c1 && c2)) continue;
      announcedAlerts.add(alert.id);
      fireAlert(alert.id);
      notifyAlert(`${symbol} ALERT`, `${symbol} ${last.toFixed(digits)} · ${alert.note ?? alert.price.toFixed(digits)}`);
      beepAlert();
      useToastStore
        .getState()
        .push(
          `${symbol} hit ${alert.dir === 'above' ? '≥' : '≤'} ${alert.price.toFixed(digits)} (${last.toFixed(digits)})`,
          alert.dir === 'above' ? 'bull' : 'bear',
          10_000,
        );
    }
  }, [candles, myAlerts, fireAlert, symbol, digits]);

  /* ------------------------------ compare overlay --------------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!compareTicker || !compareCandles || compareCandles.length < 2) {
      if (compareRef.current) {
        chart.removeSeries(compareRef.current);
        compareRef.current = null;
      }
      compareAppliedRef.current = null;
      return;
    }
    if (!compareRef.current) {
      compareRef.current = chart.addSeries(LineSeries, {
        color: '#7c5cff', // SERIES_COLORS violet – palette consistency
        lineWidth: 2,
        priceScaleId: 'compare',
        priceLineVisible: false,
        lastValueVisible: false,
        title: `${compareTicker} %`,
      }) as AnySeries;
    }
    const base = compareCandles[0]!.c;
    compareAppliedRef.current = applyBars(
      compareRef.current,
      compareCandles.map((candle) => ({
        time: (candle.t / 1000) as UTCTimestamp,
        value: base > 0 ? (candle.c / base - 1) * 100 : 0,
      })),
      compareAppliedRef.current,
      `${chartId}|cmp:${compareTicker}|${compareCandles[0]?.t ?? 0}`,
    );
  }, [compareTicker, compareCandles, chartId]);

  /* -------------------------------- watermark ------------------------------- */

  useEffect(() => {
    watermarkPrimRef.current?.setSource({
      // TradingView-style centre mark – the URL only, fitted to the pane so
      // it never overlaps the legend, axes or pane chrome.
      ticker: 'www.NodeChart.cc',
      caption: '',
      primary: chartTheme.primary,
      accent: chartTheme.accent,
      alpha: 0.12,
    });
  }, [chartTheme]);

  /* ------------------------------ theme updates ----------------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main) return;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.bg },
        textColor: chartTheme.muted,
      },
      grid: {
        vertLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
        horzLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
      },
      rightPriceScale: { borderColor: chartTheme.border },
      timeScale: { borderColor: chartTheme.border },
      crosshair: {
        vertLine: { color: chartTheme.accent, labelBackgroundColor: chartTheme.accent },
        horzLine: { color: chartTheme.accent, labelBackgroundColor: chartTheme.accent },
      },
    });
    applySeriesColors(main, chartType, chartTheme);
  }, [chartTheme, chartType]);

  /* ---------------------------- remote crosshair ---------------------------- */

  useEffect(() => {
    const source: CrosshairSource =
      !syncCrosshair || remote.time === null
        ? { time: null, price: null, sameSymbol: false, color: chartTheme.accent, digits, label: null }
        : {
            time: remote.time,
            price: remote.price,
            sameSymbol: remote.symbol === symbol,
            color: chartTheme.accent,
            digits,
            label: remote.symbol === symbol ? null : remote.symbol,
          };
    crosshairPrimRef.current?.setSource(source);
  }, [remote, syncCrosshair, chartTheme, digits, symbol]);

  /* --------------------------- drawing interaction -------------------------- */

  const panePoint = useCallback((event: { clientX: number; clientY: number }): XY | null => {
    const paneEl = chartRef.current?.panes()[0]?.getHTMLElement();
    if (!paneEl) return null;
    const rect = paneEl.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const lockChart = useCallback((locked: boolean) => {
    chartRef.current?.applyOptions({ handleScroll: !locked, handleScale: !locked });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const prim = drawingPrimRef.current;
      if (!prim) return;
      const at = panePoint(event);
      if (!at) return;

      // Price alert: while armed, a click drops an alert at that level.
      if (alertArm) {
        const point = prim.fromXY(at.x, at.y);
        if (point) {
          const last = candlesRef.current[candlesRef.current.length - 1]?.c ?? point.price;
          addAlert(symbolRef.current, point.price, last);
        }
        return;
      }

      // Anchored VWAP: while armed, a click drops the anchor instead of drawing.
      if (avwapArm) {
        const point = prim.fromXY(at.x, at.y);
        if (point) {
          setAvwapAnchor(paneId, Math.round(point.time * 1000));
          setAvwapArm(false);
        }
        return;
      }

      const hit = hitTestDrawings(drawings, prim.toXY, at);

      if (tool === 'eraser') {
        if (hit) removeDrawing(paneId, hit.id);
        return;
      }

      if (tool === 'none') {
        setSelected(paneId, hit?.id ?? null);
        if (hit) {
          dragRef.current = { mode: 'move', start: at, drawingId: hit.id, origin: hit.points };
          lockChart(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        return;
      }

      const point = prim.fromXY(at.x, at.y);
      if (!point) return;
      dragRef.current = { mode: 'create', start: at, drawingId: null, origin: null };
      lockChart(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraft({
        tool,
        points: [point, point],
        color: SERIES_COLORS[drawings.length % SERIES_COLORS.length] ?? SERIES_COLORS[0]!,
      });
    },
    [addAlert, alertArm, avwapArm, drawings, lockChart, paneId, panePoint, removeDrawing, setAvwapAnchor, setAvwapArm, setSelected, tool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag.mode) return;
      const prim = drawingPrimRef.current;
      if (!prim) return;
      const at = panePoint(event);
      if (!at) return;

      if (drag.mode === 'create') {
        const point = prim.fromXY(at.x, at.y);
        if (!point) return;
        setDraft((current) => (current ? { ...current, points: [current.points[0], point] } : current));
        return;
      }

      if (drag.mode === 'move' && drag.drawingId && drag.origin && drag.start) {
        const from = prim.fromXY(drag.start.x, drag.start.y);
        const to = prim.fromXY(at.x, at.y);
        if (!from || !to) return;
        const dt = to.time - from.time;
        const dp = to.price - from.price;
        updateDrawing(paneId, drag.drawingId, [
          { time: drag.origin[0].time + dt, price: drag.origin[0].price + dp },
          { time: drag.origin[1].time + dt, price: drag.origin[1].price + dp },
        ]);
      }
    },
    [paneId, panePoint, updateDrawing],
  );

  const endDrag = useCallback(
    (event?: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag.mode === 'create' && draft) {
        const at = event ? panePoint(event) : null;
        // A click without movement would create a zero-length shape (useless for
        // everything except a horizontal price level, which only needs the y).
        const distance = at && drag.start ? Math.hypot(at.x - drag.start.x, at.y - drag.start.y) : 0;
        const farEnough = draft.tool === 'horizontal' || distance >= 4;
        if (farEnough) addDrawing(paneId, { tool: draft.tool, points: draft.points, color: draft.color });
      }

      setDraft(null);
      dragRef.current = { mode: null, start: null, drawingId: null, origin: null };
      lockChart(false);
      if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [addDrawing, draft, lockChart, paneId, panePoint],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDraft(null);
      dragRef.current = { mode: null, start: null, drawingId: null, origin: null };
      lockChart(false);
      setTool('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lockChart, setTool]);

  /* -------------------------------- handle --------------------------------- */

  useImperativeHandle(
    ref,
    () => ({
      toPng: () => {
        const chart = chartRef.current;
        if (!chart) return null;
        try {
          return chart.takeScreenshot(true, true).toDataURL('image/png');
        } catch {
          return null;
        }
      },
      fit: () => chartRef.current?.timeScale().fitContent(),
    }),
    [],
  );

  /* --------------------------------- render -------------------------------- */

  const drawingActive = tool !== 'none';

  return (
    <div
      className="relative h-full w-full"
      data-watermark="www.NodeChart.cc"
      data-liq-radar={liqOn ? 'on' : 'off'}
    >
      <div
        ref={containerRef}
        className={cn('h-full w-full', drawingActive && 'cursor-crosshair')}
        style={{ touchAction: drawingActive ? 'none' : 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />

      {/* legend – DOM on purpose: selectable, translatable, screen-reader friendly */}
      <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-micro-10 leading-tight">
        <span className="text-fg">{symbol}</span>
        <span className="text-faint">{intervalLabel ?? timeframe}</span>
        {shown && (
          <span className="text-muted">
            O <span className="text-fg">{shown.o.toFixed(digits)}</span> H{' '}
            <span className="text-fg">{shown.h.toFixed(digits)}</span> L{' '}
            <span className="text-fg">{shown.l.toFixed(digits)}</span> C{' '}
            <span className={shown.c >= shown.o ? 'text-bull' : 'text-bear'}>{shown.c.toFixed(digits)}</span>
            {barCountdown && !hover && (
              <span className="ml-2 tabular-nums text-warning" title="bar close">⏳{barCountdown}</span>
            )}
          </span>
        )}
        {computed.map((entry) => {
          const def = INDICATOR_LIBRARY[entry.kind];
          const key = def.outputs[0]?.key ?? '';
          const value = lastValue(entry.values?.[key]);
          const osc = def.placement === 'pane';
          return (
            <span key={entry.id} className="text-faint">
              {entry.title}{' '}
              <span className="text-muted">{value === undefined ? '–' : value.toFixed(osc ? 2 : digits)}</span>
            </span>
          );
        })}
      </div>

      {status !== 'open' && (
        <div className="pointer-events-none absolute bottom-1.5 left-2 z-10 font-mono text-micro-10 uppercase tracking-cyber text-faint">
          {status}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- helpers --------------------------------- */

function createMainSeries(
  chart: IChartApi,
  chartType: ChartType,
  theme: ChartTheme,
  digits: number,
  basePrice: number,
): AnySeries {
  const priceFormat = { type: 'price' as const, precision: digits, minMove: minMoveFor(digits) };

  switch (chartType) {
    case 'bars':
      return chart.addSeries(BarSeries, { upColor: theme.bull, downColor: theme.bear, priceFormat }) as AnySeries;
    case 'line':
      return chart.addSeries(LineSeries, {
        color: theme.primary,
        lineWidth: 2,
        priceFormat,
      }) as AnySeries;
    case 'baseline':
      return chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: basePrice },
        topLineColor: theme.bull,
        topFillColor1: withAlpha(theme.bull, 0.28),
        topFillColor2: withAlpha(theme.bull, 0.04),
        bottomLineColor: theme.bear,
        bottomFillColor1: withAlpha(theme.bear, 0.04),
        bottomFillColor2: withAlpha(theme.bear, 0.28),
        lineWidth: 2,
        priceFormat,
      }) as AnySeries;
    case 'area':
      return chart.addSeries(AreaSeries, {
        lineColor: theme.primary,
        topColor: withAlpha(theme.primary, 0.35),
        bottomColor: withAlpha(theme.primary, 0.02),
        lineWidth: 2,
        priceFormat,
      }) as AnySeries;
    case 'heikinAshi':
    case 'candles':
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: theme.bull,
        downColor: theme.bear,
        wickUpColor: theme.bull,
        wickDownColor: theme.bear,
        borderUpColor: theme.bull,
        borderDownColor: theme.bear,
        priceFormat,
      }) as AnySeries;
  }
}

function applySeriesColors(main: AnySeries, chartType: ChartType, theme: ChartTheme): void {
  if (chartType === 'line') {
    main.applyOptions({ color: theme.primary } as never);
    return;
  }
  if (chartType === 'area') {
    main.applyOptions({
      lineColor: theme.primary,
      topColor: withAlpha(theme.primary, 0.35),
      bottomColor: withAlpha(theme.primary, 0.02),
    } as never);
    return;
  }
  if (chartType === 'bars') {
    main.applyOptions({ upColor: theme.bull, downColor: theme.bear } as never);
    return;
  }
  if (chartType === 'baseline') {
    main.applyOptions({
      topLineColor: theme.bull,
      topFillColor1: withAlpha(theme.bull, 0.28),
      topFillColor2: withAlpha(theme.bull, 0.04),
      bottomLineColor: theme.bear,
      bottomFillColor1: withAlpha(theme.bear, 0.04),
      bottomFillColor2: withAlpha(theme.bear, 0.28),
    } as never);
    return;
  }
  main.applyOptions({
    upColor: theme.bull,
    downColor: theme.bear,
    wickUpColor: theme.bull,
    wickDownColor: theme.bear,
    borderUpColor: theme.bull,
    borderDownColor: theme.bear,
  } as never);
}

/** Candles + computed values → lightweight-charts series data (gaps skipped). */
function mapSeries(
  candles: Candle[],
  values: (number | undefined)[],
  style: 'line' | 'histogram' | 'band',
  color: string,
): (LineData<Time> | HistogramData<Time>)[] {
  const out: (LineData<Time> | HistogramData<Time>)[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const value = values[i];
    const candle = candles[i];
    if (value === undefined || candle === undefined) continue;
    const time = (candle.t / 1000) as UTCTimestamp;
    if (style === 'histogram') out.push({ time, value, color: value >= 0 ? color : withAlpha(color, 0.45) });
    else out.push({ time, value });
  }
  return out;
}
