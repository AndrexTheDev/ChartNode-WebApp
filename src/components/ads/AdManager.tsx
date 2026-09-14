// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { detectAdBlockOnce } from '@/lib/ads/adblock';
import { mountNativeBanner, whenIdle } from '@/lib/ads/adsterra';
import {
  AD_BREAKPOINT,
  ADS_ENABLED,
  isDesktopViewport,
  nativePlacement,
  socialBarPlacement,
  type AdVariant,
} from '@/lib/ads/config';
import { donationGraceActive, useViralStore, WALL_COOLDOWN_MS } from '@/store/useViralStore';
import { ShareModal } from '../share/ShareModal';
import { SupportModal } from './SupportModal';

/** Social Bar: max. Versuche (Initial + Netz-Retry + Retry nach Wall-Close). */
const SOCIAL_MAX_TRIES = 3;

/**
 * Misst nach dem Load die selbst verankerte Social Bar (fixed, bodennah) und
 * legt ihre Höhe als `--nc-socialbar-h` ab – das Terminal reserviert darunter
 * auf Mobile genau diesen Platz, damit die Bar nie UI verdeckt (Desktop
 * bleibt Overlay, die Bar schwebt dort über der Chart-Fläche).
 * Best-Effort mit Retries: Adsterra rendert die Bar teils verzögert nach dem
 * Script-Load; findet sich nichts Fixiertes, bleibt die Variable bei 0.
 */
function findSocialBar(): { height: number; el: HTMLElement | null } {
  const isOurs = (el: Element) =>
    (el.id !== '' && el.id.startsWith('nc-')) ||
    (typeof el.className === 'string' && el.className.includes('nc-'));
  let height = 0;
  let found: HTMLElement | null = null;
  const consider = (el: Element, depth: number) => {
    if (height > 0 || depth > 2 || isOurs(el)) return;
    const cs = window.getComputedStyle(el as HTMLElement);
    if (cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden') {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const bottomAnchored = Math.abs(window.innerHeight - rect.bottom) < 48;
      if (bottomAnchored && rect.height >= 20 && rect.height <= 220) {
        height = Math.max(height, rect.height);
        found = el as HTMLElement;
        return;
      }
    }
    for (const child of Array.from(el.children)) consider(child, depth + 1);
  };
  for (const child of Array.from(document.body.children)) consider(child, 0);
  return { height, el: found };
}

function measureSocialBar(): void {
  const attempt = (left: number) => {
    window.setTimeout(() => {
      let h = 0;
      let el: HTMLElement | null = null;
      try {
        const found = findSocialBar();
        h = found.height;
        el = found.el;
      } catch {
        /* Messung ist Best-Effort */
      }
      if (h > 0) {
        document.documentElement.style.setProperty('--nc-socialbar-h', `${Math.ceil(h)}px`);
        // Marker für CSS-Regeln (z. B. Pause unter offenen Modals)
        if (el) el.dataset.ncSocialbar = '1';
        return;
      }
      if (left > 0) attempt(left - 1);
    }, 900);
  };
  attempt(4); // ≈ 0,9 / 1,8 / 2,7 / 3,6 / 4,5 s nach Load
}

/**
 * Global monetization layer – mounted once in the root layout.
 *
 *  · Social Bar (Adsterra, echtes Delivery-Skript aus config.ts) läuft NUR auf
 *    den App-Seiten (…/terminal) und verankert sich selbst am Viewport-Boden.
 *    Injection zur Laufzeit per `body.appendChild` = „right above the closing
 *    </body> tag", lazy (Timer) und mit `data-cfasync="false"` gegen Cloudflare
 *    Rocket Loader. Anti-Blocker-Strategie (transparent, keine Maskierung):
 *      – onerror ⇒ detectAdBlockOnce(): echter Blocker ⇒ Cyberpunk-Soft-Wall
 *        (bittet um Deaktivierung/Spende), Netz-Flake ⇒ 1 stiller Retry;
 *      – Wall-Close ⇒ ein weiterer Retry (Blocker ggf. gerade deaktiviert);
 *      – Donation-Grace & navigator.webdriver ⇒ gar keine Injection.
 *  · Ad-block detection runs once per session; a blocked visitor sees the
 *    cyberpunk soft-wall (unless supporter or inside the 7-day cooldown).
 *    `?adwall=1` forces it open – used by the browser proof and for demos.
 *  · Hosts <SupportModal/> + <ShareModal/> so both work on every route.
 *
 * Renders no markup of its own besides the modals → zero hydration risk and
 * zero layout shift when ads are disabled.
 */
