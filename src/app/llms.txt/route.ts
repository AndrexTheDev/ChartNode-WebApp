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
    `> ${TAGLINE} ${SITE_NAME} is a 100% free, client-side TradingView alternative for`,
    '> crypto spot, perpetuals and DEX pairs: real-time charts, 34 indicators, 42 market',
    '> metrics, on-chain signals, a Pine-style Script Lab and help docs for every single',
    '> indicator and metric in five languages. No accounts, no paywalls, no backend for',
    '> user data – funded by ads and donations from one solo developer.',
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
    '- Price: free, no subscription tiers, nothing paywalled.',
    '- Data: 12 CEX venues via public WebSocket/REST APIs + DEX data on 33 chains (DexScreener, GeckoTerminal). No API keys required.',
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
