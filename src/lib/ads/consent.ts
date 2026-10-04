// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useSyncExternalStore } from 'react';

/** Optional ad delivery is fail-closed until a fresh, explicit choice exists. */
export type AdConsentChoice = 'granted' | 'denied';
export type AdConsentStatus = AdConsentChoice | 'unknown';

type StoredConsent = {
  version: 1;
  choice: AdConsentChoice;
  decidedAt: number;
};

export const AD_CONSENT_STORAGE_KEY = 'nc-ad-consent-v1';
const AD_CONSENT_SESSION_FALLBACK_KEY = 'nc-ad-consent-session-v1';
/** Engineering default only; this retention period is not a legal conclusion. */
export const AD_CONSENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const OPEN_AD_SETTINGS_EVENT = 'nc-open-ad-settings';
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const listeners = new Set<() => void>();
let inMemoryDenial = false;
let volatileDenial = false;

/** Strictly parse the small first-party preference record; all invalid input fails closed. */
export function parseAdConsent(raw: string | null, now = Date.now()): AdConsentStatus {
  if (!raw) return 'unknown';
  try {
    const value = JSON.parse(raw) as Partial<StoredConsent>;
    if (value.version !== 1 || (value.choice !== 'granted' && value.choice !== 'denied')) return 'unknown';
    if (!Number.isSafeInteger(value.decidedAt) || typeof value.decidedAt !== 'number' || value.decidedAt < 0) {
      return 'unknown';
    }
    if (value.decidedAt > now + MAX_FUTURE_SKEW_MS || now - value.decidedAt > AD_CONSENT_TTL_MS) return 'unknown';
    return value.choice;
  } catch {
    return 'unknown';
  }
}

export function getAdConsent(): AdConsentStatus {
  if (inMemoryDenial) return 'denied';
  if (typeof window === 'undefined') return 'unknown';
  let stored: AdConsentStatus = 'unknown';
  let sessionFallback: AdConsentStatus = 'unknown';
  try {
    stored = parseAdConsent(window.localStorage.getItem(AD_CONSENT_STORAGE_KEY));
  } catch {
    // Continue to the session-only denial fallback when localStorage is blocked.
  }
  try {
    sessionFallback = parseAdConsent(window.sessionStorage.getItem(AD_CONSENT_SESSION_FALLBACK_KEY));
  } catch {
    // Missing or blocked storage is not a grant.
  }
  if (sessionFallback === 'denied') return 'denied';
  return stored;
}

/** True when denial currently depends on this document's memory, not storage. */
export function hasVolatileAdDenial(): boolean {
  return inMemoryDenial && volatileDenial;
}

function hasPersistedDenial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (parseAdConsent(window.localStorage.getItem(AD_CONSENT_STORAGE_KEY)) === 'denied') return true;
  } catch {
    // A blocked store cannot prove a persisted choice.
  }
  try {
    return parseAdConsent(window.sessionStorage.getItem(AD_CONSENT_SESSION_FALLBACK_KEY)) === 'denied';
  } catch {
    return false;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key === AD_CONSENT_STORAGE_KEY || event.key === null) notify();
}

/** Subscribe to same-tab writes and consent changes from other tabs. */
export function subscribeAdConsent(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined' && listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Persist before notifying. If storage fails, only a denial may fall back to session or memory. */
export function setAdConsent(choice: AdConsentChoice, decidedAt = Date.now()): boolean {
  if (typeof window === 'undefined' || !Number.isSafeInteger(decidedAt) || decidedAt < 0) return false;
  const value: StoredConsent = { version: 1, choice, decidedAt };
  const serialized = JSON.stringify(value);

  if (choice === 'granted') {
    try {
      window.sessionStorage.removeItem(AD_CONSENT_SESSION_FALLBACK_KEY);
    } catch {
      // A remaining session denial must continue to take precedence over this grant.
    }
    try {
      window.localStorage.setItem(AD_CONSENT_STORAGE_KEY, serialized);
      inMemoryDenial = false;
      volatileDenial = false;
    } catch {
      return false;
    }
    if (getAdConsent() !== 'granted') return false;
    notify();
    return true;
  }

  try {
    window.localStorage.setItem(AD_CONSENT_STORAGE_KEY, serialized);
    try {
      window.sessionStorage.removeItem(AD_CONSENT_SESSION_FALLBACK_KEY);
    } catch {
      // A leftover session denial is consistent with this choice.
    }
  } catch {
    try {
      window.sessionStorage.setItem(AD_CONSENT_SESSION_FALLBACK_KEY, serialized);
    } catch {
      // If both stores reject writes, remove any readable previous local grant.
    }
    try {
      window.localStorage.removeItem(AD_CONSENT_STORAGE_KEY);
    } catch {
      // The in-memory denial below still blocks ad delivery in this document.
    }
  }

  const persisted = hasPersistedDenial();
  inMemoryDenial = !persisted;
  volatileDenial = !persisted;
  // A volatile denial is honoured now but not represented as durably saved.
  notify();
  return persisted && getAdConsent() === 'denied';
}

export function canLoadAdScripts(): boolean {
  return getAdConsent() === 'granted';
}

export function openAdConsentSettings(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_AD_SETTINGS_EVENT));
}

const getServerSnapshot = (): AdConsentStatus => 'unknown';
const subscribeClientReady = (): (() => void) => () => {};
const getClientReadySnapshot = (): boolean => true;
const getServerReadySnapshot = (): boolean => false;

/** Hydration-safe React view of the consent preference. */
export function useAdConsent(): AdConsentStatus {
  return useSyncExternalStore(subscribeAdConsent, getAdConsent, getServerSnapshot);
}

/** False in server HTML/hydration; true only after the browser snapshot is active. */
export function useClientReady(): boolean {
  return useSyncExternalStore(subscribeClientReady, getClientReadySnapshot, getServerReadySnapshot);
}
