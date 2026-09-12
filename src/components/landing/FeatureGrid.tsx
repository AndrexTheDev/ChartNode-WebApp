// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { getTranslations } from 'next-intl/server';
import { FeatureIcon } from '@/components/ui/FeatureIcon';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { SectionHeading } from '@/components/ui/SectionHeading';
import type { Locale } from '@/i18n/routing';

interface FeatureItem {
  icon: string;
  title: string;
  body: string;
}

export async function FeatureGrid({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'features' });
  const items = t.raw('items') as FeatureItem[];

  return (
    <section id="features" className="container scroll-mt-header py-20 lg:py-28">
      <SectionHeading eyebrow={t('eyebrow')} title={t('heading')} description={t('subheading')} />

      <div className="mt-12 grid gap-px border border-line/70 bg-line/40 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <NeonPanel
            key={item.title}
            as="article"
            clipped={false}
            glow="sm"
            className="group relative border-0 bg-bg/85 p-6 transition-colors duration-300 hover:bg-elevated/60"
          >
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-px scale-y-0 bg-primary transition-transform duration-500 ease-cyber group-hover:scale-y-100"
            />
            <span className="mb-5 flex items-center justify-between">
              <span className="flex size-11 items-center justify-center border border-primary/35 bg-primary/8 text-primary transition-shadow duration-300 group-hover:shadow-neon-sm">
                <FeatureIcon name={item.icon} className="size-5" />
              </span>
              <span className="font-mono text-2xs text-faint">
                {String(index + 1).padStart(2, '0')}
              </span>
            </span>

            <h3 className="text-lg font-bold leading-snug text-fg">{item.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-muted">{item.body}</p>
          </NeonPanel>
        ))}
      </div>
    </section>
  );
}
