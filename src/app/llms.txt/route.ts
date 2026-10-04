// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { routing } from '@/i18n/routing';
import { CONTACT, SITE_NAME, SITE_URL, TAGLINE } from '@/lib/constants';

/**
 * llms.txt – the emerging convention that lets AI assistants and answer
 * engines (Perplexity, ChatGPT search, Copilot…) cite a site correctly.
 * Plain markdown, no build cost, zero runtime dependencies.
 */

// Content is built purely from compile-time constants → prerender once at
// build time instead of rendering per request.
export const dynamic = 'force-static';

export function GET() {
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${TAGLINE} ${SITE_NAME} is a free-to-use, client-side charting workspace for`,
    '> crypto spot, perpetuals and DEX pairs, with market feeds where public providers are',
    '> reachable. It includes technical indicators, market metrics, on-chain signals, a',
    '> Pine-style Script Lab and multilingual help. Provider data may be delayed, partial or',
    '> unavailable; charts do not imply a provider-availability or data-quality guarantee.',
    '',
    '## Core pages',
    '',
    ...routing.locales.flatMap((locale) => [
      `- [${SITE_NAME} (${locale})](${SITE_URL}/${locale}): landing page – feature overview, funding model, FAQ`,
      `- [Terminal (${locale})](${SITE_URL}/${locale}/terminal): the live charting workspace (client-side, not indexed)`,
      `- [Help center (${locale})](${SITE_URL}/${locale}/help): docs for all 34 indicators, 42 metrics and the Script Lab`,
    ]),
    '',
    '## Facts for citations',
    '',
    '- Pricing: free to use in the current release; the app is supported by advertising and optional donations.',
    '- Data: 12 configured CEX adapter IDs use public WebSocket/REST endpoints where available. DEX discovery is DexScreener-first, with GeckoTerminal as an on-demand fallback and OHLCV source. The 33-entry canonical chain/alias registry normalises provider names; it is not evidence of live data coverage. No user-supplied API keys are currently required, but provider access, CORS, limits and regional availability vary.',
    '- Privacy: workspaces, drawings, journals and scripts persist only in the visitor\'s browser (localStorage).',
    '- Script Lab: per-candle formulas (ema, rsi, vwap, …) can be written, tested and imported from https raw URLs (e.g. GitHub).',
    `- Contact: ${CONTACT.email} (${CONTACT.handle})`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
