// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { STORAGE_KEY } from '@/lib/constants';
import { THEME_COLOR } from '@/lib/theme';
import type { ThemeId } from '@/store/types';

/**
 * Inline, render-blocking script that applies the persisted theme BEFORE the
 * first paint. Without it users would see a flash of the default skin.
 * Must stay dependency-free (runs before hydration) and must never throw.
 *
 * Security: the persisted theme id is validated against a fixed whitelist
 * regex before it touches the DOM, so a hand-edited `localStorage` value can
 * never reach `dataset.theme` or the meta tag. The theme-color map is baked
 * in as a JSON literal (no import at runtime, no string concatenation from
 * storage) and stays in sync with `applyTheme()` in `lib/theme.ts`.
 */
const THEME_IDS = Object.keys(THEME_COLOR) as ThemeId[];
const THEME_WHITELIST = `^(${THEME_IDS.join('|')})$`;
const THEME_COLOR_MAP = JSON.stringify(THEME_COLOR);

export function ThemeBootScript() {
  const code = `(function(){try{var k=${JSON.stringify(STORAGE_KEY)};var colors=${THEME_COLOR_MAP};var wl=${JSON.stringify(THEME_WHITELIST)};var t='acid';var r=document.documentElement;var s=localStorage.getItem(k);if(s){var p=JSON.parse(s);if(p&&p.state&&typeof p.state.theme==='string'&&new RegExp(wl).test(p.state.theme))t=p.state.theme;}r.dataset.theme=t;if(t!=='light')r.classList.add('dark');else r.classList.remove('dark');var c=colors[t]||colors.acid;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',c);}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
