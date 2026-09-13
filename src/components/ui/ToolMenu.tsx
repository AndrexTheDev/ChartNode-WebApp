// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFixedPopover } from '@/lib/useFixedPopover';
import { cn } from '@/lib/cn';

export interface ToolMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** toggle-style entries show a neon dot + primary colour when on */
  active?: boolean;
  onClick: () => void;
}

interface ToolMenuProps {
  /** stable id – also exposed as `data-menu-trigger` for automated checks */
  id: string;
  label: string;
  icon: LucideIcon;
  items: ToolMenuItem[];
  align?: 'left' | 'right';
  /** highlight the trigger while any toggle item inside is active */
  engaged?: boolean;
}

/**
 * Compact dropdown that keeps the terminal toolbar readable: related tools
 * live behind one labelled trigger instead of a wall of chips.
 *
 * Closes on Escape, outside press and after choosing an entry; the trigger
 * carries `aria-haspopup="menu"` and the panel is a real `role="menu"` so
 * screen readers and keyboard users get a proper menu, not a div.
 */
export function ToolMenu({ id, label, icon: Icon, items, align = 'left', engaged = false }: ToolMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { triggerRef, panelRef, style: anchorStyle } = useFixedPopover<HTMLButtonElement, HTMLDivElement>(
    open,
    align === 'right' ? 'end' : 'start',
  );
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const node = event.target as Node;
      if (!rootRef.current?.contains(node) && !panelRef.current?.contains(node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelRef]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-menu-trigger={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'nc-clip-sm inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors',
          open || engaged
            ? 'border-primary/60 bg-primary/12 text-primary shadow-neon-sm hover:border-primary/80 hover:bg-primary/18 active:bg-primary/25'
            : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:bg-elevated/60 hover:text-fg active:bg-elevated/70',
        )}
      >
        <Icon className="size-3" aria-hidden />
        <span>{label}</span>
        <ChevronDown className={cn('size-3 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>

      {open && createPortal(
        <div
          id={panelId}
          ref={panelRef}
          role="menu"
          aria-label={label}
          style={anchorStyle}
          className={cn(
            'nc-clip-sm z-overlay min-w-48 animate-fade-up [animation-duration:200ms] border border-line bg-surface/95 py-1 shadow-neon-sm backdrop-blur-xl',
          )}
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-menu-item={item.key}
                aria-pressed={typeof item.active === 'boolean' ? item.active : undefined}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-2xs uppercase tracking-cyber transition-colors',
                  item.active ? 'text-primary hover:bg-elevated/60' : 'text-muted hover:bg-elevated/60 hover:text-fg',
                )}
              >
                {ItemIcon ? <ItemIcon className="size-3 shrink-0" aria-hidden /> : <span className="size-3 shrink-0" aria-hidden />}
                <span className="flex-1 truncate">{item.label}</span>
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
        </div>,
        document.body,
      )}
    </div>
  );
}
