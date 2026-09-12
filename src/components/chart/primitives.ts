/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Canvas primitives for lightweight-charts v5.
 *
 * Two custom drawings live *inside* the chart canvas (not in a DOM overlay):
 *
 *   1. `DrawingPrimitive`  – trendline / ray / horizontal / fib / zone tools,
 *      plus the in-progress draft and the selection handles.
 *   2. `CrosshairPrimitive` – the mirrored crosshair of the *other* grid panes
 *      (the library has no API to set a crosshair, so we draw the guide lines).
 *
 * Being real primitives means they pan/zoom with the data, survive resizing and
 * — the important part — are included in `chart.takeScreenshot()`, exactly like
 * the watermark. Shapes are stored in data space (unix seconds + price) and
 * converted here via `timeToCoordinate` / `priceToCoordinate`.
 */

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  Coordinate,
  IChartApi,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { CHART_THEME_FALLBACK, withAlpha, type ChartTheme } from '@/lib/chart-theme';
import { drawingLabel, extendToRight, fibLevelsFor, type ToXY } from '@/lib/drawings';
import type { Drawing, DrawingPoint, DrawingToolKind } from '@/store/useChartStore';

/** Shape currently being dragged out by the user (not yet in the store). */
export interface DraftShape {
  tool: DrawingToolKind;
  points: [DrawingPoint, DrawingPoint];
  color: string;
}

export interface DrawingSource {
  drawings: Drawing[];
  draft: DraftShape | null;
  selectedId: string | null;
  theme: ChartTheme;
  /** Digits used for price labels. */
  digits: number;
}

const EMPTY_SOURCE: DrawingSource = {
  drawings: [],
  draft: null,
  selectedId: null,
  // Nie gerendert (PriceChart reicht immer den echten Theme durch), aber
  // token-exakt statt eigener Hex-Kopien: Single Source of Truth.
  theme: CHART_THEME_FALLBACK,
  digits: 2,
};

function num(value: Coordinate | number | null | undefined): number | null {
  return value == null ? null : Number(value);
}

/* =============================== drawings ================================= */

