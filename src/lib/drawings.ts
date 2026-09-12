/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Drawing geometry — pure functions, no DOM, no lightweight-charts import.
 *
 * Everything the canvas renderer needs (fib levels, hit tests, ray projection,
 * zone corners) lives here so it can be unit-tested offline in the smoke
 * harness. Coordinate conversion is injected as `ToXY`, which keeps this module
 * independent of the chart instance.
 *
 * Drawings are stored in **data space** (unix seconds + price), never pixels,
 * so they stay glued to the candles across zoom, resize and re-seed.
 */

import type { Drawing, DrawingPoint } from '@/store/useChartStore';

export interface XY {
  x: number;
  y: number;
}

/** Maps a stored point into pane pixel space; `null` when off-scale. */
export type ToXY = (point: DrawingPoint) => XY | null;

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Fib line colors (level → neon), 0.618 is the "golden" highlight. */
export const FIB_COLORS: Record<string, string> = {
  '0': '#7c5cff',
  '0.236': '#4dd2ff',
  '0.382': '#00f0ff',
  '0.5': '#c6ff00',
  '0.618': '#ffb020',
  '0.786': '#ff2fb9',
  '1': '#7c5cff',
};

export function fibColor(level: number): string {
  return FIB_COLORS[String(level)] ?? '#4dd2ff';
}

/** Points are stored left-to-right so rendering never has to care. */
export function normalizePoints(a: DrawingPoint, b: DrawingPoint): [DrawingPoint, DrawingPoint] {
  return a.time <= b.time ? [a, b] : [b, a];
}

/**
 * Fib retracement price for `level` between anchor `start` and target `end`.
 * Direction-agnostic: an up-swing (100 → 200) and a down-swing (200 → 100)
 * both return the same set of prices for the same level.
 */
export function fibPrice(start: number, end: number, level: number): number {
  return start + (end - start) * level;
}

export function fibLevelsFor(drawing: Drawing): { level: number; price: number }[] {
  const [a, b] = drawing.points;
  return FIB_LEVELS.map((level) => ({ level, price: fibPrice(a.price, b.price, level) }));
}

/* --------------------------------- hit test -------------------------------- */

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Same as above but the line continues past both endpoints (ray/extension). */
export function distanceToLine(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function zoneRect(a: XY, b: XY): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function isInsideRect(at: XY, rect: { left: number; top: number; width: number; height: number }): boolean {
  return (
    at.x >= rect.left && at.x <= rect.left + rect.width && at.y >= rect.top && at.y <= rect.top + rect.height
  );
}

export const HIT_TOLERANCE_PX = 7;

/** True when `at` is close enough to (or inside) the shape to grab it. */
export function hitTestDrawing(drawing: Drawing, toXY: ToXY, at: XY, tolerance = HIT_TOLERANCE_PX): boolean {
  const [a, b] = drawing.points;
  const pa = toXY(a);
  const pb = toXY(b);

  switch (drawing.tool) {
    case 'horizontal': {
      // Only the price matters – the anchor point defines the level.
      if (!pa) return false;
      return Math.abs(at.y - pa.y) <= tolerance;
    }
    case 'zone': {
      if (!pa || !pb) return false;
      const rect = zoneRect(pa, pb);
      return isInsideRect(at, rect) || distanceToRectEdge(at, rect) <= tolerance;
    }
    case 'fib': {
      if (!pa || !pb) return false;
      return fibLevelsFor(drawing).some((line) => {
        const y = pa.y + (pb.y - pa.y) * line.level;
        return Math.abs(at.y - y) <= tolerance && at.x >= Math.min(pa.x, pb.x) - tolerance;
      });
    }
    case 'ray': {
      if (!pa || !pb) return false;
      // Only the half-line from A through B (and beyond) is grabbable.
      const t = projectionT(at, pa, pb);
      if (t < 0) return distanceToSegment(at.x, at.y, pa.x, pa.y, pa.x, pa.y) <= tolerance;
      return distanceToLine(at.x, at.y, pa.x, pa.y, pb.x, pb.y) <= tolerance;
    }
    case 'trendline':
    default: {
      if (!pa || !pb) return false;
      return distanceToSegment(at.x, at.y, pa.x, pa.y, pb.x, pb.y) <= tolerance;
    }
  }
}

function distanceToRectEdge(at: XY, rect: { left: number; top: number; width: number; height: number }): number {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  return Math.min(
    distanceToSegment(at.x, at.y, rect.left, rect.top, right, rect.top),
    distanceToSegment(at.x, at.y, rect.left, bottom, right, bottom),
    distanceToSegment(at.x, at.y, rect.left, rect.top, rect.left, bottom),
    distanceToSegment(at.x, at.y, right, rect.top, right, bottom),
  );
}

/** Position of `at` along the A→B axis (0 = at A, 1 = at B). */
function projectionT(at: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return 0;
  return ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSq;
}

/** Topmost hit = last drawn, matching how users expect stacking to work. */
export function hitTestDrawings(list: Drawing[], toXY: ToXY, at: XY, tolerance?: number): Drawing | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const drawing = list[i];
    if (drawing && hitTestDrawing(drawing, toXY, at, tolerance)) return drawing;
  }
  return null;
}

/* --------------------------------- editing --------------------------------- */

/** Moves a whole shape by a delta in data space (drag with the select tool). */
export function translateDrawing(
  drawing: Drawing,
  delta: { time: number; price: number },
): Drawing {
  const shift = (point: DrawingPoint): DrawingPoint => ({
    time: point.time + delta.time,
    price: point.price + delta.price,
  });
  return { ...drawing, points: [shift(drawing.points[0]), shift(drawing.points[1])] };
}

/** Extends A→B to the right edge of the pane (rays + trendline projection). */
export function extendToRight(a: XY, b: XY, maxX: number): XY {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0) return { x: b.x, y: b.y };
  const t = (maxX - a.x) / dx;
  if (t <= 1) return { x: b.x, y: b.y };
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Label for a shape, e.g. the % change of a trendline or a zone's range. */
export function drawingLabel(drawing: Drawing, priceDigits = 2): string {
  const [a, b] = drawing.points;
  if (drawing.tool === 'horizontal') return a.price.toFixed(priceDigits);
  const change = a.price === 0 ? 0 : ((b.price - a.price) / a.price) * 100;
  if (drawing.tool === 'zone') {
    return `${Math.min(a.price, b.price).toFixed(priceDigits)} – ${Math.max(a.price, b.price).toFixed(priceDigits)}`;
  }
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}