function AdManagerInner() {
  const [wallOpen, setWallOpen] = useState(false);
  const pathname = usePathname();
  /** „APP page" im Monetization-Sinn: das Charting-Terminal. */
  const isAppPage = pathname.includes('/terminal');

  const socialSrcRef = useRef<string | null>(null);
  const socialTries = useRef(0);
  const socialDone = useRef(false);
  const socialBlocked = useRef(false);

  const injectSocial = useCallback(
    // Benannte Function-Expression: legale Selbstreferenz für die Retries
    // (react-hooks verbietet den Zugriff auf das eigene const vor Deklaration).
    function inject(src: string): void {
      if (socialDone.current || socialTries.current >= SOCIAL_MAX_TRIES) return;
      socialTries.current += 1;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.dataset.ncSocialTry = String(socialTries.current);
      script.onload = () => {
        socialDone.current = true;
        measureSocialBar();
      };
      script.onerror = () => {
        script.remove();
        void detectAdBlockOnce().then((blocked) => {
          if (blocked) {
            // Transparente Gegenmaßnahme: Soft-Wall statt stiller Verlust.
            socialBlocked.current = true;
            socialDone.current = true;
            setWallOpen(true);
          } else if (socialTries.current < SOCIAL_MAX_TRIES) {
            inject(src); // Netz-Flake, kein Blocker → stiller Retry
          } else {
            socialDone.current = true;
          }
        });
      };
      document.body.appendChild(script); // Laufzeit-Äquivalent zu „vor </body>"
    },
    [],
  );

  useEffect(() => {
    if (!isAppPage || !ADS_ENABLED) return;
    if (donationGraceActive()) return; // Spende schlägt alles – auch die Bar
    if (navigator.webdriver) return; // QA/CI (Puppeteer) bleibt werbefrei
    const src = socialBarPlacement(isDesktopViewport() ? 'desktop' : 'mobile');
    if (!src) return;
    socialSrcRef.current = src;
    // Deferred: nie synchrone Arbeit/setState im Effect; die Bar darf nie mit
    // Chart-Seeding oder First Paint um die Main Thread kämpfen.
    const timer = setTimeout(() => injectSocial(src), 0);
    return () => clearTimeout(timer);
  }, [isAppPage, injectSocial]);

  const closeWall = useCallback(() => {
    setWallOpen(false);
    // Andere Ad-Flächen (Native Banner) hören auf dieses Event für ihren
    // letzten Retry – Blocker ggf. gerade deaktiviert.
    window.dispatchEvent(new CustomEvent('nc-adwall-closed'));
    // Wall eben geschlossen ⇒ Blocker ggf. gerade deaktiviert: letzter Versuch.
    if (socialBlocked.current && socialSrcRef.current && socialTries.current < SOCIAL_MAX_TRIES) {
      socialBlocked.current = false;
      socialDone.current = false;
      injectSocial(socialSrcRef.current);
    }
  }, [injectSocial]);

  useEffect(() => {
    let cancelled = false;

    // Donation-Grace schlägt alles – auch den ?adwall=1-Testweg: Wer
    // gespendet hat (48 h, über $5 → 5 Tage), bekommt keinen Aufruf zu
    // sehen. Punkt. (QA nutzt genau das als deterministischen Beweis.)
    if (donationGraceActive()) return;

    const force = new URLSearchParams(window.location.search).get('adwall') === '1';
    if (force) {
      // Deferred so the effect never setState synchronously (lint rule).
      const forceTimer = setTimeout(() => setWallOpen(true), 0);
      return () => {
        cancelled = true;
        clearTimeout(forceTimer);
      };
    }

    const { wallDismissedAt } = useViralStore.getState();
    if (wallDismissedAt !== null && Date.now() - wallDismissedAt < WALL_COOLDOWN_MS) return;

    const timer = setTimeout(() => {
      void detectAdBlockOnce().then((blocked) => {
        if (!cancelled && blocked) setWallOpen(true);
      });
    }, 1500); // never interrupt first paint

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <SupportModal open={wallOpen} onClose={closeWall} />
      <ShareModal />
    </>
  );
}

export function AdManager() {
  return <AdManagerInner />;
}

/** Tiny corner tag so an unfilled (blocked) slot never looks broken. */
function SlotTag({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1 top-1 z-10 font-mono text-micro-8 uppercase tracking-cyber text-faint/70"
    >
      {label}
    </span>
  );
}

/**
 * The two ad containers – one per device class.
 *
 *  · `desktop` – vertical rail right of the chart grid (lg+), receives the
 *    desktop native-banner placement.
 *  · `mobile`  – horizontal strip between toolbar and grid (<lg), receives
 *    the mobile placement (320×100 / responsive native).
 *
 * Visibility is pure CSS (`lg:hidden` / `hidden lg:block`), so orientation
 * changes and resizes flip instantly without JS; the *injection* follows the
 * same breakpoint via matchMedia and lazy-loads the other placement when the
 * visitor crosses it. Containers render only when a placement is configured
 * (build-time env), keeping server/client markup identical.
 */
export function AdSlot({ variant }: { variant: AdVariant }) {
  const ref = useRef<HTMLElement | null>(null);
  const t = useTranslations('ads');
  const src = nativePlacement(variant);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    const mq = window.matchMedia(AD_BREAKPOINT);
    const apply = () => {
      const active = variant === 'desktop' ? mq.matches : !mq.matches;
      // Container-bound self-placing script (next/script cannot target a
      // container) -> async + idle-scheduled so it never fights chart work.
      if (active) whenIdle(() => void mountNativeBanner(el, variant));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [variant, src]);

  if (!src) return null;
  const label = t('sponsored');

  if (variant === 'desktop') {
    return (
      <aside
        ref={(el) => {
          ref.current = el;
        }}
        data-ad-slot="desktop"
        aria-label={label}
        className="relative hidden min-h-[600px] w-44 shrink-0 overflow-hidden border-l border-line/60 bg-surface/20 p-2 lg:block"
      >
        <SlotTag label={label} />
      </aside>
    );
  }
  return (
    <div
      ref={(el) => {
        ref.current = el;
      }}
      data-ad-slot="mobile"
      aria-label={label}
      className="relative mx-2 mb-2 flex min-h-[110px] items-center justify-center overflow-hidden border border-line/60 bg-surface/30 p-2 lg:hidden"
    >
      <SlotTag label={label} />
    </div>
  );
}
