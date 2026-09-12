// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { timeoutSignal } from '@/lib/abort';
import type { Timeframe } from '@/store/types';
import { REACH_TTL_MS, SLOW_MS, useExchangeStore } from '@/store/useExchangeStore';
import { ADAPTERS, EXCHANGE_PREFERENCE } from '@/websockets/registry';
import { restReachableFromBrowser, seedUrl } from '@/websockets/rest';
import type { ExchangeId } from '@/websockets/types';

export type ProbeStatus = 'ok' | 'slow' | 'blocked' | 'error';

export interface ProbeOutcome {
  exchange: ExchangeId;
  status: ProbeStatus;
  ms: number | null;
  note: string | null;
}

const PROBE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;

/**
 * Measures which venues this visitor can actually reach, and how fast.
 *
 * The probe reuses the exact REST request the chart seed will make (`seedUrl`),
 * so a 451/403 here means the real feed would fail too. Exchanges without a
 * REST history (Crypto.com) are probed by their socket handshake instead.
 * Everything is key-less, free and cached for 6 h in `useExchangeStore`.
 */
export async function probeExchange(
  exchange: ExchangeId,
  symbol = 'BTC/USDT',
  timeframe: Timeframe = '1m',
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  const url = seedUrl({ exchange, symbol, timeframe });
  if (!url) return probeSocketOf(exchange);

  // CORS-blinde Venue (REST ohne ACAO, live per curl verifiziert): Ein
  // Browser-Fetch dagegen scheitert garantiert und erzeugt einen nicht
  // unterdrückbaren Konsolen-Error. Der Socket-Handshake ist nicht
  // CORS-gebunden – er ist hier der primäre Check, Note bleibt 'rest-cors'.
  if (!restReachableFromBrowser(exchange)) {
    const socket = await probeSocketOf(exchange);
    if (socket.status === 'ok' || socket.status === 'slow') {
      return { ...socket, note: 'rest-cors' };
    }
    return socket;
  }

  const http = await probeHttp(exchange, url, signal);
  // A browser throws a bare TypeError for CORS rejections – indistinguishable
  // from "offline". WebSockets are not CORS-bound, so such a venue may still
  // stream perfectly: verify with the socket handshake before condemning it.
  if (http.status === 'error' && http.note === 'TypeError') {
    const socket = await probeSocketOf(exchange);
    if (socket.status === 'ok' || socket.status === 'slow') {
      return { ...socket, note: 'rest-cors' };
    }
  }
  return http;
}

async function probeSocketOf(exchange: ExchangeId): Promise<ProbeOutcome> {
  const adapter = ADAPTERS[exchange];
  // resolveUrl (z. B. KuCoin bullet-public) ist selbst ein REST-Fetch – für
  // CORS-blinde Venues im Browser überspringen und die statische URL nutzen.
  const socketUrl =
    adapter.resolveUrl && restReachableFromBrowser(exchange)
      ? await adapter.resolveUrl().catch(() => adapter.url)
      : adapter.url;
  return probeSocket(exchange, socketUrl);
}

async function probeHttp(exchange: ExchangeId, url: string, signal?: AbortSignal): Promise<ProbeOutcome> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: signal ?? timeoutSignal(PROBE_TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - startedAt);

    if (response.ok) {
      return { exchange, status: ms > SLOW_MS ? 'slow' : 'ok', ms, note: null };
    }
    if (response.status === 401 || response.status === 403 || response.status === 451) {
      return { exchange, status: 'blocked', ms, note: `HTTP ${response.status}` };
    }
    if (response.status === 429) {
      // Reachable, just busy – still usable.
      return { exchange, status: 'slow', ms, note: 'HTTP 429' };
    }
    return { exchange, status: 'error', ms, note: `HTTP ${response.status}` };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      exchange,
      status: 'error',
      ms: null,
      note: timedOut ? 'timeout' : error instanceof Error ? error.name : 'unreachable',
    };
  }
}

function probeSocket(exchange: ExchangeId, url: string): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      resolve({ exchange, status: 'error', ms: null, note: 'no-websocket' });
      return;
    }
    const startedAt = performance.now();
    let settled = false;
    let socket: WebSocket | null = null;

    const finish = (status: ProbeStatus, note: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already gone
      }
      resolve({
        exchange,
        status,
        ms: status === 'ok' || status === 'slow' ? Math.round(performance.now() - startedAt) : null,
        note,
      });
    };

    const timer = setTimeout(() => finish('error', 'timeout'), PROBE_TIMEOUT_MS);
    try {
      socket = new WebSocket(url);
    } catch (error) {
      finish('error', error instanceof Error ? error.name : 'ctor');
      return;
    }
    socket.onopen = () => finish(performance.now() - startedAt > SLOW_MS ? 'slow' : 'ok', null);
    socket.onerror = () => finish('error', 'handshake');
  });
}

export interface ProbeRunOptions {
  symbol?: string;
  timeframe?: Timeframe;
  exchanges?: ExchangeId[];
  signal?: AbortSignal;
}

/** Probes every venue (4 at a time) and writes the results into the store. */
export async function probeAllExchanges(options: ProbeRunOptions = {}): Promise<ProbeOutcome[]> {
  const { symbol = 'BTC/USDT', timeframe = '1m', exchanges = EXCHANGE_PREFERENCE, signal } = options;
  const store = useExchangeStore.getState();
  store.setProbing(true);

  const outcomes: ProbeOutcome[] = [];
  const queue = [...exchanges];

  const worker = async (): Promise<void> => {
    for (;;) {
      const exchange = queue.shift();
      if (!exchange || signal?.aborted) return;
      useExchangeStore.getState().setReach(exchange, { status: 'probing', ms: null, note: null });
      const outcome = await probeExchange(exchange, symbol, timeframe, signal);
      if (signal?.aborted) return;
      useExchangeStore.getState().setReach(exchange, {
        status: outcome.status,
        ms: outcome.ms,
        note: outcome.note,
      });
      outcomes.push(outcome);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } finally {
    useExchangeStore.getState().setProbing(false);
  }
  return outcomes;
}

/** Probes only when results are missing or older than the TTL. */
export function needsProbe(state: ReturnType<typeof useExchangeStore.getState>): boolean {
  if (state.probing) return false;
  if (!state.lastProbeAt || Date.now() - state.lastProbeAt > REACH_TTL_MS) return true;
  return EXCHANGE_PREFERENCE.some((id) => !state.reach[id] || state.reach[id]?.status === 'unknown');
}
