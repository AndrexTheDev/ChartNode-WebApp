// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MockChart } from '@/components/ui/MockChart';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { cn } from '@/lib/cn';
import { CHART_LAYOUTS, LAYOUT_IDS } from '@/store/presets';
import {
  selectActiveToken,
  selectLayout,
  selectTheme,
  selectTimeframe,
  useAppStore,
} from '@/store/useAppStore';
import { useHydrated } from '@/store/useHydrated';
import type { ChartLayoutId } from '@/store/types';

/**
 * Interactive proof that the Zustand store is the single source of truth:
 * the buttons below write `layout` into the same store the terminal reads,
 * and the grid re-renders from that state. Reload the page – it persists.
 */
export function LayoutShowcase() {
  const t = useTranslations('showcase');
  const hydrated = useHydrated();

  const layout = useAppStore(selectLayout);
  const setLayout = useAppStore((s) => s.setLayout);
  const activeToken = useAppStore(selectActiveToken);
  const timeframe = useAppStore(selectTimeframe);
  const theme = useAppStore(selectTheme);

  const preset = CHART_LAYOUTS[hydrated ? layout : '1x1'];
  const token = hydrated ? activeToken : null;

  return (
    <section
      id="layouts"
      className="container scroll-mt-header border-t border-line/60 py-20 lg:py-28"
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-start">
        <div className="flex flex-col gap-8">
          <SectionHeading eyebrow={t('eyebrow')} title={t('heading')} description={t('subheading')} />

          {/* layout picker */}
          <div
            role="group"
            aria-label={t('eyebrow')}
            className="flex flex-col gap-px border border-line/70 bg-line/40"
          >
            {LAYOUT_IDS.map((id) => {
              const active = hydrated && id === layout;
              const presetItem = CHART_LAYOUTS[id];
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLayout(id)}
                  className={cn(
                    'group relative flex items-center gap-4 bg-bg/85 px-4 py-4 text-left transition-colors duration-200',
                    active
                      ? 'bg-primary/10 hover:bg-primary/16 active:bg-primary/22'
                      : 'hover:bg-elevated/60 active:bg-elevated/70',
                  )}
                >
                  <LayoutGlyph id={id} active={active} />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-mono text-xs uppercase tracking-cyber',
                          active ? 'text-primary' : 'text-fg',
                        )}
                      >
                        {t(`layouts.${id}.name` as `layouts.${ChartLayoutId}.name`)}
                      </span>
                      {active && (
                        <span className="nc-chip border-primary/50 px-1.5 py-0 text-micro-9 text-primary">
                          <Check className="size-2.5" aria-hidden /> {t('active')}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">
                      {t(`layouts.${id}.desc` as `layouts.${ChartLayoutId}.desc`)}
                    </span>
                  </span>

                  <span className="shrink-0 font-mono text-2xs text-faint">
                    {presetItem.panes} {presetItem.panes === 1 ? 'pane' : 'panes'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* live store readout */}
          <div className="nc-panel nc-clip-sm p-4">
            <p className="mb-3 font-mono text-2xs uppercase tracking-mega text-faint">
              {t('stateReadout')}
            </p>
            <dl className="grid grid-cols-2 gap-2 font-mono text-2xs">
              <Readout label="layout" value={hydrated ? layout : '1x1'} highlight />
              <Readout label="theme" value={hydrated ? theme : 'acid'} />
              <Readout label="timeframe" value={timeframe} />
              <Readout label={t('venue').toLowerCase()} value={token?.venue ?? 'CEX'} />
              <Readout
                label={t('symbol').toLowerCase()}
                value={token?.symbol ?? 'BTC/USDT'}
                className="col-span-2"
              />
            </dl>
          </div>
        </div>

        {/* ---------------------------- live grid --------------------------- */}
        <div
          className={cn('grid gap-3', preset.gridClass)}
          style={{ minHeight: preset.rows * preset.rowMinHeight }}
        >
          {Array.from({ length: preset.panes }, (_, index) => (
            <NeonPanel
              key={`${preset.id}-${index}`}
              glow="sm"
              scan={index === 0}
              title={`${t('pane', { index: index + 1 })}`}
              actions={
                <span className="nc-chip border-primary/40 px-1.5 py-0 text-micro-9 text-primary">
                  {timeframe}
                </span>
              }
              className="min-h-[220px] bg-bg/70"
              bodyClassName="flex h-full flex-col"
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-line/60 px-3 py-2">
                <span className="font-display text-sm font-bold tracking-tight">
                  {token?.symbol ?? 'BTC/USDT'}
                </span>
                <span className="nc-chip px-1.5 py-0 text-micro-9">
                  {token?.venue ?? 'CEX'}
                  {token?.exchange ? ` · ${token.exchange.toUpperCase()}` : ''}
                  {token?.chain ? ` · ${token.chain.toUpperCase()}` : ''}
                </span>
              </div>

              <div className="relative min-h-0 flex-1">
                <MockChart seed={1337 + index * 7919} bars={preset.panes > 2 ? 30 : 40} />
              </div>

              <p className="border-t border-line/60 px-3 py-2 font-mono text-2xs uppercase tracking-cyber text-faint">
                {t('waiting')}
              </p>
            </NeonPanel>
          ))}
        </div>
      </div>
    </section>
  );
}

function Readout({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border border-line/60 bg-bg/60 px-2.5 py-1.5',
        className,
      )}
    >
      <dt className="uppercase tracking-cyber text-faint">{label}</dt>
      <dd className={cn('truncate', highlight ? 'text-primary neon-text' : 'text-muted')}>{value}</dd>
    </div>
  );
}

/** Mini wireframe of the grid so the option is recognisable without reading. */
function LayoutGlyph({ id, active }: { id: ChartLayoutId; active: boolean }) {
  const cells = CHART_LAYOUTS[id].panes;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 gap-0.5 border p-1 transition-colors duration-200',
        cells > 2 ? 'grid-cols-2 grid-rows-2' : cells === 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-1',
        active ? 'border-primary/60 bg-primary/10' : 'border-line bg-elevated/40',
      )}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className={cn('w-full', active ? 'bg-primary/55' : 'bg-muted/30', 'transition-colors')}
        />
      ))}
    </span>
  );
}

