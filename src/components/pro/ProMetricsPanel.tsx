// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  CandlestickChart,
  Gauge,
  Globe2,
  Grid3x3,
  RefreshCw,
  Sigma,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusLed } from '@/components/ui/StatusLed';
import { cn } from '@/lib/cn';
import { clockTime, compact, compactUsd, pct, usd } from '@/lib/format';
import { selectActiveToken, useAppStore } from '@/store/useAppStore';
import { selectProOpen, useProStore, type ProGroup } from '@/store/useProStore';

/**
 * PRO metrics dock – the numbers paid terminals charge for:
 *
 *   derivatives (funding, premium, OI, long/short, liquidations) · order flow
 *   (spread, book imbalance, live CVD from the tape) · global market (cap,
 *   dominance, Fear & Greed) · exchange heatmap · options intelligence
 *   (DVOL implied vol, put/call OI, max pain).
 *
 * Same lifecycle as the on-chain panel: fetches only while open.
 */

const PRO_GROUPS: ProGroup[] = ['deriv', 'flow', 'global', 'heat', 'vol', 'hist', 'breadth'];

export function ProMetricsPanel() {
  const t = useTranslations('pro');
  const open = useProStore(selectProOpen);
  const setOpen = useProStore((s) => s.setOpen);
  const refresh = useProStore((s) => s.refresh);
  const tick = useProStore((s) => s.tick);
  const activeToken = useAppStore(selectActiveToken);
  const base = activeToken.base;

  useEffect(() => {
    if (!open) return;
    const boot = setTimeout(() => tick(base), 0);
    const interval = setInterval(() => tick(base), 15_000);
    return () => {
      clearTimeout(boot);
      clearInterval(interval);
    };
  }, [open, tick, base]);

  if (!open) return null;

  return (
    <aside
      aria-label={t('title')}
      className="fixed bottom-0 right-0 top-0 z-40 flex w-full animate-panel-in flex-col border-l border-line bg-bg/96 backdrop-blur-xl sm:top-header sm:w-[26rem]"
    >
      <div className="flex items-center gap-2 border-b border-line/80 px-3 py-2.5">
        <span className="nc-clip-sm flex items-center gap-1.5 border border-secondary/45 bg-secondary/10 px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-secondary">
          <Gauge className="size-3" aria-hidden />
          {t('title')}
        </span>
        <button
          type="button"
          onClick={() => {
            for (const group of PRO_GROUPS) void refresh(group, base, true);
          }}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="nc-clip-sm inline-flex size-8 items-center justify-center border border-line bg-surface/60 text-muted transition-colors hover:border-secondary/60 hover:text-secondary"
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          className="nc-clip-sm ml-auto inline-flex size-8 items-center justify-center border border-line bg-surface/60 text-muted transition-colors hover:border-bear/60 hover:text-bear"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-3">
          <DerivCard base={base} />
          <FlowCard base={base} />
          <BreadthCard />
          <GlobalCard />
          <HeatCard />
          <VolCard />
        </div>
        <p className="mt-3 font-mono text-2xs uppercase tracking-cyber text-faint">{t('sources')}</p>
      </div>
    </aside>
  );
}

/* ------------------------------ shared bits -------------------------------- */

