// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useExchangeStore } from '@/store/useExchangeStore';
import { useMarketStore } from '@/store/useMarketStore';
import { CandleDeriver } from './derive';
import { ADAPTERS } from './registry';
import { CORS_FRIENDLY_SEEDS, fetchSeed, restReachableFromBrowser, UnsupportedPairError } from './rest';
import { ManagedSocket } from './socket';
import { whaleTracker } from './whale';
import {
  FeedBlockedError,
  feedId,
  type Candle,
  type ExchangeAdapter,
  type ExchangeId,
  type FeedKey,
  type FeedStatus,
  type RawTrade,
} from './types';

export interface WhaleTarget {
  exchange: ExchangeId;
  symbol: string;
}

/** KuCoin hands out a token first, so its endpoint is resolved at connect time. */
function dynamicUrl(adapter: ExchangeAdapter): string {
  return `dynamic:${adapter.id}`;
}

/** Which endpoint a channel belongs to (OKX needs two, most exchanges one). */
function channelUrl(adapter: ExchangeAdapter, channel: string): string {
  if (adapter.resolveUrl) return dynamicUrl(adapter);
  return adapter.urlFor ? adapter.urlFor(channel) : adapter.url;
}

/** Adapters may return one message or a batch (Kraken, HTX, Gate, …). */
function transmit(socket: ManagedSocket, payload: unknown): void {
  if (payload === null || payload === undefined) return;
  if (Array.isArray(payload)) {
    for (const entry of payload) socket.send(entry);
    return;
  }
  socket.send(payload);
}

/**
 * Live trade bus: every raw trade that arrives on any subscribed trade
 * channel is fanned out here (used by the CVD accumulator in `useProStore`).
 * Registering is cheap; the set stays empty when nobody listens.
 */
export const tradeBus = new Set<(trade: RawTrade) => void>();

type ChannelRef = { kind: 'kline'; key: FeedKey } | { kind: 'trade'; exchangeSymbol: string };

function channelOf(adapter: ExchangeAdapter, ref: ChannelRef): string {
  return ref.kind === 'kline'
    ? adapter.klineChannel(ref.key)
    : adapter.tradeChannel(ref.exchangeSymbol);
}

/**
 * One resilient socket per (exchange, endpoint), multiplexing N kline channels
 * and M trade channels. Channels are reference-counted, so two panes watching
 * BTC/USDT share a single subscription and the socket closes as soon as the
 * last consumer releases it.
 */
class ExchangeStream {
  private readonly socket: ManagedSocket;
  private readonly channels = new Map<string, { ref: ChannelRef; count: number }>();
  private readonly derivers = new Map<string, CandleDeriver>();
  private readonly subscribed = new Set<string>();
  private readonly seeded = new Set<string>();
  private readonly seeding = new Set<string>();

  constructor(
    private readonly adapter: ExchangeAdapter,
    private readonly urlKey: string,
  ) {
    const dynamic = urlKey.startsWith('dynamic:');
    this.socket = new ManagedSocket({
      id: `${adapter.id}@${dynamic ? 'dynamic' : urlKey.replace(/^wss?:\/\//, '')}`,
      url: dynamic ? undefined : urlKey,
      resolveUrl: dynamic ? () => (adapter.resolveUrl ? adapter.resolveUrl() : Promise.resolve(adapter.url)) : undefined,
      binary: adapter.binary,
      decode: adapter.decode,
      keepalive: adapter.keepalive,
      onMessage: (payload) => this.handleMessage(payload),
      onOpen: () => {
        // Re-subscribe everything this stream owns (also used on reconnect).
        this.subscribed.clear();
        this.reconcile();
      },
      onStatus: (status, info) => this.propagateStatus(status, info),
      heartbeat: adapter.heartbeat,
      watchdogMs: 45_000,
    });
  }

  get isEmpty(): boolean {
    return this.channels.size === 0;
  }

  get status(): FeedStatus {
    return this.socket.status;
  }

