// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { createAbortContext } from '@/lib/abort';
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
 * Best-effort browser-side probe used only as one venue-selection signal.
 *
 * The probe attempts the chart's REST seed URL where browser access is
 * configured; for CORS-blind/no-seed endpoints it opens a WebSocket and closes
 * it on the opening handshake. It does not validate the response payload,
 * subscribe to market data, or prove ongoing availability. Results can be
 * affected by CORS, extensions, provider policy, region and transient network
 * state. Every attempt has its own deadline, and HTTP bodies are cancelled as
 * soon as headers arrive because this is not a data-seeding request.
 */
export async function probeExchange(
  exchange: ExchangeId,
  symbol = 'BTC/USDT',
  timeframe: Timeframe = '1m',
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  if (signal?.aborted) return { exchange, status: 'error', ms: null, note: 'aborted' };
  const url = seedUrl({ exchange, symbol, timeframe });
  if (!url) return probeSocketOf(exchange, signal);

  if (!restReachableFromBrowser(exchange)) {
    const socket = await probeSocketOf(exchange, signal);
    if (socket.status === 'ok' || socket.status === 'slow') return { ...socket, note: 'rest-cors' };
    return socket;
  }

  const http = await probeHttp(exchange, url, signal);
  // Browser CORS failures surface as TypeError. WebSockets do not use CORS, so
  // an HTTP CORS rejection is inconclusive rather than proof the exchange is down.
  if (http.status === 'error' && http.note === 'TypeError' && !signal?.aborted) {
    const socket = await probeSocketOf(exchange, signal);
    if (socket.status === 'ok' || socket.status === 'slow') return { ...socket, note: 'rest-cors' };
  }
  return http;
}

async function probeSocketOf(exchange: ExchangeId, signal?: AbortSignal): Promise<ProbeOutcome> {
  const adapter = ADAPTERS[exchange];
  const context = createAbortContext(PROBE_TIMEOUT_MS, signal);
  let socketUrl = adapter.url;
  try {
    // Dynamic endpoints (KuCoin) are now resolved through the same-origin,
    // fixed-provider token route, not by attempting a browser-blocked CORS call.
    if (adapter.resolveUrl) socketUrl = await adapter.resolveUrl(context.signal);
    if (context.signal.aborted) return timeoutOrAbort(exchange, context.timedOut());
    return await probeSocket(exchange, socketUrl, context.signal);
  } catch (error) {
    if (context.signal.aborted) return timeoutOrAbort(exchange, context.timedOut());
    return { exchange, status: 'error', ms: null, note: error instanceof Error ? error.name : 'endpoint' };
  } finally {
    context.dispose();
  }
}

function timeoutOrAbort(exchange: ExchangeId, timedOut: boolean): ProbeOutcome {
  return { exchange, status: 'error', ms: null, note: timedOut ? 'timeout' : 'aborted' };
}

async function probeHttp(exchange: ExchangeId, url: string, signal?: AbortSignal): Promise<ProbeOutcome> {
  const startedAt = performance.now();
  const context = createAbortContext(PROBE_TIMEOUT_MS, signal);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: context.signal });
    const ms = Math.round(performance.now() - startedAt);
    await response.body?.cancel().catch(() => {});

    if (response.ok) return { exchange, status: ms > SLOW_MS ? 'slow' : 'ok', ms, note: null };
    if (response.status === 401 || response.status === 403 || response.status === 451) {
      return { exchange, status: 'blocked', ms, note: `HTTP ${response.status}` };
    }
    // A fast 429 is a response, but it is not a usable data response; do not
    // rank it as a healthy/slow venue. The note and observed response time stay
    // available for diagnostics.
    if (response.status === 429) return { exchange, status: 'error', ms, note: 'HTTP 429' };
    return { exchange, status: 'error', ms, note: `HTTP ${response.status}` };
  } catch (error) {
    const note = context.timedOut()
      ? 'timeout'
      : signal?.aborted
        ? 'aborted'
        : error instanceof Error
          ? error.name
          : 'unreachable';
    return { exchange, status: 'error', ms: null, note };
  } finally {
    context.dispose();
  }
}

function probeSocket(exchange: ExchangeId, url: string, signal?: AbortSignal): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      resolve({ exchange, status: 'error', ms: null, note: 'no-websocket' });
      return;
    }

    const startedAt = performance.now();
    const context = createAbortContext(PROBE_TIMEOUT_MS, signal);
    let settled = false;
    let socket: WebSocket | null = null;

    const finish = (status: ProbeStatus, note: string | null): void => {
      if (settled) return;
      settled = true;
      context.dispose();
      context.signal.removeEventListener('abort', onAbort);
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

    const onAbort = (): void => finish('error', context.timedOut() ? 'timeout' : 'aborted');
    context.signal.addEventListener('abort', onAbort, { once: true });
    if (context.signal.aborted) {
      onAbort();
      return;
    }

    try {
      socket = new WebSocket(url);
    } catch (error) {
      finish('error', error instanceof Error ? error.name : 'ctor');
      return;
    }
    socket.onopen = () => finish(performance.now() - startedAt > SLOW_MS ? 'slow' : 'ok', null);
    socket.onerror = () => finish('error', 'handshake');
    socket.onclose = () => {
      if (!settled) finish('error', 'closed-before-open');
    };
  });
}

export interface ProbeRunOptions {
  symbol?: string;
  timeframe?: Timeframe;
  exchanges?: ExchangeId[];
  signal?: AbortSignal;
}

/** Attempts probes for the configured venues (4 at a time) and stores the snapshot. */
export async function probeAllExchanges(options: ProbeRunOptions = {}): Promise<ProbeOutcome[]> {
  const { symbol = 'BTC/USDT', timeframe = '1m', exchanges = EXCHANGE_PREFERENCE, signal } = options;
  const store = useExchangeStore.getState();
  if (store.probing) return [];
  store.setProbing(true);

  const outcomes: ProbeOutcome[] = [];
  const queue = [...new Set(exchanges)];

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const exchange = queue.shift();
      if (!exchange) return;
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
