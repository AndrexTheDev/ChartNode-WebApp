// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useRateLimitStore } from '@/store/useRateLimitStore';

/** Default pause for providers that do not return a Retry-After header. */
export const COOLDOWN_MS = 5_000;

/** The shared overlay may be extended if several providers are rate-limited. */
type Resolver = () => void;

let cooldownPromise: Promise<void> | null = null;
let resolveCooldown: Resolver | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Shared, provider-aware cooldown UI.
 *
 * This is a presentation/wait primitive only: `http.ts` tracks provider
 * cooldowns independently, so an unrelated API is never held back by another
 * provider's 429. If a provider supplies Retry-After, its duration is used up
 * to the HTTP client's short automatic-retry ceiling; longer waits fail fast
 * and can be served from the stale cache instead.
 */
export function beginCooldown(source: string, ms: number = COOLDOWN_MS): Promise<void> {
  const store = useRateLimitStore.getState();
  const duration = Math.max(250, Math.min(ms, 60_000));

  if (store.active) {
    store.bump(source, duration);
    scheduleSafetyEnd();
    return cooldownPromise ?? Promise.resolve();
  }

  store.begin(source, duration);
  cooldownPromise = new Promise<void>((resolve) => {
    resolveCooldown = resolve;
  });
  scheduleSafetyEnd();
  return cooldownPromise;
}

function scheduleSafetyEnd(): void {
  if (safetyTimer !== null) clearTimeout(safetyTimer);
  const { deadline } = useRateLimitStore.getState();
  safetyTimer = setTimeout(() => endCooldown(), Math.max(0, deadline - Date.now()) + 2_000);
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
