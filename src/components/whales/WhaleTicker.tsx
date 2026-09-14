// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef } from 'react';
import { ArrowDownRight, ArrowUpRight, Waves } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusLed } from '@/components/ui/StatusLed';
import { cn } from '@/lib/cn';
import { clockTime, compactUsd } from '@/lib/format';
import { selectWhaleEnabled, selectWhaleTrades, useWhaleStore } from '@/store/useWhaleStore';
import type { WhaleTrade } from '@/store/useWhaleStore';

/**
 * Bottom whale-flow ticker.
 *
 * Subscribes to `useWhaleStore`, which the socket manager fills from the live
 * trade channels (Binance aggTrade / Bybit publicTrade / OKX trades) filtered
 * at > threshold USD. Buys glow neon-green, sells neon-red; new prints slide
 * in from the left in batches (the tracker flushes every 400 ms).
 *
 * Anchoring: `fixed`, not `sticky bottom-0`.
 *
 * Sticky only holds while the element's own scroll container is on screen.
 * This ticker lives inside `<main>`, and `<main>` ends before the site
 * footer — so the bar peeled off the viewport floor at ~1200px of scroll and
 * was gone entirely by ~1800px, even though the page is ~2900px tall. A live
 * ticker that scrolls away defeats its purpose.
 *
 * `pointer-events-none` on the wrapper plus `pointer-events-auto` on the inner
 * bar means the fixed surface never swallows clicks on the footer behind it,
 * while the ticker itself stays interactive. `pb-[env(safe-area-inset-bottom)]`
 * keeps it clear of the iOS home indicator.
 *
 * The bar is out of flow, so the room it occupies has to be reserved by the
 * page shell — see the matching bottom padding in `src/app/[locale]/layout.tsx`.
 */
export function WhaleTicker() {
  const t = useTranslations('whales');
  const trades = useWhaleStore(selectWhaleTrades);
  const enabled = useWhaleStore(selectWhaleEnabled);
  const threshold = useWhaleStore((s) => s.thresholdUsd);
  const count = useWhaleStore((s) => s.count);
  const total = useWhaleStore((s) => s.totalNotional);

  /*
   * The bar is `fixed`, so it is out of flow and the page has to reserve its
   * height itself — otherwise the last footer line hides behind it. The
   * footer is shared by every route while this ticker only exists on
   * /terminal, so the offset is published as a CSS custom property on the
   * document root and read by the footer. No route knowledge leaks into the
   * shared layout, and the value stays in sync with the rendered bar.
   */
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const bar = barRef.current;
    if (!bar) return;
    const apply = () => {
      const h = bar.getBoundingClientRect().height;
      // Social Bar (fixed, Boden) schiebt den Ticker nach oben – die Seite
      // reserviert beides zusammen, damit nichts hinter etwas verschwindet.
      const sb = parseFloat(window.getComputedStyle(root).getPropertyValue('--nc-socialbar-h')) || 0;
      const next = `${Math.ceil(h + sb)}px`;
      if (next === lastOffset) return; // keine Mutation → keine Observer-Schleife
      lastOffset = next;
      root.style.setProperty('--nc-dock-offset', next);
    };
    let lastOffset = '';
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    // --nc-socialbar-h ändert sich asynchron (Ad-Load) → mitbeobachten
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ['style'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      root.style.removeProperty('--nc-dock-offset');
    };
  }, []);

  return (
    <div
      ref={barRef}
      aria-label={t('aria')}
      className="pointer-events-none fixed inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]"
      style={{ bottom: 'var(--nc-socialbar-h, 0px)' }}
    >
      <div className="pointer-events-auto border-t border-line/80 bg-bg/92 backdrop-blur-xl">
        <div aria-hidden className="h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        <div className="flex items-center gap-3 px-3 py-2">
          <span className="nc-clip-sm flex min-w-0 items-center gap-1.5 border border-secondary/45 bg-secondary/10 px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-secondary">
            <Waves className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{t('title')}</span>
          </span>

          <StatusLed tone={enabled ? 'ok' : 'idle'} label={t('live')} className="shrink-0" />

          <span className="nc-chip hidden shrink-0 md:inline-flex">{t('threshold', { value: compactUsd(threshold) })}</span>
          <span className="nc-chip hidden shrink-0 lg:inline-flex">
            {t('total', { count, volume: compactUsd(total) })}
          </span>

          <div className="relative min-w-0 flex-1">
            {/* edge fades */}
            {/* Fades: `inset-y-0 left-0/right-0` statt `inset-y-0 X-0 w-8` –
                die fixe Breite stand bei schmalem Wrapper (< 32px) über und
                erzeugte horizontales Overflow im flex-1-Container. */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 max-w-full bg-gradient-to-r from-bg to-transparent" />
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 max-w-full bg-gradient-to-l from-bg to-transparent" />

            {trades.length === 0 ? (
              <p className="truncate py-1 text-center font-mono text-2xs uppercase tracking-cyber text-faint">
                {t('empty')}
              </p>
            ) : (
              <ul className="nc-no-scrollbar flex items-center gap-2 overflow-x-auto py-0.5">
                {trades.map((trade) => (
                  <WhaleChip key={trade.id} trade={trade} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WhaleChip({ trade }: { trade: WhaleTrade }) {
  const t = useTranslations('whales');
  const buy = trade.side === 'buy';
  const Icon = buy ? ArrowUpRight : ArrowDownRight;

  return (
    <li className="shrink-0 animate-whale-in">
      <span
        className={cn(
          'nc-clip-sm inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-2xs',
          buy
            ? 'border-bull/50 bg-bull/8 text-bull shadow-[0_0_12px_-2px_hsl(var(--nc-bull)/0.6)]'
            : 'border-bear/50 bg-bear/8 text-bear shadow-[0_0_12px_-2px_hsl(var(--nc-bear)/0.6)]',
        )}
      >
        <Icon className="size-3" aria-hidden />
        <span className="font-bold uppercase tracking-cyber">{trade.symbol}</span>
        <span className="tabular-nums font-bold">{compactUsd(trade.notional)}</span>
        <span className="hidden opacity-70 sm:inline">{buy ? t('buy') : t('sell')}</span>
        <span className="hidden opacity-50 md:inline">{trade.exchange}</span>
        <span className="hidden opacity-50 lg:inline tabular-nums">{clockTime(trade.ts)}</span>
      </span>
    </li>
  );
}
