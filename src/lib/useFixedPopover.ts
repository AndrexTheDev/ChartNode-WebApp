// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Portal-freundliches Anchoring für Dropdown-Panels.
 *
 * Die Terminal-Toolbars sind ab `lg` horizontale Scroll-Container
 * (`overflow-x-auto`). Absolut positionierte Panels würden darin auf die
 * Zeilenhöhe geclippt und wären unsichtbar – deshalb rendern die Panels per
 * Portal in `document.body` und bekommen hier fixe Viewport-Koordinaten vom
 * Trigger-Rechteck: unten angedockt, bei Platzmangel oben, horizontal in den
 * Viewport geklemmt. `visibility:hidden` bis zum ersten Messen verhindert ein
 * Aufblitzen an (0,0).
 */
export function useFixedPopover<T extends HTMLElement, P extends HTMLElement>(
  open: boolean,
  align: 'start' | 'end' = 'start',
  gap = 6,
) {
  const triggerRef = useRef<T | null>(null);
  const panelRef = useRef<P | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const apply = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      let left = align === 'end' ? rect.right - w : rect.left;
      left = Math.max(4, Math.min(left, vw - w - 4));
      let top = rect.bottom + gap;
      if (top + h > vh - 4) {
        const above = rect.top - h - gap;
        top = above >= 4 ? above : Math.max(4, vh - h - 4);
      }
      setStyle({ position: 'fixed', top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, visibility: 'visible' });
    };
    apply();
    const raf = requestAnimationFrame(apply);
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [open, align, gap]);

  return { triggerRef, panelRef, style };
}