function ProCard({
  group,
  icon: Icon,
  label,
  children,
}: {
  group: ProGroup;
  icon: typeof Gauge;
  label: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('pro');
  const status = useProStore((s) => s.status[group]);
  const updatedAt = useProStore((s) => s.updatedAt[group]);
  const tone = status === 'ok' ? 'ok' : status === 'error' ? 'error' : status === 'loading' ? 'warn' : 'idle';
  const led = status === 'ok' ? t('live') : status === 'error' ? t('offline') : status === 'loading' ? t('loading') : t('idle');

  return (
    <section aria-label={label} className="nc-clip-sm border border-line bg-surface/40 p-2.5">
      <header className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 text-secondary" aria-hidden />
        <h3 className="font-display text-xs font-bold uppercase tracking-cyber text-fg">{label}</h3>
        <StatusLed tone={tone} label={led} className="ml-auto" pulse={status === 'ok'} />
        {updatedAt > 0 && <span className="font-mono text-2xs text-faint">{clockTime(updatedAt)}</span>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' | 'warn' }) {
  return (
    <div className="nc-clip-sm border border-line/70 bg-bg/50 px-2 py-1.5">
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
      <p
        className={cn(
          'font-mono text-sm tabular-nums',
          tone === 'bull' && 'text-bull',
          tone === 'bear' && 'text-bear',
          tone === 'warn' && 'text-warning',
          !tone && 'text-fg',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="py-1 text-center font-mono text-2xs uppercase tracking-cyber text-faint">{text}</p>;
}

/** Minimal sparkline over nullable numbers; gaps are skipped, area filled. */
function Spark({ values, color, height = 22 }: { values: (number | null)[]; color: string; height?: number }) {
  const points = values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value != null && Number.isFinite(entry.value));
  if (points.length < 2) return <div className="h-6" aria-hidden />;
  const min = Math.min(...points.map((entry) => entry.value));
  const max = Math.max(...points.map((entry) => entry.value));
  const span = max - min || Math.abs(max) || 1;
  const coords = points
    .map((entry) => {
      const x = (entry.index / (values.length - 1)) * 100;
      const y = 21 - ((entry.value - min) / span) * 19;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 22" className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth="1.4" points={coords} />
    </svg>
  );
}

/** Ticking mm:ss (or hh:mm:ss) countdown to a unix-ms deadline. */
function useCountdown(deadline: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline == null) return '—';
  const left = Math.max(0, deadline - now);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/* --------------------------------- cards ----------------------------------- */

function DerivCard({ base }: { base: string }) {
  const t = useTranslations('pro');
  const deriv = useProStore((s) => s.deriv);
  const hist = useProStore((s) => s.hist);
  const nextFunding = useCountdown(deriv?.nextFundingTime ?? null);
  return (
    <ProCard group="deriv" icon={CandlestickChart} label={`${t('groups.deriv')} · ${base}`}>
      {!deriv ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat
              label={t('deriv.funding')}
              value={deriv.fundingRate != null ? `${(deriv.fundingRate * 100).toFixed(4)}%` : '—'}
              tone={deriv.fundingRate != null ? (deriv.fundingRate >= 0 ? 'bull' : 'bear') : undefined}
            />
            <Stat
              label={t('deriv.annual')}
              value={deriv.fundingAnnualPct != null ? pct(deriv.fundingAnnualPct, 1) : '—'}
              tone={deriv.fundingAnnualPct != null ? (deriv.fundingAnnualPct >= 0 ? 'bull' : 'bear') : undefined}
            />
            <Stat label={t('deriv.mark')} value={usd(deriv.markPrice)} />
            <Stat
              label={t('deriv.premium')}
              value={deriv.premiumPct != null ? pct(deriv.premiumPct, 3) : '—'}
              tone={deriv.premiumPct != null ? (deriv.premiumPct >= 0 ? 'bull' : 'bear') : undefined}
            />
            <Stat label={t('deriv.oi')} value={deriv.openInterestUsd != null ? compactUsd(deriv.openInterestUsd) : '—'} />
            <Stat label={t('deriv.index')} value={usd(deriv.indexPrice)} />
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <Stat
              label={t('deriv.lsrAcc')}
              value={deriv.lsrAccounts != null ? deriv.lsrAccounts.toFixed(2) : '—'}
              tone={deriv.lsrAccounts != null ? (deriv.lsrAccounts >= 1 ? 'bull' : 'bear') : undefined}
            />
            <Stat
              label={t('deriv.lsrTaker')}
              value={deriv.lsrTaker != null ? deriv.lsrTaker.toFixed(2) : '—'}
              tone={deriv.lsrTaker != null ? (deriv.lsrTaker >= 1 ? 'bull' : 'bear') : undefined}
            />
            <Stat
              label={t('deriv.lsrTop')}
              value={deriv.topLsr != null ? deriv.topLsr.toFixed(2) : '—'}
              tone={deriv.topLsr != null ? (deriv.topLsr >= 1 ? 'bull' : 'bear') : undefined}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between border border-line/70 bg-bg/50 px-2 py-1.5">
            <span className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('deriv.nextFunding')}</span>
            <span className="font-mono text-sm font-bold tabular-nums text-warning">{nextFunding}</span>
          </div>
          {hist && hist.times.length > 1 && (
            <div className="mt-1.5 grid grid-cols-1 gap-1.5">
              <div className="border border-line/70 bg-bg/50 px-2 pt-1.5">
                <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('deriv.oiHist')}</p>
                <Spark values={hist.oiUsd} color="hsl(var(--nc-secondary))" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="border border-line/70 bg-bg/50 px-2 pt-1.5">
                  <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('deriv.lsrHist')}</p>
                  <Spark values={hist.lsrTaker} color="hsl(var(--nc-bull))" />
                </div>
                <div className="border border-line/70 bg-bg/50 px-2 pt-1.5">
                  <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('deriv.fundingHist')}</p>
                  <Spark values={hist.fundingHistory} color="hsl(var(--nc-warning))" />
                </div>
              </div>
            </div>
          )}
          {(deriv.liqLongUsd != null || deriv.liqShortUsd != null) && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('deriv.liq5m')}</span>
              <span className="font-mono text-2xs text-bear">S {compactUsd(deriv.liqShortUsd ?? 0)}</span>
              <span className="h-1.5 flex-1 bg-line/50">
                <span
                  className="block h-full bg-bear/70"
                  style={{
                    width: `${
                      (deriv.liqShortUsd ?? 0) + (deriv.liqLongUsd ?? 0) > 0
                        ? ((deriv.liqShortUsd ?? 0) / ((deriv.liqShortUsd ?? 0) + (deriv.liqLongUsd ?? 0))) * 100
                        : 50
                    }%`,
                  }}
                />
              </span>
              <span className="font-mono text-2xs text-bull">L {compactUsd(deriv.liqLongUsd ?? 0)}</span>
            </div>
          )}
        </>
      )}
    </ProCard>
  );
}