export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private notify: () => void = () => {};
  private source: DrawingSource = EMPTY_SOURCE;
  private view: IPrimitivePaneView = {
    zOrder: () => 'top' as PrimitivePaneViewZOrder,
    renderer: () => ({
      draw: (target: CanvasRenderingTarget2D) => this.paint(target),
    }),
  };
  private views: readonly IPrimitivePaneView[] = [this.view];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.notify = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** Called by React whenever drawings/draft/selection/theme change. */
  setSource(source: DrawingSource): void {
    this.source = source;
    this.notify();
  }

  redraw(): void {
    this.notify();
  }

  /* ------------------------------ coordinates ----------------------------- */

  /** data space → pixels (null when the bar/price is outside the viewport) */
  toXY: ToXY = (point) => {
    if (!this.chart || !this.series) return null;
    const x = num(this.chart.timeScale().timeToCoordinate(point.time as Time));
    const y = num(this.series.priceToCoordinate(point.price));
    if (x === null || y === null) return null;
    return { x, y };
  };

  /** pixels → data space, snapped to the nearest bar */
  fromXY(x: number, y: number): DrawingPoint | null {
    if (!this.chart || !this.series) return null;
    const time = this.chart.timeScale().coordinateToTime(x as Coordinate);
    const price = this.series.coordinateToPrice(y as Coordinate);
    if (time == null || price == null) return null;
    return { time: Number(time), price: Number(price) };
  }

  /* --------------------------------- paint -------------------------------- */

  paint(target: CanvasRenderingTarget2D): void {
    const { drawings, draft, selectedId, theme, digits } = this.source;
    if (drawings.length === 0 && !draft) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';

      for (const drawing of drawings) {
        this.paintShape(ctx, drawing, drawing.id === selectedId, width, theme, digits);
      }
      if (draft) {
        this.paintShape(
          ctx,
          { id: '__draft__', tool: draft.tool, points: draft.points, color: draft.color, createdAt: 0 },
          true,
          width,
          theme,
          digits,
        );
      }
      ctx.restore();
    });
  }

  private paintShape(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    selected: boolean,
    width: number,
    theme: ChartTheme,
    digits: number,
  ): void {
    const a = this.toXY(drawing.points[0]);
    const b = this.toXY(drawing.points[1]);
    if (!a && !b) return;

    ctx.strokeStyle = drawing.color;
    ctx.fillStyle = drawing.color;
    ctx.lineWidth = selected ? 2.25 : 1.5;
    ctx.shadowBlur = selected ? 10 : 6;
    ctx.shadowColor = drawing.color;

    switch (drawing.tool) {
      case 'horizontal': {
        if (!a) return;
        ctx.setLineDash([6, 4]);
        line(ctx, 0, a.y, width, a.y);
        ctx.setLineDash([]);
        tag(ctx, `${drawing.points[0].price.toFixed(digits)}`, width - 4, a.y, drawing.color, theme, 'right');
        break;
      }

      case 'zone': {
        if (!a || !b) return;
        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.globalAlpha = 0.16;
        ctx.fillRect(left, top, w, h);
        ctx.globalAlpha = 1;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(left, top, w, h);
        ctx.setLineDash([]);
        tag(ctx, drawingLabel(drawing, digits), left + 6, top + 12, drawing.color, theme, 'left');
        break;
      }

      case 'fib': {
        if (!a || !b) return;
        for (const level of fibLevelsFor(drawing)) {
          const y = a.y + (b.y - a.y) * level.level;
          ctx.globalAlpha = level.level === 0.618 || level.level === 0 ? 1 : 0.75;
          ctx.lineWidth = level.level === 0.618 ? 2 : 1.25;
          line(ctx, a.x, y, width, y);
          ctx.globalAlpha = 1;
          tag(
            ctx,
            `${level.level.toFixed(3)} · ${level.price.toFixed(digits)}`,
            a.x + 6,
            y - 4,
            drawing.color,
            theme,
            'left',
          );
        }
        ctx.lineWidth = selected ? 2.25 : 1.5;
        break;
      }

      case 'ray': {
        if (!a || !b) return;
        const end = extendToRight(a, b, width);
        line(ctx, a.x, a.y, end.x, end.y);
        tag(ctx, drawingLabel(drawing, digits), Math.min(end.x + 4, width - 4), end.y - 6, drawing.color, theme, 'right');
        break;
      }

      case 'trendline':
      default: {
        if (!a || !b) return;
        line(ctx, a.x, a.y, b.x, b.y);
        // projection: dashed continuation to the right edge
        const projected = extendToRight(a, b, width);
        if (projected.x > b.x + 1) {
          ctx.setLineDash([4, 5]);
          ctx.globalAlpha = 0.55;
          line(ctx, b.x, b.y, projected.x, projected.y);
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
        tag(ctx, drawingLabel(drawing, digits), b.x + 6, b.y - 6, drawing.color, theme, 'left');
        break;
      }
    }

    ctx.shadowBlur = 0;
    if (selected) {
      for (const point of [a, b]) {
        if (!point) continue;
        ctx.fillStyle = theme.bg;
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(point.x - 3.5, point.y - 3.5, 7, 7);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

/* ============================== crosshair ================================== */

export interface CrosshairSource {
  /** Remote cursor position, or null when nothing is synced. */
  time: number | null;
  price: number | null;
  /** Only draw the horizontal guide when both panes show the same symbol. */
  sameSymbol: boolean;
  color: string;
  digits: number;
  label: string | null;
}

const NO_CROSSHAIR: CrosshairSource = {
  time: null,
  price: null,
  sameSymbol: false,
  color: '#00f0ff',
  digits: 2,
  label: null,
};

export class CrosshairPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private notify: () => void = () => {};
  private source: CrosshairSource = NO_CROSSHAIR;
  private views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => 'top' as PrimitivePaneViewZOrder,
      renderer: () => ({
        draw: (target: CanvasRenderingTarget2D) => this.paint(target),
      }),
    },
  ];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.notify = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setSource(source: CrosshairSource): void {
    this.source = source;
    this.notify();
  }

  paint(target: CanvasRenderingTarget2D): void {
    const { time, price, sameSymbol, color, digits, label } = this.source;
    if (time === null || !this.chart || !this.series) return;

    const x = num(this.chart.timeScale().timeToCoordinate(time as Time));
    if (x === null) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { width, height } = scope.mediaSize;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.globalAlpha = 0.85;
      line(ctx, x, 0, x, height);

      if (sameSymbol && price !== null) {
        const y = num(this.series?.priceToCoordinate(price));
        if (y !== null) {
          line(ctx, 0, y, width, y);
          ctx.setLineDash([]);
          tag(ctx, price.toFixed(digits), width - 4, y, color, undefined, 'right');
        }
      }

      if (label) {
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        tag(ctx, label, x + 6, 12, color, undefined, 'left');
      }
      ctx.restore();
    });
  }
}

