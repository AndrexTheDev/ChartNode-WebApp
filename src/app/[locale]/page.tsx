// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BenefitSection } from '@/components/landing/BenefitSection';
import { CtaSection } from '@/components/landing/CtaSection';
import { Hero } from '@/components/landing/Hero';
import { Ticker } from '@/components/landing/Ticker';
import { SmartlinkKit } from '@/components/ads/SmartlinkKit';
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

  // Keep structured data aligned with the visible feature inventory: paid[]
  // uses { feat, gate } rows, while unique[] contains plain strings.
  const tb = await getTranslations({ locale, namespace: 'benefit' });
  const paid = tb.raw('paid') as { feat: string }[];
  const unique = tb.raw('unique') as string[];
  const featureList = [...paid.map((row) => row.feat), ...unique].filter(
    (feature): feature is string => typeof feature === 'string' && feature.trim().length > 0,
  );

  return (
    <>
      <JsonLd data={softwareApplicationLd(locale, featureList)} />
      <Hero locale={locale} />
      <Ticker locale={locale} />
      <BenefitSection locale={locale} />
      <CtaSection locale={locale} />
      {/* Smartlink-Kit (Landing): Enhancement, Cap-Tracking, Fallback-Modal */}
      <SmartlinkKit surface="landing" />
    </>
  );
}
