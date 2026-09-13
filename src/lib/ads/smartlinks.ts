/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Adsterra-Smartlink-Konfiguration für die Next-App.
 *
 * Das Vanilla-Kit lebt in `ads-kit/` und wird per `npm run ads:sync` nach
 * `public/ads/` gespiegelt (Single Source of Truth bleibt ads-kit/).
 * Die App injiziert die Skripte hydration-safe aus Effekten – exakt die
 * Doctrine aus `adsterra.ts` – und übergibt Locale-Texte + URL per
 * `data-config` (JSON) an das Kit.
 *
 * Environment (beide optional):
 *   NEXT_PUBLIC_ADSTERRA_SMARTLINK_URL   überschreibt die feste Direct-Link-URL
 *   NEXT_PUBLIC_SMARTLINKS_ENABLED       'false' schaltet alle Smartlinks aus
 */

/** Fester Adsterra Direct Link (Spec) – via Env überschreibbar. */
export const SMARTLINK_URL: string =
  process.env.NEXT_PUBLIC_ADSTERRA_SMARTLINK_URL ||
  'https://globalimmaturelunatic.com/ufhc3mt24s?key=11473c6a64af7fbf2fcabca038d21036';

/** Build-time-Schalter (SSR/CSR identisch → kein Hydration-Risiko). */
export const SMARTLINKS_ENABLED: boolean = process.env.NEXT_PUBLIC_SMARTLINKS_ENABLED !== 'false';

export const SMARTLINK_LANDING_SRC = '/ads/landing-smartlinks.js';
export const SMARTLINK_APP_SRC = '/ads/app-smartlinks.js';
export const SMARTLINK_CSS = '/ads/smartlinks.css';

export type SmartlinkSurface = 'landing' | 'app';

/** Vom Kit auf window gelegte APIs (nur die von der App genutzten Teile). */
interface SmartlinkKitApi {
  toast?: (url?: string, source?: string) => boolean;
  open?: (url?: string, source?: string) => boolean;
  remaining?: () => number;
}

declare global {
  interface Window {
    SmartlinksLanding?: SmartlinkKitApi;
    SmartlinksApp?: SmartlinkKitApi;
  }
}

/**
 * Post-Action-Offer: zeigt den transparenten Offer-Toast des Terminal-Kits
 * (Cap + Interval-Logik liegen im Kit). Bewusst NACH der Feature-Aktion
 * aufrufen – niemals davor (kein Klick-Hijacking, kein Invalid Traffic).
 * Ohne geladenes Kit ein No-Op.
 */
export function offerToast(source: string): void {
  if (typeof window === 'undefined' || !SMARTLINKS_ENABLED) return;
  try {
    window.SmartlinksApp?.toast?.(SMARTLINK_URL, source);
  } catch {
    /* Kit nicht bereit – Offer bleibt aus, Feature läuft */
  }
}