/* -------------------------------- helpers ---------------------------------- */

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Small price/label chip. `theme` is optional (falls back to a dark chip). */
function tag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  theme: ChartTheme | undefined,
  align: 'left' | 'right',
): void {
  const pad = 4;
  const w = ctx.measureText(text).width + pad * 2;
  const h = 15;
  const left = align === 'right' ? x - w : x;
  const top = Math.max(1, y - h / 2);

  ctx.globalAlpha = 0.92;
  ctx.fillStyle = theme?.bg ?? '#0a0a0a';
  ctx.fillRect(left, top, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + pad, top + h / 2);
}

/* ================================ watermark ================================= */

export interface WatermarkSource {
  /** The watermark line, e.g. `www.NodeChart.cc`. */
  ticker: string;
  /** Fallback line when `ticker` is empty. */
  caption: string;
  /** Neon colors pulled from the active theme. */
  primary: string;
  accent: string;
  /** 0..1 – kept low so candles stay readable. */
  alpha: number;
}

const WATERMARK_DEFAULTS: WatermarkSource = {
  ticker: '',
  caption: 'NODECHART',
  primary: '#39ff14',
  accent: '#00f0ff',
  alpha: 0.14,
};

/**
 * NodeChart logo + current ticker, painted into the chart canvas itself
 * (`zOrder: 'bottom'`, i.e. *behind* the candles).
 *
 * Why a primitive and not a DOM overlay: DOM would vanish from
 * `chart.takeScreenshot()` and could be cropped by CSS. Vector paths (instead of
 * `createImageWatermark`) stay crisp at any devicePixelRatio and need no async
 * image decode, so the very first painted frame already carries the mark.
 */
export class WatermarkPrimitive implements ISeriesPrimitive<Time> {
  private source: WatermarkSource = WATERMARK_DEFAULTS;
  private notify: () => void = () => {};
  private views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => 'bottom' as PrimitivePaneViewZOrder,
      renderer: () => ({
        draw: (target: CanvasRenderingTarget2D) => this.paint(target),
      }),
    },
  ];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.notify = param.requestUpdate;
  }

  detached(): void {
    this.notify = () => {};
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setSource(source: WatermarkSource): void {
    this.source = source;
    this.notify();
  }

  paint(target: CanvasRenderingTarget2D): void {
    const { ticker, caption, primary, alpha } = this.source;
    const text = ticker || caption;
    if (!text) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { width, height } = scope.mediaSize;
      // Tiny pane (mobile split): skip the mark instead of colliding.
      if (width < 120 || height < 48) return;

      // TradingView-style: one quiet centred line, shrunk to fit inside 72%
      // of the pane width so it never touches axes, legend or pane borders,
      // and vertically centred in the free area behind the series.
      const maxWidth = width * 0.72;
      let size = Math.max(14, Math.min(width * 0.055, height * 0.16, 40));
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const measured = ctx.measureText(text).width;
      if (measured > maxWidth) {
        size = Math.max(10, (size * maxWidth) / measured);
        ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = primary;
      ctx.fillText(text, width / 2, height / 2);
      ctx.restore();
    });
  }
}

/* --------------------------- volume profile (VPVR) -------------------------- */

export interface VolumeProfileSource {
  bins: { p0: number; p1: number; vol: number }[];
  poc: number;
  vah: number;
  val: number;
  maxVol: number;
  /** Theme accent colors for the profile + level lines. */
  area: string;
  outside: string;
  level: string;
}