function FlowCard({ base }: { base: string }) {
  const t = useTranslations('pro');
  const flow = useProStore((s) => s.flow);
  const cvd = useProStore((s) => s.cvd[`${base}/USDT`]);
  return (
    <ProCard group="flow" icon={ArrowLeftRight} label={`${t('groups.flow')} · ${base}`}>
      {!flow ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label={t('flow.bid')} value={usd(flow.bestBid)} tone="bull" />
            <Stat label={t('flow.ask')} value={usd(flow.bestAsk)} tone="bear" />
            <Stat label={t('flow.spread')} value={flow.spreadBps != null ? `${flow.spreadBps.toFixed(2)} bps` : '—'} />
            <Stat
              label={t('flow.imbalance')}
              value={flow.imbalancePct != null ? `${flow.imbalancePct >= 0 ? '+' : ''}${flow.imbalancePct.toFixed(1)}%` : '—'}
              tone={flow.imbalancePct != null ? (flow.imbalancePct >= 0 ? 'bull' : 'bear') : undefined}
            />
          </div>
          <div className="mt-1.5 flex h-2 w-full overflow-hidden border border-line/60" aria-hidden>
            <span
              className="h-full bg-bull/70"
              style={{ width: `${flow.imbalancePct != null ? 50 + flow.imbalancePct / 2 : 50}%` }}
            />
            <span className="h-full flex-1 bg-bear/70" />
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <Stat
              label={t('flow.cvd')}
              value={cvd ? `${cvd.cvdUsd >= 0 ? '+' : ''}${compact(cvd.cvdUsd)}` : '0'}
              tone={cvd ? (cvd.cvdUsd >= 0 ? 'bull' : 'bear') : undefined}
            />
            <Stat
              label={t('flow.delta60')}
              value={cvd ? `${cvd.delta60sUsd >= 0 ? '+' : ''}${compact(cvd.delta60sUsd)}` : '0'}
              tone={cvd ? (cvd.delta60sUsd >= 0 ? 'bull' : 'bear') : undefined}
            />
            <Stat label={t('flow.trades')} value={cvd ? compact(cvd.trades) : '0'} />
          </div>
          {flow.depthBids.length > 1 && flow.depthAsks.length > 1 && <DepthChart bids={flow.depthBids} asks={flow.depthAsks} label={t('flow.depth')} />}
          <p className="mt-1.5 font-mono text-2xs text-faint">{t('flow.cvdHint')}</p>
        </>
      )}
    </ProCard>
  );
}

