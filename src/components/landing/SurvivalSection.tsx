// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { Heart } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { WalletsList } from '@/components/support/WalletsList';
import type { Locale } from '@/i18n/routing';

/**
 * The honest funding section: one dev, no investors, ads + tips.
 * No paywall pitch, no fake scarcity – just why the lights stay on.
 */
export async function SurvivalSection({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'support' });

  return (
    <section id="survival" className="container scroll-mt-header py-20 lg:py-24">
      <SectionHeading eyebrow={t('landingEyebrow')} title={t('landingHeading')} description={t('landingSub')} />
      {/* `minmax(0,1fr)` statt `1fr`: Grid-Spuren sind per Default
          `min-width:auto` und wachsen auf die min-content-Breite ihres
          Inhalts. Die Wallet-Adressen (44 Zeichen, monospace, ohne
          Umbruchstelle) sprengten so bei 320px die Spur auf 444px und
          machten die ganze Seite horizontal scrollbar. */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="nc-clip border border-line/70 bg-bg/85 p-6">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs leading-relaxed text-muted">{t('story1')}</p>
            <p className="font-mono text-xs leading-relaxed text-muted">{t('story2')}</p>
            <p className="font-mono text-2xs leading-relaxed text-faint">{t('adsWhy')}</p>
            <div className="nc-clip-sm border border-line/70 bg-surface/40 p-3">
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('monthly')}</p>
              <ul className="flex flex-col gap-1.5 font-mono text-2xs text-muted">
                <li>☕ {t('slot1')}</li>
                <li>🍕 {t('slot2')}</li>
                <li>🛒 {t('slot3')}</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="nc-clip flex flex-col gap-3 border border-secondary/40 bg-bg/85 p-6">
          <WalletsList title={t('wallets')} copyLabel={t('copy')} copiedLabel={t('copied')} />
          <p className="mt-auto flex items-center gap-2 font-mono text-2xs text-faint">
            <Heart className="size-3 fill-current text-secondary" aria-hidden />
            {t('story3')}
          </p>
        </div>
      </div>
    </section>
  );
}