/**
 * Volume Profile Visible Range – the paywalled classic.
 *
 * Horizontal volume bars anchored to the right pane edge (like the real VPVR),
 * drawn *inside* the canvas so screenshots keep them. Bars inside the 70 %
 * value area glow in the accent color; the POC gets a solid level line and
 * VAH/VAL dashed ones. Price→pixel goes through `series.priceToCoordinate`,
 * so the profile pans/zooms with the candles.
 */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private source: VolumeProfileSource | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private notify: () => void = () => {};
  private views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => 'bottom' as PrimitivePaneViewZOrder,
      renderer: () => ({
        draw: (target: CanvasRenderingTarget2D) => this.paint(target),
      }),
    },
  ];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.series = param.series;
    this.notify = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.notify = () => {};
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setSource(source: VolumeProfileSource | null): void {
    this.source = source;
    this.notify();
  }

  private y(price: number): number | null {
    const coordinate = this.series?.priceToCoordinate(price);
    return coordinate == null ? null : Number(coordinate);
  }

  paint(target: CanvasRenderingTarget2D): void {
    const source = this.source;
    if (!source || source.bins.length === 0) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { width } = scope.mediaSize;
      const maxBar = Math.min(width * 0.24, 220);

      for (const bin of source.bins) {
        const y1 = this.y(bin.p1);
        const y0 = this.y(bin.p0);
        if (y1 == null || y0 == null) continue;
        const top = Math.min(y0, y1);
        const height = Math.max(1, Math.abs(y0 - y1) - 0.5);
        if (top + height < 0 || top > scope.mediaSize.height) continue;
        const barWidth = (bin.vol / source.maxVol) * maxBar;
        const inValueArea = bin.p1 > source.val && bin.p0 < source.vah;
        ctx.fillStyle = inValueArea ? source.area : source.outside;
        ctx.fillRect(width - barWidth, top, barWidth, height);
      }

      // POC / VAH / VAL level lines
      const levels: [number, number, number[]][] = [
        [source.poc, 1.4, []],
        [source.vah, 1, [4, 3]],
        [source.val, 1, [4, 3]],
      ];
      for (const [price, lineWidth, dash] of levels) {
        const yLevel = this.y(price);
        if (yLevel == null || yLevel < 0 || yLevel > scope.mediaSize.height) continue;
        ctx.save();
        ctx.strokeStyle = source.level;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(0, yLevel);
        ctx.lineTo(width, yLevel);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
}

/* ------------------------- wave-7: liquidation magnets --------------------- */

export interface LiqMagnetSource {
  buckets: { price: number; side: 'long' | 'short'; intensity: number; leverage: number; distancePct: number }[];
  /** half band width in percent of price */
  halfPct: number;
  /** theme base colours – alpha is applied per band intensity */
  longBase: string;
  shortBase: string;
  label: string;
}

/**
 * Liq Radar bands: translucent horizontal zones where estimated liquidation
 * clusters sit – long cascades below spot (bear-coloured), short cascades
 * above (bull-coloured), alpha scaled by cluster intensity. Painted in-canvas
 * so screenshots and exports carry the map, exactly like the VP.
 */
export class LiqMagnetPrimitive implements ISeriesPrimitive<Time> {
  private source: LiqMagnetSource | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private notify: () => void = () => {};
  private views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => 'bottom' as PrimitivePaneViewZOrder,
      renderer: () => ({
        draw: (target: CanvasRenderingTarget2D) => this.paint(target),
      }),
    },
  ];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.series = param.series;
    this.notify = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.notify = () => {};
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setSource(source: LiqMagnetSource | null): void {
    this.source = source;
    this.notify();
  }

  private y(price: number): number | null {
    const coordinate = this.series?.priceToCoordinate(price);
    return coordinate == null ? null : Number(coordinate);
  }

  paint(target: CanvasRenderingTarget2D): void {
    const source = this.source;
    if (!source || source.buckets.length === 0) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { width, height } = scope.mediaSize;
      const bands = source.buckets.slice(0, 16);

      for (const band of bands) {
        const upper = this.y(band.price * (1 + source.halfPct));
        const lower = this.y(band.price * (1 - source.halfPct));
        if (upper == null || lower == null) continue;
        const top = Math.min(upper, lower);
        const bandHeight = Math.max(2, Math.abs(lower - upper));
        if (top + bandHeight < 0 || top > height) continue;
        const alpha = 0.06 + 0.22 * band.intensity;
        ctx.fillStyle = withAlpha(band.side === 'long' ? source.longBase : source.shortBase, alpha);
        ctx.fillRect(0, top, width, bandHeight);
      }

      // leverage tags for the three strongest buckets per side
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const tagged = new Set<string>();
      for (const band of bands) {
        const sideKey = `${band.side}`;
        const count = [...tagged].filter((entry) => entry === sideKey).length;
        if (count >= 3) continue;
        const yLevel = this.y(band.price);
        if (yLevel == null || yLevel < 8 || yLevel > height - 8) continue;
        tagged.add(sideKey);
        ctx.fillStyle = source.label;
        ctx.fillText(`${band.leverage}x ${band.side === 'long' ? 'L' : 'S'} ${band.distancePct >= 0 ? '+' : ''}${band.distancePct.toFixed(1)}%`, 8, yLevel);
      }
    });
  }
}