  /** Registers a consumer for a channel (reference-counted). */
  add(ref: ChannelRef): void {
    const channel = channelOf(this.adapter, ref);
    const existing = this.channels.get(channel);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.channels.set(channel, { ref, count: 1 });
    if (ref.kind === 'kline') {
      useMarketStore.getState().setFeedStatus(feedId(ref.key), this.socket.status === 'open' ? 'open' : 'connecting');
      if (this.adapter.derivesCandles) {
        this.derivers.set(feedId(ref.key), new CandleDeriver(ref.key.timeframe));
      }
    }
    this.reconcile();
    // Channels added while the socket is already open never see the onOpen
    // hook – seed them here, otherwise a timeframe switch would show an empty
    // chart until two live bars accumulate (the WebSocket only pushes the
    // *current* candle).
    if (ref.kind === 'kline' && this.socket.status === 'open') this.seedAll();
  }

  /** Drops one consumer. The subscription ends with the last one. */
  remove(ref: ChannelRef): boolean {
    const channel = channelOf(this.adapter, ref);
    const existing = this.channels.get(channel);
    if (!existing) return false;
    existing.count -= 1;
    if (existing.count > 0) return true;
    this.channels.delete(channel);
    if (existing.ref.kind === 'kline') {
      const id = feedId(existing.ref.key);
      this.derivers.delete(id);
      this.seeded.delete(id);
      // Letzter Konsument weg → Slice als "released" markieren: bleibt als
      // Warm-Cache liegen (Zurückwechseln zeigt sofort alte Kerzen) und wird
      // per LRU verdrängt. Ohne diese Grenze wächst `feeds` pro besuchtem
      // Token/TF/Venue für die ganze Session – ein schleichendes Speicherleck.
      useMarketStore.getState().markFeedReleased(id);
    }
    this.reconcile();
    return true;
  }

  shutdown(): void {
    // Auch beim harten Abbau (Venue-Wechsel, releaseAll) die Kline-Slices als
    // released markieren – sonst umgeht dieser Pfad die LRU-Buchhaltung.
    const store = useMarketStore.getState();
    for (const entry of this.channels.values()) {
      if (entry.ref.kind === 'kline') store.markFeedReleased(feedId(entry.ref.key));
    }
    this.channels.clear();
    this.derivers.clear();
    this.subscribed.clear();
    this.seeded.clear();
    this.seeding.clear();
    this.socket.close();
  }

  /**
   * Wake-up after hidden-tab throttling / offline phases: hands through to
   * `ManagedSocket.resume()`, which reconnects dead or backoff-exhausted
   * sockets immediately instead of waiting for the watchdog.
   */
  revive(): void {
    if (this.isEmpty) return;
    this.socket.resume();
  }

  /* ------------------------------- internals ------------------------------ */

  private reconcile(): void {
    if (this.isEmpty) {
      this.shutdown();
      return;
    }

    const desired = new Set(this.channels.keys());
    const add = [...desired].filter((channel) => !this.subscribed.has(channel));
    const remove = [...this.subscribed].filter((channel) => !desired.has(channel));

    if (this.socket.status === 'open') {
      if (remove.length > 0) transmit(this.socket, this.adapter.unsubscribe(remove));
      if (add.length > 0) transmit(this.socket, this.adapter.subscribe(add));
      for (const channel of add) this.subscribed.add(channel);
      for (const channel of remove) this.subscribed.delete(channel);
    } else {
      // (Re)connect – the onOpen handler replays `desired` in one message.
      this.socket.connect();
    }
  }

  private handleMessage(payload: unknown): void {
    const events = this.adapter.parse(payload);
    if (events.length === 0) {
      this.reportUpstreamError(payload);
      return;
    }

    const store = useMarketStore.getState();
    for (const event of events) {
      if (event.type === 'candle') {
        store.upsertCandle(feedId(event.key), event.candle);
        // Crypto.com sends its history inside the subscribe response.
        this.seeded.add(feedId(event.key));
      } else {
        whaleTracker.observe(event.trade);
        this.derive(event.trade);
        for (const listener of tradeBus) listener(event.trade);
      }
    }
  }

  /** Venues without a candle channel: build candles from the trade stream. */
  private derive(trade: RawTrade): void {
    if (!this.adapter.derivesCandles || this.derivers.size === 0) return;
    const store = useMarketStore.getState();
    for (const entry of this.channels.values()) {
      if (entry.ref.kind !== 'kline') continue;
      const key = entry.ref.key;
      if (key.symbol !== trade.symbol) continue;
      const id = feedId(key);
      const deriver = this.derivers.get(id);
      if (!deriver) continue;
      for (const candle of deriver.push(trade)) store.upsertCandle(id, candle);
    }
  }

