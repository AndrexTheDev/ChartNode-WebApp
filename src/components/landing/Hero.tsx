// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { ArrowRight, Gift, Landmark, Radio, Terminal } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SmartlinkCta } from '@/components/ads/SmartlinkCta';
import { NeonButton } from '@/components/ui/NeonButton';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { StatusLed } from '@/components/ui/StatusLed';
import { MockChart } from '@/components/ui/MockChart';
import { ROUTES } from '@/lib/constants';
import type { Locale } from '@/i18n/routing';

interface HeroProps {
  locale: Locale;
}

export async function Hero({ locale }: HeroProps) {
  const t = await getTranslations({ locale, namespace: 'hero' });
  const tt = await getTranslations({ locale, namespace: 'ticker' });
  const tads = await getTranslations({ locale, namespace: 'ads' });

  const stats = [
    { key: 'cost', value: t('stats.cost.value'), label: t('stats.cost.label') },
    { key: 'locales', value: t('stats.locales.value'), label: t('stats.locales.label') },
    { key: 'layouts', value: t('stats.layouts.value'), label: t('stats.layouts.label') },
    { key: 'trackers', value: t('stats.trackers.value'), label: t('stats.trackers.label') },
  ] as const;

  return (
    <section className="container relative grid items-center gap-14 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-24">
      {/* ------------------------------ copy ------------------------------ */}
      <div className="flex flex-col gap-7">
        <span className="nc-clip-sm inline-flex w-fit items-center gap-2 border border-primary/35 bg-primary/8 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-primary">
          <Radio className="size-3 animate-pulse-glow" aria-hidden />
          {t('badge')}
        </span>

        <h1 className="font-display text-[2.6rem] font-black leading-[0.98] tracking-tight [overflow-wrap:anywhere] sm:text-6xl lg:text-display">
          <span className="block text-fg">{t('titleLine1')}</span>
          <span className="text-gradient-neon mt-1 block animate-shimmer">{t('titleLine2')}</span>
        </h1>

        <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">{t('subtitle')}</p>

        <div className="flex flex-wrap items-center gap-3">
          <NeonButton href={ROUTES.terminal} size="lg" pulse leading={<Terminal className="size-4" aria-hidden />}>
            {t('ctaPrimary')}
          </NeonButton>
          <NeonButton
            href="/#features"
            size="lg"
            variant="outline"
            trailing={<ArrowRight className="size-4 transition-transform duration-200 group-hover/btn:translate-x-1" aria-hidden />}
          >
            {t('ctaSecondary')}
          </NeonButton>
        </div>

        <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('hint')}</p>

        {/* sponsored partner offers – gekennzeichnet (rel=sponsored + Badge),
            echter Anker → blocker-resistent, Kit tracked nur Cap/Events */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SmartlinkCta
            label={tads('claimBonus')}
            badge={tads('sponsored')}
            leading={<Gift className="size-3.5" aria-hidden />}
          />
          <SmartlinkCta
            label={tads('partnerDeals')}
            badge={tads('sponsored')}
            leading={<Landmark className="size-3.5" aria-hidden />}
          />
          <span className="max-w-56 font-mono text-2xs leading-snug tracking-cyber text-faint">
            {tads('partnerNote')}
          </span>
        </div>

        <dl className="mt-2 grid max-w-lg grid-cols-2 gap-px border border-line/70 bg-line/40 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.key} className="bg-bg/80 px-4 py-3.5">
              <dt className="sr-only">{stat.label}</dt>
              <dd className="font-display text-2xl font-black text-primary neon-text">{stat.value}</dd>
              <dd className="mt-1 font-mono text-2xs uppercase tracking-cyber text-faint [overflow-wrap:anywhere]">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ---------------------------- terminal ---------------------------- */}
      <NeonPanel
        titleTag="p"
        className="relative shadow-panel"
        glow="lg"
        scan
        title="nodechart://terminal"
        actions={
          <>
            <span className="nc-chip border-primary/40 text-primary">{tt('demo')}</span>
            <StatusLed tone="ok" />
          </>
        }
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/70 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-extrabold tracking-tight">BTC/USDT</span>
            <span className="nc-chip">CEX · BINANCE</span>
          </div>
          <div className="flex items-baseline gap-3 font-mono text-xs">
            <span className="text-primary">68 412.50</span>
            <span className="text-bull">+2.41%</span>
          </div>
        </div>

        <div className="relative h-[300px] w-full bg-bg/40 sm:h-[340px]">
          <MockChart seed={20260909} bars={46} />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,hsl(var(--nc-bg)/0.7)_100%)]" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-line/70 px-4 py-2.5">
          {['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map((tf, i) => (
            <span
              key={tf}
              className={
                i === 3
                  ? 'nc-chip border-primary/60 bg-primary/12 text-primary'
                  : 'nc-chip opacity-70'
              }
            >
              {tf}
            </span>
          ))}
          <span className="nc-chip ml-auto border-secondary/50 text-secondary">1x1</span>
        </div>
      </NeonPanel>
    </section>
  );
}
