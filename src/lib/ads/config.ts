/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Adsterra placement configuration – device aware.
 *
 * Adsterra serves every format (Native Banner, Social Bar, Popunder) as a
 * plain `<script src>` tag tied to a placement hash from the publisher
 * dashboard, and it expects *separate placements for mobile and desktop
 * traffic* (different bids, different creatives). NodeChart therefore ships
 * two containers – a mobile strip and a desktop rail – and injects the
 * matching placement script into the matching container.
 *
 * Environment (all optional, all `NEXT_PUBLIC_*` because injection happens
 * client-side; paste the full script URL per placement):
 *
 *   NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP / _MOBILE   native banner per device
 *   NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP / _MOBILE
 *   NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP / _MOBILE  override the bundled src
 *
 * Legacy single-value variables (`…_NATIVE`, `…_SOCIALBAR`, `…_POPUNDER`) act
 * as fallback for both devices, so existing setups keep working. Native and
 * Social Bar render zero slots without config; the Popunder ships with the
 * real delivery script for nodechart.cc (dashboard code, before </head>).
 */
// NEXT_PUBLIC_* values are inlined at BUILD time – and only for *static*
// member access (`process.env.NEXT_PUBLIC_X`), never for computed keys.
const nativeBase = process.env.NEXT_PUBLIC_ADSTERRA_NATIVE ?? '';

/**
 * Echtes Adsterra-Social-Bar-Delivery-Skript für nodechart.cc (Dashboard:
 * „Insert it right above the closing </body> tag"). Läuft als Default ohne
 * Env-Setup; `NEXT_PUBLIC_ADSTERRA_SOCIALBAR*` überschreibt es.
 */
const SOCIALBAR_DELIVERY_SRC =
  'https://globalimmaturelunatic.com/e2/b2/33/e2b23323b70ad88bcd24fec9985a99b5.js';
const socialBarBase = process.env.NEXT_PUBLIC_ADSTERRA_SOCIALBAR || SOCIALBAR_DELIVERY_SRC;

/**
 * Echtes Adsterra-Popunder-Delivery-Skript für nodechart.cc (Dashboard:
 * „Paste the code snippet right before the closing </head> tag"). Läuft als
 * Default ohne Env-Setup; `NEXT_PUBLIC_ADSTERRA_POPUNDER*` überschreibt es.
 */
const POPUNDER_DELIVERY_SRC =
  'https://globalimmaturelunatic.com/00/ca/4a/00ca4a13867dc6964d9b2366466a0448.js';
const popunderBase = process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER || POPUNDER_DELIVERY_SRC;

export const ADSTERRA = {
  /** Native Banner in the desktop rail (lg+). */
  nativeDesktop: process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP || nativeBase,
  /** Native Banner in the mobile strip (< lg). */
  nativeMobile: process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE || nativeBase,
  /** Social Bar – self-anchors to the viewport bottom, per device. */
  socialBarDesktop: process.env.NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP || socialBarBase,
  socialBarMobile: process.env.NEXT_PUBLIC_ADSTERRA_SOCIALBAR_MOBILE || socialBarBase,
  /** Popunder – armed on the multi-chart gesture, per device. */
  popunderDesktop: process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP || popunderBase,
  popunderMobile: process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER_MOBILE || popunderBase,
} as const;

export type AdVariant = 'mobile' | 'desktop';

/** Layout breakpoint that separates the mobile slot from the desktop slot. */
export const AD_BREAKPOINT = '(min-width: 1024px)';

/** True when the current viewport counts as desktop for ad purposes. */
export function isDesktopViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(AD_BREAKPOINT).matches;
}

export function nativePlacement(variant: AdVariant): string {
  return variant === 'desktop' ? ADSTERRA.nativeDesktop : ADSTERRA.nativeMobile;
}

export function socialBarPlacement(variant: AdVariant): string {
  return variant === 'desktop' ? ADSTERRA.socialBarDesktop : ADSTERRA.socialBarMobile;
}

export function popunderPlacement(variant: AdVariant): string {
  return variant === 'desktop' ? ADSTERRA.popunderDesktop : ADSTERRA.popunderMobile;
}

export const ADS_ENABLED: boolean = Boolean(
  ADSTERRA.nativeDesktop ||
    ADSTERRA.nativeMobile ||
    ADSTERRA.socialBarDesktop ||
    ADSTERRA.socialBarMobile ||
    ADSTERRA.popunderDesktop ||
    ADSTERRA.popunderMobile,
);

/** Popunder is allowed once per browser session – revenue without rage-clicks. */
export const POPUNDER_SESSION_KEY = 'nc-popunder-fired';
