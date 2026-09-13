// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * Indicator modal.
 *
 * Left: the library (overlays + oscillators) – click to add an instance.
 * Right: every instance currently on this pane, with live parameter editing.
 *
 * Instances are unbounded: adding RSI three times with 7 / 14 / 21 is a normal
 * workflow, and each instance gets its own neon color + its own oscillator pane.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Activity, Eye, EyeOff, LineChart, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import {
  INDICATOR_LIBRARY,
  OVERLAY_INDICATORS,
  PANE_INDICATORS,
  SERIES_COLORS,
  defaultParams,
  indicatorTitle,
  type IndicatorKind,
  type ParamSpec,
} from '@/lib/indicators';
import { selectIndicators, useChartStore } from '@/store/useChartStore';

interface IndicatorModalProps {
  paneId: string;
  open: boolean;
  onClose: () => void;
}

export function IndicatorModal({ paneId, open, onClose }: IndicatorModalProps) {
  const t = useTranslations('chart');
  const instances = useChartStore(selectIndicators(paneId));
  const addIndicator = useChartStore((s) => s.addIndicator);
  const updateIndicator = useChartStore((s) => s.updateIndicator);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const clearIndicators = useChartStore((s) => s.clearIndicators);

  const [editing, setEditing] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const counts = new Map<IndicatorKind, number>();
    return instances.map((instance) => {
      const index = counts.get(instance.kind) ?? 0;
      counts.set(instance.kind, index + 1);
      return { instance, index };
    });
  }, [instances]);

  const active = grouped.find((entry) => entry.instance.id === editing) ?? grouped[0] ?? null;
  const activeId = active?.instance.id ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClass="max-w-4xl"
      title={t('modal.title')}
      subtitle={t('modal.subtitle', { pane: paneId.replace('pane-', '#') })}
      footer={
        <>
          {instances.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearIndicators(paneId);
                setEditing(null);
              }}
              className="nc-clip-sm inline-flex h-8 items-center gap-1.5 border border-line px-3 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-danger/60 hover:text-danger"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t('modal.clearAll')}
            </button>
          )}
          <span className="mr-auto font-mono text-2xs text-faint">{t('modal.count', { n: instances.length })}</span>
          <button
            type="button"
            onClick={onClose}
            className="nc-clip-sm inline-flex h-8 items-center border border-primary/60 bg-primary/12 px-4 font-mono text-2xs uppercase tracking-cyber text-primary transition-colors hover:bg-primary/20"
          >
            {t('modal.done')}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ------------------------------ library ----------------------------- */}
        <div>
          <LibrarySection
            title={t('modal.overlays')}
            icon={<LineChart className="size-3.5" aria-hidden />}
            kinds={OVERLAY_INDICATORS}
            onAdd={(kind) => {
              if (kind === 'CUSTOM') {
                useChartStore.getState().setScriptLabOpen(true);
                return;
              }
              const id = addIndicator(paneId, kind);
              setEditing(id);
            }}
          />
          <LibrarySection
            title={t('modal.oscillators')}
            icon={<Activity className="size-3.5" aria-hidden />}
            kinds={PANE_INDICATORS}
            onAdd={(kind) => {
              if (kind === 'CUSTOM') {
                useChartStore.getState().setScriptLabOpen(true);
                return;
              }
              const id = addIndicator(paneId, kind);
              setEditing(id);
            }}
          />
        </div>

        {/* ---------------------------- active list --------------------------- */}
        <div className="min-w-0">
          <h3 className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('modal.active')}</h3>

          {instances.length === 0 && (
            <p className="nc-clip border border-dashed border-line/70 px-3 py-6 text-center font-mono text-2xs text-faint">
              {t('modal.empty')}
            </p>
          )}

          <ul className="space-y-1">
            {grouped.map(({ instance, index }) => (
              <li key={instance.id}>
                <button
                  type="button"
                  onClick={() => setEditing(instance.id)}
                  aria-pressed={activeId === instance.id}
                  className={cn(
                    'nc-clip-sm flex w-full items-center gap-2 border px-2.5 py-1.5 text-left transition-colors',
                    activeId === instance.id
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-line bg-surface/50 hover:border-primary/35',
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: SERIES_COLORS[index % SERIES_COLORS.length],
                      opacity: instance.visible ? 1 : 0.3,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg">
                    {indicatorTitle(instance.kind, instance.params)}
                  </span>
                  <span className="font-mono text-micro-9 uppercase tracking-cyber text-faint">
                    {INDICATOR_LIBRARY[instance.kind].placement === 'pane' ? t('modal.pane') : t('modal.overlay')}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {active && (
            <div className="mt-3 nc-clip border border-line/70 bg-surface/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-display text-xs font-bold uppercase tracking-cyber text-fg">
                  {t(`indicators.${active.instance.kind}.name`)}
                </p>
                <div className="flex items-center gap-1">
                  <IconAction
                    label={active.instance.visible ? t('modal.hide') : t('modal.show')}
                    onClick={() => updateIndicator(paneId, active.instance.id, { visible: !active.instance.visible })}
                  >
                    {active.instance.visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </IconAction>
                  <IconAction
                    label={t('modal.reset')}
                    onClick={() =>
                      updateIndicator(paneId, active.instance.id, {
                        params: defaultParams(INDICATOR_LIBRARY[active.instance.kind]),
                      })
                    }
                  >
                    <RotateCcw className="size-3.5" />
                  </IconAction>
                  <IconAction
                    label={t('modal.remove')}
                    danger
                    onClick={() => {
                      removeIndicator(paneId, active.instance.id);
                      setEditing(null);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconAction>
                </div>
              </div>

              <p className="mb-3 font-mono text-2xs leading-relaxed text-muted">
                {t(`indicators.${active.instance.kind}.hint`)}
              </p>

              <div className="space-y-3">
                {INDICATOR_LIBRARY[active.instance.kind].params.map((spec) => (
                  <ParamRow
                    key={spec.key}
                    spec={spec}
                    value={active.instance.params[spec.key] ?? spec.default}
                    label={t(`params.${spec.key}`)}
                    onChange={(value) => updateIndicator(paneId, active.instance.id, { params: { [spec.key]: value } })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------- pieces --------------------------------- */

function LibrarySection({
  title,
  icon,
  kinds,
  onAdd,
}: {
  title: string;
  icon: React.ReactNode;
  kinds: IndicatorKind[];
  onAdd: (kind: IndicatorKind) => void;
}) {
  const t = useTranslations('chart');
  return (
    <section className="mb-4">
      <h3 className="mb-2 flex items-center gap-1.5 font-mono text-2xs uppercase tracking-cyber text-faint">
        {icon}
        {title}
      </h3>
      <div className="grid gap-1 sm:grid-cols-2">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onAdd(kind)}
            className="nc-clip-sm group flex items-start gap-2 border border-line bg-surface/50 px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/8"
          >
            <Plus className="mt-0.5 size-3.5 shrink-0 text-primary opacity-60 group-hover:opacity-100" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-display text-xs font-bold text-fg">
                {t(`indicators.${kind}.name`)}
              </span>
              <span className="block overflow-hidden font-mono text-micro-10 leading-relaxed text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{t(`indicators.${kind}.short`)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ParamRow({
  spec,
  value,
  label,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xs uppercase tracking-cyber text-muted">{label}</span>
        <span className="font-mono text-2xs tabular-nums text-primary">{value}</span>
      </span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-[hsl(var(--nc-primary))]"
        />
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="nc-clip-sm h-7 w-16 border border-line bg-bg/70 px-1.5 text-right font-mono text-2xs tabular-nums text-fg focus:border-primary focus:outline-none"
        />
      </span>
    </label>
  );
}

function IconAction({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'nc-clip-sm inline-flex size-7 items-center justify-center border border-line text-muted transition-colors',
        danger ? 'hover:border-danger/60 hover:text-danger' : 'hover:border-primary/60 hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}
