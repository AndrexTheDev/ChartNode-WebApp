// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef } from 'react';
import { applyTheme } from '@/lib/theme';
import { selectTheme, useAppStore } from '@/store/useAppStore';
import { rehydrateStore } from '@/store/useHydrated';

/**
 * The single bridge between the server-rendered world and the client store:
 *
 *   1. rehydrates the persisted Zustand slice (skipHydration is on, so this
 *      has to happen explicitly after mount to avoid hydration mismatches)
 *   2. mirrors the active next-intl locale into `useAppStore.locale`
 *   3. applies `theme` to <html data-theme> whenever it changes
 *
 * Renders nothing.
 */
export function StoreBridge({ locale }: { locale: string }) {
  const theme = useAppStore(selectTheme);
  const setLocale = useAppStore((s) => s.setLocale);

  // Pull persisted state in once, right after mount (skipHydration is on).
  useEffect(() => {
    rehydrateStore();
  }, []);

  useEffect(() => {
    setLocale(locale);
  }, [locale, setLocale]);

  // The boot script already painted the persisted theme before first paint.
  // Applying the still-default store theme on the very first effect run would
  // overwrite it for one frame (visible skin flash on every reload with a
  // non-default theme). Skip that first run; rehydrate flips `theme` right
  // afterwards, and every later change applies as usual.
  const firstThemeRun = useRef(true);
  useEffect(() => {
    if (firstThemeRun.current) {
      firstThemeRun.current = false;
      return;
    }
    applyTheme(theme);
  }, [theme]);

  return null;
}
