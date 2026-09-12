// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { ROUTES } from '@/lib/constants';
import { isTypingTarget } from '@/lib/hooks/useDismiss';
import { useAppStore } from '@/store/useAppStore';
import type { ChartLayoutId } from '@/store/types';

const LAYOUT_KEYS: Record<string, ChartLayoutId> = { '1': '1x1', '2': '2x1', '3': '2x2' };

/**
 * App-wide keyboard layer (documented on /[locale]/help):
 *   ⌘K / Ctrl+K  → toggle the command palette
 *   1 / 2 / 3    → chart layout 1x1 / 2x1 / 2x2
 *   ?            → help center
 * Escape is handled locally by each overlay.
 */
export function GlobalShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey) return;

      // ⌘K / Ctrl+K works even inside inputs.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const { commandPaletteOpen, setCommandPaletteOpen } = useAppStore.getState();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      if (event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return;

      const layout = LAYOUT_KEYS[event.key];
      if (layout) {
        event.preventDefault();
        useAppStore.getState().setLayout(layout);
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        router.push(ROUTES.help);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return null;
}
