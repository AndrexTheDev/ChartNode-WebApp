// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Timeframe } from '@/store/types';
import type { Candle, RawTrade } from './types';
import { bucketOf } from './adapters/shared';

/**
 * Builds candles out of a trade stream.
 *
 * Some venues have no public candle channel (Coinbase Exchange, KuCoin spot,
 * CoinEx v1). Rather than dropping them, the manager derives OHLCV from the
 * trade feed on top of the REST history: the seed provides the past, this
 * provides the present. Volume of the *current* bucket is therefore slightly
 * optimistic (trades that already happened before we subscribed are counted
 * twice) – acceptable for a live tape, and every closed candle is exact.
 */
export class CandleDeriver {
  private current: Candle | null = null;

  constructor(
    private readonly timeframe: Timeframe,
    seed?: Candle | null,
  ) {
    if (seed) this.current = { ...seed, closed: false };
  }

  /** Called when REST history lands, so the live candle continues it. */
  setSeed(seed: Candle | null): void {
    if (!seed) return;
    if (this.current && this.current.t >= seed.t) return;
    this.current = { ...seed, closed: false };
  }

  /** Returns 0–2 candles to upsert (a closed one plus the running one). */
  push(trade: RawTrade): Candle[] {
    if (!Number.isFinite(trade.price) || !Number.isFinite(trade.qty)) return [];
    const bucket = bucketOf(trade.ts, this.timeframe);
    if (!Number.isFinite(bucket)) return [];

    if (!this.current) {
      this.current = { t: bucket, o: trade.price, h: trade.price, l: trade.price, c: trade.price, v: trade.qty, closed: false };
      return [{ ...this.current }];
    }

    if (bucket === this.current.t) {
      this.current = {
        t: this.current.t,
        o: this.current.o,
        h: Math.max(this.current.h, trade.price),
        l: Math.min(this.current.l, trade.price),
        c: trade.price,
        v: this.current.v + trade.qty,
        closed: false,
      };
      return [{ ...this.current }];
    }

    if (bucket > this.current.t) {
      const closed: Candle = { ...this.current, closed: true };
      this.current = { t: bucket, o: trade.price, h: trade.price, l: trade.price, c: trade.price, v: trade.qty, closed: false };
      return [closed, { ...this.current }];
    }

    // Late trade for an already-closed bucket – ignore.
    return [];
  }
}
