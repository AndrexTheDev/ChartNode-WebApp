// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  SIDEBAR_BANNER_HEIGHT,
  SIDEBAR_BANNER_KEY,
  SIDEBAR_BANNER_SRCS,
  SIDEBAR_BANNER_WIDTH,
} from '@/lib/ads/config';
import { detectAdBlockOnce } from '@/lib/ads/adblock';
import { donationGraceActive } from '@/store/useViralStore';

/** atOptions-Loader: globale Konfiguration, die invoke.js beim Ausführen liest. */
declare global {
  interface Window {
    atOptions?: Record<string, unknown>;
  }
}

/** Rail lebt im xl-Row-Layout des Shells – darunter (auch lg) nicht injizieren. */
const SIDEBAR_BREAKPOINT = '(min-width: 1280px)';

/**
 * Banner 160×600 in der LINKEN Terminal-Sidebar – Desktop only (lg+).
 *
 *  · Injection nur im Desktop-Breakpoint (matchMedia-Doktrin wie AdSlot):
 *    Mobile lädt gar nichts – „Ansichten zu klein".
 *  · atOptions-Block + invoke.js werden IN den Rail-Container injiziert
 *    („place it anywhere in the page body"), Loader async=false für Reihenfolge.
 *  · Anti-Blocker-Kette: Fallback-Kette über Loader-Domains (onerror → nächste),
 *    `data-cfasync="false"`; echter Blocker ⇒ globale Soft-Wall-Erkennung
 *    greift ohnehin (AdManager), Rail kollabiert zusätzlich.
 *  · Donation-Grace & navigator.webdriver ⇒ keine Injection, Rail kollabiert.
 *  · Kein Fill (Flake/kein Bid) ⇒ Rail kollabiert nach Retries ⇒ kein toter
 *    160-px-Streifen; Fill ⇒ Rail bleibt (In-Flow, keine Overlaps möglich).
 */
export function SidebarBanner() {
  const t = useTranslations('ads');
  // Ehrlicher Demo-Weg (?addemo=1): Rail + klar beschrifteter Platzhalter statt
  // iframe – zum Sichtbar-Testen ohne Ad-Netz/Blocker. Keine Fake-Werbung.
  const [demo] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('addemo') === '1',
  );
  const [filled, setFilled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (demo) {
      done.current = true;
      setFilled(true);
      return;
    }
    if (donationGraceActive() || navigator.webdriver) {
      setCollapsed(true);
      return;
    }
    const mq = window.matchMedia(SIDEBAR_BREAKPOINT);
    let cancelled = false;
    let tries = 0;

    const pollFilled = (left: number) => {
      window.setTimeout(() => {
        if (cancelled) return;
        const holder = holderRef.current;
        if (holder && (holder.querySelector('iframe') || holder.childElementCount > 1)) {
          done.current = true;
          setFilled(true);
          return;
        }
        if (left > 0) pollFilled(left - 1);
        else {
          done.current = true;
          setCollapsed(true);
        }
      }, 1500);
    };

    const inject = function injectFn(srcIndex: number): void {
      if (cancelled || done.current || srcIndex >= SIDEBAR_BANNER_SRCS.length) {
        if (srcIndex >= SIDEBAR_BANNER_SRCS.length) {
          done.current = true;
          setCollapsed(true);
        }
        return;
      }
      const holder = holderRef.current;
      if (!holder) return;
      const src = SIDEBAR_BANNER_SRCS[srcIndex];
      if (!src) {
        done.current = true;
        setCollapsed(true);
        return;
      }
      tries += 1;
      // atOptions MUSS vor invoke.js gesetzt sein (globale Variable)
      window.atOptions = {
        key: SIDEBAR_BANNER_KEY,
        format: 'iframe',
        height: SIDEBAR_BANNER_HEIGHT,
        width: SIDEBAR_BANNER_WIDTH,
        params: {},
      };
      const opt = document.createElement('script');
      opt.textContent = `atOptions = ${JSON.stringify(window.atOptions)};`;
      const loader = document.createElement('script');
      loader.src = src;
      loader.async = false; // Reihenfolge nach opt-Block
      loader.setAttribute('data-cfasync', 'false');
      loader.dataset.ncSidebarTry = String(tries);
      loader.onerror = () => {
        loader.remove();
        opt.remove();
        void detectAdBlockOnce().then((blocked) => {
          if (cancelled || done.current) return;
          if (blocked) {
            // Soft-Wall läuft global; Rail zusätzlich kollabieren
            done.current = true;
            setCollapsed(true);
          } else {
            injectFn(srcIndex + 1); // nächste Loader-Domain
          }
        });
      };
      loader.onload = () => pollFilled(4);
      holder.appendChild(opt);
      holder.appendChild(loader);
    };

    const apply = () => {
      if (!mq.matches) return; // Mobile: gar nichts laden
      window.setTimeout(() => inject(0), 0);
    };
    apply();
    // Meldet der Loader gar nichts (Hang/Flake), kollabiert der Rail nach
    // 15 s ⇒ kein toter 160-px-Streifen im Terminal.
    const armCollapse = window.setTimeout(() => {
      if (!cancelled && !done.current) {
        done.current = true;
        setCollapsed(true);
      }
    }, 15_000);
    mq.addEventListener('change', apply);
    return () => {
      cancelled = true;
      window.clearTimeout(armCollapse);
      mq.removeEventListener('change', apply);
    };
  }, [demo]);

  if (collapsed) return null;

  return (
    <aside
      aria-label={t('sponsored')}
      style={{ width: SIDEBAR_BANNER_WIDTH + 16 }}
      className="relative hidden shrink-0 overflow-hidden border-r border-line/60 bg-surface/20 p-2 xl:block"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute right-1 top-1 z-10 font-mono text-micro-8 uppercase tracking-cyber text-faint/70"
      >
        {t('sponsored')}
      </span>
      {/* Reserve-Box 160×600: füllt ohne CLS, kollabiert ohne Fill */}
      <div
        ref={holderRef}
        data-sidebar-banner=""
        style={{ width: SIDEBAR_BANNER_WIDTH, height: filled ? undefined : SIDEBAR_BANNER_HEIGHT }}
        className="mx-auto flex items-start justify-center overflow-hidden"
      >
        {demo && (
          <div
            style={{ width: SIDEBAR_BANNER_WIDTH, height: SIDEBAR_BANNER_HEIGHT }}
            className="flex flex-col items-center justify-center gap-2 border border-dashed border-line/70 bg-surface/40 p-2 text-center font-mono text-micro-9 uppercase tracking-cyber text-faint"
          >
            <span className="text-primary">160 × 600</span>
            <span>Ad-Frame</span>
            <span>Demo-Platzhalter</span>
            <span className="normal-case tracking-normal">(addemo=1 – hier füllt das echte Adsterra-Banner im freien Netz)</span>
          </div>
        )}
      </div>
    </aside>
  );
}
