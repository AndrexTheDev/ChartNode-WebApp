// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/store/useToastStore';
import { BIG_DONATION_USD, useViralStore } from '@/store/useViralStore';

/**
 * „Ich habe gespendet" – zweistufig, ehrlich, ohne Backend.
 *
 * On-chain lässt sich eine Spende client-side nicht *zuordnen* (kein Konto,
 * kein Backend, $0-Stack), deshalb ist Stufe 2 eine Selbstauskunft über die
 * Größenordnung – genau wie der alte eine Klick, nur dass sie jetzt über die
 * Gnadenfrist entscheidet:
 *
 *   Stufe 1: „Ich habe gespendet"          → Betrag-Frage klappt auf
 *   Stufe 2: „Bis $5"     → registerDonation(1)  → 48 h keine Aufrufe
 *          „Über $5"    → registerDonation(10) → 5 Tage keine Aufrufe
 *
 * Beide Wege setzen zusätzlich das dauerhafte SUPPORTER-Badge (kosmetisch) –
 * die *Stille* ist zeitlich begrenzt, die Ehre nicht.
 */

/** Nominale Beträge der beiden Chips (nur die >$5-Schwelle ist relevant). */
export const DONATION_SMALL_USD = 1;
export const DONATION_BIG_USD = 10;

export function DonatedFlow({
  onDone,
  variant = 'footer',
}: {
  /** Wird nach der Betragswahl aufgerufen (z. B. Wall schließen). */
  onDone?: () => void;
  /** 'footer' = kompakt (Wall), 'block' = volle Breite (Tip-Jar). */
  variant?: 'footer' | 'block';
}) {
  const t = useTranslations('support');
  const registerDonation = useViralStore((s) => s.registerDonation);
  const supporter = useViralStore((s) => s.supporter);
  const [asking, setAsking] = useState(false);

  const declare = (usd: number): void => {
    registerDonation(usd);
    const big = usd > BIG_DONATION_USD;
    useToastStore.getState().push(t(big ? 'donatedThanks5d' : 'donatedThanks48'), 'bull', 9000);
    setAsking(false);
    onDone?.();
  };

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={cn(
          'nc-clip-sm inline-flex items-center justify-center gap-1.5 border font-mono text-2xs uppercase tracking-cyber transition-colors',
          variant === 'block' ? 'h-9 w-full px-3' : 'px-3 py-1.5',
          supporter
            ? 'border-bull/60 bg-bull/12 text-bull'
            : 'border-primary/60 bg-primary/15 text-primary shadow-[0_0_14px_-2px_hsl(var(--nc-primary)/0.8)] hover:bg-primary/25',
        )}
      >
        <Heart className={cn('size-3', variant === 'block' && 'size-3.5', supporter && 'fill-current')} aria-hidden />
        {supporter ? t('supporter') : t('donated')}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'nc-clip-sm flex flex-wrap items-center gap-x-2 gap-y-1.5 border border-bull/50 bg-bull/8 px-2.5 py-1.5',
        variant === 'block' && 'w-full justify-between',
      )}
    >
      <span className="font-mono text-2xs leading-snug text-muted">{t('donatedAsk')}</span>
      <span className="ml-auto flex shrink-0 gap-1.5">
        <button
          type="button"
          onClick={() => declare(DONATION_SMALL_USD)}
          className="nc-clip-sm border border-line bg-surface/60 px-2.5 py-1 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-bull/60 hover:text-bull"
        >
          {t('donatedSmall')}
        </button>
        <button
          type="button"
          onClick={() => declare(DONATION_BIG_USD)}
          className="nc-clip-sm border border-bull/60 bg-bull/12 px-2.5 py-1 font-mono text-2xs uppercase tracking-cyber text-bull transition-colors hover:bg-bull/22"
        >
          {t('donatedBig')}
        </button>
      </span>
    </div>
  );
}
