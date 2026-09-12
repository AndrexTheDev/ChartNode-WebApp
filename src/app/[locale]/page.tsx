// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CtaSection } from '@/components/landing/CtaSection';
import { FaqSection } from '@/components/landing/FaqSection';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
import { Hero } from '@/components/landing/Hero';
import { LayoutShowcase } from '@/components/landing/LayoutShowcase';
import { SurvivalSection } from '@/components/landing/SurvivalSection';
import { Ticker } from '@/components/landing/Ticker';
import { JsonLd } from '@/components/seo/JsonLd';
import { softwareApplicationLd } from '@/lib/jsonld';
import { assertLocale } from '@/lib/locale-param';
import { buildAlternates, buildOpenGraph } from '@/lib/seo';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('title');
  const description = t('description');

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

  const tf = await getTranslations({ locale, namespace: 'features' });
  const featureList = (tf.raw('items') as { title: string }[]).map((item) => item.title);

  return (
    <>
      <JsonLd data={softwareApplicationLd(locale, featureList)} />
      <Hero locale={locale} />
      <Ticker locale={locale} />
      <FeatureGrid locale={locale} />
      <LayoutShowcase />
      <SurvivalSection locale={locale} />
      <FaqSection locale={locale} />
      <CtaSection locale={locale} />
    </>
  );
}
