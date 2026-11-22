// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ReactNode } from 'react';
import { NeonButton } from '@/components/ui/NeonButton';
import { SMARTLINKS_ENABLED, SMARTLINK_URL } from '@/lib/ads/smartlinks';

interface SmartlinkCtaProps {
  /** Button-Label (übersetzt vom Call-Site). */
  label: string;
  /** Disclosure-Text fürs Badge (ads.sponsored). */
  badge: string;
  leading?: ReactNode;
  size?: 'sm' | 'md';
}

/**
 * Server-gerenderter Smartlink-CTA: echter `<a href target="_blank"
 * rel="sponsored noopener">` – von Anfang an im HTML (SEO-konform als Paid
 * Link gekennzeichnet, blocker-resistent weil reine User-Geste-Navigation).
 * Das Kit ergänzt nur Tracking/Cap; das Badge ist bereits statisch, damit
 * vor dem Kit-CSS-Laden kein ungestylter Text blitzt (Tailwind-Basis).
 */
export function SmartlinkCta({ label, badge, leading, size = 'sm' }: SmartlinkCtaProps) {
  if (!SMARTLINKS_ENABLED) return null;
  return (
    <NeonButton
      href={SMARTLINK_URL}
      external
      target="_blank"
      rel="sponsored noopener"
      data-smartlink=""
      variant="outline"
      size={size}
      leading={leading}
      /*
       * `max-w-full min-w-0`: NeonButton bringt `inline-flex` + `whitespace-nowrap`
       * mit. In einem Flex-Wrapper (Hero-Reihe) ist die automatische Mindest-
       * breite dann die volle Textbreite – bei 320 px ziehen lange Labels
       * (es/ru) den Button auf 340 px und die Seite scrollt horizontal
       * (`DOCUMENT scrollWidth 356 > 320`). Mit `min-w-0` darf der Button
       * schrumpfen; `overflow-hidden` klippt den Labeltext, statt ihn
       * auslaufen zu lassen. Gemessen: Wrapper 273 px, Button vorher 340 px.
       */
      className="max-w-full min-w-0 overflow-hidden"
      labelClassName="min-w-0 overflow-hidden text-ellipsis"
      trailing={
        /*
         * `whitespace-nowrap` + `shrink-0` halten das Badge kompakt, aber auf
         * 320-px-Viewports darf es den Button nicht über die Viewport-Breite
         * ziehen: ab `sm` sichtbar, darunter ausgeblendet. Der Sponsoring-
         * Hinweis steht ohnehin zusätzlich im Fließtext der Seite.
         */
        <span className="nc-sl-badge ml-1 hidden shrink-0 whitespace-nowrap border border-primary/30 bg-primary/5 px-1 font-mono text-micro-8 uppercase tracking-cyber text-primary/80 sm:inline">
          {badge}
        </span>
      }
    >
      {label}
    </NeonButton>
  );
}
