// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import localFont from 'next/font/local';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import '@fontsource-variable/orbitron/wght.css';
import '@fontsource-variable/exo-2/wght.css';
import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';

import { CommandPalette } from '@/components/layout/CommandPalette';
import { GlobalShortcuts } from '@/components/layout/GlobalShortcuts';
import { AdManager } from '@/components/ads/AdManager';
import { AdConsentBanner } from '@/components/ads/AdConsentBanner';
import { LocaleDetectBanner } from '@/components/layout/LocaleDetectBanner';
import { RateLimitOverlay } from '@/components/overlays/RateLimitOverlay';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { HeaderNativeBanner } from '@/components/ads/HeaderNativeBanner';
import { StoreBridge } from '@/components/layout/StoreBridge';
import { ThemeBootScript } from '@/components/layout/ThemeBootScript';
import { GridBackdrop } from '@/components/ui/GridBackdrop';
import { routing } from '@/i18n/routing';
import { assertLocale } from '@/lib/locale-param';
import { CONTACT, SITE_NAME, SITE_URL } from '@/lib/constants';
import { buildAlternates, buildOpenGraph, ROBOTS_DEFAULT, metaDescription } from '@/lib/seo';
import { organizationLd, websiteLd } from '@/lib/jsonld';
import { JsonLd } from '@/components/seo/JsonLd';
import { LOCALE_META } from '@/lib/locales';
import { THEME_COLOR } from '@/lib/theme';
import { cn } from '@/lib/cn';
import '@/styles/globals.css';

// The hero display face is the LCP text font. Preload its Latin subset with
// next/font while retaining Fontsource's other scripts as glyph fallbacks.
const exo2LatinPreload = localFont({
  src: '../../../node_modules/@fontsource-variable/exo-2/files/exo-2-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-display-preload',
});

/* -------------------------------------------------------------------------- */
/* Self-hosted variable fonts from Fontsource: no build-time Google Fonts fetch. */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Static generation                                                         */
/* -------------------------------------------------------------------------- */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/* -------------------------------------------------------------------------- */
/*  SEO                                                                       */
/* -------------------------------------------------------------------------- */

export const viewport: Viewport = {
  themeColor: THEME_COLOR.acid,
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('title');
  const description = metaDescription(t('description'));

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description,
    keywords: t('keywords')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    applicationName: SITE_NAME,
    authors: [{ name: CONTACT.handle, url: CONTACT.mailto }],
    creator: CONTACT.handle,
    publisher: CONTACT.handle,
    category: 'technology',
    formatDetection: { email: false, address: false, telephone: false },
    alternates: buildAlternates(locale),
    openGraph: buildOpenGraph({ locale, title, description }),
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${SITE_URL}/og.png`],
    },
    robots: ROBOTS_DEFAULT,
  };
}

/* -------------------------------------------------------------------------- */
/*  Root layout (per locale)                                                  */
/* -------------------------------------------------------------------------- */

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // assertLocale() narrows the param to the Locale union and renders the 404
  // for unsupported languages (e.g. /fr/…).
  const locale = assertLocale((await params).locale);

  // Enables static rendering for this subtree – without it every page that
  // uses translations would opt into dynamic rendering.
  setRequestLocale(locale);

  const [messages, t] = await Promise.all([getMessages(), getTranslations('nav')]);
  const meta = LOCALE_META[locale];

  return (
    <html
      lang={meta.htmlLang}
      dir="ltr"
      data-theme="acid"
      className={exo2LatinPreload.variable}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the persisted theme before first paint – no flash of wrong skin. */}
        <ThemeBootScript />
      </head>

      <body
        className={cn(
          'relative flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased',
          meta.script === 'cjk' && '[font-feature-settings:"palt"]',
        )}
      >
        <GridBackdrop />

        {/* schema.org baseline for the whole site: who we are + what this is */}
        <JsonLd data={[organizationLd(), websiteLd(locale)]} />

        <NextIntlClientProvider locale={locale} messages={messages}>
          <StoreBridge locale={locale} />
          <GlobalShortcuts />

          <a
            href="#nc-content"
            className={cn(
              'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-toast',
              'focus:bg-primary focus:px-4 focus:py-2 focus:font-mono focus:text-xs',
              'focus:uppercase focus:tracking-cyber focus:text-primary-fg focus:shadow-neon',
            )}
          >
            {t('skipToContent')}
          </a>

          <SiteHeader />

          {/* Optional Adsterra delivery is opt-in; the notice is in-flow, not a blocking modal. */}
          <AdConsentBanner />

          {/* Native Banner (4:1) in der Header-Zone – Terminal skippt (Strip) */}
          <HeaderNativeBanner />

          {/* Sprach-Hinweis in-flow in der Header-Zone: verdeckt nie Content */}
          <LocaleDetectBanner />

          <main id="nc-content" className="flex-1">
            {children}
          </main>

          <SiteFooter locale={locale} />

          <CommandPalette />
          <RateLimitOverlay />
          {/* Adsterra slots, ad-block soft-wall, share-to-unlock modals */}
          <AdManager />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
