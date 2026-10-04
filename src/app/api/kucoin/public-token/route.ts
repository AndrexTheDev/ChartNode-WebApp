// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UPSTREAM_URL = 'https://api.kucoin.com/api/v1/bullet-public';
const TOKEN_CACHE_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 128 * 1024;

interface KucoinPublicToken {
  token: string;
  endpoint: string;
  expiresAt: number;
}

interface KucoinBulletResponse {
  code?: string;
  data?: {
    token?: string;
    instanceServers?: Array<{ endpoint?: string }>;
  };
}

// The upstream token is public and short-lived. Cache it per Worker isolate and
// coalesce simultaneous refreshes; this is deliberately not an arbitrary URL
// proxy and accepts no user-controlled host, path, body, or headers.
let cached: KucoinPublicToken | null = null;
let refresh: Promise<KucoinPublicToken> | null = null;
let nextAllowedFetchAt = 0;
let upstreamBackoffMs = 0;

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return ok(cached);
  if (refresh) {
    try {
      return ok(await refresh);
    } catch {
      return unavailable();
    }
  }
  if (nextAllowedFetchAt > now) return unavailable(Math.ceil((nextAllowedFetchAt - now) / 1000));

  refresh = fetchPublicToken();
  try {
    cached = await refresh;
    upstreamBackoffMs = 0;
    nextAllowedFetchAt = 0;
    return ok(cached);
  } catch (error) {
    // Avoid a tight retry loop when KuCoin is unavailable or throttling us.
    upstreamBackoffMs = Math.min(60_000, upstreamBackoffMs ? upstreamBackoffMs * 2 : 5_000);
    nextAllowedFetchAt = Date.now() + upstreamBackoffMs;
    const retryAfter = error instanceof UpstreamRateLimitError ? error.retryAfterSeconds : undefined;
    if (retryAfter) nextAllowedFetchAt = Math.max(nextAllowedFetchAt, Date.now() + retryAfter * 1000);
    return unavailable(Math.max(1, Math.ceil((nextAllowedFetchAt - Date.now()) / 1000)));
  } finally {
    refresh = null;
  }
}

async function fetchPublicToken(): Promise<KucoinPublicToken> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-length': '0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429) {
      const header = Number(response.headers.get('retry-after'));
      await response.body?.cancel().catch(() => {});
      throw new UpstreamRateLimitError(Number.isFinite(header) && header > 0 ? Math.min(header, 60) : 5);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`KuCoin token endpoint returned HTTP ${response.status}`);
    }

    const text = await readBoundedText(response);
    const payload = JSON.parse(text) as KucoinBulletResponse;
    if (payload.code && payload.code !== '200000') throw new Error('KuCoin rejected the public-token request');
    const token = payload.data?.token;
    const endpoint = payload.data?.instanceServers?.[0]?.endpoint;
    if (!token || token.length > 4_096 || !validWebSocketEndpoint(endpoint)) {
      throw new Error('KuCoin returned an invalid public endpoint/token');
    }

    return { token, endpoint, expiresAt: Date.now() + TOKEN_CACHE_MS };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('KuCoin token response exceeded the size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('KuCoin token response exceeded the size limit');
    return text;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('KuCoin token response exceeded the size limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validWebSocketEndpoint(value: string | undefined): value is string {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' && (url.hostname === 'kucoin.com' || url.hostname.endsWith('.kucoin.com'));
  } catch {
    return false;
  }
}

function ok(value: KucoinPublicToken): NextResponse {
  return NextResponse.json(
    { token: value.token, endpoint: value.endpoint },
    {
      status: 200,
      headers: {
        // The token is public. A short shared-cache window limits refresh
        // traffic without storing credentials or creating user-specific state.
        'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=60',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

function unavailable(retryAfterSeconds = 5): NextResponse {
  return NextResponse.json(
    { error: 'KuCoin public market stream is temporarily unavailable.' },
    {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'retry-after': String(Math.max(1, Math.min(60, retryAfterSeconds))),
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

class UpstreamRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('KuCoin public-token endpoint rate-limited the request');
  }
}
