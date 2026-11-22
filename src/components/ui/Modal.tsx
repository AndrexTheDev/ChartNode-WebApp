// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class, e.g. `max-w-3xl`. */
  widthClass?: string;
  /** Bottom-anchored, safe-area-aware sheet for compact-screen controls. */
  variant?: 'dialog' | 'sheet';
  labelledBy?: string;
}

/**
 * Cyberpunk modal dialog.
 *
 * Closes on Escape, on backdrop click and (a11y) traps nothing fancy but keeps
 * focus inside on open, restoring it on close. Rendered in place – no portal,
 * because the terminal is the only consumer and stacking contexts are already
 * handled by the panel z-index.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  widthClass = 'max-w-2xl',
  variant = 'dialog',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Immer der aktuelle `onClose` – Effekte lesen ihn hier, damit ein pro Render
   * neu erzeugter Callback den Fokus-Effekt nicht neu startet (siehe unten).
   */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Let an open portalled popup consume Escape first. Its trigger remains
        // inside the dialog and declares the popup with aria-haspopup; ordinary
        // expanded sections must not block Escape from closing the dialog.
        if (panelRef.current?.querySelector('[aria-expanded="true"][aria-haspopup][aria-controls]')) return;
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden]'));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const previousOverflow = document.body.style.overflow;
    if (variant === 'sheet') document.body.style.overflow = 'hidden';
    // Ad-Overlays (Adsterra Social Bar mit Eigen-Z-Index) pausieren, solange
    // ein Dialog offen ist – sonst liegt fremdes UI über Modal-Controls.
    document.body.classList.add('nc-modal-open');
    /*
     * Initialfokus: **nur** wenn der Dialog nicht schon selbst fokussiert hat.
     *
     * Vorher griff der Timer immer und setzte den Fokus auf das erste
     * `input, button` im Panel. Sobald irgendein State-Update das Modal neu
     * rendert (z. B. Tippen im Script-Lab-Editor), riss das den Fokus aus dem
     * `textarea` – jede weitere Taste landete im falschen Control, in
     * Screenreadern sprang die Leseposition. Jetzt gewinnt der Dialog:
     * hat er bereits ein fokussierbares Element aktiv, bleibt der Fokus ruhig.
     */
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel.contains(active) && active !== panel) return;
      panel.querySelector<HTMLElement>('input, button')?.focus();
    }, 0);
    /*
     * Der Effekt darf **nicht** an `onClose` hängen. Consumer erzeugen den
     * Callback pro Render neu (z. B. `handleClose` im Script-Lab), wodurch der
     * Effekt bei jedem Tastendruck neu lief: Cleanup → `restoreRef.focus()`
     * (Fokus zurück auf den Menü-Trigger) und der neue Timer fokussierte den
     * Close-Button. Ergebnis: Tippen im Textarea sprang nach dem ersten
     * Zeichen aus dem Feld. Der Callback lebt jetzt in einer Ref, der Effekt
     * hängt nur an `open`/`variant`.
     */

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('nc-modal-open');
      if (variant === 'sheet') document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      restoreRef.current?.focus();
    };
  }, [open, variant]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-modal flex animate-fade-in overflow-y-auto bg-black/72 backdrop-blur-sm',
        variant === 'sheet'
          ? 'items-end justify-center p-0 sm:items-center sm:p-6'
          : 'items-start justify-center p-3 sm:p-6',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'nc-clip w-full animate-fade-up border border-primary/35 bg-elevated/95 shadow-[0_0_45px_-12px_hsl(var(--nc-primary)/0.55)]',
          '[animation-duration:220ms]',
          variant === 'sheet'
            ? 'my-0 max-h-[min(82dvh,calc(100dvh-1rem))] max-w-none overflow-hidden rounded-t-md border-b-0 sm:my-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-md sm:border-b'
            : cn('my-auto', widthClass),
        )}
      >
        <header className="flex items-start gap-3 border-b border-line/70 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 font-display text-sm font-extrabold uppercase tracking-cyber text-fg [overflow-wrap:anywhere]">{title}</h2>
            {subtitle && <p className="mt-0.5 font-mono text-2xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nc-clip-sm inline-flex size-8 shrink-0 items-center justify-center border border-line text-muted transition-colors hover:border-danger/60 hover:text-danger"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">close</span>
          </button>
        </header>

        <div
          className={cn(
            'max-h-[70vh] overflow-y-auto px-4 py-3',
            variant === 'sheet' &&
              'max-h-[calc(82dvh-4.25rem)] overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[calc(85vh-4.25rem)]',
          )}
        >
          {children}
        </div>

        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line/70 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
