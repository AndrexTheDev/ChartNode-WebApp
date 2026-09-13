// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { Lock, Mail, Scale, ShieldAlert, type LucideIcon } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbLd } from '@/lib/jsonld';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { routing } from '@/i18n/routing';
import { CONTACT } from '@/lib/constants';
import { buildAlternates, buildOpenGraph, buildTwitter, metaDescription } from '@/lib/seo';
import { assertLocale } from '@/lib/locale-param';

/** One route file serves all three legal documents in all five locales. */
const DOCS = ['terms', 'disclaimer', 'privacy'] as const;
type Doc = (typeof DOCS)[number];

const ICONS: Record<Doc, LucideIcon> = {
  terms: Scale,
  disclaimer: ShieldAlert,
  privacy: Lock,
};

interface PageProps {
  params: Promise<{ locale: string; doc: string }>;
}

function assertDoc(doc: string): Doc {
  if (!(DOCS as readonly string[]).includes(doc)) return 'terms';
  return doc as Doc;
}

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => DOCS.map((doc) => ({ locale, doc })));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: rawLocale, doc: rawDoc } = await params;
  const locale = assertLocale(rawLocale);
  const doc = assertDoc(rawDoc);
  const t = await getTranslations({ locale, namespace: `legal.${doc}` });
  const tl = await getTranslations({ locale, namespace: 'legal' });
  const title = t('title');
  const description = metaDescription(t('intro'));

  return {
    title,
    description,
    alternates: buildAlternates(locale, `/legal/${doc}`),
    openGraph: buildOpenGraph({ locale, title, description, path: `/legal/${doc}` }),
    twitter: buildTwitter(title, description),
    robots: { index: true, follow: true },
    other: { 'nc:document': doc, 'nc:notice': tl('readingTime') },
  };
}

export default async function LegalPage({ params }: PageProps) {
  const { locale: rawLocale, doc: rawDoc } = await params;
  const locale = assertLocale(rawLocale);
  const doc = assertDoc(rawDoc);

  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: `legal.${doc}` });
  const tl = await getTranslations({ locale, namespace: 'legal' });
  const format = await getFormatter({ locale });
  const Icon = ICONS[doc];

  const sections = t.raw('sections') as { heading: string; body: string }[];

  return (
    <>
      <Breadcrumbs items={[{ href: '/', label: 'NodeChart' }, { href: `/legal/${doc}`, label: t('title') }]} />
      <JsonLd
        data={breadcrumbLd(locale, [
          { name: 'NodeChart', path: '/' },
          { name: t('title'), path: `/legal/${doc}` },
        ])}
      />
      <LegalDocument
      eyebrow={tl('readingTime')}
      title={t('title')}
      intro={t('intro')}
      backLabel={tl('back')}
      updatedLabel={tl('updated', {
        date: format.dateTime(new Date('2026-09-09T00:00:00Z'), { dateStyle: 'long' }),
      })}
      sections={sections}
      icon={<Icon className="size-3.5" aria-hidden />}
      contactBlock={
        <NeonPanel glow="sm" className="p-6 sm:p-7">
          <h2 className="font-mono text-2xs uppercase tracking-mega text-faint">
            {tl('contactBlock')}
          </h2>
          <p className="mt-3 font-display text-xl font-extrabold">{CONTACT.handle}</p>
          <a
            href={CONTACT.mailto}
            className="mt-2 inline-flex items-center gap-2 font-mono text-sm text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
          >
            <Mail className="size-4" aria-hidden />
            {CONTACT.email}
          </a>
        </NeonPanel>
      }
      />
    </>
  );
}
