// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * Drawing toolbar + grid-sync switches.
 *
 * Mobile UX (as specified): on touch devices the drawing tools are **hidden by
 * default** and a warning explains why ("complex drawing is not recommended on
 * touch screens"). A "Force enable" switch unlocks them anyway, and the choice
 * is persisted, so a tablet user with a stylus is not locked out.
 */

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Crosshair,
  Eraser,
  Minus,
  MousePointer2,
  MoveRight,
  Percent,
  Scan,
  Square,
  Trash2,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsTouchHost } from '@/lib/device';
import {
  DRAWING_TOOLS,
  selectDrawingToolsForced,
  selectSyncCrosshair,
  selectSyncTimeframe,
  selectSyncZoom,
  selectTool,
  selectVolume,
  useChartStore,
  type ActiveTool,
  type DrawingToolKind,
} from '@/store/useChartStore';

const TOOL_ICONS: Record<DrawingToolKind, React.ReactNode> = {
  trendline: <TrendingUp className="size-3.5" aria-hidden />,
  ray: <MoveRight className="size-3.5" aria-hidden />,
  horizontal: <Minus className="size-3.5" aria-hidden />,
  fib: <Percent className="size-3.5" aria-hidden />,
  zone: <Square className="size-3.5" aria-hidden />,
};

interface DrawingToolbarProps {
  /** Pane the tools act on (drawings are stored per pane). */
  paneId: string;
  drawingCount: number;
  onClearDrawings: () => void;
  className?: string;
}

export function DrawingToolbar({ paneId, drawingCount, onClearDrawings, className }: DrawingToolbarProps) {
  const t = useTranslations('chart');
  const isTouch = useIsTouchHost();
  const forced = useChartStore(selectDrawingToolsForced);
  const setForced = useChartStore((s) => s.setDrawingToolsForced);
  const dismissed = useChartStore((s) => s.mobileWarningDismissed);
  const dismiss = useChartStore((s) => s.dismissMobileWarning);

  const tool = useChartStore(selectTool);
  const setTool = useChartStore((s) => s.setTool);
  const volume = useChartStore(selectVolume);
  const toggleVolume = useChartStore((s) => s.toggleVolume);
  const syncTimeframe = useChartStore(selectSyncTimeframe);
  const syncCrosshair = useChartStore(selectSyncCrosshair);
  const syncZoom = useChartStore(selectSyncZoom);
  const setSyncTimeframe = useChartStore((s) => s.setSyncTimeframe);
  const setSyncCrosshair = useChartStore((s) => s.setSyncCrosshair);
  const setSyncZoom = useChartStore((s) => s.setSyncZoom);

  const toolsLocked = isTouch && !forced;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {/* ------------------------------- tools -------------------------------- */}
      <div
        role="group"
        aria-label={t('tools.group')}
        className={cn('flex items-center gap-1', toolsLocked && 'pointer-events-none opacity-35')}
      >
        <ToolButton
          active={tool === 'none'}
          label={t('tools.none')}
          onClick={() => setTool('none')}
          icon={<MousePointer2 className="size-3.5" aria-hidden />}
        />
        {DRAWING_TOOLS.map((kind) => (
          <ToolButton
            key={kind}
            active={tool === kind}
            label={t(`tools.${kind}`)}
            onClick={() => setTool(tool === kind ? 'none' : (kind as ActiveTool))}
            icon={TOOL_ICONS[kind]}
          />
        ))}
        <ToolButton
          active={tool === 'eraser'}
          label={t('tools.eraser')}
          onClick={() => setTool(tool === 'eraser' ? 'none' : 'eraser')}
          icon={<Eraser className="size-3.5" aria-hidden />}
        />
        <ToolButton
          active={false}
          label={t('tools.clear', { n: drawingCount })}
          disabled={drawingCount === 0}
          onClick={onClearDrawings}
          icon={<Trash2 className="size-3.5" aria-hidden />}
        />
      </div>

      <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

      {/* ------------------------------- sync --------------------------------- */}
      <div role="group" aria-label={t('sync.group')} className="flex items-center gap-1">
        <ToolButton
          active={syncTimeframe}
          label={t('sync.timeframe')}
          onClick={() => setSyncTimeframe(!syncTimeframe)}
          icon={<Scan className="size-3.5" aria-hidden />}
        />
        <ToolButton
          active={syncCrosshair}
          label={t('sync.crosshair')}
          onClick={() => setSyncCrosshair(!syncCrosshair)}
          icon={<Crosshair className="size-3.5" aria-hidden />}
        />
        <ToolButton
          active={syncZoom}
          label={t('sync.zoom')}
          onClick={() => setSyncZoom(!syncZoom)}
          icon={<MoveRight className="size-3.5" aria-hidden />}
        />
        <ToolButton
          active={volume}
          label={t('sync.volume')}
          onClick={toggleVolume}
          icon={<BarChart3 className="size-3.5" aria-hidden />}
        />
      </div>

      {/* ------------------------------ mobile gate ---------------------------- */}
      {isTouch && !dismissed && (
        <div
          role="status"
          className="nc-clip flex w-full items-start gap-2 border border-warning/45 bg-warning/10 px-3 py-2"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xs font-bold uppercase tracking-cyber text-warning">
              {t('mobile.title')}
            </p>
            <p className="mt-0.5 font-mono text-2xs leading-relaxed text-muted">{t('mobile.body')}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => setForced(!forced)}
              aria-pressed={forced}
              className={cn(
                'nc-clip-sm inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-micro-10 uppercase tracking-cyber transition-colors',
                forced
                  ? 'border-primary/70 bg-primary/14 text-primary hover:bg-primary/22'
                  : 'border-line bg-surface/60 text-muted hover:border-primary/40 hover:text-fg',
              )}
            >
              {t('mobile.force')}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="nc-clip-sm inline-flex h-7 items-center border border-line bg-surface/40 px-2 font-mono text-micro-10 uppercase tracking-cyber text-faint transition-colors hover:text-fg"
            >
              {t('mobile.dismiss')}
            </button>
          </div>
        </div>
      )}

      {toolsLocked && dismissed && (
        <button
          type="button"
          onClick={() => setForced(true)}
          className="nc-clip-sm inline-flex h-7 items-center gap-1.5 border border-line px-2 font-mono text-micro-10 uppercase tracking-cyber text-faint transition-colors hover:border-primary/50 hover:text-primary"
        >
          <TriangleAlert className="size-3" aria-hidden />
          {t('mobile.force')}
        </button>
      )}

      <span className="sr-only" aria-live="polite">
        {paneId} · {t('tools.active', { tool: tool === 'none' ? t('tools.none') : t(`tools.${tool}`) })}
      </span>
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  icon,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'nc-clip-sm inline-flex size-7 items-center justify-center border transition-colors duration-150',
        active
          ? 'border-primary/70 bg-primary/14 text-primary shadow-neon-sm hover:bg-primary/22'
          : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:text-fg',
        disabled && 'cursor-not-allowed opacity-40 hover:border-line hover:text-muted',
      )}
    >
      {icon}
    </button>
  );
}
