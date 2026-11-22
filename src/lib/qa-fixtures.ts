// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { TOKEN_INDEX } from '@/lib/constants';
import { useAppStore } from '@/store/useAppStore';
import { useChartStore } from '@/store/useChartStore';
import { useExchangeStore } from '@/store/useExchangeStore';
import { resolveExchangeSelection } from '@/store/useExchangeSelection';
import { useMarketStore } from '@/store/useMarketStore';
import type { Timeframe } from '@/store/types';
import type { Candle } from '@/websockets/types';

/**
 * QA-Fixtures (`?qa=1&fixtures=1`) – deterministische Kerzen ohne Netz.
 *
 * Warum es das gibt: Die Browser-Suiten (`qa:features`, `qa:interaction`,
 * `qa:modules`, Release-Screenshot-Matrix) warten auf `canvas`. Der Chart
 * zeichnet aber erst ab zwei Kerzen, und die kommen aus WebSocket/REST eines
 * Providers. In CI, hinter einer Firewall, in einer Sandbox ohne Provider-Zugang
 * oder bei einem regionalen Block gibt es keine Kerzen – dann hängt der Test
 * 30 s im Timeout und meldet „Chart fehlt", obwohl die App korrekt ist.
 *
 * Diese Fixtures sind **ausschließlich** an das explizite URL-Flag gebunden:
 * ohne `fixtures=1` passiert hier gar nichts. Sie erzeugen eine rein lokale,
 * reproduzierbare Reihe (fester Seed, keine Zufallsquelle) und halten den
 * letzten Bar am Leben, damit Session-Chip, Countdown und Indikatoren echte
 * Arbeit haben.
 */

const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

const BAR_COUNT = 400;

/**
 * Deterministische Kerzen: zwei überlagerte Sinuswellen plus Drift. Kein
 * `Math.random`, damit Screenshots und Zahlen zwischen Läufen identisch sind.
 */
export function deterministicCandles(count: number, stepMs: number, endTime: number, start = 100): Candle[] {
  const candles: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i += 1) {
    const drift = Math.sin(i / 9) * 0.9 + Math.cos(i / 23) * 0.5 + 0.03;
    const open = price;
    const close = Math.max(1, open + drift);
    const wick = 0.35 + Math.abs(Math.sin(i / 7)) * 0.5;
    candles.push({
      t: endTime - (count - 1 - i) * stepMs,
      o: open,
      h: Math.max(open, close) + wick,
      l: Math.min(open, close) - wick,
      c: close,
      v: 10 + Math.abs(drift) * 40 + Math.abs(Math.sin(i / 5)) * 15,
    });
    price = close;
  }
  return candles;
}

/**
 * Alle feedIds, die der Chart aktuell liest – **pro Pane**.
 *
 * Wichtig für Multi-Pane-Layouts (2x1/2x2): jedes Pane hat seinen eigenen
 * Timeframe (`paneTimeframe[paneId]`). Nur Pane-1 zu seeden ließ die anderen
 * Panes leer; bei Layout-Wechsel oder TF-Sync verschwanden dann Legenden und
 * Canvases, und die QA-Suiten maßen gegen ein leeres Grid. Diese Funktion
 * liefert deshalb jede tatsächlich benötigte Kombination.
 */
export function resolveFixtureFeeds(): Array<{ id: string; timeframe: Timeframe }> {
  const app = useAppStore.getState();
  const chart = useChartStore.getState();
  const exchange = useExchangeStore.getState();
  const selectionState = {
    country: exchange.country,
    reach: exchange.reach,
    unsupported: exchange.unsupported,
    preferred: exchange.preferred,
  };

  /*
   * Timeframe-Auflösung exakt wie in ChartGrid:
   *   syncTimeframe ? globalTimeframe : (paneTimeframe[pane] ?? globalTimeframe)
   * Der **globale** Timeframe liegt im AppStore (`selectTimeframe`), nicht im
   * ChartStore – ein früherer Entwurf las nur `paneTimeframe` und seedete
   * deshalb nach einem 5m-Wechsel weiter 1h-Feeds: alle Panes blieben leer.
   */
  const syncTimeframe = chart.syncTimeframe;
  const globalTimeframe = app.timeframe;
  const out = new Map<string, Timeframe>();
  for (const pane of app.panes) {
    // Pane-Token: explizit gewähltes Pane-Token gewinnt, sonst der aktive Token
    // (identisch zur Auflösung in ChartGrid).
    const token = pane.tokenId ? (TOKEN_INDEX[pane.tokenId] ?? app.activeToken) : app.activeToken;
    if (!token) continue;
    const paneTf = chart.paneTimeframe?.[pane.id] ?? null;
    const timeframe: Timeframe = syncTimeframe ? globalTimeframe : (paneTf ?? globalTimeframe);
    const selection = resolveExchangeSelection(token.symbol, timeframe, token.exchange, selectionState);
    if (!selection) continue;
    out.set(`${selection.exchange}:${token.symbol}:${timeframe}`, timeframe);
  }
  // Pane-1/Global immer mitnehmen, selbst wenn die Selektion oben scheitert.
  if (out.size === 0) {
    const timeframe: Timeframe = globalTimeframe ?? '1h';
    const selection = resolveExchangeSelection(app.activeToken.symbol, timeframe, app.activeToken.exchange, selectionState);
    if (selection) out.set(`${selection.exchange}:${app.activeToken.symbol}:${timeframe}`, timeframe);
  }
  return [...out.entries()].map(([id, timeframe]) => ({ id, timeframe }));
}

