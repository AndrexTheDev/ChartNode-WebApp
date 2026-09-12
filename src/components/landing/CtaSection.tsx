// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { Mail, Terminal } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { NeonButton } from '@/components/ui/NeonButton';
import { CONTACT, ROUTES } from '@/lib/constants';
import type { Locale } from '@/i18n/routing';

export async function CtaSection({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'cta' });

  return (
    <section className="container py-20 lg:py-28">
      <div className="nc-panel nc-clip-lg relative overflow-hidden px-6 py-14 text-center sm:px-14 sm:py-20">
        {/* decorative layers */}
        <div aria-hidden className="nc-grid absolute inset-0 bg-grid opacity-60" />
        <div aria-hidden className="absolute inset-0 bg-hero-glow" />
        <div aria-hidden className="nc-hatch absolute inset-x-0 top-0 h-1.5 opacity-50" />
        <div aria-hidden className="nc-hatch absolute inset-x-0 bottom-0 h-1.5 opacity-50" />

        <div className="relative flex flex-col items-center gap-6">
          <span className="nc-eyebrow">
            <span aria-hidden className="text-primary/60">
              {'//'}
            </span>
            {t('eyebrow')}
          </span>

          <h2 className="max-w-2xl text-3xl font-black leading-tight sm:text-5xl">{t('heading')}</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted sm:text-base">{t('body')}</p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <NeonButton href={ROUTES.terminal} size="xl" pulse leading={<Terminal className="size-4" aria-hidden />}>
              {t('primary')}
            </NeonButton>
            <NeonButton href={ROUTES.help} size="xl" variant="secondary">
              {t('secondary')}
            </NeonButton>
          </div>

          <p className="mt-4 flex flex-wrap items-center justify-center gap-2 font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('contactLine')}
            <a
              href={CONTACT.mailto}
              className="inline-flex items-center gap-1.5 text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
            >
              <Mail className="size-3" aria-hidden />
              {CONTACT.email}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
