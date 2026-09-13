// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFixedPopover } from '@/lib/useFixedPopover';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DropdownItem {
  id: string;
  label: string;
  hint?: string;
  badge?: string;
  icon?: ReactNode;
  selected?: boolean;
  onSelect: () => void;
}

interface DropdownProps {
  items: DropdownItem[];
  /** Accessible name of the trigger button. */
  triggerLabel: string;
  /** Short text rendered inside the trigger (e.g. `DE`). */
  triggerText?: ReactNode;
  triggerIcon?: ReactNode;
  title?: string;
  align?: 'start' | 'end';
  widthClass?: string;
  className?: string;
  menuLabel?: string;
}

/**
 * Accessible dropdown used by the locale + theme switchers.
 * Full keyboard support: Arrow/Home/End navigation, Enter/Space activation,
 * Escape and outside-click dismissal, focus restored to the trigger.
 */
export function Dropdown({
  items,
  triggerLabel,
  triggerText,
  triggerIcon,
  title,
  align = 'end',
  widthClass = 'w-60',
  className,
  menuLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const { triggerRef, panelRef, style: anchorStyle } = useFixedPopover<HTMLButtonElement, HTMLUListElement>(open, align);
  const listId = useId();

  // Panel lebt im Portal → Outside-Click muss Wrapper UND Panel kennen.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent | TouchEvent) => {
      const node = event.target as Node;
      if (!rootRef.current?.contains(node) && !panelRef.current?.contains(node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelRef]);

  function toggle() {
    setOpen((prev) => {
      if (!prev) {
        const selected = items.findIndex((item) => item.selected);
        setActiveIndex(selected >= 0 ? selected : 0);
      }
      return !prev;
    });
  }

  function selectItem(index: number) {
    const item = items[index];
    setOpen(false);
    triggerRef.current?.focus();
    item?.onSelect();
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectItem(activeIndex);
        break;
      case 'Tab':
        setOpen(false);
        break;
      case 'Escape':
        // Panel-seitig mitbehandeln: Falls der Fokus-Träger gerade durch ein
        // Live-Re-Render abgelöst wurde, käme das Document-Event nie an.
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        break;
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={triggerLabel}
        title={title ?? triggerLabel}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'nc-clip-sm inline-flex h-9 items-center gap-1.5 border border-line bg-surface/70 px-2.5',
          'font-mono text-2xs uppercase tracking-cyber text-muted transition-colors duration-200',
          'hover:border-primary/60 hover:text-fg',
          open && 'border-primary/70 text-fg shadow-neon-sm',
        )}
      >
        {triggerIcon}
        {triggerText && <span className="max-w-24 truncate">{triggerText}</span>}
        <span
          aria-hidden
          className={cn('text-faint transition-transform duration-200', open && 'rotate-180')}
        >
          ▾
        </span>
      </button>

      {open && createPortal(
        <ul
          id={listId}
          ref={panelRef}
          role="listbox"
          aria-label={menuLabel ?? triggerLabel}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          style={anchorStyle}
          className={cn(
            'nc-clip z-overlay max-h-80 overflow-y-auto',
            'border border-line bg-elevated/95 p-1 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.95)] backdrop-blur-md',
            'animate-fade-up nc-no-scrollbar',
            widthClass,
          )}
        >
          {items.map((item, index) => (
            <li key={item.id} role="option" aria-selected={Boolean(item.selected)}>
              <button
                type="button"
                tabIndex={index === activeIndex ? 0 : -1}
                data-active={index === activeIndex}
                ref={(node) => {
                  if (node && open && index === activeIndex) node.focus();
                }}
                onClick={() => selectItem(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onKeyDown={onListKeyDown}
                className={cn(
                  'flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors duration-150',
                  'nc-clip-sm',
                  index === activeIndex ? 'bg-primary/12 text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {item.icon && <span className="shrink-0 text-primary">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.label}</span>
                  {item.hint && (
                    <span className="block font-mono text-2xs leading-relaxed text-faint [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{item.hint}</span>
                  )}
                </span>
                {item.badge && (
                  <span className="nc-chip shrink-0 px-1.5 py-0.5 text-micro-9">{item.badge}</span>
                )}
                {item.selected && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
