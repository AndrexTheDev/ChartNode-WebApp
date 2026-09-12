// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The terminal is a client-side workspace with no crawlable content yet.
        disallow: ['/*/terminal'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