  /** Surface subscribe failures instead of leaving a silently empty chart. */
  private reportUpstreamError(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return;
    const record = payload as Record<string, unknown>;
    const isError =
      record.event === 'error' ||
      typeof record.errorMessage === 'string' ||
      typeof record.error === 'string' ||
      record.type === 'error';
    if (!isError) return;
    const message = record.msg ?? record.errorMessage ?? record.error ?? record.data;
    console.warn(`[nodechart] ${this.adapter.id} stream error:`, message);

    const text = String(message).toLowerCase();
    const missingPair = /not exist|unknown|invalid|does not|no such|not found|404/.test(text);
    if (missingPair) {
      for (const entry of this.channels.values()) {
        if (entry.ref.kind === 'kline') {
          useExchangeStore.getState().markUnsupported(entry.ref.key.exchange, entry.ref.key.symbol);
          useMarketStore.getState().setFeedStatus(feedId(entry.ref.key), this.socket.status, {
            note: 'unsupported',
          });
        }
      }
    }
  }

  /**
   * Sofort-Status, wenn das Betriebssystem Netzverlust meldet (`offline`-Event):
   * TCP hängt ohne RST (wie Kabel gezogen) – ohne diesen Hook würde die UI bis
   * zu 45 s (Watchdog) ein falsches LIVE zeigen.
   */
  flagOffline(): void {
    this.propagateStatus('reconnecting', { note: 'network-offline' });
  }

  private propagateStatus(
    status: FeedStatus,
    info?: { attempt?: number; note?: string | null },
  ): void {
    const store = useMarketStore.getState();
    for (const entry of this.channels.values()) {
      if (entry.ref.kind !== 'kline') continue;
      store.setFeedStatus(feedId(entry.ref.key), status, info);
    }
    // History must not depend on the socket: a venue whose WS host or token
    // endpoint is unreachable (regional block, outage) still deserves candles –
    // `seedWithFallback` borrows them from a CORS-friendly neighbour. The
    // seeded/seeding guards make repeated status flips cheap (seed once/feed).
    if (status === 'open' || status === 'connecting' || status === 'reconnecting' || status === 'error') {
      this.seedAll();
    }
  }

  private seedAll(): void {
    // Socket-seeded venues receive history with the subscription – but only
    // while that socket actually opens. If it never does, fall through to the
    // REST path so the chart still gets (neighbour-seeded) candles.
    if (this.adapter.seedsViaSocket && this.socket.status === 'open') return;
    for (const entry of this.channels.values()) {
      if (entry.ref.kind !== 'kline') continue;
      const id = feedId(entry.ref.key);
      if (this.seeded.has(id) || this.seeding.has(id)) continue;
      this.seeding.add(id);
      void this.seed(entry.ref.key);
    }
  }

  private async seed(key: FeedKey): Promise<void> {
    const id = feedId(key);
    try {
      const candles = await this.seedWithFallback(key);
      // Kanal während des Flights freigegeben (Token-/TF-Wechsel)? Dann darf
      // der Seed weder den Store schreiben (dropFeed lief bereits) noch die
      // seeded-Menge verunreinigen.
      if (!this.channels.has(this.adapter.klineChannel(key))) return;
      this.seeded.add(id);
      if (candles.length > 0) {
        useMarketStore.getState().seedCandles(id, candles);
        const last = candles[candles.length - 1] ?? null;
        this.derivers.get(id)?.setSeed(last);
      }
    } catch (error) {
      const exchanges = useExchangeStore.getState();
      let note = 'seed-failed';
      if (error instanceof UnsupportedPairError) {
        // The pair is not listed here – let the picker choose another venue.
        exchanges.markUnsupported(key.exchange, key.symbol);
        note = 'unsupported';
      } else if (error instanceof FeedBlockedError) {
        // Whole venue unreachable from this region – remember it for ranking.
        exchanges.setReach(key.exchange, { status: 'blocked', ms: null, note: 'region' });
        note = 'region';
      }
      useMarketStore.getState().setFeedStatus(id, this.socket.status, { note });
    } finally {
      this.seeding.delete(id);
    }
  }