/** Cumulative depth: bids mirrored left (bull), asks right (bear), log-ish scaled. */
function DepthChart({ bids, asks, label }: { bids: [number, number][]; asks: [number, number][]; label: string }) {
  const mid = ((bids[0]?.[0] ?? 0) + (asks[0]?.[0] ?? 0)) / 2;
  const maxCum = Math.max(bids[bids.length - 1]?.[1] ?? 0, asks[asks.length - 1]?.[1] ?? 0);
  if (mid <= 0 || maxCum <= 0) return null;
  // price range: ±0.5 % around mid, clipped to the book span
  const span = Math.max(mid * 0.005, Math.abs(bids[bids.length - 1]![0] - asks[asks.length - 1]![0]) / 2);
  const p0 = mid - span;
  const p1 = mid + span;
  const x = (price: number) => ((price - p0) / (p1 - p0)) * 100;
  const y = (cum: number) => 38 - (cum / maxCum) * 36;
  const bidPath = [...bids]
    .reverse()
    .filter(([price]) => price >= p0)
    .map(([price, cum], i) => `${i === 0 ? 'M' : 'L'}${x(price).toFixed(1)},${y(cum).toFixed(1)}`)
    .join(' ');
  const askPath = asks
    .filter(([price]) => price <= p1)
    .map(([price, cum], i) => `${i === 0 ? 'M' : 'L'}${x(price).toFixed(1)},${y(cum).toFixed(1)}`)
    .join(' ');
  return (
    <div className="mt-1.5 border border-line/70 bg-bg/50 px-2 pt-1.5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
        <p className="font-mono text-2xs text-faint">±{(span / mid * 100).toFixed(2)}%</p>
      </div>
      <svg viewBox="0 0 100 40" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
        <line x1={x(mid).toFixed(1)} y1="0" x2={x(mid).toFixed(1)} y2="40" stroke="hsl(var(--nc-line))" strokeWidth="0.4" />
        {bidPath && <path d={`${bidPath} L${x(p0).toFixed(1)},40 L100,40 Z`.replace('L100,40', `L${x(mid).toFixed(1)},40`)} fill="hsl(var(--nc-bull) / 0.15)" stroke="none" />}
        {bidPath && <path d={bidPath} fill="none" stroke="hsl(var(--nc-bull))" strokeWidth="1" />}
        {askPath && <path d={`${askPath} L${x(p1).toFixed(1)},40 L${x(mid).toFixed(1)},40 Z`} fill="hsl(var(--nc-bear) / 0.15)" stroke="none" />}
        {askPath && <path d={askPath} fill="none" stroke="hsl(var(--nc-bear))" strokeWidth="1" />}
      </svg>
    </div>
  );
}

