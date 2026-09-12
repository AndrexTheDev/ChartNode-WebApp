// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface NeonPanelProps {
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Optional terminal-style title bar. */
  title?: ReactNode;
  actions?: ReactNode;
  /** Cut corners (default) vs. plain rectangle. */
  clipped?: boolean;
  /** Adds an animated scan line sweeping down the panel. */
  scan?: boolean;
  glow?: 'none' | 'sm' | 'lg';
  as?: 'div' | 'section' | 'article' | 'aside';
  id?: string;
}

const GLOW = {
  none: '',
  sm: 'hover:shadow-neon-sm',
  lg: 'hover:shadow-neon-lg',
} as const;

/**
 * Panel = the atomic surface of the whole UI (cards, terminal cells, dialogs).
 * `nc-panel` supplies border + surface + backdrop blur, `nc-clip` the silhouette.
 */
export function NeonPanel({
  children,
  className,
  bodyClassName,
  title,
  actions,
  clipped = true,
  scan = false,
  glow = 'sm',
  as: Tag = 'div',
  id,
}: NeonPanelProps) {
  return (
    <Tag
      id={id}
      className={cn(
        'nc-panel group/panel overflow-hidden transition-shadow duration-300 ease-cyber',
        clipped && 'nc-clip',
        GLOW[glow],
        className,
      )}
    >
      {scan && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 overflow-hidden">
          <span className="absolute inset-x-0 h-px animate-scan bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
        </span>
      )}

      {(title || actions) && (
        <header className="relative flex items-center justify-between gap-3 border-b border-line/80 bg-elevated/50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="flex gap-1">
              <span className="size-1.5 rounded-full bg-bear/70" />
              <span className="size-1.5 rounded-full bg-warning/70" />
              <span className="size-1.5 rounded-full bg-primary/70" />
            </span>
            <h3 className="truncate font-mono text-2xs uppercase tracking-cyber text-muted">{title}</h3>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}

      <div className={cn('relative', bodyClassName)}>{children}</div>
    </Tag>
  );
}
