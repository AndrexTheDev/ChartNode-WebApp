// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { ExponentialBackoff } from './backoff';
import type { FeedStatus } from './types';

export interface ManagedSocketOptions {
  id: string;
  /** Static endpoint. Ignored when `resolveUrl` is set. */
  url?: string;
  /** Async endpoint (e.g. KuCoin's token handshake). Re-run on every reconnect. */
  resolveUrl?: () => Promise<string>;
  /** Called with every parsed message payload. */
  onMessage: (payload: unknown) => void;
  /** Called on every (re)connect – send your SUBSCRIBE ops here. */
  onOpen: (send: (payload: unknown) => void) => void;
  onStatus: (status: FeedStatus, info?: { attempt?: number; note?: string | null }) => void;
  /** Application-level keepalive (Bybit/OKX/KuCoin/Bitget require it). */
  heartbeat?: { intervalMs: number; payload: () => unknown | null } | null;
  /** Server frames are binary and need decoding (HTX gzip). */
  binary?: boolean;
  decode?: (raw: ArrayBuffer, send: (payload: unknown) => void) => unknown | Promise<unknown>;
  /** Server-initiated pings. Return true to swallow the frame. */
  keepalive?: (payload: unknown, send: (payload: unknown) => void) => boolean;
  /** If no message arrives within this window the socket is considered dead. */
  watchdogMs?: number;
  maxReconnectAttempts?: number;
}

/**
 * One resilient WebSocket connection.
 *
 * Handles: (async) connect, auto-resubscribe on open, exponential+jitter
 * reconnect, application heartbeat, server pings, binary/gzip decoding and a
 * watchdog that kills silent sockets (a common failure mode where the TCP
 * connection survives but the exchange stopped pushing). Browser-only by
 * design – never imported from Server Components.
 */
export class ManagedSocket {
  private ws: WebSocket | null = null;
  private backoff: ExponentialBackoff;
  private heartbeatTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private lastMessageAt = 0;
  private intentionallyClosed = false;
  private connecting: Promise<void> | null = null;
  private currentStatus: FeedStatus = 'idle';

  constructor(private readonly options: ManagedSocketOptions) {
    this.backoff = new ExponentialBackoff(800, 30_000, options.maxReconnectAttempts ?? 12);
  }

  get status(): FeedStatus {
    return this.currentStatus;
  }

  connect(): void {
    if (typeof WebSocket === 'undefined') {
      this.setStatus('error', { note: 'no-websocket' });
      return;
    }
    if (this.connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionallyClosed = false;
    this.setStatus(this.backoff.attempts === 0 ? 'connecting' : 'reconnecting', {
      attempt: this.backoff.attempts,
    });

    this.connecting = this.openSocket().finally(() => {
      this.connecting = null;
    });
    void this.connecting;
  }

  send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (payload === null) return;
    this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.stopWatchdog();
    if (this.ws) {
      // Alle Handler nullen: die Closures referenzieren Adapter/Stores – nach
      // dem Close darf nichts davon am (u. U. noch CONNECTING-)Socket hängen.
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('closed');
  }

  /**
   * Wake-up call after the tab was hidden or the network returned.
   *
   * Background tabs throttle `setInterval`/`setTimeout` (heartbeats stop,
   * reconnect timers stall at ≥1/min) and a server drops us for the missed
   * pings. Instead of waiting for the watchdog (≤45 s) or an exhausted
   * backoff, `resume()` reconnects immediately: pending timers are cancelled,
   * a spent backoff is reset, and an already open/connecting socket is left
   * alone. Intentionally closed sockets stay closed.
   */
  resume(): void {
    if (this.intentionallyClosed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.backoff.exhausted) this.backoff.reset();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  /* ------------------------------- internals ------------------------------ */

  private async openSocket(): Promise<void> {
    let url = this.options.url ?? '';
    if (this.options.resolveUrl) {
      try {
        url = await this.options.resolveUrl();
      } catch {
        this.scheduleReconnect();
        return;
      }
    }
    if (!url || this.intentionallyClosed) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.options.binary) socket.binaryType = 'arraybuffer';
    this.ws = socket;

    socket.onopen = () => {
      this.backoff.reset();
      this.lastMessageAt = Date.now();
      this.setStatus('open');
      this.options.onOpen((payload) => this.send(payload));
      this.startHeartbeat();
      this.startWatchdog();
    };

    socket.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      void this.dispatch(event.data);
    };

    socket.onerror = () => {
      // onclose always follows; reconnect logic lives there.
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.stopWatchdog();
      this.ws = null;
      if (this.intentionallyClosed) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  /** String frames parse synchronously, binary frames may need async decoding. */
  private async dispatch(data: unknown): Promise<void> {
    let payload: unknown;

    if (typeof data === 'string') {
      // OKX answers heartbeats with the bare string "pong".
      if (data === 'pong') return;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
    } else if (this.options.decode && data instanceof ArrayBuffer) {
      try {
        payload = await this.options.decode(data, (out) => this.send(out));
      } catch {
        return;
      }
      if (payload === null || payload === undefined) return;
    } else {
      return;
    }

    // Ein fehlerhaftes Server-Payload darf niemals eine Uncaught Exception
    // erzeugen: keepalive/onMessage laufen hinter einer Guard, der Fehler
    // wird geloggt und das Frame verworfen – der Stream lebt weiter.
    try {
      if (this.options.keepalive?.(payload, (out) => this.send(out))) return;
    } catch (error) {
      console.warn(`[nodechart] ${this.options.id} keepalive handler:`, error);
      return;
    }
    try {
      this.options.onMessage(payload);
    } catch (error) {
      console.warn(`[nodechart] ${this.options.id} message handler:`, error);
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectTimer !== null) return;
    if (this.backoff.exhausted) {
      this.setStatus('error', { note: 'max-attempts' });
      return;
    }
    const delay = this.backoff.next();
    this.setStatus('reconnecting', { attempt: this.backoff.attempts });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    const hb = this.options.heartbeat;
    if (!hb) return;
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      const payload = hb.payload();
      if (payload !== null) this.send(payload);
    }, hb.intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startWatchdog(): void {
    const window_ = this.options.watchdogMs ?? 45_000;
    this.stopWatchdog();
    this.watchdogTimer = window.setInterval(() => {
      if (Date.now() - this.lastMessageAt > window_) {
        // Silent socket: force a clean reconnect (onclose drives the backoff).
        this.ws?.close();
      }
    }, Math.min(10_000, window_ / 2));
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private setStatus(status: FeedStatus, info?: { attempt?: number; note?: string | null }): void {
    this.currentStatus = status;
    this.options.onStatus(status, info);
  }
}
