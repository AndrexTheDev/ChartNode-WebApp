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
export function Modal({ open, onClose, title, subtitle, children, footer, widthClass = 'max-w-2xl' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
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
    // Ad-Overlays (Adsterra Social Bar mit Eigen-Z-Index) pausieren, solange
    // ein Dialog offen ist – sonst liegt fremdes UI über Modal-Controls.
    document.body.classList.add('nc-modal-open');
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('nc-modal-open');
      window.clearTimeout(focusTimer);
      restoreRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex animate-fade-in items-start justify-center overflow-y-auto bg-black/72 p-3 backdrop-blur-sm sm:p-6"
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
          'nc-clip my-auto w-full animate-fade-up border border-primary/35 bg-elevated/95 shadow-[0_0_45px_-12px_hsl(var(--nc-primary)/0.55)]',
          '[animation-duration:220ms]',
          widthClass,
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

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>

        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line/70 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
