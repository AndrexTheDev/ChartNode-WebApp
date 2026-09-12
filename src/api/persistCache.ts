// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * L2 response cache in `localStorage`.
 *
 * Layering of the data supply:
 *   L1 – in-memory TTL cache in `http.ts` (same session, dedupe, cheap)
 *   L2 – this cache (survives reloads and feeds the chart while an upstream
 *        rate-limits us: HTTP 429 → glitch overlay → *stale* L2 candles
 *        instead of an empty grid)
 *
 * Design rules:
 *  - every access is wrapped: Safari private mode throws on `localStorage`,
 *    and a quota error must degrade to "no L2", never to a broken fetch;
 *  - bounded: one index entry per key, LRU eviction at MAX_ENTRIES, values
 *    above MAX_VALUE_BYTES are not persisted at all (seed responses are
 *    ~30 KB, so 60 entries stay far below the 5 MB quota);
 *  - stale serving is opt-in per call site via `staleTtlMs` in `fetchJson` –
 *    an L2 hit older than that is treated as a miss.
 */

const NS = 'nc-l2-v1';
const INDEX_KEY = `${NS}:index`;
const MAX_ENTRIES = 60;
const MAX_VALUE_BYTES = 512 * 1024;

interface IndexEntry {
  k: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    // Property access alone can throw (Safari private mode, disabled storage).
    const probe = '__nc_l2_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): IndexEntry[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is IndexEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as IndexEntry).k === 'string' &&
        typeof (entry as IndexEntry).savedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeIndex(store: Storage, entries: IndexEntry[]): void {
  try {
    store.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Index write failed (quota) – L2 stays best-effort.
  }
}

function evictOldest(store: Storage, entries: IndexEntry[], count: number): IndexEntry[] {
  const sorted = [...entries].sort((a, b) => a.savedAt - b.savedAt);
  const dropped = sorted.slice(0, count);
  for (const entry of dropped) {
    try {
      store.removeItem(`${NS}:${entry.k}`);
    } catch {
      // ignore
    }
  }
  const droppedKeys = new Set(dropped.map((entry) => entry.k));
  return entries.filter((entry) => !droppedKeys.has(entry.k));
}

/**
 * Reads a persisted response. Returns `null` when missing, corrupt, or older
 * than `staleTtlMs`.
 */
export function readPersisted<T>(key: string, staleTtlMs: number): { value: T; savedAt: number } | null {
  if (typeof window === 'undefined') return null;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(`${NS}:${key}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { savedAt?: unknown; value?: unknown };
    if (typeof record.savedAt !== 'number' || Date.now() - record.savedAt > staleTtlMs) return null;
    return { value: record.value as T, savedAt: record.savedAt };
  } catch {
    return null;
  }
}

/**
 * Persists a successful response (fire-and-forget from `fetchJson`). Serialises
 * first so oversized payloads never touch storage, then LRU-evicts on quota.
 */
export function writePersisted(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  let serialised: string;
  try {
    serialised = JSON.stringify({ savedAt: Date.now(), value });
  } catch {
    return; // circular/exotic value – not cacheable
  }
  if (serialised.length > MAX_VALUE_BYTES) return;

  const store = storage();
  if (!store) return;

  try {
    store.setItem(`${NS}:${key}`, serialised);
  } catch {
    // Quota exceeded – drop the oldest quarter and retry once.
    let entries = readIndex(store);
    entries = evictOldest(store, entries, Math.max(4, Math.ceil(entries.length / 4)));
    writeIndex(store, entries);
    try {
      store.setItem(`${NS}:${key}`, serialised);
    } catch {
      return; // still no room – L1 cache remains the fallback
    }
  }

  // Index maintenance: move-to-front semantics via savedAt, cap the size.
  let entries = readIndex(store).filter((entry) => entry.k !== key);
  entries.push({ k: key, savedAt: Date.now() });
  if (entries.length > MAX_ENTRIES) {
    entries = evictOldest(store, entries, entries.length - MAX_ENTRIES);
  }
  writeIndex(store, entries);
}