function BreadthCard() {
  const t = useTranslations('pro');
  const breadth = useProStore((s) => s.breadth);
  return (
    <ProCard group="breadth" icon={BarChart3} label={t('groups.breadth')}>
      {!breadth ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label={t('breadth.adv')} value={compact(breadth.advancers)} tone="bull" />
            <Stat label={t('breadth.dec')} value={compact(breadth.decliners)} tone="bear" />
            <Stat
              label={t('breadth.median')}
              value={breadth.medianChangePct != null ? pct(breadth.medianChangePct, 2) : '—'}
              tone={breadth.medianChangePct != null ? (breadth.medianChangePct >= 0 ? 'bull' : 'bear') : undefined}
            />
          </div>
          {breadth.advPct != null && (
            <div className="mt-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('breadth.advPct')}</span>
                <span className="font-mono text-2xs tabular-nums text-fg">{breadth.advPct.toFixed(1)}%</span>
              </div>
              <div className="mt-1 flex h-2 w-full overflow-hidden border border-line/60" aria-hidden>
                <span className="h-full bg-bull/70" style={{ width: `${breadth.advPct}%` }} />
                <span className="h-full flex-1 bg-bear/70" />
              </div>
            </div>
          )}
          <p className="mt-1.5 font-mono text-2xs text-faint">{t('breadth.hint', { total: compact(breadth.total) })}</p>
        </>
      )}
    </ProCard>
  );
}

