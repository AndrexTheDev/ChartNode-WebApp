// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Terminal carries `robots: index:false` in its metadata – meta beats
        // robots.txt here, because social bots must still fetch the page to
        // read its OpenGraph/Twitter card (a disallow would kill share cards).
      },
      {
        userAgent: [
          'Twitterbot',
          'facebookexternalhit',
          'TelegramBot',
          'LinkedInBot',
          'Discordbot',
          'WhatsApp',
          'Slackbot',
        ],
        allow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