  /**
   * History of the chosen venue, or – when the browser cannot read that REST
   * endpoint (CORS / outage) – history of the nearest CORS-friendly venue.
   * Live updates always keep flowing over the chosen venue's socket, so a
   * bybit chart still *is* a bybit chart; only its first candles may come
   * from a neighbour with identical market data.
   */
  private async seedWithFallback(key: FeedKey): Promise<Candle[]> {
    // CORS-blinde Venues im Browser gar nicht erst anfunken (Konsolen-Lärm +
    // tote Roundtrips) – direkt die Nachbar-Liste darunter nutzen.
    if (restReachableFromBrowser(key.exchange)) {
      try {
        const candles = await fetchSeed(key);
        if (candles.length > 0) return candles;
      } catch (error) {
        if (error instanceof UnsupportedPairError || error instanceof FeedBlockedError) throw error;
        // CORS/HTTP trouble from the page – try the neighbour venues below.
      }
    }
    for (const venue of CORS_FRIENDLY_SEEDS) {
      if (venue === key.exchange) continue;
      if (!ADAPTERS[venue]?.timeframes.includes(key.timeframe)) continue;
      try {
        const candles = await fetchSeed({ ...key, exchange: venue });
        if (candles.length > 0) {
          const id = feedId(key);
          useMarketStore.getState().setFeedStatus(id, this.socket.status, { note: `seed-via:${venue}` });
          return candles;
        }
      } catch {
        // next venue
      }
    }
    return [];
  }
}

/** All streams of one exchange (OKX: candles + trades on separate endpoints). */
class ExchangeConnection {
  private readonly streams = new Map<string, ExchangeStream>();
  /** Gewollte Kline-Feeds (feedId → key) für den setFeeds-Diff. */
  private readonly feeds = new Map<string, FeedKey>();

  constructor(private readonly adapter: ExchangeAdapter) {}

  get isEmpty(): boolean {
    return this.streams.size === 0;
  }

  ensureFeed(key: FeedKey): void {
    this.streamFor(this.adapter.klineChannel(key)).add({ kind: 'kline', key });
  }

  releaseFeed(key: FeedKey): void {
    const channel = this.adapter.klineChannel(key);
    this.streamFor(channel).remove({ kind: 'kline', key });
    this.prune(channel);
  }

  /**
   * Atomarer Soll/Ist-Abgleich einer Menge von Kline-Feeds.
   *
   * Erst ADD, dann RELEASE, dann PRUNE: Dadurch kippt kein Stream auch nur
   * kurz auf null Referenzen – ein TF-/Token-Wechsel auf derselben Venue
   * bleibt ein UNSUB+SUB auf dem offenen Socket statt Close+Reconnect
   * (Reconnect-Churn war der Hauptbefund des Lifecycle-Audits).
   */
  setFeeds(next: FeedKey[]): void {
    const wanted = new Map(next.map((key) => [feedId(key), key]));

    // 1) Neue Feeds anmelden (Referenzzählung im Stream).
    for (const [id, key] of wanted) {
      if (this.feeds.has(id)) continue;
      this.feeds.set(id, key);
      this.ensureFeed(key);
    }

    // 2) Abgemeldete Feeds freigeben – NACH den Adds.
    const releasedChannels: string[] = [];
    for (const [id, key] of [...this.feeds]) {
      if (wanted.has(id)) continue;
      this.feeds.delete(id);
      const channel = this.adapter.klineChannel(key);
      releasedChannels.push(channel);
      this.streamFor(channel).remove({ kind: 'kline', key });
    }

    // 3) Leer gewordene Streams schließen (echte Zombie-Prävention).
    for (const channel of releasedChannels) this.prune(channel);
  }

  flagOffline(): void {
    for (const stream of this.streams.values()) stream.flagOffline();
  }

  reviveAll(): void {
    for (const stream of this.streams.values()) stream.revive();
  }

  ensureTrade(symbol: string): void {
    const exchangeSymbol = this.adapter.toExchangeSymbol(symbol);
    this.streamFor(this.adapter.tradeChannel(exchangeSymbol)).add({ kind: 'trade', exchangeSymbol });
  }

  releaseTrade(symbol: string): void {
    const exchangeSymbol = this.adapter.toExchangeSymbol(symbol);
    const channel = this.adapter.tradeChannel(exchangeSymbol);
    this.streamFor(channel).remove({ kind: 'trade', exchangeSymbol });
    this.prune(channel);
  }

  shutdown(): void {
    for (const stream of this.streams.values()) stream.shutdown();
    this.streams.clear();
    this.feeds.clear();
  }

  private streamFor(channel: string): ExchangeStream {
    const url = channelUrl(this.adapter, channel);
    let stream = this.streams.get(url);
    if (!stream) {
      stream = new ExchangeStream(this.adapter, url);
      this.streams.set(url, stream);
    }
    return stream;
  }

