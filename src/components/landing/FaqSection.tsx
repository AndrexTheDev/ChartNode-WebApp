// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { getTranslations } from 'next-intl/server';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqPageLd } from '@/lib/jsonld';
import type { Locale } from '@/i18n/routing';

interface FaqItem {
  q: string;
  a: string;
}

/**
 * Visible, crawlable FAQ – keyword-rich questions in plain HTML
 * (<details>/<summary> = zero JS, content ships in the prerender) plus the
 * matching FAQPage schema so search engines can show rich results.
 */
export async function FaqSection({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'faq' });
  const items = t.raw('items') as FaqItem[];

  return (
    <section id="faq" className="container scroll-mt-header py-20 lg:py-28">
      <SectionHeading eyebrow={t('heading')} title={t('heading')} description={t('sub')} />

      <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-px border border-line/70 bg-line/40">
        {items.map((item) => (
          <details key={item.q} className="group bg-bg/85 open:bg-elevated/30">
            <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 text-sm font-semibold text-fg transition-colors hover:text-primary sm:text-base [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="font-mono text-2xs text-primary transition-transform group-open:rotate-90">
                ▸
              </span>
              {item.q}
            </summary>
            <p className="border-l border-primary/30 px-5 pb-5 pl-[3.4rem] text-sm leading-relaxed text-muted">
              {item.a}
            </p>
          </details>
        ))}
      </div>

      <JsonLd data={faqPageLd(items.map((item) => ({ question: item.q, answer: item.a })))} />
    </section>
  );
}
