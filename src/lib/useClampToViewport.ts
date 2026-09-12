// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Viewport-Clamp für absolut positionierte Dropdown-/Menü-Panels.
 *
 * Die Panels sind per `left-0`/`right-0` an ihren Trigger geankert und kennen
 * die Viewport-Kante nicht: Auf 320px-Bildschirmen (oder wenn der Trigger nah
 * am Rand sitzt) ragen sie links/rechts heraus – Dropdowns müssen laut
 * Z-Index-/Overlap-Matrix aber immer vollständig sichtbar bleiben.
 *
 * Der Hook misst das offene Panel und schiebt es per Margin zurück in den
 * Viewport. Bewusst kein `transform`: Das gehört der fade-up-Animation
 * (animation-fill überschreibt Inline-Styles). Die Margin-Seite folgt der
 * Ankerung: Bei `right-0` verschiebt `margin-left` nichts, also wird dort
 * `margin-right` negativ gesetzt (und umgekehrt).
 */
export function useClampToViewport<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const apply = () => {
      el.style.marginLeft = '';
      el.style.marginRight = '';
      el.style.maxHeight = '';
      const rect = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      let delta = 0;
      if (rect.left < 4) delta = 4 - rect.left;
      else if (rect.right > vw - 4) delta = vw - 4 - rect.right;
      if (delta !== 0) {
        const anchoredRight = getComputedStyle(el).right !== 'auto';
        if (anchoredRight) el.style.marginRight = `${-delta}px`;
        else el.style.marginLeft = `${delta}px`;
      }

      // Vertikal: Auf kurzen Screens (320×740) ragt ein langes Menü unten
      // heraus – dann begrenzen und scrollen statt abschneiden.
      if (rect.bottom > vh - 4) {
        const max = Math.max(120, vh - rect.top - 8);
        el.style.maxHeight = `${max}px`;
        el.style.overflowY = 'auto';
      }
    };
    // Doppelt messen: `animate-fade-up` startet mit `translateY(14px)` und
    // Webfont-Metriken können beim ersten Frame noch nicht stehen – der
    // zweite rAF verifiziert das Panel im eingeschwungenen Zustand.
    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      apply();
      raf2 = requestAnimationFrame(apply);
    });
    window.addEventListener('resize', apply);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      window.removeEventListener('resize', apply);
    };
  }, [open]);

  return ref;
}
