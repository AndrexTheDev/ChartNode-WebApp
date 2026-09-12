/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Ad-block detection – two independent signals, no fingerprinting.
 *
 * 1. DOM bait: a 1×1 px div carrying the class names every popular filter
 *    list hides (`.ad-banner`, `.adsbox`, …). If a blocker is active the
 *    element is `display:none`d → zero offset height.
 * 2. Script bait: `/ads.js` is served by *our own* `public/` folder, but the
 *    path matches EasyList-style patterns, so blockers cancel the request →
 *    `onerror`. Without a blocker the tiny file loads and sets a flag.
 *
 * Both signals are combined (OR) because some blockers only do cosmetic
 * filtering (DOM) while others only cancel requests (network).
 */
export const AD_CHECK_SESSION_KEY = 'nc-adcheck';

declare global {
  interface Window {
    ncAdsServed?: boolean;
  }
}

export async function detectAdBlock(): Promise<boolean> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;

  const bait = document.createElement('div');
  bait.className = 'ad-banner adsbox ad-placement pub_300x250 textads banner-ads ad-container';
  bait.setAttribute('aria-hidden', 'true');
  bait.style.cssText = 'position:absolute;left:-20px;top:-20px;width:1px;height:1px;pointer-events:none;';
  document.body.appendChild(bait);

  // Await the bait script deterministically instead of guessing with a fixed
  // timeout: on a slow (not blocked!) connection a 400 ms guess would report
  // "blocked" and – cached per session – show the soft-wall to a clean
  // visitor for their whole visit. `null` = inconclusive (very slow network)
  // and fails OPEN: a missed detection costs less than a wrongful wall.
  const scriptLoaded = await new Promise<boolean | null>((resolve) => {
    const script = document.createElement('script');
    let giveUp = 0;
    const settle = (value: boolean | null) => {
      window.clearTimeout(giveUp);
      script.onload = null;
      script.onerror = null;
      script.remove();
      resolve(value);
    };
    giveUp = window.setTimeout(() => settle(null), 3_000);
    script.src = '/ads.js';
    script.async = true;
    script.onload = () => settle(true);
    script.onerror = () => settle(false);
    document.body.appendChild(script);
  });

  // Cosmetic filters need a frame or two to hide the DOM bait.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const style = window.getComputedStyle(bait);
  const domBlocked =
    bait.offsetHeight === 0 || bait.offsetParent === null || style.display === 'none' || style.visibility === 'hidden';

  bait.remove();

  const networkBlocked = scriptLoaded === false || (scriptLoaded === true && window.ncAdsServed !== true);
  return domBlocked || networkBlocked;
}

/** One detection per session is enough – the result is cached in sessionStorage. */
export async function detectAdBlockOnce(): Promise<boolean> {
  try {
    const cached = sessionStorage.getItem(AD_CHECK_SESSION_KEY);
    if (cached !== null) return cached === '1';
  } catch {
    /* storage disabled – just measure */
  }
  const blocked = await detectAdBlock();
  try {
    sessionStorage.setItem(AD_CHECK_SESSION_KEY, blocked ? '1' : '0');
  } catch {
    /* ignore */
  }
  return blocked;
}
