// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BenefitSection } from '@/components/landing/BenefitSection';
import { CtaSection } from '@/components/landing/CtaSection';
import { Hero } from '@/components/landing/Hero';
import { Ticker } from '@/components/landing/Ticker';
import { JsonLd } from '@/components/seo/JsonLd';
import { softwareApplicationLd } from '@/lib/jsonld';
import { assertLocale } from '@/lib/locale-param';
import { buildAlternates, buildOpenGraph, metaDescription } from '@/lib/seo';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('title');
  const description = metaDescription(t('description'));

  return {
    title,
    description,
    alternates: buildAlternates(locale),
    openGraph: buildOpenGraph({ locale, title, description }),
  };
}

export default async function LandingPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  // featureList = exakt was die Landing sichtbar verspricht (9 bezahlte
  // Konkurrenz-Features + 9 NodeChart-Uniques) → LD und Seite deckungsgleich
  const tb = await getTranslations({ locale, namespace: 'benefit' });
  const paid = tb.raw('paid') as { title: string }[];
  const unique = tb.raw('unique') as { title: string }[];
  const featureList = [...paid, ...unique].map((item) => item.title);

  return (
    <>
      <JsonLd data={softwareApplicationLd(locale, featureList)} />
      <Hero locale={locale} />
      <Ticker locale={locale} />
      <BenefitSection locale={locale} />
      <CtaSection locale={locale} />
    </>
  );
}
