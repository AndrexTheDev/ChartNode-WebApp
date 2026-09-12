// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { defineRouting } from 'next-intl/routing';

/**
 * Single source of truth for locale routing.
 *
 * `localePrefix: 'always'` is a deliberate SEO decision:
 *   • every language lives on its own canonical URL (/de, /en, /es, /zh, /ru)
 *   • hreflang + x-default can be emitted unambiguously
 *   • all 5 locales are prerendered at build time via generateStaticParams,
 *     so Cloudflare serves pure static HTML from the edge (0 ms TTFB, $0)
 *   • language auto-detection happens once, in `src/proxy.ts`, as a redirect
 *     from `/` – it never forces a page to become dynamic.
 */
export const routing = defineRouting({
  locales: ['en', 'de', 'es', 'zh', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];

export const locales = routing.locales;
export const defaultLocale = routing.defaultLocale;

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
