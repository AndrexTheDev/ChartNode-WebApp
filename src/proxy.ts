// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { COUNTRY_COOKIE } from './lib/region';

const intlMiddleware = createMiddleware(routing);

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts` (Node.js runtime).
 *
 * What this does for NodeChart:
 *   1. `/` → 307 to `/{locale}` using, in order of precedence:
 *        a. the NEXT_LOCALE cookie (set the first time a user picks a language)
 *        b. the `Accept-Language` header sent by the browser/OS
 *        c. `routing.defaultLocale`
 *      => "automatische Spracherkennung des Systems" with zero JS on the client.
 *   2. Prefixes/validates every other route and keeps deep links intact.
 *   3. Mirrors Cloudflare's `cf-ipcountry` header into a cookie so the client
 *      can adapt exchange selection to the visitor's region – even on fully
 *      prerendered pages, where no request headers exist at render time.
 *   4. Runs on Cloudflare's edge, costs nothing and adds no cold start.
 */
export default function proxy(request: NextRequest) {
  const response = intlMiddleware(request);

  // Cloudflare sets cf-ipcountry on every request (two-letter ISO-3166 alpha-2).
  const country = request.headers.get('cf-ipcountry');
  if (country && /^[A-Za-z]{2}$/.test(country) && country.toUpperCase() !== 'XX') {
    const value = country.toUpperCase();
    // Only write when it changed: a Set-Cookie on every navigation would vary
    // the CDN cache key for prerendered pages.
    if (request.cookies.get(COUNTRY_COOKIE)?.value !== value) {
      response.cookies.set(COUNTRY_COOKIE, value, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        sameSite: 'lax',
      });
    }
  }

  return response;
}

export const config = {
  // Match all pathnames except static assets, Next internals and API routes.
  matcher: ['/((?!api|trpc|_next|_vercel|og|icon\\.svg|favicon\\.ico|.*\\..*).*)'],
};
