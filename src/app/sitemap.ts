// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/constants';
/** Indexierbare Routen samt gepflegtem Inhalts-Stand (siehe lib/sitemap-meta). */
import { ROUTE_SEO } from '@/lib/sitemap-meta';

function url(locale: string, path: string) {
  return `${SITE_URL}/${locale}${path}`;
}

/**
 * One entry per (locale × route), each carrying hreflang alternates for all
 * five languages plus `x-default`. Generated at build time.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTE_SEO.flatMap((route) =>
    routing.locales.map((locale) => ({
      url: url(locale, route.path),
      lastModified: new Date(route.lastmod),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: Object.fromEntries([
          ...routing.locales.map((l) => [l, url(l, route.path)] as const),
          ['x-default', url(routing.defaultLocale, route.path)] as const,
        ]),
      },
    })),
  );
}
