// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ThemeId } from '@/store/types';

export const THEME_COLOR: Record<ThemeId, string> = {
  acid: '#0a0a0a',
  violet: '#0b0710',
  light: '#f5f7fb',
  matrix: '#020604',
  miami: '#0b0413',
};

/**
 * Share-to-unlock skins. They are part of `ThemeId` (so persisted values stay
 * valid) but `requestTheme()` gates them behind `useViralStore.shareUnlocked`.
 */
export const PREMIUM_THEMES: ThemeId[] = ['matrix', 'miami'];

export function isPremiumTheme(theme: ThemeId): boolean {
  return PREMIUM_THEMES.includes(theme);
}

/**
 * Applies a theme to the document root.
 * Called from the inline boot script (pre-paint, no FOUC) and from the React
 * bridge whenever `useAppStore.theme` changes.
 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme !== 'light');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

/** Kept in sync with globals.css – used by the boot script in <head>. */
export const DEFAULT_THEME: ThemeId = 'acid';

export function isThemeId(value: unknown): value is ThemeId {
  return (
    value === 'acid' ||
    value === 'violet' ||
    value === 'light' ||
    value === 'matrix' ||
    value === 'miami'
  );
}
