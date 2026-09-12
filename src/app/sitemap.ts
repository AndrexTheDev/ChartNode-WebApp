// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/constants';

/** Routes that should appear in the sitemap (the terminal is `noindex`). */
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/help', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/legal/disclaimer', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' },
];

function url(locale: string, path: string) {
  return `${SITE_URL}/${locale}${path}`;
}

/**
 * One entry per (locale × route), each carrying hreflang alternates for all
 * five languages plus `x-default`. Generated at build time.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return ROUTES.flatMap((route) =>
    routing.locales.map((locale) => ({
      url: url(locale, route.path),
      lastModified,
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
