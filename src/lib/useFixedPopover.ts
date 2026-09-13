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
      // Naturhöhe messen OHNE DOM-Mutation: scrollHeight liefert die
      // ungeklammte Inhaltshöhe. (Direktes Leeren von style.maxHeight würde
      // mit Reacts Style-Diff kollidieren: gleicher State → kein Re-Apply →
      // der Clamp verschwindet dauerhaft.)
      const h = Math.max(panel.offsetHeight, panel.scrollHeight);
      let left = align === 'end' ? rect.right - w : rect.left;
      left = Math.max(4, Math.min(left, vw - w - 4));
      let top = rect.bottom + gap;
      let maxHeight: number | null = null;
      const spaceBelow = vh - 4 - top;
      const spaceAbove = rect.top - 4 - gap;
      if (h > spaceBelow) {
        // flippen, wenn oben mehr Platz ist – sonst Höhe klemmen + scrollen,
        // damit das Panel immer vollständig in die Ansicht passt
        if (spaceAbove > spaceBelow) {
          top = Math.max(4, rect.top - h - gap);
          maxHeight = Math.max(120, rect.top - gap - 8);
        } else {
          maxHeight = Math.max(120, spaceBelow);
        }
      }
      setStyle({
        position: 'fixed',
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        visibility: 'visible',
        ...(maxHeight != null ? { maxHeight: `${Math.round(maxHeight)}px`, overflowY: 'auto' as const } : {}),
      });
    };
    apply();
    const raf = requestAnimationFrame(apply);
    // Webfont-Swap lässt Inhalte nachträglich wachsen → per ResizeObserver
    // und fonts.ready neu vermessen, damit der Clamp immer greift
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(panelRef.current as Element);
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) apply();
    }).catch(() => {});
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [open, align, gap]);

  return { triggerRef, panelRef, style };
}