/**
 * Seedet die Fixtures und hält sie aktuell. Gibt eine Aufräumfunktion zurück.
 *
 * Der Timer schreibt nur in den Store (kein Render-Loop, kein Netz): der letzte
 * Bar „lebt", damit Countdown, Session-Stats und Live-Indikatoren sichtbar
 * arbeiten – genau die Interaktionen, die die QA-Suiten prüfen.
 */
export function installQaFixtures(): () => void {
  let cancelled = false;
  const seeded = new Set<string>();
  let tick = 0;
  const timers: number[] = [];

  const seedFresh = (id: string, timeframe: Timeframe) => {
    const stepMs = TF_MS[timeframe] ?? 3_600_000;
    const now = Math.floor(Date.now() / stepMs) * stepMs;
    const candles = deterministicCandles(BAR_COUNT, stepMs, now);
    const store = useMarketStore.getState();
    store.seedCandles(id, candles);
    // `seedCandles` setzt bewusst keinen Status – der kommt vom Feed. Für die
    // QA muss der Chart „offen" aussehen, sonst blenden Pane-Header und
    // Status-LED den Live-Zustand aus und die Suiten prüfen das Falsche.
    useMarketStore.getState().setFeedStatus(id, 'open');
    seeded.add(id);
  };

  /*
   * Nach dem ersten Seed wird **nicht** das Array neu geschrieben, sondern nur
   * der lebende Bar fortgeschrieben (`upsertCandle`) – genau wie ein echter
   * Feed. Ein Sekunden-`seedCandles` mit 400 neuen Objekten erzeugte sonst
   * jede Sekunde einen Chart-Re-Render; die Layout-Shift-Messung der
   * Interaction-Suite schlug daran fehl (ΔCLS ≈ 0,012), und der Fehler lag
   * im Fixture, nicht in der App.
   */
  const tickFixtures = () => {
    if (cancelled) return;
    const feeds = resolveFixtureFeeds();
    if (feeds.length === 0) return;

    tick += 1;
    const wick = 0.35 + Math.abs(Math.sin(tick / 7)) * 0.5;
    const drift = Math.sin(tick / 9) * 0.9 + Math.cos(tick / 23) * 0.5 + 0.03;

    for (const feed of feeds) {
      // Neues Pane, Token- oder Timeframe-Wechsel ⇒ eigene Reihe seeden.
      if (!seeded.has(feed.id)) {
        seedFresh(feed.id, feed.timeframe);
        continue;
      }
      /*
       * Bestehende Reihe nur fortschreiben: **ein** `upsertCandle` auf den
       * lebenden Bar statt 400 neuer Objekte. Ein Sekunden-Reseed erzeugte
       * sonst einen Re-Render pro Sekunde und damit Layout-Shifts, die die
       * Interaction-Suite (zu Recht) als Jitter gemeldet hat.
       */
      const live = useMarketStore.getState().feeds[feed.id]?.candles ?? [];
      const last = live[live.length - 1];
      if (!last) continue;
      const close = Math.max(1, last.c + drift * 0.05);
      useMarketStore.getState().upsertCandle(feed.id, {
        t: last.t,
        o: last.o,
        h: Math.max(last.h, close) + wick * 0.05,
        l: Math.min(last.l, close) - wick * 0.05,
        c: close,
        v: last.v + 0.4,
      });
    }
  };

  tickFixtures();
  timers.push(window.setInterval(tickFixtures, 1_000) as unknown as number);

  return () => {
    cancelled = true;
    for (const timer of timers) window.clearInterval(timer);
  };
}

/** True, wenn die aktuelle URL die Fixtures anfordert. */
export function qaFixturesRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fixtures') === '1';
}
