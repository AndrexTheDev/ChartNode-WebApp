// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { whenIdle } from '@/lib/ads/adsterra';
import {
  SMARTLINKS_ENABLED,
  SMARTLINK_APP_SRC,
  SMARTLINK_CSS,
  SMARTLINK_LANDING_SRC,
  SMARTLINK_URL,
  type SmartlinkSurface,
} from '@/lib/ads/smartlinks';
import { donationGraceActive } from '@/store/useViralStore';

/** Kit-Skript wird pro Surface genau einmal injiziert. */
const injected = new Set<SmartlinkSurface>();

/**
 * Lädt das Vanilla-Smartlink-Kit (`public/ads/…-smartlinks.js`) – exakt die
 * Injection-Doctrine aus `adsterra.ts`: React rendert nur Container, das
 * Skript kommt idle-geplant aus einem Effekt (kein Hydration-Mismatch, keine
 * Konkurrenz zum Chart-Seeding).
 *
 *  · Donation-Grace unterdrückt die Injection komplett (48 h / 5 Tage).
 *  · Locale-Texte + URL gehen per `data-config` (JSON) an das Kit, das sie
 *    beim synchronen IIFE-Start via `document.currentScript` übernimmt.
 *  · `SKIP_BOTS` im Kit hält die eigene Puppeteer-QA popunder-/toast-frei.
 *
 * Rendert selbst kein Markup → null.
 */
export function SmartlinkKit({ surface }: { surface: SmartlinkSurface }) {
  const t = useTranslations('ads');

  useEffect(() => {
    if (!SMARTLINKS_ENABLED) return;
    if (injected.has(surface)) return;
    // Wer gespendet hat, sieht gar nichts – auch keine Smartlinks.
    if (donationGraceActive()) return;
    injected.add(surface);

    whenIdle(() => {
      if (!document.querySelector('link[data-smartlink-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = SMARTLINK_CSS;
        link.dataset.smartlinkCss = '1';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = surface === 'app' ? SMARTLINK_APP_SRC : SMARTLINK_LANDING_SRC;
      script.async = true;
      script.dataset.config = JSON.stringify({
        URL: SMARTLINK_URL,
        LABEL: t('sponsored'),
        TOAST_TEXT: `🎁 ${t('toastText')}`,
        TOAST_CTA: t('toastCta'),
        FALLBACK_TITLE: t('fallbackTitle'),
        FALLBACK_TEXT: t('fallbackText'),
        FALLBACK_CTA: t('fallbackCta'),
        FALLBACK_CLOSE: t('close'),
      });
      script.onerror = () => {
        // Blockiert/404 → Surface für spätere Versuche offen halten.
        injected.delete(surface);
        script.remove();
      };
      document.body.appendChild(script);
    });
  }, [surface, t]);

  return null;
}
