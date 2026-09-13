// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';

import { HelpExplorer } from '@/components/help/HelpExplorer';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { breadcrumbLd, definedTermSetLd, faqPageLd } from '@/lib/jsonld';
import { assertLocale } from '@/lib/locale-param';
import { buildAlternates, buildOpenGraph, buildTwitter, metaDescription, ROBOTS_DEFAULT, absoluteUrl } from '@/lib/seo';

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
    url: absoluteUrl(locale, `/help#${topic.id}`),
  }));
  // TOC-Zähler: Basis-Themen + generierte Indikatoren/Metriken je Kategorie
  const indicatorCount = Object.keys(chart.indicators ?? {}).length;
  const metricCount = Object.keys(help.metrics ?? {}).length;
  const toc = [
    ...(['gettingStarted', 'charts', 'data', 'troubleshooting'] as const).map((cat) => ({
      id: cat,
      count: (help.topics as { id: string; category?: string }[]).filter((topic) => topic.category === cat).length,
    })),
    { id: 'indicators' as const, count: indicatorCount },
    { id: 'metrics' as const, count: metricCount },
    { id: 'scripts' as const, count: help.scriptTopics.length },
    { id: 'edge' as const, count: help.edgeTopics.length },
  ].filter((entry) => entry.count > 0);
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

        <nav aria-label={t('toc')} className="mb-12">
          <h2 className="mb-3 font-mono text-2xs uppercase tracking-cyber text-faint">{t('toc')}</h2>
          <ul className="flex flex-wrap gap-2">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#sec-${entry.id}`}
                  className="nc-clip-sm inline-flex items-center gap-2 border border-line bg-surface/50 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-primary/50 hover:text-primary"
                >
                  {t(`categories.${entry.id}`)}
                  <span className="text-micro-9 text-faint">{entry.count}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <HelpExplorer />
      </div>
    </>
  );
}
