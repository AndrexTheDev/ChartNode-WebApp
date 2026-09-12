/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Chart theming.
 *
 * The design system stores every color as an HSL triplet CSS variable
 * (`--nc-primary: 110 100% 54%`) on `<html data-theme="…">`. Instead of
 * duplicating three palettes here, the chart reads the *live* values, so it
 * always matches the surrounding UI — including a theme the user switched to
 * while the terminal was open.
 *
 * Canvas needs concrete color strings, so triplets are rebuilt as
 * `hsl(h, s%, l%)` (comma syntax: universally supported by canvas parsers).
 */

export interface ChartTheme {
  bg: string;
  surface: string;
  grid: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  primary: string;
  secondary: string;
  accent: string;
  bull: string;
  bear: string;
  /** 0..1 – how strong the grid lines are. */
  gridOpacity: number;
}

/**
 * Token-exakte Acid-Defaults (HSL-Komma-Syntax, canvas-tauglich). Auch der
 * Fallback-Theme-Stub in `primitives.ts` nutzt diese Werte, damit nirgends
 * zweite, leicht abweichende Hex-Kopien der Tokens herumliegen.
 */
export const CHART_THEME_FALLBACK: ChartTheme = {
  bg: 'hsl(0, 0%, 4%)',
  surface: 'hsl(240, 6%, 7%)',
  grid: 'hsl(110, 22%, 24%)',
  border: 'hsl(110, 22%, 24%)',
  text: 'hsl(110, 25%, 93%)',
  muted: 'hsl(110, 9%, 63%)',
  faint: 'hsl(110, 7%, 42%)',
  primary: 'hsl(110, 100%, 54%)',
  secondary: 'hsl(278, 100%, 57%)',
  accent: 'hsl(186, 100%, 50%)',
  bull: 'hsl(157, 100%, 50%)',
  bear: 'hsl(344, 100%, 59%)',
  gridOpacity: 0.5,
};

const FALLBACK = CHART_THEME_FALLBACK;

/** `110 100% 54%` → `hsl(110, 100%, 54%)`; optional alpha → 4th component. */
export function hsl(triplet: string, alpha?: number): string | null {
  const parts = triplet.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [h, s, l] = parts as [string, string, string];
  return alpha === undefined ? `hsl(${h}, ${s}, ${l})` : `hsl(${h}, ${s}, ${l}, ${alpha})`;
}

/**
 * Reads the palette for `theme`.
 *
 * The id is not just a cache key: when the store has already flipped but the
 * `data-theme` attribute write is still in flight, we read the variables from a
 * throwaway probe element carrying the requested theme, so the chart never
 * paints one frame in the previous skin.
 */
export function readChartTheme(theme?: string): ChartTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK;

  let host: HTMLElement = document.documentElement;
  let probe: HTMLDivElement | null = null;
  if (theme && document.documentElement.getAttribute('data-theme') !== theme) {
    probe = document.createElement('div');
    probe.setAttribute('data-theme', theme);
    probe.style.display = 'none';
    document.body.appendChild(probe);
    host = probe;
  }

  try {
    const styles = getComputedStyle(host);
    const get = (name: string): string => styles.getPropertyValue(name).trim();
    const resolved: ChartTheme = {
      bg: hsl(get('--nc-bg')) ?? FALLBACK.bg,
      surface: hsl(get('--nc-surface')) ?? FALLBACK.surface,
      grid: hsl(get('--nc-line')) ?? FALLBACK.grid,
      border: hsl(get('--nc-line')) ?? FALLBACK.border,
      text: hsl(get('--nc-fg')) ?? FALLBACK.text,
      muted: hsl(get('--nc-muted')) ?? FALLBACK.muted,
      faint: hsl(get('--nc-faint')) ?? FALLBACK.faint,
      primary: hsl(get('--nc-primary')) ?? FALLBACK.primary,
      secondary: hsl(get('--nc-secondary')) ?? FALLBACK.secondary,
      accent: hsl(get('--nc-accent')) ?? FALLBACK.accent,
      bull: hsl(get('--nc-bull')) ?? FALLBACK.bull,
      bear: hsl(get('--nc-bear')) ?? FALLBACK.bear,
      gridOpacity: Number.parseFloat(get('--nc-grid-opacity')) || FALLBACK.gridOpacity,
    };
    return resolved;
  } catch {
    return FALLBACK;
  } finally {
    probe?.remove();
  }
}

export function withAlpha(color: string, alpha: number): string {
  // hsl(h, s%, l%) → hsl(h, s%, l%, a)
  if (color.startsWith('hsl(') && !color.includes(', 0.')) {
    return `${color.slice(0, -1)}, ${alpha})`;
  }
  return color;
}
