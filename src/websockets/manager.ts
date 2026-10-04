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
  private readonly seedControllers = new Map<string, AbortController>();
  private readonly seedRetryTimers = new Map<string, number>();
  private readonly seedRetryAttempts = new Map<string, number>();

  constructor(
    private readonly adapter: ExchangeAdapter,
    private readonly urlKey: string,
  ) {
    const dynamic = urlKey.startsWith('dynamic:');
    this.socket = new ManagedSocket({
      id: `${adapter.id}@${dynamic ? 'dynamic' : urlKey.replace(/^wss?:\/\//, '')}`,
      url: dynamic ? undefined : urlKey,
      resolveUrl: dynamic ? (signal) => (adapter.resolveUrl ? adapter.resolveUrl(signal) : Promise.resolve(adapter.url)) : undefined,
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
      this.seedControllers.get(id)?.abort();
      this.seedControllers.delete(id);
      this.seeding.delete(id);
      this.clearSeedRetry(id);
      this.seedRetryAttempts.delete(id);
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
    for (const controller of this.seedControllers.values()) controller.abort();
    for (const timer of this.seedRetryTimers.values()) window.clearTimeout(timer);
    this.seedControllers.clear();
    this.seedRetryTimers.clear();
    this.seedRetryAttempts.clear();
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
        // Only the socket-seeded venue can satisfy history from a websocket
        // message. Other adapters' live ticks must not suppress their REST seed.
        if (this.adapter.seedsViaSocket) this.seeded.add(feedId(event.key));
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
    const ownsKline = [...this.channels.values()].some((entry) => entry.ref.kind === 'kline');
    if (ownsKline && status === 'open') {
      const current = useExchangeStore.getState().reach[this.adapter.id];
      if (current?.status !== 'ok' || current.note !== 'ws-open') {
        // A successful browser socket is stronger evidence than a stale REST
        // probe: remember it so automatic routing does not avoid a usable venue.
        useExchangeStore.getState().setReach(this.adapter.id, { status: 'ok', ms: null, note: 'ws-open' });
      }
    } else if (ownsKline && status === 'reconnecting' && (info?.attempt ?? 0) >= 4) {
      const current = useExchangeStore.getState().reach[this.adapter.id];
      if (current?.status !== 'error' || current.note !== 'ws-reconnect') {
        // Four failed connection cycles indicate this visitor cannot currently
        // use this venue. The selection hook can move the chart to a different
        // CEX; the old stream is then released instead of retrying forever.
        useExchangeStore.getState().setReach(this.adapter.id, { status: 'error', ms: null, note: 'ws-reconnect' });
      }
    }
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
      const controller = new AbortController();
      this.seedControllers.set(id, controller);
      void this.seed(entry.ref.key, controller);
    }
  }

  private async seed(key: FeedKey, controller: AbortController): Promise<void> {
    const id = feedId(key);
    const signal = controller.signal;
    const startedAt = Date.now();
    try {
      const candles = await this.seedWithFallback(key, signal);
      // A released feed must not write into the store, and an empty result is
      // not a successful seed: keep the last visible candles and retry later.
      if (signal.aborted || !this.channels.has(this.adapter.klineChannel(key))) return;
      if (candles.length === 0) {
        useMarketStore.getState().setFeedStatus(id, this.socket.status, { note: 'seed-pending' });
        this.scheduleSeedRetry(key);
        return;
      }
      this.seeded.add(id);
      this.clearSeedRetry(id);
      this.seedRetryAttempts.delete(id);
      const store = useMarketStore.getState();
      const current = store.feeds[id];
      const seedRows = new Map(candles.map((candle) => [candle.t, candle]));
      // A live tick may arrive while REST history is in flight. Merge it into
      // the seed (live candle wins for equal timestamps) instead of replacing
      // fresh stream data with an older snapshot.
      if (current?.updatedAt != null && current.updatedAt > startedAt) {
        for (const candle of current.candles) seedRows.set(candle.t, candle);
      }
      const combined = [...seedRows.values()].sort((a, b) => a.t - b.t).slice(-500);
      store.seedCandles(id, combined);
      const last = combined[combined.length - 1] ?? null;
      this.derivers.get(id)?.setSeed(last);
    } catch (error) {
      if (signal.aborted || !this.channels.has(this.adapter.klineChannel(key))) return;
      const exchanges = useExchangeStore.getState();
      let note = 'seed-failed';
      if (error instanceof UnsupportedPairError) {
        exchanges.markUnsupported(key.exchange, key.symbol);
        note = 'unsupported';
      } else if (error instanceof FeedBlockedError) {
        exchanges.setReach(key.exchange, { status: 'blocked', ms: null, note: 'region' });
        note = 'region';
      } else if (error instanceof Error && error.name === 'AbortError') {
        return;
      } else {
        this.scheduleSeedRetry(key);
      }
      useMarketStore.getState().setFeedStatus(id, this.socket.status, { note });
    } finally {
      if (this.seedControllers.get(id) === controller) {
        this.seedControllers.delete(id);
        this.seeding.delete(id);
      }
    }
  }

  private scheduleSeedRetry(key: FeedKey): void {
    const id = feedId(key);
    if (this.seedRetryTimers.has(id) || !this.channels.has(this.adapter.klineChannel(key))) return;
    const attempt = (this.seedRetryAttempts.get(id) ?? 0) + 1;
    this.seedRetryAttempts.set(id, attempt);
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(attempt - 1, 4));
    const timer = window.setTimeout(() => {
      this.seedRetryTimers.delete(id);
      if (!this.seeded.has(id) && this.channels.has(this.adapter.klineChannel(key))) this.seedAll();
    }, delay);
    this.seedRetryTimers.set(id, timer);
  }

  private clearSeedRetry(id: string): void {
    const timer = this.seedRetryTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.seedRetryTimers.delete(id);
  }

  /**
   * Try the selected venue first. If its REST endpoint is CORS-blind, blocked,
   * or temporarily down, race a small group of configured CORS-readable seed
   * candidates and cancel the losers as soon as one history response succeeds.
   */
  private async seedWithFallback(key: FeedKey, signal: AbortSignal): Promise<Candle[]> {
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    let directError: unknown;
    const staleAgeByVenue = new Map<ExchangeId, number>();

    if (restReachableFromBrowser(key.exchange)) {
      try {
        const candles = await fetchSeed(key, signal, 7_000, (ageMs) => staleAgeByVenue.set(key.exchange, ageMs));
        if (candles.length > 0) {
          const staleAgeMs = staleAgeByVenue.get(key.exchange);
          if (staleAgeMs != null) {
            useMarketStore.getState().setFeedStatus(feedId(key), this.socket.status, {
              note: `seed-stale:${key.exchange}:${Math.floor(staleAgeMs / 1000)}`,
            });
          }
          return candles;
        }
      } catch (error) {
        directError = error;
        this.recordSeedFailure(key.exchange, key.symbol, error);
      }
    }

    const candidates = CORS_FRIENDLY_SEEDS.filter(
      (venue) => venue !== key.exchange && ADAPTERS[venue]?.timeframes.includes(key.timeframe),
    );
    const batchSize = 3;

    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const batch = candidates.slice(offset, offset + batchSize);
      const controller = new AbortController();
      const abortBatch = (): void => controller.abort();
      signal.addEventListener('abort', abortBatch, { once: true });
      if (signal.aborted) abortBatch();

      try {
        const winner = await Promise.any(
          batch.map(async (venue) => {
            try {
              const candles = await fetchSeed(
                { ...key, exchange: venue },
                controller.signal,
                7_000,
                (ageMs) => staleAgeByVenue.set(venue, ageMs),
              );
              if (candles.length === 0) throw new Error('empty seed');
              return { venue, candles };
            } catch (error) {
              this.recordSeedFailure(venue, key.symbol, error);
              throw error;
            }
          }),
        );
        controller.abort(); // stop duplicate work as soon as one provider wins
        const staleAgeMs = staleAgeByVenue.get(winner.venue);
        const note = staleAgeMs == null
          ? `seed-via:${winner.venue}`
          : `seed-stale:${winner.venue}:${Math.floor(staleAgeMs / 1000)}`;
        useMarketStore.getState().setFeedStatus(feedId(key), this.socket.status, { note });
        return winner.candles;
      } catch {
        controller.abort();
      } finally {
        signal.removeEventListener('abort', abortBatch);
      }
    }

    if (directError instanceof UnsupportedPairError || directError instanceof FeedBlockedError) throw directError;
    return [];
  }

  private recordSeedFailure(exchange: ExchangeId, symbol: string, error: unknown): void {
    if (error instanceof UnsupportedPairError) {
      useExchangeStore.getState().markUnsupported(exchange, symbol);
    } else if (error instanceof FeedBlockedError) {
      useExchangeStore.getState().setReach(exchange, { status: 'blocked', ms: null, note: 'region' });
    }
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
 * from effects – the manager owns sockets, backoff, history seeding, candle
 * derivation and whale routing for the configured venue adapters.
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
