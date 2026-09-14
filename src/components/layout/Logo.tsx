// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { useId } from 'react';
import { cn } from '@/lib/cn';

/** Hexagonal node mark with three candlesticks inside. Pure inline SVG. */
export function LogoGlyph({ className }: { className?: string }) {
  // Id muss pro Instanz eindeutig sein (Logo sitzt in Header UND Footer)
  const gid = 'nc-logo-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--nc-primary))" />
          <stop offset="100%" stopColor="hsl(var(--nc-secondary))" />
        </linearGradient>
      </defs>
      <path
        d="M16 1.8 29 9.1v13.8L16 30.2 3 22.9V9.1z"
        fill="hsl(var(--nc-surface) / 0.6)"
        stroke={`url(#${gid})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <g stroke="hsl(var(--nc-primary))" strokeWidth="1.4" strokeLinecap="round">
        <path d="M11 12v8" opacity="0.55" />
        <path d="M16 9.5v13" opacity="0.55" />
        <path d="M21 13.5v6" opacity="0.55" />
      </g>
      <g fill="hsl(var(--nc-primary))">
        <rect x="9.2" y="14" width="3.6" height="4.6" rx="0.4" />
        <rect x="14.2" y="11.6" width="3.6" height="8.4" rx="0.4" />
        <rect x="19.2" y="15.4" width="3.6" height="3.4" rx="0.4" fill="hsl(var(--nc-secondary))" />
      </g>
    </svg>
  );
}

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md';
}

export function Logo({ className, showText = true, size = 'md' }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoGlyph className={cn(size === 'sm' ? 'size-6' : 'size-8', 'shrink-0')} />
      {showText && (
        <span
          className={cn(
            'font-brand font-black uppercase leading-none tracking-[0.16em]',
            size === 'sm' ? 'text-sm' : 'text-base',
          )}
        >
          <span className="text-fg">Node</span>
          <span className="neon-text text-primary">Chart</span>
        </span>
      )}
    </span>
  );
}
