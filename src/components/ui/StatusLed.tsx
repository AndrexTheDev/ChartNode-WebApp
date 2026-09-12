// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { cn } from '@/lib/cn';

interface StatusLedProps {
  tone?: 'ok' | 'warn' | 'error' | 'idle';
  label?: string;
  className?: string;
  pulse?: boolean;
}

const TONES = {
  ok: 'bg-primary shadow-[0_0_10px_hsl(var(--nc-primary)/0.9)]',
  warn: 'bg-warning shadow-[0_0_10px_hsl(var(--nc-warning)/0.9)]',
  error: 'bg-danger shadow-[0_0_10px_hsl(var(--nc-danger)/0.9)]',
  idle: 'bg-muted shadow-none',
} as const;

/** Tiny glowing indicator used for connection/system status. */
export function StatusLed({ tone = 'ok', label, className, pulse = true }: StatusLedProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', TONES[tone], pulse && 'animate-pulse-glow')}
      />
      {label && <span className="font-mono text-2xs uppercase tracking-cyber text-muted">{label}</span>}
    </span>
  );
}
