// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MarketDataProvider } from '@/components/market/MarketDataProvider';
import { TerminalShell } from '@/components/terminal/TerminalShell';
import { WhaleTicker } from '@/components/whales/WhaleTicker';
import { assertLocale } from '@/lib/locale-param';
import { sanitizePrice, sanitizeTicker } from '@/lib/og';
import { buildAlternates, buildOpenGraph, buildTwitter } from '@/lib/seo';
import { SITE_URL } from '@/lib/constants';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ticker?: string; price?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'nav' });

  // Shared terminal links carry ticker + price → the OG edge renders the
  // *actual* setup as social card (`/api/og`, see README §10.5).
  const ticker = sanitizeTicker(query.ticker ?? null);
  const price = sanitizePrice(query.price ?? null);
  const ogUrl = `/api/og?ticker=${encodeURIComponent(ticker)}${price ? `&price=${encodeURIComponent(query.price ?? '')}` : ''}&locale=${locale}`;
  const title = query.ticker ? `$${ticker} · ${t('terminal')}` : t('terminal');
  const description = t('terminalDescription');

  return {
    title,
    description,
    alternates: buildAlternates(locale, '/terminal'),
    openGraph: buildOpenGraph({
      locale,
      title,
      description,
      path: '/terminal',
      image: `${SITE_URL}${ogUrl}`,
    }),
    twitter: buildTwitter(title, description, `${SITE_URL}${ogUrl}`),
    // Deliberately not indexed until the chart engine (Part 2) ships – we do
    // not want a thin workspace page competing with the landing page.
    robots: { index: false, follow: true },
  };
}

export default async function TerminalPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  return (
    <>
      <MarketDataProvider />
      <TerminalShell />
      <WhaleTicker />
    </>
  );
}
