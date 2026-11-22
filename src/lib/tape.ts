// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { RawTrade } from '@/websockets/types';

/**
 * Lokaler Tape-Puffer (0 Netzwerk-Quota).
 *
 * Der Trade-Bus liefert bereits jeden Trade, den die App über ihre
 * ref-counted WebSockets empfängt – exakt dieselben Daten, die CVD im
 * PRO-Panel und den Whale-Ticker füttern. Indikatoren brauchen aber eine
 * *per Kerze* gebuckelte Signatur (Kauf-Notional vs. Verkauf-Notional), nicht
 * nur Sitzungs-Aggregate.
 *
 * Dieser Puffer hält pro Symbol eine begrenzte, zeitlich sortierte Reihe von
 * Minuten-Buckets. Er ist bewusst klein und selbstbegrenzend:
 *   - max. 4 Symbole × 1 440 Minuten-Buckets (24 h) ⇒ feste Obergrenze,
 *   - älteste Buckets werden vorne verworfen,
 *   - kein Timer, kein Interval: das Aufräumen passiert beim Einfügen.
 *
 * Fehlt Tape (kein Trade-Stream für das Symbol), liefern die CVD-Indikatoren
 * `undefined`-Lücken – nie eine erfundene Null-Linie.
 */

export interface TapeBucket {
  /** Bucket-Start in ms (Minutenraster). */
  t: number;
  buyUsd: number;
  sellUsd: number;
  trades: number;
}

const BUCKET_MS = 60_000;
const MAX_BUCKETS = 1_440;
const MAX_SYMBOLS = 4;

const bucketsBySymbol = new Map<string, TapeBucket[]>();
const totalTrades = new Map<string, number>();

/** Normalisiert `BTC/USDT` und `BTCUSDT` auf denselben Schlüssel. */
export function tapeKey(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function recordTapeTrade(trade: RawTrade): void {
  const key = tapeKey(trade.symbol);
  const notional = trade.price * trade.qty;
  if (!Number.isFinite(notional) || notional <= 0) return;

  const t = Math.floor(trade.ts / BUCKET_MS) * BUCKET_MS;
  let list = bucketsBySymbol.get(key);
  if (!list) {
    list = [];
    bucketsBySymbol.set(key, list);
    // Bounded: bei mehr Symbolen fliegt die älteste (Insertions-Reihenfolge).
    if (bucketsBySymbol.size > MAX_SYMBOLS) {
      const oldest = bucketsBySymbol.keys().next();
      if (!oldest.done && oldest.value !== key) {
        bucketsBySymbol.delete(oldest.value);
        totalTrades.delete(oldest.value);
      }
    }
  }

  const last = list[list.length - 1];
  if (!last || last.t < t) {
    list.push({
      t,
      buyUsd: trade.side === 'buy' ? notional : 0,
      sellUsd: trade.side === 'sell' ? notional : 0,
      trades: 1,
    });
    if (list.length > MAX_BUCKETS) list.splice(0, list.length - MAX_BUCKETS);
  } else if (last.t === t) {
    if (trade.side === 'buy') last.buyUsd += notional;
    else last.sellUsd += notional;
    last.trades += 1;
  }
  // Ältere Trades (Out-of-Order auf Langsam-Leitungen) werden verworfen –
  // ein nachträgliches Umsortieren würde O(n) pro Tick kosten.

  totalTrades.set(key, (totalTrades.get(key) ?? 0) + 1);
}

export function readTape(symbol: string): TapeBucket[] {
  return bucketsBySymbol.get(tapeKey(symbol)) ?? [];
}

export function tapeTradeCount(symbol: string): number {
  return totalTrades.get(tapeKey(symbol)) ?? 0;
}

/**
 * Mappt Tape-Buckets auf die Zeitstempel einer Kerzenreihe und liefert pro
 * Kerze `{ buyUsd, sellUsd, delta, trades }`. Kerzen ohne Trades werden
 * explizit als `null` zurückgegeben, damit die Linie Lücken zeigt statt zu
 * suggerieren, es habe keine Aggression gegeben.
 */
export interface TapePerCandle {
  buyUsd: (number | null)[];
  sellUsd: (number | null)[];
  delta: (number | null)[];
  trades: (number | null)[];
}

export function tapePerCandle(symbol: string, candleTimes: number[], intervalMs: number): TapePerCandle {
  const tape = readTape(symbol);
  const buyUsd: (number | null)[] = new Array(candleTimes.length).fill(null);
  const sellUsd: (number | null)[] = new Array(candleTimes.length).fill(null);
  const delta: (number | null)[] = new Array(candleTimes.length).fill(null);
  const trades: (number | null)[] = new Array(candleTimes.length).fill(null);
  if (tape.length === 0 || candleTimes.length === 0) return { buyUsd, sellUsd, delta, trades };

  /*
   * Jeder Bucket wird **genau einer** Kerze zugeordnet: der Kerze, in deren
   * [start, end)-Fenster sein Minutenanfang fällt. Eine frühere Fassung hat
   * Buckets mit beiden Nachbarkerzen verschnitten, wenn die Kerzengrenzen
   * nicht auf Minutengrenzen lagen – dadurch zählte CVD das Delta doppelt.
   * Zwei Zeiger über beide aufsteigenden Reihen ⇒ O(kerzen + buckets).
   */
  const first = candleTimes[0] as number;
  let candle = 0;
  for (const bucket of tape) {
    if (bucket.t < first) continue;
    // Kerze suchen, deren Fenster den Bucket-Anfang enthält.
    while (candle < candleTimes.length && (candleTimes[candle] as number) + intervalMs <= bucket.t) candle += 1;
    if (candle >= candleTimes.length) break;
    if (bucket.t < (candleTimes[candle] as number)) continue;

    // Buckets werden relativ zum Kerzenfenster zusammengefasst. Ein Bucket,
    // der über eine Kerzengrenze ragt, verbleibt vollständig bei der Kerze
    // seines Anfangs – der Fehler ist auf < 1 Bucket begrenzt.
    buyUsd[candle] = (buyUsd[candle] ?? 0) + bucket.buyUsd;
    sellUsd[candle] = (sellUsd[candle] ?? 0) + bucket.sellUsd;
    trades[candle] = (trades[candle] ?? 0) + bucket.trades;
  }
  for (let index = 0; index < candleTimes.length; index += 1) {
    const buy = buyUsd[index];
    const sell = sellUsd[index];
    if (buy == null || sell == null) continue;
    delta[index] = buy - sell;
  }
  return { buyUsd, sellUsd, delta, trades };
}

/** Nur für Tests/Reset – leert den Puffer ohne Seiteneffekte auf Sockets. */
export function clearTape(): void {
  bucketsBySymbol.clear();
  totalTrades.clear();
}
