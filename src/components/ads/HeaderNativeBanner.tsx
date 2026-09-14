// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { detectAdBlockOnce } from '@/lib/ads/adblock';
import { NATIVE_BANNER_CONTAINER_ID, NATIVE_BANNER_SRC } from '@/lib/ads/config';
import { cn } from '@/lib/cn';
import { donationGraceActive } from '@/store/useViralStore';

/** Initial + Netz-Retry + Retry nach Wall-Close – identische Doktrin wie Social Bar. */
const MAX_TRIES = 3;
/** Ein Native Banner pro Page-Load (Adsterra: ein Container pro Placement). */
let injectedOnce = false;

/**
 * Native Banner (Adsterra, Widget-Layout 4:1) in der Header-Zone – direkt
 * unter der Sticky-Nav, über dem Seiteninhalt, auf allen Seiten AUSSER dem
 * Terminal: dort sitzt bereits der Sponsored-Strip in der Header-Zone
 * („nur wenn dort noch keine Werbung ist").
 *
 *  · SSR rendert die reservierte 4:1-Box ⇒ kein CLS, wenn das Kreativ füllt.
 *  · Füllt Adsterra nicht (Blocker/Flake/kein Fill), kollabiert die Box nach
 *    ~6 s ⇒ kein toter Raum. Donation-Grace & QA kollabieren sofort.
 *  · Anti-Blocker-Kette (transparent): onerror ⇒ detectAdBlockOnce() ⇒
 *    echter Blocker → Soft-Wall, Netz-Flake → stiller Retry; nach Wall-Close
 *    (Event `nc-adwall-closed`) ein letzter Versuch. `data-cfasync="false"`.
 *  · `navigator.webdriver` & Donation-Grace ⇒ keine Injection.
 */
export function HeaderNativeBanner() {
  const t = useTranslations('ads');
  const pathname = usePathname();
  /** Terminal-Header trägt schon Werbung (Sponsored-Strip) ⇒ kein Banner. */
  const isTerminal = pathname.includes('/terminal');
  const [collapsed, setCollapsed] = useState(false);
  const tries = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    if (isTerminal) return;
    // Spender & QA: keine Injection, reservierte Box sofort kollabieren.
    if (donationGraceActive() || navigator.webdriver) {
      setCollapsed(true);
      return;
    }
    if (injectedOnce) return;
    // „nur wenn dort noch keine Werbung ist": Container-Dedupe + Fremdbanner
    if (document.getElementById(NATIVE_BANNER_CONTAINER_ID)?.childElementCount) return;
    injectedOnce = true;

    const host = () => document.getElementById(NATIVE_BANNER_CONTAINER_ID);

    const pollFilled = (left: number) => {
      window.setTimeout(() => {
        const el = host();
        if (!el) return;
        if (el.childElementCount > 0) {
          done.current = true; // Kreativ da ⇒ Box bleibt reserviert = kein CLS
          return;
        }
        if (left > 0) pollFilled(left - 1);
        else setCollapsed(true); // kein Fill ⇒ kein toter Raum
      }, 1500);
    };

    const inject = function injectFn(src: string): void {
      if (done.current || tries.current >= MAX_TRIES) return;
      tries.current += 1;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.dataset.ncNativeTry = String(tries.current);
      script.onload = () => pollFilled(4); // ≈ 1,5/3/4,5/6/7,5 s
      script.onerror = () => {
        script.remove();
        void detectAdBlockOnce().then((blocked) => {
          if (blocked) {
            done.current = true;
            setCollapsed(true);
            // Soft-Wall öffnet AdManager-seitig (gleiche Erkennung, 1×/Session)
          } else if (tries.current < MAX_TRIES) {
            injectFn(src); // Netz-Flake → stiller Retry
          } else {
            done.current = true;
            setCollapsed(true);
          }
        });
      };
      document.body.appendChild(script);
    };

    const onWallClosed = () => {
      if (!done.current && tries.current < MAX_TRIES) inject(NATIVE_BANNER_SRC);
    };
    window.addEventListener('nc-adwall-closed', onWallClosed);
    const timer = setTimeout(() => inject(NATIVE_BANNER_SRC), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('nc-adwall-closed', onWallClosed);
    };
  }, [isTerminal]);

  if (isTerminal) return null;

  return (
    <div
      className={cn('nc-header-ad container', collapsed && 'nc-collapsed')}
      aria-label={t('sponsored')}
    >
      {/* reservierte 4:1-Box (CSS): füllt CLS-frei, kollabiert ohne Fill */}
      <div id={NATIVE_BANNER_CONTAINER_ID} data-native-banner="" />
    </div>
  );
}
