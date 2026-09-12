// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useState } from 'react';

/**
 * Device detection for the drawing-tool gate.
 *
 * We combine three signals because none of them alone is reliable:
 *   • `pointer: coarse`  – touch-first device (phones, tablets)
 *   • `maxTouchPoints`   – touch laptops report `pointer: fine`
 *   • viewport width     – a 380 px window is unusable for pixel-precise lines
 *
 * Everything is SSR-safe: during prerendering the functions report "desktop"
 * and the React hook only flips after mount, so the server HTML never contains
 * a mobile warning that then disappears (no hydration mismatch, no CLS).
 */

const COARSE_QUERY = '(pointer: coarse)';
const MOBILE_UA = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile Safari/i;

export function isTouchCapable(): boolean {
  // `window` alone is not enough: SSR shims and workers can have one without a
  // navigator, so every browser global is guarded individually.
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia(COARSE_QUERY).matches) return true;
  } catch {
    // matchMedia missing (very old browsers) – fall through to maxTouchPoints
  }
  if (typeof navigator === 'undefined') return false;
  return (navigator.maxTouchPoints ?? 0) > 0;
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_UA.test(navigator.userAgent);
}

export function isNarrowViewport(maxWidth = 768): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= maxWidth;
}

/** "Drawing on this device is going to be painful" – the gate for the tools. */
export function isTouchDrawingHost(): boolean {
  return isTouchCapable() && (isMobileUserAgent() || isNarrowViewport());
}

/**
 * React hook: `false` during SSR/first paint, then the real answer.
 * Also re-evaluates on resize so a desktop window dragged onto a touch display
 * (or a rotated tablet) updates the UI.
 */
export function useIsTouchHost(): boolean {
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const update = () => setTouch(isTouchDrawingHost());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return touch;
}
