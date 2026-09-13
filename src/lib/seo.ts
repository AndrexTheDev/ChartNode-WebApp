// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { LOCALE_META } from './locales';
import { SITE_NAME, SITE_URL } from './constants';
import { locales, type Locale } from '@/i18n/routing';

/** Absolute URL for a locale-scoped path. */
export function absoluteUrl(locale: Locale, path = ''): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}/${locale}${suffix === '/' ? '' : suffix}`;
}

/**
 * Builds `alternates` with a canonical URL plus hreflang for every locale
 * (and `x-default` pointing at English). This is what makes each of the five
 * language versions rank independently instead of competing with each other.
 */
export function buildAlternates(locale: Locale, path = '') {
  const languages: Record<string, string> = {
    'x-default': absoluteUrl('en', path),
  };
  for (const l of locales) languages[l] = absoluteUrl(l, path);

  return {
    canonical: absoluteUrl(locale, path),
    languages,
  };
}

/** Shared OpenGraph/Twitter defaults; page metadata merges on top. */
export function buildOpenGraph(opts: {
  locale: Locale;
  title: string;
  description: string;
  path?: string;
  image?: string;
}): Metadata['openGraph'] {
  const path = opts.path ?? '';
  const images = [{ url: opts.image ?? `${SITE_URL}/og.png`, width: 1200, height: 630, alt: opts.title }];

  return {
    type: 'website',
    siteName: SITE_NAME,
    title: opts.title,
    description: opts.description,
    url: absoluteUrl(opts.locale, path),
    locale: LOCALE_META[opts.locale].ogLocale,
    // Tells social platforms that four more language editions exist.
    alternateLocale: locales.filter((l) => l !== opts.locale).map((l) => LOCALE_META[l].ogLocale),
    images,
  };
}

export const ROBOTS_DEFAULT: Metadata['robots'] = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  },
};

/** Twitter/X-Card passend zur OpenGraph-Konfiguration. */
export function buildTwitter(title: string, description: string, image?: string): Metadata['twitter'] {
  return {
    card: 'summary_large_image',
    title,
    description,
    images: [image ?? `${SITE_URL}/og.png`],
  };
}

/**
 * Description auf Snippet-Länge kappen (ideal 50–160 Zeichen): an der letzten
 * Satz-/Kommagrenze vor 160 Zeichen enden, nie mitten im Wort.
 */
export function metaDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf(', '));
  return (boundary > 60 ? cut.slice(0, boundary + 1) : cut).trim();
}
