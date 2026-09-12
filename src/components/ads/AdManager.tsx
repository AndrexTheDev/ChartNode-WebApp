// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useTranslations } from 'next-intl';
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

/**
 * Global monetization layer – mounted once in the root layout.
 *
 *  · Social Bar (Adsterra) anchors itself to the viewport bottom, all pages.
 *  · Ad-block detection runs once per session; a blocked visitor sees the
 *    cyberpunk soft-wall (unless supporter or inside the 7-day cooldown).
 *    `?adwall=1` forces it open – used by the browser proof and for demos.
 *  · Hosts <SupportModal/> + <ShareModal/> so both work on every route.
 *
 * Renders no markup of its own besides the modals → zero hydration risk and
 * zero layout shift when ads are disabled (the default in development).
 */
function AdManagerInner() {
  const [wallOpen, setWallOpen] = useState(false);
  // Body-level, self-anchoring format -> canonical next/script idle loader.
  // Resolved client-side (device class), rendered only once known, so the
  // server HTML stays ad-free and hydration-neutral.
  const [socialSrc, setSocialSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!ADS_ENABLED) return;
    // Deferred: never setState synchronously inside an effect (lint rule),
    // and the device class is only meaningful client-side anyway.
    const timer = setTimeout(() => {
      setSocialSrc(socialBarPlacement(isDesktopViewport() ? 'desktop' : 'mobile') || null);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

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
      {socialSrc ? <Script src={socialSrc} strategy="lazyOnload" data-cfasync="false" /> : null}
      <SupportModal open={wallOpen} onClose={() => setWallOpen(false)} />
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
