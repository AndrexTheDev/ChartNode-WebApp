// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useRateLimitStore } from '@/store/useRateLimitStore';

/** The glitch overlay runs exactly this long before the retry fires. */
export const COOLDOWN_MS = 5_000;

type Resolver = () => void;

let cooldownPromise: Promise<void> | null = null;
let resolveCooldown: Resolver | null = null;
let safetyTimer: number | null = null;

/**
 * Central rate-limit controller.
 *
 * Flow on HTTP 429:
 *   1. `beginCooldown(source)` flips the store → <RateLimitOverlay/> mounts and
 *      renders the glitch + 5 s countdown.
 *   2. The awaited promise blocks the calling fetch (so the retry happens
 *      exactly when the countdown hits zero, not before).
 *   3. The overlay calls `endCooldown()` at zero → promise resolves → retry.
 *
 * Concurrent 429s from other sources during an active cooldown simply join the
 * running promise instead of stacking overlays.
 */
export function beginCooldown(source: string, ms: number = COOLDOWN_MS): Promise<void> {
  const store = useRateLimitStore.getState();

  if (store.active) {
    store.bump(source);
    return cooldownPromise ?? Promise.resolve();
  }

  store.begin(source, ms);

  cooldownPromise = new Promise<void>((resolve) => {
    resolveCooldown = resolve;
  });

  // Safety net: if the overlay never unmounts (tab hidden, rAF throttled),
  // release the waiters anyway so requests cannot hang forever.
  if (safetyTimer !== null) clearTimeout(safetyTimer);
  safetyTimer = window.setTimeout(() => endCooldown(), ms + 2_000);

  return cooldownPromise;
}

export function endCooldown(): void {
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  useRateLimitStore.getState().end();
  const resolve = resolveCooldown;
  resolveCooldown = null;
  cooldownPromise = null;
  resolve?.();
}

export function isCoolingDown(): boolean {
  return useRateLimitStore.getState().active;
}
