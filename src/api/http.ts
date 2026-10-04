// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { beginCooldown, COOLDOWN_MS } from './rateLimit';
import { readPersisted, writePersisted } from './persistCache';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly source: string,
  ) {
    super(`${source}: HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

/** Local proactive quota skip; unlike a real upstream 429 this never opens the global overlay. */
export class ProviderBudgetError extends Error {
  constructor(
    readonly source: string,
    readonly retryAfterMs: number,
  ) {
    super(`${source}: local request budget exhausted`);
    this.name = 'ProviderBudgetError';
  }
}

/** Regional / legal refusal – retrying is pointless and noisy. */
export function isBlockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 451;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

interface InFlightEntry {
  promise: Promise<unknown>;
  controller: AbortController;
  expiresAt: number;
  subscribers: number;
  settled: boolean;
}
const inFlight = new Map<string, InFlightEntry>();

interface SourceCooldown {
  until: number;
}
const sourceCooldowns = new Map<string, SourceCooldown>();

interface RequestBudgetStamp {
  id: string;
  at: number;
}

/**
 * Keyless DEX endpoints have small IP-wide pools. Keep a safety margin below
 * GeckoTerminal's approximate 10 requests/minute and coordinate same-origin
 * tabs best-effort through localStorage. These timestamps are usage metadata,
 * not provider response data; storage failures fall back to this tab's memory.
 */
const SOURCE_REQUEST_BUDGETS: Record<string, { maxRequests: number; windowMs: number }> = {
  geckoterminal: { maxRequests: 8, windowMs: 60_000 },
};
const requestBudgetBySource = new Map<string, RequestBudgetStamp[]>();
const REQUEST_BUDGET_STORAGE_PREFIX = 'nodechart:api-budget:v1:';
const REQUEST_BUDGET_MAX_SOURCES = 16;
let requestBudgetSequence = 0;

/**
 * Every distinct search keystroke would otherwise leave an entry in `cache`
 * forever (TTL expiry only stops hits, it never frees memory). Prune lazily
 * on write: drop expired entries first, then evict insertion-oldest until
 * under the cap – bounded memory without a background timer.
 */
const CACHE_MAX_ENTRIES = 400;
const INFLIGHT_MAX_ENTRIES = 64;
const SOURCE_COOLDOWN_MAX_ENTRIES = 128;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Long Retry-After values use stale data / fail fast rather than freezing UI. */
const MAX_AUTOMATIC_WAIT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

function pruneMaps(now: number): void {
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  for (const [key, entry] of inFlight) {
    if (entry.settled || entry.expiresAt <= now || entry.controller.signal.aborted) {
      if (!entry.settled) entry.controller.abort();
      inFlight.delete(key);
    }
  }
  // Do not evict active shared requests: doing so would create duplicate
  // upstream calls and make the public-provider rate limits worse.
  while (inFlight.size > INFLIGHT_MAX_ENTRIES) {
    const settled = [...inFlight].find(([, entry]) => entry.settled);
    if (!settled) break;
    inFlight.delete(settled[0]);
  }

  for (const [source, cooldown] of sourceCooldowns) {
    if (cooldown.until <= now) sourceCooldowns.delete(source);
  }
  while (sourceCooldowns.size > SOURCE_COOLDOWN_MAX_ENTRIES) {
    const oldest = sourceCooldowns.keys().next();
    if (oldest.done) break;
    sourceCooldowns.delete(oldest.value);
  }

  for (const [source, stamps] of requestBudgetBySource) {
    const policy = SOURCE_REQUEST_BUDGETS[source];
    const recent = policy ? stamps.filter((stamp) => stamp.at > now - policy.windowMs) : [];
    if (recent.length === 0) requestBudgetBySource.delete(source);
    else requestBudgetBySource.set(source, recent);
  }
  while (requestBudgetBySource.size > REQUEST_BUDGET_MAX_SOURCES) {
    const oldest = requestBudgetBySource.keys().next();
    if (oldest.done) break;
    requestBudgetBySource.delete(oldest.value);
  }
}

export interface FetchJsonOptions {
  /** Logical upstream name shown in the rate-limit overlay. */
  source: string;
  /** Retries after a short 429 cooldown or transient network/5xx failure. */
  retries?: number;
  timeoutMs?: number;
  /** GET/POST response cache TTL in ms. 0 disables. */
  cacheTtlMs?: number;
  /** Dedupe identical concurrent requests. Default true when cacheTtlMs > 0. */
  dedupe?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** POST body (JSON-RPC etc.). Setting it switches the request to POST. */
  body?: string;
  /**
   * Soft-rate-limit / validity test for parsed bodies. Some providers return
   * HTTP 200 with a rate-limit code (e.g. GoPlus 4029); those responses must
   * not be cached as successful market/security data.
   */
  inspectBody?: (value: unknown) => 'rate-limit' | 'invalid' | null;
  /** Persist successful responses in the best-effort localStorage L2 cache. */
  persistKey?: string;
  /** Max age of an L2 copy that may be served after a failed request. */
  staleTtlMs?: number;
  /** Called when a persisted copy is served, with its age in milliseconds. */
  onStale?: (ageMs: number) => void;
}

/**
 * The shared JSON transport used by provider adapters.
 *
 * It bounds request time and response size, retries transient failures with
 * jitter, honours Retry-After without holding the entire app hostage, dedupes
 * in-flight calls safely across independently-cancelled callers, and serves
 * an optional stale local copy when an upstream is unavailable.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const {
    source,
    retries = 2,
    timeoutMs = 12_000,
    cacheTtlMs = 0,
    dedupe = cacheTtlMs > 0,
    signal,
    headers,
    body,
    persistKey,
    staleTtlMs,
    onStale,
    inspectBody,
  } = options;

  if (signal?.aborted) throw makeAbortError();
  const cacheKey = `${source}::${url}${body ? `::${body}` : ''}`;

  if (cacheTtlMs > 0) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }

  let value: T;
  try {
    const requestOptions = { source, retries, timeoutMs, headers, body, inspectBody };
    if (!dedupe) {
      value = await attempt<T>(url, { ...requestOptions, signal });
    } else {
      const now = Date.now();
      pruneMaps(now);
      let flight = inFlight.get(cacheKey);
      if (
        !flight ||
        flight.settled ||
        flight.controller.signal.aborted ||
        flight.expiresAt <= now
      ) {
        flight?.controller.abort();
        const controller = new AbortController();
        const promise = attempt<T>(url, { ...requestOptions, signal: controller.signal });
        flight = {
          promise,
          controller,
          expiresAt: now + Math.max(30_000, timeoutMs * (retries + 1) + MAX_AUTOMATIC_WAIT_MS * retries + 5_000),
          subscribers: 0,
          settled: false,
        };
        inFlight.set(cacheKey, flight);
        const created = flight;
        // Attach both outcomes so a caller that cancels never leaves an
        // unhandled rejection behind. Consumers still receive the original.
        void promise.then(
          () => settleFlight(cacheKey, created),
          () => settleFlight(cacheKey, created),
        );
      }
      value = await consumeFlight<T>(flight, signal);
    }
  } catch (error) {
    const aborted = isAbortError(error) || signal?.aborted === true;
    if (persistKey && staleTtlMs && !aborted) {
      const stale = readPersisted<T>(persistKey, staleTtlMs);
      if (stale) {
        const ageMs = Math.max(0, Date.now() - stale.savedAt);
        onStale?.(ageMs);
        console.info(
          `[nodechart] ${source}: serving ${Math.round(ageMs / 1000)}s-old L2 cache copy`,
        );
        if (cacheTtlMs > 0) {
          pruneMaps(Date.now());
          cache.set(cacheKey, { value: stale.value, expiresAt: Date.now() + cacheTtlMs });
        }
        return stale.value;
      }
    }
    throw error;
  }

  if (cacheTtlMs > 0) {
    pruneMaps(Date.now());
    cache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
  }
  if (persistKey) writePersisted(persistKey, value);
  return value;
}

function settleFlight(key: string, flight: InFlightEntry): void {
  flight.settled = true;
  if (inFlight.get(key) === flight) inFlight.delete(key);
}

/** Each caller can abort its wait without cancelling another caller's fetch. */
function consumeFlight<T>(flight: InFlightEntry, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(makeAbortError());
  if (flight.controller.signal.aborted) return Promise.reject(makeAbortError());
  flight.subscribers += 1;

  return new Promise<T>((resolve, reject) => {
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', onAbort);
      flight.subscribers = Math.max(0, flight.subscribers - 1);
      if (flight.subscribers === 0 && !flight.settled) flight.controller.abort();
    };
    const onAbort = (): void => {
      release();
      reject(makeAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    void flight.promise.then(
      (value) => {
        release();
        resolve(value as T);
      },
      (error: unknown) => {
        release();
        reject(error);
      },
    );
  });
}

function makeAbortError(): DOMException {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error as DOMException;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelay(attemptIndex: number): number {
  const ceiling = Math.min(2_000, 250 * 2 ** attemptIndex);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return COOLDOWN_MS;
  const seconds = Number(header.trim());
  let duration = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(duration)) return COOLDOWN_MS;
  duration = Math.max(250, duration);
  return Math.min(duration, MAX_RETRY_AFTER_MS);
}

function setSourceCooldown(source: string, ms: number): void {
  const now = Date.now();
  pruneMaps(now);
  const until = now + ms;
  const previous = sourceCooldowns.get(source);
  sourceCooldowns.set(source, { until: Math.max(previous?.until ?? 0, until) });
  // Refresh insertion order so the oldest entry is the least recently used.
  sourceCooldowns.delete(source);
  sourceCooldowns.set(source, { until: Math.max(previous?.until ?? 0, until) });
}

function readRequestBudget(source: string): RequestBudgetStamp[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${REQUEST_BUDGET_STORAGE_PREFIX}${encodeURIComponent(source)}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (stamp): stamp is RequestBudgetStamp =>
        typeof stamp === 'object' &&
        stamp !== null &&
        typeof (stamp as RequestBudgetStamp).id === 'string' &&
        typeof (stamp as RequestBudgetStamp).at === 'number' &&
        Number.isFinite((stamp as RequestBudgetStamp).at),
    );
  } catch {
    return [];
  }
}

function reserveSourceRequest(source: string): void {
  const policy = SOURCE_REQUEST_BUDGETS[source];
  if (!policy) return;

  const now = Date.now();
  const stampsById = new Map<string, RequestBudgetStamp>();
  for (const stamp of [...readRequestBudget(source), ...(requestBudgetBySource.get(source) ?? [])]) {
    if (stamp.at > now - policy.windowMs && stamp.at <= now + 5_000) stampsById.set(stamp.id, stamp);
  }
  const recent = [...stampsById.values()].sort((a, b) => a.at - b.at);
  if (recent.length >= policy.maxRequests) {
    const retryAfterMs = Math.max(250, (recent[0]?.at ?? now) + policy.windowMs - now);
    throw new ProviderBudgetError(source, retryAfterMs);
  }

  requestBudgetSequence += 1;
  recent.push({
    id: `${now}:${requestBudgetSequence}:${Math.random().toString(36).slice(2, 8)}`,
    at: now,
  });
  requestBudgetBySource.set(source, recent);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `${REQUEST_BUDGET_STORAGE_PREFIX}${encodeURIComponent(source)}`,
        JSON.stringify(recent),
      );
    } catch {
      // Storage is an optional cross-tab coordination aid, never a fetch dependency.
    }
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(makeAbortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(makeAbortError());
    };
    function done(): void {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function boundedJson<T>(response: Response, url: string, source: string): Promise<T> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(413, url, source);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new HttpError(413, url, source);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(502, url, source);
    }
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new HttpError(413, url, source);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    try {
      return JSON.parse(chunks.join('')) as T;
    } catch {
      throw new HttpError(502, url, source);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw error;
  }
}

async function attempt<T>(
  url: string,
  opts: {
    source: string;
    retries: number;
    timeoutMs: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    body?: string;
    inspectBody?: (value: unknown) => 'rate-limit' | 'invalid' | null;
  },
): Promise<T> {
  let lastError: unknown = null;

  for (let tryIndex = 0; tryIndex <= opts.retries; tryIndex += 1) {
    if (opts.signal?.aborted) throw makeAbortError();

    // A provider that explicitly told us to back off is not contacted again
    // by another feature/query until that source-specific window expires.
    const cooling = sourceCooldowns.get(opts.source)?.until ?? 0;
    if (cooling > Date.now()) throw new HttpError(429, url, opts.source);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs);
    const onOuterAbort = (): void => controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      // Skip optional keyless-provider calls before the upstream budget is
      // exhausted; callers keep the last good store value or use another source.
      reserveSourceRequest(opts.source);
      const response = await fetch(url, {
        method: opts.body ? 'POST' : 'GET',
        body: opts.body,
        headers: {
          accept: 'application/json',
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (response.status === 429) {
        const delayMs = retryAfterMs(response);
        await response.body?.cancel().catch(() => {});
        setSourceCooldown(opts.source, delayMs);
        lastError = new HttpError(429, url, opts.source);
        if (tryIndex >= opts.retries || delayMs > MAX_AUTOMATIC_WAIT_MS) throw lastError;
        await abortableCooldown(opts.source, delayMs, opts.signal);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = new HttpError(response.status, url, opts.source);
        if (isTransientHttpStatus(response.status) && tryIndex < opts.retries) {
          await wait(retryDelay(tryIndex), opts.signal);
          continue;
        }
        throw error;
      }

      const payload = await boundedJson<T>(response, url, opts.source);
      const verdict = opts.inspectBody?.(payload) ?? null;
      if (verdict === 'rate-limit') {
        const delayMs = COOLDOWN_MS;
        setSourceCooldown(opts.source, delayMs);
        lastError = new HttpError(429, url, opts.source);
        if (tryIndex >= opts.retries) throw lastError;
        await abortableCooldown(opts.source, delayMs, opts.signal);
        continue;
      }
      if (verdict === 'invalid') throw new HttpError(502, url, opts.source);
      return payload;
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 429) throw error;
        if (isTransientHttpStatus(error.status) && tryIndex < opts.retries) {
          await wait(retryDelay(tryIndex), opts.signal);
          continue;
        }
        throw error;
      }
      if (opts.signal?.aborted) throw makeAbortError();
      if (timedOut && tryIndex < opts.retries) {
        await wait(retryDelay(tryIndex), opts.signal);
        continue;
      }
      // CORS/network TypeErrors are indistinguishable in a browser. One quick
      // jittered retry helps transient disconnects; known CORS-blind providers
      // are skipped at their adapters and never spend this retry budget.
      if (error instanceof TypeError && tryIndex < opts.retries) {
        await wait(retryDelay(tryIndex), opts.signal);
        continue;
      }
      lastError = error;
      throw error;
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${opts.source}: request failed`);
}

async function abortableCooldown(source: string, ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw makeAbortError();
  const pending = beginCooldown(source, ms);
  if (!signal) return pending;
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(makeAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void pending.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
