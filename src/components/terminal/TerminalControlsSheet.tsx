// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import type { ToolMenuItem } from '@/components/ui/ToolMenu';

interface TerminalControlsSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Compact-screen home for chart setup and less-frequent terminal actions. */
export function TerminalControlsSheet({ open, onClose, title, children }: TerminalControlsSheetProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} variant="sheet">
      <div data-mobile-controls-sheet className="space-y-3">{children}</div>
    </Modal>
  );
}

export function ControlSection({
  title,
  children,
  collapsible = false,
  defaultOpen = false,
  sectionKey,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  sectionKey?: string;
}) {
  const className = 'nc-clip-sm border border-line/70 bg-surface/32 p-3';
  const content = <div className="mt-2.5 space-y-2">{children}</div>;
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section aria-label={title} data-mobile-section={sectionKey} className={className}>
        <h3 className="font-display text-2xs font-bold uppercase tracking-cyber text-fg">{title}</h3>
        {content}
      </section>
    );
  }

  return (
    <section aria-label={title} data-mobile-section={sectionKey} className={className}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
      >
        <span className="font-display text-2xs font-bold uppercase tracking-cyber text-fg">{title}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-faint transition-transform', isOpen && 'rotate-180')} aria-hidden />
      </button>
      <div id={contentId} hidden={!isOpen} className="mt-2.5 space-y-2 border-t border-line/50 pt-2.5">
        {children}
      </div>
    </section>
  );
}

/** Touch-friendly equivalent of a desktop ToolMenu, rendered inside the sheet. */
export function MobileActionGrid({ items, onClose }: { items: ToolMenuItem[]; onClose: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            data-mobile-action={item.key}
            aria-pressed={typeof item.active === 'boolean' ? item.active : undefined}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={cn(
              'nc-clip-sm flex min-h-11 min-w-0 items-center gap-2 border px-2.5 py-2 text-left transition-colors',
              item.active
                ? 'border-primary/60 bg-primary/10 text-primary shadow-neon-sm'
                : 'border-line bg-bg/45 text-muted hover:border-primary/40 hover:text-fg',
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 truncate font-mono text-2xs uppercase tracking-cyber">{item.label}</span>
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                item.active ? 'bg-primary shadow-[0_0_8px_hsl(var(--nc-primary)/0.9)]' : 'bg-line',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