  private prune(channel: string): void {
    const url = channelUrl(this.adapter, channel);
    const stream = this.streams.get(url);
    if (stream?.isEmpty) {
      stream.shutdown();
      this.streams.delete(url);
    }
  }
}

/**
 * App-wide singleton. Mount <MarketDataProvider/> once and call ensure/release
 * from effects – the manager owns sockets, backoff, seeding, candle derivation
 * and whale routing across all twelve venues.
 */
class CexSocketManager {
  private readonly connections = new Map<ExchangeId, ExchangeConnection>();
  private whaleTargets: WhaleTarget[] = [];

  /**
   * Deklarative Feed-Menge des Views (ein Aufruf pro Render-Pass des
   * Providers). Diff pro Venue über `ExchangeConnection.setFeeds` – Adds vor
   * Releases, damit offene Sockets bei Token-/TF-/Venue-Wechsel weiterlaufen
   * und nur wirklich verwaiste Verbindungen geschlossen werden.
   */
  setFeeds(keys: FeedKey[]): void {
    const byExchange = new Map<ExchangeId, FeedKey[]>();
    for (const key of keys) {
      const list = byExchange.get(key.exchange) ?? [];
      list.push(key);
      byExchange.set(key.exchange, list);
    }

    const touched = new Set<ExchangeId>([...byExchange.keys(), ...this.connections.keys()]);
    for (const exchange of touched) {
      const wanted = byExchange.get(exchange) ?? [];
      const connection = this.connections.get(exchange);
      if (!connection) {
        if (wanted.length > 0) this.connection(exchange).setFeeds(wanted);
        continue;
      }
      connection.setFeeds(wanted);
      if (wanted.length === 0) this.prune(exchange);
    }
  }

  /**
   * Reaktiviert gedrosselte/gestorbene Sockets nach `visibilitychange`
   * (Tab wieder sichtbar) oder `online`: Hintergrund-Tabs throttle'n
   * Heartbeats und Reconnect-Timer, der Server trennt uns – resume()
   * verbindet sofort neu statt bis zu 45 s auf den Watchdog zu warten.
   */
  resumeAll(): void {
    for (const connection of this.connections.values()) connection.reviveAll();
  }

  /** Siehe ExchangeStream.flagOffline – Fan-out über alle Venues. */
  markNetworkOffline(): void {
    for (const connection of this.connections.values()) connection.flagOffline();
  }

  /**
   * Declarative trade-channel set for the whale stream. Diffed against the
   * previous call so toggling the stream or the watchlist never leaks subs.
   */
  setWhaleTargets(targets: WhaleTarget[]): void {
    const previous = this.whaleTargets;
    this.whaleTargets = targets;

    const wanted = new Map<ExchangeId, Set<string>>();
    for (const target of targets) {
      const set = wanted.get(target.exchange) ?? new Set<string>();
      set.add(target.symbol);
      wanted.set(target.exchange, set);
    }

    for (const [exchange, symbols] of wanted) {
      const connection = this.connection(exchange);
      const previousForExchange = new Set(
        previous.filter((t) => t.exchange === exchange).map((t) => t.symbol),
      );
      for (const symbol of symbols) {
        if (!previousForExchange.has(symbol)) connection.ensureTrade(symbol);
      }
    }

    for (const target of previous) {
      const stillWanted = wanted.get(target.exchange)?.has(target.symbol) ?? false;
      if (stillWanted) continue;
      const connection = this.connections.get(target.exchange);
      if (!connection) continue;
      connection.releaseTrade(target.symbol);
      this.prune(target.exchange);
    }
  }

  releaseAll(): void {
    for (const connection of this.connections.values()) connection.shutdown();
    this.connections.clear();
    this.whaleTargets = [];
    whaleTracker.drain();
  }

  private connection(exchange: ExchangeId): ExchangeConnection {
    let connection = this.connections.get(exchange);
    if (!connection) {
      connection = new ExchangeConnection(ADAPTERS[exchange]);
      this.connections.set(exchange, connection);
    }
    return connection;
  }

  private prune(exchange: ExchangeId): void {
    const connection = this.connections.get(exchange);
    if (connection?.isEmpty) {
      connection.shutdown();
      this.connections.delete(exchange);
    }
  }
}

export const cexManager = new CexSocketManager();
