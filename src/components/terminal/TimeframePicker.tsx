// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useFixedPopover } from '@/lib/useFixedPopover';
import { cn } from '@/lib/cn';
import { TIMEFRAMES } from '@/store/presets';
import { selectTimeframe, useAppStore } from '@/store/useAppStore';
import { useChartStore } from '@/store/useChartStore';
import { useHydrated } from '@/store/useHydrated';

interface TimeframePickerProps {
  className?: string;
  /** Larger hit areas for the compact phone/tablet toolbar. */
  touchTargets?: boolean;
}

/** Shared timeframe strip for desktop and compact terminal toolbars. */
export function TimeframePicker({ className, touchTargets = false }: TimeframePickerProps) {
  const t = useTranslations('showcase');
  const timeframe = useAppStore(selectTimeframe);
  const setTimeframe = useAppStore((state) => state.setTimeframe);
  const hydrated = useHydrated();
  const customAgg = useChartStore((state) => state.customAgg);
  const setCustomAgg = useChartStore((state) => state.setCustomAgg);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(10);
  const { triggerRef, panelRef, style: anchorStyle } = useFixedPopover<HTMLButtonElement, HTMLDivElement>(
    customOpen,
    'start',
  );
  const popoverId = useId();

  useEffect(() => {
    if (!customOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setCustomOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setCustomOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [customOpen, panelRef, triggerRef]);

  return (
    <div
      role="group"
      aria-label={t('timeframe')}
      className={cn('nc-no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto', className)}
    >
      {TIMEFRAMES.map((value) => (
        <TimeframeChip
          key={value}
          active={hydrated && value === timeframe}
          touchTargets={touchTargets}
          onClick={() => setTimeframe(value)}
        >
          {value}
        </TimeframeChip>
      ))}
      <span className="relative shrink-0">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={customOpen}
          aria-haspopup="dialog"
          aria-controls={customOpen ? popoverId : undefined}
          aria-label={customAgg != null ? `${customAgg}m` : t('custom.label')}
          title={t('custom.label')}
          onClick={() => {
            if (!customOpen) setCustomDraft(customAgg ?? 10);
            setCustomOpen((value) => !value);
          }}
          className={cn(
            'nc-clip-sm inline-flex shrink-0 items-center justify-center gap-1.5 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors duration-150',
            touchTargets ? 'h-9' : 'h-7',
            customAgg != null
              ? 'border-primary/70 bg-primary/14 text-primary shadow-neon-sm hover:bg-primary/22'
              : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:text-fg',
          )}
        >
          {customAgg != null ? `${customAgg}m` : t('custom.label')}
        </button>
        {customOpen && createPortal(
          <div
            id={popoverId}
            ref={panelRef}
            role="dialog"
            aria-label={t('custom.label')}
            style={anchorStyle}
            className="z-overlay flex items-center gap-1 border border-line bg-surface p-2 shadow-neon-sm"
          >
            <input
              type="number"
              min={2}
              max={43200}
              value={customDraft}
              onChange={(event) => setCustomDraft(Number(event.target.value))}
              aria-label={t('custom.label')}
              className="w-20 border border-line bg-surface/60 px-2 py-1 font-mono text-xs tabular-nums text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm"
            />
            <button
              type="button"
              onClick={() => {
                setCustomAgg(customDraft);
                setCustomOpen(false);
              }}
              className="border border-bull/50 px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-bull transition-colors hover:bg-bull/15"
            >
              {t('custom.apply')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomAgg(null);
                setCustomOpen(false);
              }}
              className="border border-line px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-line/90 hover:text-fg"
            >
              {t('custom.clear')}
            </button>
          </div>,
          document.body,
        )}
      </span>
    </div>
  );
}

function TimeframeChip({
  children,
  active,
  touchTargets,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  touchTargets: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'nc-clip-sm inline-flex shrink-0 items-center gap-1.5 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors duration-150',
        touchTargets ? 'h-9 px-2.5' : 'h-7',
        active
          ? 'border-primary/70 bg-primary/14 text-primary shadow-neon-sm hover:bg-primary/22'
          : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
