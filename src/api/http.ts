// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { beginCooldown } from './rateLimit';
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
  expiresAt: number;
}
const inFlight = new Map<string, InFlightEntry>();

/**
 * Every distinct search keystroke would otherwise leave an entry in `cache`
 * forever (TTL expiry only stops hits, it never frees memory). Prune lazily
 * on write: drop expired entries first, then evict insertion-oldest until
 * under the cap – bounded memory without a background timer.
 */
const CACHE_MAX_ENTRIES = 400;
const INFLIGHT_MAX_ENTRIES = 64;

function pruneMaps(now: number): void {
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  for (const [key, entry] of inFlight) if (entry.expiresAt <= now) inFlight.delete(key);
  while (inFlight.size > INFLIGHT_MAX_ENTRIES) {
    const oldest = inFlight.keys().next();
    if (oldest.done) break;
    inFlight.delete(oldest.value);
  }
}

export interface FetchJsonOptions {
  /** Logical upstream name shown in the rate-limit overlay. */
  source: string;
  /** Retries after a 429 cooldown (0 = fail immediately). */
  retries?: number;
  timeoutMs?: number;
  /** GET response cache TTL in ms. 0 disables. */
  cacheTtlMs?: number;
  /** Dedupe identical concurrent GETs. Default true when cacheTtlMs > 0. */
  dedupe?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** POST body (JSON-RPC etc.). Setting it switches the request to POST. */
  body?: string;
  /**
   * Soft-Rate-Limit-/Validitäts-Prüfung des geparsten Bodys. Manche Anbieter
   * (GoPlus) drosseln mit HTTP 200 + Fehlercode im Body – ohne diese Prüfung
   * würde die Drossel-Antwort für die volle TTL gecacht und jeder Retry aus
   * dem vergifteten Cache bedient. `'rate-limit'` verhält sich exakt wie ein
   * HTTP 429 (Glitch-Overlay, Cooldown, Retry), `'invalid'` verwirft die
   * Antwort ohne Cache-Eintrag.
   */
  inspectBody?: (value: unknown) => 'rate-limit' | 'invalid' | null;
  /**
   * Persist successful responses in the localStorage L2 cache under this key.
   * Combined with `staleTtlMs` this is the rate-limit fallback: when the
   * upstream finally refuses (429 exhausted / network dead), the chart is
   * served from the last good copy instead of going blank.
   */
  persistKey?: string;
  /** Max age of an L2 copy that may be served on a failed request. */
  staleTtlMs?: number;
}

/**
 * The only fetch entry point in the app.
 *
 * - enforces a timeout (hanging public APIs are the #1 UX killer)
 * - detects HTTP 429, triggers the global cooldown overlay and retries after it
 * - refuses to retry regional blocks (401/403/451)
 * - optional TTL cache + in-flight dedupe to stay under public rate limits
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
    inspectBody,
  } = options;

  const cacheKey = `${source}::${url}${body ? `::${body}` : ''}`;

  if (cacheTtlMs > 0) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }

  if (dedupe) {
    const running = inFlight.get(cacheKey);
    if (running && running.expiresAt > Date.now()) return running.promise as Promise<T>;
  }

  const promise = attempt<T>(url, { source, retries, timeoutMs, signal, headers, body, inspectBody });

  if (dedupe) {
    const now = Date.now();
    pruneMaps(now);
    inFlight.set(cacheKey, { promise, expiresAt: now + Math.max(timeoutMs, 5_000) });
    promise.catch(() => inFlight.delete(cacheKey));
  }

  let value: T;
  try {
    value = await promise;
  } catch (error) {
    // Letzter Ausweg bei Rate-Limit/Netzfehler: die letzte gute L2-Kopie.
    // Ein abgebrochener Caller (nächster Suchanschlag) bekommt nichts Altes
    // serviert – er interessiert sich nicht mehr für diese Antwort.
    const aborted =
      (error instanceof DOMException && error.name === 'AbortError') || signal?.aborted === true;
    if (persistKey && staleTtlMs && !aborted) {
      const stale = readPersisted<T>(persistKey, staleTtlMs);
      if (stale) {
        console.info(
          `[nodechart] ${source}: serving ${Math.round((Date.now() - stale.savedAt) / 1000)}s-old L2 cache copy`,
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

/** Public APIs answer in KiB – a hostile/hijacked endpoint must not be able
 *  to stream gigabytes into the tab (memory DoS). Hard cap: 4 MiB. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

async function boundedJson<T>(response: Response, url: string, source: string): Promise<T> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new HttpError(413, url, source);
  }
  const reader = response.body?.getReader();
  if (!reader) return (await response.json()) as T;
  const decoder = new TextDecoder();
  // Chunk array + join: repeated `text +=` re-copies the whole payload on
  // every read (O(n²) on multi-MiB responses).
  const chunks: string[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const part = decoder.decode(value, { stream: true });
      length += part.length;
      chunks.push(part);
    }
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HttpError(413, url, source);
    }
  }
  chunks.push(decoder.decode());
  return JSON.parse(chunks.join('')) as T;
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
    // An aborted caller (e.g. the next search keystroke) must never spend a
    // retry or a rate-limit slot – also re-checked AFTER a 429 cooldown,
    // because the 5 s glitch countdown outlives most debounced queries.
    if (opts.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort);

    try {
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
        // Ungelesener Body hält die Verbindung im Browser-Pool (max. 6 pro
        // Host) – explizit verwerfen, sonst stallen Folge-Requests.
        await response.body?.cancel().catch(() => {});
        // Surface the glitch overlay, wait out the countdown, then retry.
        await beginCooldown(opts.source);
        lastError = new HttpError(429, url, opts.source);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new HttpError(response.status, url, opts.source);
      }

      const payload = (await boundedJson<T>(response, url, opts.source)) as T;
      const verdict = opts.inspectBody?.(payload) ?? null;
      if (verdict === 'rate-limit') {
        // HTTP 200, aber der Body sagt "too many requests" (z. B. GoPlus
        // code 4029): exakt wie einen 429 behandeln – Cooldown + Retry, und
        // vor allem KEIN Cache-Eintrag für die Drossel-Antwort.
        await beginCooldown(opts.source);
        lastError = new HttpError(429, url, opts.source);
        continue;
      }
      if (verdict === 'invalid') {
        throw new HttpError(502, url, opts.source);
      }
      return payload;
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        lastError = error;
        continue; // loop retries after cooldown
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${opts.source}: request failed`);
}
