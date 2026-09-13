// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { Check, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { NeonPanel } from '@/components/ui/NeonPanel';
import type { Locale } from '@/i18n/routing';

interface BenefitSectionProps {
  locale: Locale;
}

interface PaidRow {
  feat: string;
  gate: string;
}

/**
 * Trader-first benefit block: two compact panels — what costs a subscription
 * elsewhere (with the gate named) and what only NodeChart has. No story-time,
 * no fluff: one screen, every line a reason to open the terminal.
 */
export async function BenefitSection({ locale }: BenefitSectionProps) {
  const t = await getTranslations({ locale, namespace: 'benefit' });
  const paid = t.raw('paid') as PaidRow[];
  const unique = t.raw('unique') as string[];

  return (
    <section id="features" className="container relative py-14 lg:py-20">
      <div className="mb-8 flex flex-col gap-3">
        <h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">{t('title')}</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{t('sub')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- paid elsewhere ---------------- */}
        <NeonPanel title={t('paidTitle')} glow="sm">
          <ul className="divide-y divide-line/60">
            {paid.map((row) => (
              <li key={row.feat} className="flex items-start gap-3 px-4 py-2.5">
                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs uppercase tracking-cyber text-fg">{row.feat}</span>
                  <span className="block font-mono text-micro-10 text-faint">{row.gate}</span>
                </span>
                <span className="nc-chip shrink-0 border-primary/40 px-1.5 py-0.5 text-micro-9 text-primary">
                  {t('free')}
                </span>
              </li>
            ))}
          </ul>
        </NeonPanel>

        {/* ---------------- nodechart only ---------------- */}
        <NeonPanel title={t('uniqueTitle')} glow="sm">
          <ul className="divide-y divide-line/60">
            {unique.map((row) => (
              <li key={row} className="flex items-start gap-3 px-4 py-2.5">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-secondary" aria-hidden />
                <span className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-muted">
                  {row}
                </span>
              </li>
            ))}
          </ul>
        </NeonPanel>
      </div>

      <p className="mt-6 max-w-3xl font-mono text-2xs leading-relaxed text-faint">
        {t('support')}
      </p>
    </section>
  );
}
