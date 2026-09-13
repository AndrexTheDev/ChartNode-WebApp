// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import {
  ADS_ENABLED,
  isDesktopViewport,
  nativePlacement,
  POPUNDER_SESSION_KEY,
  popunderPlacement,
  type AdVariant,
} from './config';
import { donationGraceActive } from '@/store/useViralStore';

/**
 * Minimal, hydration-safe Adsterra loader – device aware.
 *
 * Adsterra's formats are classic self-placing scripts: the Native Banner
 * renders next to its own `<script>` node, the Social Bar anchors itself to
 * the viewport bottom, and the Popunder arms itself on the next user gesture.
 * Because of that the React tree only ever renders *containers* – scripts are
 * injected from effects, so server HTML and client HTML stay identical (no
 * hydration mismatch, no `next/script` strategy quirks).
 *
 * Mobile and desktop use separate placements (Adsterra bids them separately);
 * each container receives exactly the script for its own device class, and a
 * breakpoint listener injects the other placement when a visitor rotates or
 * resizes across the breakpoint.
 */

/** Body-level scripts (popunder) are injected once per URL. */
const injected = new Set<string>();

/**
 * Defer non-critical work to the browser's idle time (fallback: 1.5 s timer).
 * Ad scripts must never compete with chart seeding or the first interactive
 * paint for the main thread.
 */
export function whenIdle(task: () => void, timeoutMs = 1_500): void {
  if (typeof window === 'undefined') return;
  const ric = (
    window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  ).requestIdleCallback;
  if (typeof ric === 'function') ric(() => task(), { timeout: timeoutMs });
  else window.setTimeout(task, timeoutMs);
}

function injectAdScript(src: string, container: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('ad-script-blocked'));
    container.appendChild(script);
  });
}

/**
 * Native Banner: the script places itself inside the given container.
 * The container remembers its script (`data-ad-src`), so breakpoint flips and
 * re-mounts never double-inject – and a shared fallback URL can serve both
 * containers without the second one being skipped.
 */
export function mountNativeBanner(container: HTMLElement, variant: AdVariant): Promise<void> {
  const src = nativePlacement(variant);
  if (!ADS_ENABLED || !src) return Promise.resolve();
  if (container.dataset.adSrc === src) return Promise.resolve();
  return injectAdScript(src, container)
    .then(() => {
      container.dataset.adSrc = src;
    })
    .catch(() => undefined);
}

/**
 * Social Bar: self-anchoring, body-level – loaded via `next/script` with
 * `strategy="lazyOnload"` from <AdManager/> (canonical Next.js idle loader).
 * Kept out of this module so the loader owns its own dedupe/keying.
 */

/**
 * Popunder, fired when the user enables a multi-chart layout.
 *
 * Adsterra's popunder script opens its window on the *next* click it observes,
 * so injecting it inside the layout click handler makes exactly that gesture
 * the trigger. Capped to one popunder per session, placement per device.
 */
export function requestPopunder(): void {
  if (!ADS_ENABLED || typeof window === 'undefined') return;
  // Donation-Grace schlägt alles: Wer gespendet hat, sieht keinen Popunder.
  if (donationGraceActive()) return;
  // QA/CI (Puppeteer, navigator.webdriver) bleibt werbefrei – sonst laden
  // externe Ad-Skripte in browser-check/qa-features und verfälschen Tests.
  if (navigator.webdriver) return;
  const src = popunderPlacement(isDesktopViewport() ? 'desktop' : 'mobile');
  if (!src) return;
  try {
    if (sessionStorage.getItem(POPUNDER_SESSION_KEY) !== null) return;
    sessionStorage.setItem(POPUNDER_SESSION_KEY, String(Date.now()));
  } catch {
    return; // storage disabled – skip the popunder entirely
  }
  if (injected.has(src)) return;
  injected.add(src);
  void injectAdScript(src, document.body).catch(() => undefined);
}
