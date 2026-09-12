// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Candle } from '@/websockets/types';

/**
 * Liq Radar – the liquidation magnet map (NodeChart original).
 *
 * Perpetual-futures liquidations are mechanical: an isolated-margin position
 * entered at price `p` with leverage `L` is force-closed near `p·(1 ∓ 1/L)`.
 * Nobody publishes where those clusters sit – but every chart does publish
 * where positions were *opened* (volume). So we spread the recent volume over
 * a leverage ladder, age-decay it (positions get closed/managed over time)
 * and bucket the resulting liquidation prices: the result is an estimate of
 * the price levels where cascades are statistically most likely – "magnets".
 *
 * 100 % client-side maths over candles the terminal already holds.
 */

export const LIQ_LEVERAGES = [10, 25, 50, 100] as const;
export type LiqSide = 'long' | 'short';

export interface LiqBucket {
  /** bucket centre price */
  price: number;
  side: LiqSide;
  /** 0..1, normalised against the strongest bucket */
  intensity: number;
  /** leverage that contributes most mass to this bucket */
  leverage: number;
  /** share of price distance from spot, in % */
  distancePct: number;
}

export interface LiqMap {
  buckets: LiqBucket[];
  topLongs: LiqBucket[];
  topShorts: LiqBucket[];
  spot: number;
}

const MAINTENANCE = 0.004;

/** Isolated-margin liquidation price for a position opened at `entry`. */
export function liquidationPrice(entry: number, leverage: number, side: LiqSide): number {
  return side === 'long'
    ? entry * (1 - 1 / leverage + MAINTENANCE)
    : entry * (1 + 1 / leverage - MAINTENANCE);
}

export function buildLiqMap(candles: Candle[], window = 400, bucketPct = 0.0025): LiqMap | null {
  const slice = candles.slice(-window);
  const spot = slice[slice.length - 1]?.c;
  if (!spot || spot <= 0 || slice.length < 30) return null;

  const halfLife = slice.length / 2;
  const mass = new Map<string, number>();
  const leverageMass = new Map<string, Map<number, number>>();

  slice.forEach((candle, index) => {
    const age = slice.length - 1 - index;
    const decay = Math.exp(-age / halfLife);
    const weight = candle.v * decay;
    // corrupt feeds can carry zero/negative closes – never let them seed a magnet
    if (!(weight > 0) || !(candle.c > 0)) return;
    for (const leverage of LIQ_LEVERAGES) {
      for (const side of ['long', 'short'] as const) {
        const price = liquidationPrice(candle.c, leverage, side);
        // long liquidations sit BELOW spot, short liquidations ABOVE –
        // everything else can never trigger and is dropped.
        if (side === 'long' && price >= spot) continue;
        if (side === 'short' && price <= spot) continue;
        const bucket = Math.round(Math.log(price / spot) / Math.log(1 + bucketPct));
        // bucket 0 sits within ±bucketPct of spot – that is noise, not a magnet
        if (bucket === 0) continue;
        const key = `${side}|${bucket}`;
        mass.set(key, (mass.get(key) ?? 0) + weight);
        const perLeverage = leverageMass.get(key) ?? new Map<number, number>();
        perLeverage.set(leverage, (perLeverage.get(leverage) ?? 0) + weight);
        leverageMass.set(key, perLeverage);
      }
    }
  });

  const max = Math.max(...mass.values(), 0);
  if (max <= 0) return null;

  const buckets: LiqBucket[] = [...mass.entries()]
    .map(([key, value]) => {
      const [side, bucketText] = key.split('|') as [LiqSide, string];
      const bucket = Number(bucketText);
      const price = spot * Math.pow(1 + bucketPct, bucket);
      const perLeverage = leverageMass.get(key);
      let leverage = LIQ_LEVERAGES[0] as number;
      let best = -1;
      perLeverage?.forEach((leverValue, leverKey) => {
        if (leverValue > best) {
          best = leverValue;
          leverage = leverKey;
        }
      });
      return {
        price,
        side,
        intensity: value / max,
        leverage,
        distancePct: ((price - spot) / spot) * 100,
      };
    })
    .filter((entry) => entry.intensity >= 0.12)
    .sort((a, b) => b.intensity - a.intensity);

  const top = (side: LiqSide) =>
    buckets
      .filter((entry) => entry.side === side)
      .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
      .slice(0, 3);

  return { buckets, topLongs: top('long'), topShorts: top('short'), spot };
}
