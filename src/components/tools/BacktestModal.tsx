// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useMemo, useState } from 'react';
import { MapPin, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { pct } from '@/lib/format';
import { runBacktest, STRATEGIES, tradeMarkers, type StrategyId } from '@/lib/backtest';
import { useChartStore } from '@/store/useChartStore';
import { useToastStore } from '@/store/useToastStore';
import type { Candle } from '@/websockets/types';

/**
 * Strategy lab – the backtester TradingView reserves for Premium/Ultimate
 * (and Pine authors). Six zero-config strategies, honest fees, mark-to-market
 * equity, and one click to paint the round trips onto the chart.
 */

interface BacktestModalProps {
  paneId: string;
  symbol: string;
  timeframe: string;
  candles: Candle[];
  open: boolean;
  onClose: () => void;
}

export function BacktestModal({ paneId, symbol, timeframe, candles, open, onClose }: BacktestModalProps) {
  const t = useTranslations('tools');
  const [strategy, setStrategy] = useState<StrategyId>('emaCross');
  const [params, setParams] = useState<Record<string, number>>({});
  const [feeBps, setFeeBps] = useState(10);
  const setBtMarkers = useChartStore((s) => s.setBtMarkers);

  const def = STRATEGIES.find((entry) => entry.id === strategy) ?? STRATEGIES[0]!;
  const effective = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const spec of def.params) merged[spec.key] = params[spec.key] ?? spec.def;
    return merged;
  }, [def, params]);

  const result = useMemo(
    () => runBacktest(candles, strategy, effective, feeBps),
    [candles, strategy, effective, feeBps],
  );

  const stats = result?.stats ?? null;
  const equity = result?.equity ?? [];
  const eqMin = equity.length > 0 ? Math.min(...equity.map((point) => point.eq)) : 0;
  const eqMax = equity.length > 0 ? Math.max(...equity.map((point) => point.eq)) : 1;
  const eqSpan = eqMax - eqMin || 1;
  const eqPoints = equity
    .map((point, index) => {
      const x = equity.length > 1 ? (index / (equity.length - 1)) * 100 : 0;
      const y = 38 - ((point.eq - eqMin) / eqSpan) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const baselineY = 38 - ((1 - eqMin) / eqSpan) * 34;

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-4xl" title={t('backtest.title')} subtitle={`${symbol} · ${timeframe} · ${candles.length} bars`}>
      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        {/* config */}
        <div className="flex flex-col gap-2">
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('backtest.strategy')}
            <select
              value={strategy}
              onChange={(event) => {
                setStrategy(event.target.value as StrategyId);
                setParams({});
              }}
              className="mt-1 w-full cursor-pointer border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm"
            >
              {STRATEGIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(`backtest.strategies.${entry.id}`)}
                </option>
              ))}
            </select>
          </label>
          {def.params.map((spec) => (
            <label key={spec.key} className="font-mono text-2xs uppercase tracking-cyber text-faint">
              {spec.key} <span className="text-secondary">{(effective[spec.key] ?? spec.def).toFixed(spec.key === 'stdDev' || spec.key === 'multiplier' ? 1 : 0)}</span>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.key === 'stdDev' || spec.key === 'multiplier' ? 0.5 : 1}
                value={effective[spec.key] ?? spec.def}
                onChange={(event) => setParams((prev) => ({ ...prev, [spec.key]: Number(event.target.value) }))}
                className="mt-1 w-full accent-[hsl(var(--nc-secondary))]"
              />
            </label>
          ))}
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('backtest.fee')} <span className="text-secondary">{feeBps} bps</span>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={feeBps}
              onChange={(event) => setFeeBps(Number(event.target.value))}
              className="mt-1 w-full accent-[hsl(var(--nc-secondary))]"
            />
          </label>
          <button
            type="button"
            disabled={!result}
            onClick={() => {
              if (!result) return;
              setBtMarkers(paneId, tradeMarkers(result));
              useToastStore.getState().push(t('backtest.markersOn', { n: result.trades.length }), 'bull');
            }}
            className="nc-clip-sm inline-flex h-8 items-center justify-center gap-1.5 border border-secondary/50 bg-secondary/10 px-3 font-mono text-2xs uppercase tracking-cyber text-secondary transition-colors hover:bg-secondary/20 disabled:opacity-40"
          >
            <MapPin className="size-3.5" aria-hidden />
            {t('backtest.showOnChart')}
          </button>
          <button
            type="button"
            onClick={() => setBtMarkers(paneId, [])}
            className="nc-clip-sm inline-flex h-8 items-center justify-center gap-1.5 border border-line px-3 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-bear/50 hover:text-bear"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t('backtest.clearMarkers')}
          </button>
        </div>

        {/* results */}
        <div className="flex min-w-0 flex-col gap-2">
          {!stats ? (
            <p className="py-8 text-center font-mono text-2xs uppercase tracking-cyber text-faint">{t('backtest.needData')}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                <Stat label={t('backtest.net')} value={pct(stats.totalPct, 2)} tone={stats.totalPct >= 0 ? 'bull' : 'bear'} />
                <Stat label={t('backtest.buyHold')} value={pct(stats.buyHoldPct, 2)} tone={stats.buyHoldPct >= 0 ? 'bull' : 'bear'} />
                <Stat label={t('backtest.trades')} value={String(stats.trades)} />
                <Stat label={t('backtest.winRate')} value={`${stats.winRatePct.toFixed(0)}%`} tone={stats.winRatePct >= 50 ? 'bull' : 'bear'} />
                <Stat label={t('backtest.pf')} value={stats.profitFactor == null ? '∞' : stats.profitFactor.toFixed(2)} tone={(stats.profitFactor ?? 2) >= 1 ? 'bull' : 'bear'} />
                <Stat label={t('backtest.maxDd')} value={`−${stats.maxDrawdownPct.toFixed(1)}%`} tone="bear" />
                <Stat label={t('backtest.avg')} value={pct(stats.avgTradePct, 2)} tone={stats.avgTradePct >= 0 ? 'bull' : 'bear'} />
                <Stat label={t('backtest.best')} value={pct(stats.bestTradePct, 2)} tone="bull" />
                <Stat label={t('backtest.worst')} value={pct(stats.worstTradePct, 2)} tone="bear" />
                <Stat label={t('backtest.exposure')} value={`${stats.exposurePct.toFixed(0)}%`} />
              </div>
              <div className="border border-line/70 bg-bg/50 px-2 pt-1.5">
                <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('backtest.equity')}</p>
                <svg viewBox="0 0 100 40" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
                  <line x1="0" y1={baselineY.toFixed(1)} x2="100" y2={baselineY.toFixed(1)} stroke="hsl(var(--nc-line))" strokeWidth="0.4" strokeDasharray="2 2" />
                  {eqPoints && <polyline fill="none" stroke={stats.totalPct >= 0 ? 'hsl(var(--nc-bull))' : 'hsl(var(--nc-bear))'} strokeWidth="1.2" points={eqPoints} />}
                </svg>
              </div>
              <div className="max-h-40 overflow-y-auto border border-line/70 bg-bg/50">
                <table className="w-full font-mono text-2xs">
                  <thead className="sticky top-0 bg-surface/90 text-faint">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">{t('backtest.entry')}</th>
                      <th className="px-2 py-1 text-left">{t('backtest.exit')}</th>
                      <th className="px-2 py-1 text-right">{t('backtest.pnl')}</th>
                      <th className="px-2 py-1 text-right">{t('backtest.bars')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result?.trades.slice(-40).reverse().map((trade, index) => (
                      <tr key={trade.entryTime} className="border-t border-line/40">
                        <td className="px-2 py-1 text-faint">{result.trades.length - index}</td>
                        <td className="px-2 py-1 text-muted">{new Date(trade.entryTime).toISOString().slice(5, 16).replace('T', ' ')}</td>
                        <td className="px-2 py-1 text-muted">{new Date(trade.exitTime).toISOString().slice(5, 16).replace('T', ' ')}</td>
                        <td className={cn('px-2 py-1 text-right tabular-nums', trade.pnlPct >= 0 ? 'text-bull' : 'text-bear')}>{pct(trade.pnlPct, 2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-faint">{trade.bars}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="font-mono text-2xs text-faint">{t('backtest.hint')}</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="nc-clip-sm border border-line/70 bg-bg/50 px-2 py-1.5">
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
      <p className={cn('font-mono text-sm tabular-nums', tone === 'bull' && 'text-bull', tone === 'bear' && 'text-bear', !tone && 'text-fg')}>{value}</p>
    </div>
  );
}
