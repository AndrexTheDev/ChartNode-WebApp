// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';

import { HelpExplorer } from '@/components/help/HelpExplorer';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { breadcrumbLd, definedTermSetLd, faqPageLd } from '@/lib/jsonld';
import { assertLocale } from '@/lib/locale-param';
import { buildAlternates, buildOpenGraph, buildTwitter, metaDescription, ROBOTS_DEFAULT } from '@/lib/seo';

interface HelpBundle {
  title: string;
  topics: { id: string; question: string; answer: string }[];
  scriptTopics: { id: string; question: string; answer: string }[];
  edgeTopics: { id: string; question: string; answer: string }[];
  metrics: Record<string, { name: string; body: string }>;
}

interface ChartBundle {
  indicators: Record<string, { name: string; short: string; hint: string }>;
}

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'help' });
  const title = t('title');
  const description = metaDescription(t('subtitle'));

  return {
    title,
    description,
    alternates: buildAlternates(locale, '/help'),
    openGraph: buildOpenGraph({ locale, title, description, path: '/help' }),
    twitter: buildTwitter(title, description),
    robots: ROBOTS_DEFAULT,
  };
}

export default async function HelpPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'help' });

  const messages = await getMessages({ locale });
  const help = messages.help as HelpBundle;
  const chart = messages.chart as ChartBundle;

  // Everything the explorer renders client-side, mirrored as schema.org:
  // FAQ rich results for the guides + a glossary of every indicator/metric.
  const faqItems = [...help.topics, ...help.scriptTopics, ...help.edgeTopics].map((topic) => ({
    question: topic.question,
    answer: topic.answer,
  }));
  const terms = [
    ...Object.values(chart.indicators).map((def) => ({
      term: `${def.name} – ${def.short}`,
      description: def.hint,
    })),
    ...Object.values(help.metrics).map((def) => ({ term: def.name, description: def.body })),
  ];

  return (
    <>
      <Breadcrumbs items={[{ href: '/', label: 'NodeChart' }, { href: '/help', label: help.title }]} />
      <JsonLd
        data={[
          faqPageLd(faqItems),
          definedTermSetLd(help.title, terms),
          breadcrumbLd(locale, [
            { name: 'NodeChart', path: '/' },
            { name: help.title, path: '/help' },
          ]),
        ]}
      />
      <div className="container max-w-5xl py-14 lg:py-20">
        <SectionHeading
          className="mb-12"
          eyebrow={t('eyebrow')}
          title={t('title')}
          description={t('subtitle')}
          titleAs="h1"
        />

        <HelpExplorer />
      </div>
    </>
  );
}