function GlobalCard() {
  const t = useTranslations('pro');
  const global = useProStore((s) => s.global);
  return (
    <ProCard group="global" icon={Globe2} label={t('groups.global')}>
      {!global ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label={t('global.mcap')} value={compactUsd(global.totalMcapUsd)} />
            <Stat
              label={t('global.mcap24')}
              value={global.mcapChange24hPct != null ? pct(global.mcapChange24hPct) : '—'}
              tone={global.mcapChange24hPct != null ? (global.mcapChange24hPct >= 0 ? 'bull' : 'bear') : undefined}
            />
            <Stat label={t('global.vol')} value={global.totalVolumeUsd != null ? compactUsd(global.totalVolumeUsd) : '—'} />
            <Stat label={t('global.coins')} value={global.activeCryptos != null ? compact(global.activeCryptos) : '—'} />
            <Stat label={t('global.btcD')} value={global.btcDominancePct != null ? `${global.btcDominancePct.toFixed(1)}%` : '—'} />
            <Stat label={t('global.ethD')} value={global.ethDominancePct != null ? `${global.ethDominancePct.toFixed(1)}%` : '—'} />
          </div>
          {global.fngValue != null && (
            <div className="mt-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('global.fng')}</span>
                <span
                  className={cn(
                    'font-mono text-sm font-bold tabular-nums',
                    global.fngValue >= 55 ? 'text-bull' : global.fngValue <= 45 ? 'text-bear' : 'text-warning',
                  )}
                >
                  {global.fngValue} · {global.fngLabel ?? ''}
                </span>
              </div>
              {/* 14-day sentiment sparkline */}
              <svg viewBox="0 0 100 24" className="mt-1 h-6 w-full" preserveAspectRatio="none" aria-hidden>
                <polyline
                  fill="none"
                  stroke="hsl(var(--nc-secondary))"
                  strokeWidth="1.5"
                  points={global.fngHistory
                    .map((value, index) => {
                      const x = global.fngHistory.length > 1 ? (index / (global.fngHistory.length - 1)) * 100 : 0;
                      const y = 22 - (Math.min(100, Math.max(0, value)) / 100) * 20;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join(' ')}
                />
              </svg>
            </div>
          )}
        </>
      )}
    </ProCard>
  );
}

function HeatCard() {
  const t = useTranslations('pro');
  const heat = useProStore((s) => s.heat);
  return (
    <ProCard group="heat" icon={Grid3x3} label={t('groups.heat')}>
      {heat.length === 0 ? (
        <Placeholder text={t('loading')} />
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {heat.map((tile) => {
            const intensity = Math.min(1, Math.abs(tile.changePct) / 8);
            const background =
              tile.changePct >= 0
                ? `hsl(var(--nc-bull) / ${0.12 + intensity * 0.6})`
                : `hsl(var(--nc-bear) / ${0.12 + intensity * 0.6})`;
            return (
              <span
                key={tile.pair}
                title={`${tile.pair} · ${pct(tile.changePct)} · ${compactUsd(tile.quoteVolumeUsd)}`}
                className="flex h-9 items-center justify-center border border-line/40 font-mono text-micro-9 font-bold uppercase text-fg"
                style={{ background }}
              >
                {tile.pair.split('/')[0]?.slice(0, 5)}
              </span>
            );
          })}
        </div>
      )}
    </ProCard>
  );
}

function VolCard() {
  const t = useTranslations('pro');
  const vol = useProStore((s) => s.vol);
  return (
    <ProCard group="vol" icon={Sigma} label={t('groups.vol')}>
      {!vol ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat
              label={t('vol.dvolBtc')}
              value={vol.dvolBtc != null ? vol.dvolBtc.toFixed(1) : '—'}
              tone={vol.dvolBtcChange24h != null ? (vol.dvolBtcChange24h >= 0 ? 'warn' : 'bull') : undefined}
            />
            <Stat
              label={t('vol.dvolEth')}
              value={vol.dvolEth != null ? vol.dvolEth.toFixed(1) : '—'}
              tone={vol.dvolEthChange24h != null ? (vol.dvolEthChange24h >= 0 ? 'warn' : 'bull') : undefined}
            />
            <Stat
              label={t('vol.putCall')}
              value={vol.putCallOi != null ? vol.putCallOi.toFixed(2) : '—'}
              tone={vol.putCallOi != null ? (vol.putCallOi >= 1 ? 'bull' : 'bear') : undefined}
            />
            <Stat label={t('vol.maxPain')} value={vol.maxPain != null ? compactUsd(vol.maxPain) : '—'} />
          </div>
          {vol.maxPain != null && vol.underlying != null && vol.underlying > 0 && (
            <p className="mt-1.5 font-mono text-2xs text-faint">
              {t('vol.painDist', { value: pct(((vol.maxPain - vol.underlying) / vol.underlying) * 100, 1) })}
            </p>
          )}
          {vol.smile.length > 2 && (
            <div className="mt-1.5 border border-line/70 bg-bg/50 px-2 pt-1.5">
              <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('vol.smile')}</p>
              <SmileSvg points={vol.smile} />
            </div>
          )}
          {vol.term.length > 1 && (
            <div className="mt-1.5 border border-line/70 bg-bg/50 px-2 pt-1.5">
              <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('vol.term')}</p>
              <Spark values={vol.term.map((point) => point.iv)} color="hsl(var(--nc-primary))" />
              <div className="flex justify-between pb-1">
                <span className="font-mono text-micro-9 text-faint">{vol.term[0]?.daysToExpiry.toFixed(0)}d</span>
                <span className="font-mono text-micro-9 text-faint">{vol.term[vol.term.length - 1]?.daysToExpiry.toFixed(0)}d</span>
              </div>
            </div>
          )}
          <p className="mt-1 font-mono text-2xs text-faint">{t('vol.dvolHint')}</p>
        </>
      )}
    </ProCard>
  );
}

/** IV smile: x = moneyness %, y = mark IV %, with spot marker at x = 0. */
function SmileSvg({ points }: { points: { moneynessPct: number; iv: number }[] }) {
  const xs = points.map((point) => point.moneynessPct);
  const ys = points.map((point) => point.iv);
  const x0 = Math.min(...xs, -5);
  const x1 = Math.max(...xs, 5);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const spanY = y1 - y0 || 1;
  const px = (v: number) => ((v - x0) / (x1 - x0)) * 100;
  const py = (v: number) => 30 - ((v - y0) / spanY) * 27;
  const path = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${px(point.moneynessPct).toFixed(1)},${py(point.iv).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <line x1={px(0).toFixed(1)} y1="0" x2={px(0).toFixed(1)} y2="32" stroke="hsl(var(--nc-line))" strokeWidth="0.4" />
      <path d={path} fill="none" stroke="hsl(var(--nc-secondary))" strokeWidth="1.4" />
      {points.map((point) => (
        <circle key={point.moneynessPct} cx={px(point.moneynessPct).toFixed(1)} cy={py(point.iv).toFixed(1)} r="1.1" fill="hsl(var(--nc-secondary))" />
      ))}
    </svg>
  );
}
