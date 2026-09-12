/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Cross-chart synchronisation bus.
 *
 * A 2x1 / 2x2 grid renders one lightweight-charts instance per pane, and the
 * library deliberately has no "set crosshair" API. So each chart publishes what
 * its user is doing and every other chart reflects it:
 *
 *   • visible logical range  → `timeScale().setVisibleLogicalRange()` (zoom/pan)
 *   • crosshair position     → drawn by our own pane primitive (guide lines),
 *                              which also shows up in `takeScreenshot()`
 *
 * Panes *inside* one chart (oscillators) need no bus: they share the time scale
 * and crosshair natively.
 *
 * Echo loops are avoided by tagging every message with the sending chart id and
 * ignoring messages that came from yourself.
 */

export interface LogicalRangeMessage {
  source: string;
  range: { from: number; to: number };
}

export interface CrosshairMessage {
  source: string;
  /** Unix seconds, or `null` when the cursor left the chart. */
  time: number | null;
  /** Logical index – used when the receiving chart has no bar at that time. */
  logical: number | null;
  /** Price under the cursor in the *sending* pane (informational readout). */
  price: number | null;
  /** Pane the cursor is in on the sender (0 = price pane). */
  paneIndex: number;
  /**
   * Symbol of the sending pane. The horizontal guide is only mirrored when both
   * charts show the same instrument – otherwise a BTC price would be drawn onto
   * a SOL scale, which is worse than no line at all.
   */
  symbol: string;
}

type Handler<T> = (message: T) => void;

class Bus<T extends { source: string }> {
  private readonly handlers = new Set<Handler<T>>();
  private last: T | null = null;

  subscribe(handler: Handler<T>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(message: T): void {
    this.last = message;
    for (const handler of this.handlers) handler(message);
  }

  /** Lets a freshly mounted chart adopt the current state of the grid. */
  replay(handler: Handler<T>, exceptSource?: string): void {
    if (this.last && this.last.source !== exceptSource) handler(this.last);
  }

  clear(): void {
    this.last = null;
  }
}

export const rangeBus = new Bus<LogicalRangeMessage>();
export const crosshairBus = new Bus<CrosshairMessage>();

/** Ranges are floats – compare with an epsilon to avoid feedback loops. */
export function rangesEqual(
  a: { from: number; to: number } | null | undefined,
  b: { from: number; to: number } | null | undefined,
  epsilon = 0.01,
): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.from - b.from) < epsilon && Math.abs(a.to - b.to) < epsilon;
}
