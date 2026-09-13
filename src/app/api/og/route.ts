// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { NextRequest } from 'next/server';
import { buildOgSvg, OG_HEIGHT, OG_WIDTH, ogLocale, sanitizePrice, sanitizeTicker } from '@/lib/og';

/**
 * Dynamic social card: `/api/og?ticker=SOL&price=150&change=2.4&locale=de`.
 *
 * Runs on the default runtime: the handler is a pure string builder (no Node
 * APIs), so @opennextjs/cloudflare compiles it to a Worker as-is. The legacy
 * `runtime = 'edge'` marker is deprecated in Next 16 and only suppressed
 * static generation – nothing here needs it.
 *
 * Shared terminal links carry the ticker + the price at share time, so every
 * platform that unfurls a NodeChart URL shows the *actual* setup instead of a
 * generic banner. SVG today (Telegram/Discord/Reddit render it), Satori PNG
 * is the documented upgrade path – see `src/lib/og.ts`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const changeRaw = Number.parseFloat(params.get('change') ?? '');

  const svg = buildOgSvg({
    ticker: sanitizeTicker(params.get('ticker')),
    price: sanitizePrice(params.get('price')),
    changePct: Number.isFinite(changeRaw) ? Math.max(-99.99, Math.min(99.99, changeRaw)) : null,
    locale: ogLocale(params.get('locale')),
  });

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
      'x-og-size': `${OG_WIDTH}x${OG_HEIGHT}`,
    },
  });
}
