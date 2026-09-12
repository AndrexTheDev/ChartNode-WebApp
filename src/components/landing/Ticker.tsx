// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { getTranslations } from 'next-intl/server';
import { TICKER_SEED } from '@/lib/constants';
import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/routing';

/**
 * Infinite marquee of instruments. The list is rendered twice and translated
 * by -50% (`animate-marquee`) so the loop is seamless. Purely decorative:
 * `aria-hidden` on the moving copy, real label on the container.
 */
export async function Ticker({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'ticker' });
  const items = [...TICKER_SEED, ...TICKER_SEED];

  return (
    <div
      aria-label={t('ariaLabel')}
      className="relative w-full overflow-hidden border-y border-line/70 bg-surface/40 py-2.5"
    >
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-bg to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-bg to-transparent" />

      <div className="group flex w-max animate-marquee items-center gap-8 hover:[animation-play-state:paused]">
        {items.map((item, index) => (
          <span key={`${item.symbol}-${index}`} className="flex items-center gap-2.5 font-mono text-2xs">
            <span className={cn('size-1 rounded-full', item.venue === 'DEX' ? 'bg-secondary' : 'bg-primary')} />
            <span className="uppercase tracking-cyber text-fg/80">{item.symbol}</span>
            <span className="text-faint">{item.venue}</span>
            <span className={cn('tabular-nums', item.change >= 0 ? 'text-bull' : 'text-bear')}>
              {item.change >= 0 ? '▲' : '▼'} {Math.abs(item.change).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
