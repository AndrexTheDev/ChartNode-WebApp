// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useWhaleStore, type WhaleTrade } from '@/store/useWhaleStore';
import type { RawTrade } from './types';

/**
 * Whale filter on top of the raw trade streams.
 *
 * Trades can arrive in bursts (hundreds/second on BTC), so matches are
 * buffered and flushed to the store at most every FLUSH_MS – the ticker
 * animates in batches instead of re-rendering per tick.
 */
const FLUSH_MS = 400;

let whaleSeq = 0;

class WhaleTracker {
  private pending: WhaleTrade[] = [];
  private timer: number | null = null;

  observe(trade: RawTrade): void {
    const { enabled, thresholdUsd } = useWhaleStore.getState();
    if (!enabled) return;

    const notional = trade.price * trade.qty;
    if (!Number.isFinite(notional) || notional < thresholdUsd) return;

    whaleSeq += 1;
    this.pending.push({
      id: `${trade.exchange}-${trade.ts}-${whaleSeq}`,
      exchange: trade.exchange,
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      qty: trade.qty,
      notional,
      ts: trade.ts,
    });

    if (this.timer === null) {
      this.timer = window.setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.pending.length === 0) return;
    // Newest first: batches are prepended to the store, so a burst that spans
    // a few hundred ms still reads like a live ticker.
    const batch = [...this.pending].sort((a, b) => b.ts - a.ts);
    this.pending = [];
    useWhaleStore.getState().pushMany(batch);
  }

  /** Drop buffered trades (e.g. when the stream is disabled). */
  drain(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }
}

export const whaleTracker = new WhaleTracker();
