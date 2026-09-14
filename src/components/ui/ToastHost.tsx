// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { BellRing, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/store/useToastStore';

/**
 * Fixed toast stack (bottom-left, above the ad strip) fed by `useToastStore`.
 * Purely presentational – dismissible, auto-expiring, keyboard-accessible.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-3 z-toast flex flex-col gap-2 bottom-[calc(var(--nc-dock-offset,0px)+0.75rem)]"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'nc-clip-sm pointer-events-auto flex max-w-xs animate-toast-in items-start gap-2 border bg-surface/95 px-3 py-2 shadow-panel backdrop-blur-md',
            toast.tone === 'bull' && 'border-bull/60 shadow-neon-sm',
            toast.tone === 'bear' && 'border-bear/60 shadow-neon-sm',
            toast.tone === 'warn' && 'border-warning/60',
            toast.tone === 'info' && 'border-secondary/60 shadow-volt',
          )}
        >
          <BellRing
            className={cn(
              'mt-0.5 size-3.5 shrink-0',
              toast.tone === 'bull' && 'text-bull',
              toast.tone === 'bear' && 'text-bear',
              toast.tone === 'warn' && 'text-warning',
              toast.tone === 'info' && 'text-secondary',
            )}
            aria-hidden
          />
          <p className="font-mono text-2xs leading-snug text-fg">{toast.text}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="ml-auto text-faint transition-colors hover:text-fg"
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
