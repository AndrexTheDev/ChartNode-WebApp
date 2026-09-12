// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { usd } from '@/lib/format';
import { SEED_TOKENS, TOKEN_INDEX } from '@/lib/constants';
import { feedId, type Candle } from '@/websockets/types';
import { useChartStore } from '@/store/useChartStore';
import { selectActiveToken, selectTimeframe, useAppStore } from '@/store/useAppStore';
import { useMarketStore } from '@/store/useMarketStore';
import { useProStore } from '@/store/useProStore';
import { useExchangeSelection } from '@/store/useExchangeSelection';
import { buildLiqMap } from '@/lib/liqradar';
import { analyseLeadLag, pendingReaction } from '@/lib/leadlag';
import { classifyRegime, regimeHistory, type RegimeId } from '@/lib/regime';
import { seasonality } from '@/lib/seasonality';

interface EdgeModalProps {
  candles: Candle[];
}

/* --------------------------------- Liq Radar -------------------------------- */

export function EdgeLiqModal({ candles }: EdgeModalProps) {
  const t = useTranslations('edge');
  const open = useChartStore((s) => s.edgeLiqOpen);
  const onClose = () => useChartStore.getState().setEdgeLiqOpen(false);
  const on = useChartStore((s) => s.liqMagnetsOn);
  const toggle = useChartStore((s) => s.toggleLiqMagnets);

  const map = useMemo(() => buildLiqMap(candles), [candles]);

  return (
    <Modal open={open} onClose={onClose} title={t('liqTitle')} subtitle={t('liqSub')} widthClass="max-w-2xl">
      <div className="flex flex-col gap-5 p-5">
        <label className="flex cursor-pointer items-center gap-3 font-mono text-2xs uppercase tracking-cyber text-fg">
          <input type="checkbox" checked={on} onChange={toggle} className="size-4 accent-[hsl(var(--nc-primary))]" />
          {t('liqEnable')}
        </label>

        <p className="border-l border-primary/30 pl-4 text-xs leading-relaxed text-muted">{t('liqHow')}</p>

        {map ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-bear">{t('liqAbove')}</p>
              <MagnetRows rows={map.topShorts} tone="bear" />
            </div>
            <p className="font-mono text-xs tabular-nums text-faint">
              {t('liqSpot')}: <span className="text-fg">{usd(map.spot)}</span>
            </p>
            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-bull">{t('liqBelow')}</p>
              <MagnetRows rows={map.topLongs} tone="bull" />
            </div>
          </div>
        ) : (
          <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('liqEmpty')}</p>
        )}
      </div>
    </Modal>
  );
}

function MagnetRows({
  rows,
  tone,
}: {
  rows: { price: number; side: 'long' | 'short'; intensity: number; leverage: number; distancePct: number }[];
  tone: 'bull' | 'bear';
}) {
  const t = useTranslations('edge');
  if (rows.length === 0) return <p className="font-mono text-2xs text-faint">{t('liqEmpty')}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={`${row.side}-${row.price}`} className="flex items-center gap-3 border border-line/60 bg-surface/40 px-3 py-2">
          <span className={cn('font-mono text-2xs', tone === 'bull' ? 'text-bull' : 'text-bear')}>
            {row.leverage}× {row.side === 'long' ? 'L' : 'S'}
          </span>
          <span className="flex-1 font-mono text-xs tabular-nums text-fg">{usd(row.price)}</span>
          <span className="font-mono text-2xs tabular-nums text-faint">
            {row.distancePct >= 0 ? '+' : ''}
            {row.distancePct.toFixed(2)} %
          </span>
          <span className="h-1.5 w-24 bg-line/60" aria-hidden>
            <span
              className={cn('block h-full', tone === 'bull' ? 'bg-bull' : 'bg-bear')}
              style={{ width: `${Math.round(row.intensity * 100)}%` }}
            />
          </span>
          <span className="w-10 text-right font-mono text-2xs tabular-nums text-faint">
            {Math.round(row.intensity * 100)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- Lag Oracle -------------------------------- */

export function EdgeLagModal({ candles }: EdgeModalProps) {
  const t = useTranslations('edge');
  const open = useChartStore((s) => s.edgeLagOpen);
  const onClose = () => useChartStore.getState().setEdgeLagOpen(false);
  const leaderId = useChartStore((s) => s.lagLeaderId);
  const setLeader = useChartStore((s) => s.setLagLeader);
  const activeToken = useAppStore(selectActiveToken);
  const timeframe = useAppStore(selectTimeframe);

  const fallbackLeader =
    SEED_TOKENS.find((token) => token.venue === 'CEX' && token.id !== activeToken.id)?.id ?? 'cex:binance:BTCUSDT';
  // a stored leader that equals the active token (or is gone) falls back, so
  // the select never renders an empty value
  const effectiveLeader = leaderId && leaderId !== activeToken.id && TOKEN_INDEX[leaderId] ? leaderId : fallbackLeader;
  const leaderToken = TOKEN_INDEX[effectiveLeader];
  const selection = useExchangeSelection(leaderToken?.venue === 'CEX' ? leaderToken.symbol : '', timeframe, leaderToken?.exchange);
  const leaderFeedId = leaderToken && selection ? feedId({ exchange: selection.exchange, symbol: leaderToken.symbol, timeframe }) : null;
  const leaderCandles = useMarketStore((s) => (leaderFeedId ? s.feeds[leaderFeedId]?.candles : undefined));

  const stats = useMemo(
    () => analyseLeadLag((leaderCandles ?? []).map((c) => c.c), candles.map((c) => c.c)),
    [leaderCandles, candles],
  );
  const pending = useMemo(
    () => pendingReaction(stats, (leaderCandles ?? []).map((c) => c.c), candles.map((c) => c.c)),
    [stats, leaderCandles, candles],
  );

  // single source of truth: the store drives the provider subscription, so the
  // modal publishes its fallback leader as soon as it opens
  useEffect(() => {
    if (open && (!leaderId || leaderId === activeToken.id || !TOKEN_INDEX[leaderId])) {
      setLeader(fallbackLeader);
    }
  }, [open, leaderId, activeToken.id, fallbackLeader, setLeader]);

  const options = SEED_TOKENS.filter((token) => token.venue === 'CEX' && token.id !== activeToken.id);

  return (
    <Modal open={open} onClose={onClose} title={t('lagTitle')} subtitle={t('lagSub')} widthClass="max-w-2xl">
      <div className="flex flex-col gap-5 p-5">
        <label className="flex items-center gap-3 font-mono text-2xs uppercase tracking-cyber text-muted">
          {t('lagLeader')}
          <select
            value={effectiveLeader}
            onChange={(event) => setLeader(event.target.value)}
            className="border border-line bg-surface/70 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-primary/60"
          >
            {options.map((token) => (
              <option key={token.id} value={token.id}>
                {token.symbol} · {token.venue}
              </option>
            ))}
          </select>
        </label>

        {stats.samples < 60 || !leaderCandles || leaderCandles.length < 60 ? (
          <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('lagNeed')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px border border-line/70 bg-line/40 sm:grid-cols-4">
              <Stat label={t('lagLag')} value={String(stats.bestLag)} />
              <Stat label={t('lagCorr')} value={stats.bestCorr.toFixed(2)} />
              <Stat label={t('lagBeta')} value={stats.beta.toFixed(2)} />
              <Stat label={t('lagHits')} value={stats.hitRate == null ? '–' : `${Math.round(stats.hitRate * 100)} %`} />
            </div>

            {pending ? (
              <p
                className={cn(
                  'border px-4 py-3 font-mono text-xs',
                  pending.direction === 1 ? 'border-bull/50 bg-bull/10 text-bull' : 'border-bear/50 bg-bear/10 text-bear',
                )}
                role="status"
              >
                {t('lagPendingText', {
                  leader: leaderToken?.base ?? '',
                  dir: pending.direction === 1 ? '+' : '−',
                  bps: Math.abs(pending.leaderMoveBps).toFixed(0),
                  exp: Math.abs(pending.expectedFollowerBps).toFixed(0),
                  done: Math.abs(pending.followedSoFarBps).toFixed(0),
                })}
              </p>
            ) : (
              <p className="border border-line/60 bg-surface/40 px-4 py-3 font-mono text-xs text-muted" role="status">
                {t('lagCalm')}
              </p>
            )}
          </>
        )}

        <p className="border-l border-primary/30 pl-4 text-xs leading-relaxed text-muted">{t('lagHow')}</p>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg/85 px-3 py-2.5">
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
      <p className="mt-1 font-mono text-sm tabular-nums text-fg">{value}</p>
    </div>
  );
}

/* ------------------------------ Regime Compass ------------------------------ */

const REGIME_NAME_KEY = {
  'trend-strong': 'rTrendStrong',
  'trend-weak': 'rTrendWeak',
  range: 'rRange',
  'vol-expand': 'rVolExpand',
  'liq-storm': 'rLiqStorm',
} as const satisfies Record<RegimeId, string>;
const REGIME_DESC_KEY = {
  'trend-strong': 'rdTrendStrong',
  'trend-weak': 'rdTrendWeak',
  range: 'rdRange',
  'vol-expand': 'rdVolExpand',
  'liq-storm': 'rdLiqStorm',
} as const satisfies Record<RegimeId, string>;

const REGIME_TONE: Record<RegimeId, string> = {
  'trend-strong': 'text-bull border-bull/50 bg-bull/10',
  'trend-weak': 'text-bull/80 border-bull/30 bg-bull/5',
  range: 'text-fg border-line bg-surface/40',
  'vol-expand': 'text-warning border-warning/50 bg-warning/10',
  'liq-storm': 'text-bear border-bear/50 bg-bear/10',
};

const REGIME_HISTORY_COLOR: Record<RegimeId, string> = {
  'trend-strong': 'bg-bull',
  'trend-weak': 'bg-bull/50',
  range: 'bg-line',
  'vol-expand': 'bg-warning',
  'liq-storm': 'bg-bear',
};

export function EdgeRegimeModal({ candles }: EdgeModalProps) {
  const t = useTranslations('edge');
  const open = useChartStore((s) => s.edgeRegimeOpen);
  const onClose = () => useChartStore.getState().setEdgeRegimeOpen(false);
  const deriv = useProStore((s) => s.deriv);
  const breadth = useProStore((s) => s.breadth);
  const hist = useProStore((s) => s.hist);

  const liqMedian = useMemo(() => {
    if (!hist) return null;
    const sums = hist.times.map((_, i) => (hist.liqLongUsd[i] ?? 0) + (hist.liqShortUsd[i] ?? 0)).filter((v) => v > 0);
    if (sums.length < 5) return null;
    const sorted = [...sums].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  }, [hist]);

  const read = useMemo(
    () =>
      classifyRegime({
        candles,
        fundingRate: deriv?.fundingRate != null ? deriv.fundingRate * 100 : null,
        advPct: breadth?.advPct != null ? breadth.advPct * 100 : null,
        liq5mUsd: deriv ? (deriv.liqLongUsd ?? 0) + (deriv.liqShortUsd ?? 0) : null,
        liqMedianUsd: liqMedian,
      }),
    [candles, deriv, breadth, liqMedian],
  );
  const history = useMemo(() => regimeHistory(candles), [candles]);

  const driverLabel: Record<string, string> = {
    adx: t('dAdx'),
    rv: t('dRv'),
    slope: t('dSlope'),
    funding: t('dFunding'),
    breadth: t('dBreadth'),
    liq: t('dLiq'),
  };

  const actions = useMemo(() => {
    const state = useChartStore.getState();
    const toggleSr = () => state.toggleSr();
    const toggleVp = () => state.toggleVp();
    const toggleDiv = () => state.toggleDiv();
    const openAlerts = () => state.setAlertArm(true);
    const toggleLiq = () => state.toggleLiqMagnets();
    const byRegime: Record<RegimeId, { label: string; run: () => void }[]> = {
      'trend-strong': [
        { label: t('actAvwap'), run: () => state.setAvwapArm(true) },
        { label: t('actSr'), run: toggleSr },
      ],
      'trend-weak': [
        { label: t('actSr'), run: toggleSr },
        { label: t('actDiv'), run: toggleDiv },
      ],
      range: [
        { label: t('actSr'), run: toggleSr },
        { label: t('actVp'), run: toggleVp },
      ],
      'vol-expand': [
        { label: t('actDiv'), run: toggleDiv },
        { label: t('actAlerts'), run: openAlerts },
      ],
      'liq-storm': [
        { label: t('actLiq'), run: toggleLiq },
        { label: t('actAlerts'), run: openAlerts },
      ],
    };
    return read ? byRegime[read.id] : [];
  }, [read, t]);

  return (
    <Modal open={open} onClose={onClose} title={t('regimeTitle')} subtitle={t('regimeSub')} widthClass="max-w-2xl">
      <div className="flex flex-col gap-5 p-5">
        {read ? (
          <>
            <div className={cn('border px-4 py-3', REGIME_TONE[read.id])}>
              <p className="font-display text-lg font-extrabold">{t(REGIME_NAME_KEY[read.id])}</p>
              <p className="mt-1 text-xs leading-relaxed opacity-90">{t(REGIME_DESC_KEY[read.id])}</p>
              <p className="mt-2 font-mono text-2xs uppercase tracking-cyber opacity-80">
                {t('regimeConfidence')}: {Math.round(read.confidence * 100)} %
              </p>
            </div>

            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('regimeDrivers')}</p>
              <ul className="grid grid-cols-2 gap-px border border-line/70 bg-line/40 sm:grid-cols-3">
                {read.drivers.map((driver) => (
                  <li key={driver.key} className="bg-bg/85 px-3 py-2">
                    <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{driverLabel[driver.key]}</p>
                    <p className="mt-0.5 font-mono text-xs tabular-nums text-fg">
                      {driver.key === 'adx' ? driver.value.toFixed(0) : driver.key === 'breadth' ? `${driver.value.toFixed(0)} %` : driver.value.toFixed(2)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('regimeHistory')}</p>
              <div className="flex h-3 w-full overflow-hidden border border-line/60" aria-hidden>
                {history.map((id, index) => (
                  <span key={`${id}-${index}`} className={cn('h-full flex-1', REGIME_HISTORY_COLOR[id])} />
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('regimeRecs')}</p>
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      action.run();
                      onClose();
                    }}
                    className="border border-primary/45 bg-primary/8 px-3 py-2 font-mono text-2xs uppercase tracking-cyber text-primary transition-colors hover:border-primary hover:bg-primary/15"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('regimeNeed')}</p>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------- Clock Edge -------------------------------- */

export function EdgeClockModal({ candles }: EdgeModalProps) {
  const t = useTranslations('edge');
  const open = useChartStore((s) => s.edgeClockOpen);
  const onClose = () => useChartStore.getState().setEdgeClockOpen(false);
  const season = useMemo(() => seasonality(candles), [candles]);

  const cell = (bucket: { key: number; n: number; winRate: number; meanBps: number; t: number; significant: boolean }, now: boolean) => {
    const hue = bucket.meanBps >= 0 ? '157, 100%, 50%' : '344, 100%, 59%';
    const alpha = bucket.n === 0 ? 0.04 : Math.min(0.55, Math.abs(bucket.t) / 4) * (bucket.significant ? 1 : 0.45);
    return (
      <span
        key={bucket.key}
        title={`${String(bucket.key).padStart(2, '0')}:00 UTC · n=${bucket.n} · ${t('clockWin')} ${Math.round(bucket.winRate * 100)} % · t=${bucket.t.toFixed(1)}`}
        className={cn(
          'flex h-9 items-center justify-center border font-mono text-2xs tabular-nums',
          now ? 'border-primary text-fg shadow-neon-sm' : 'border-line/40 text-muted',
        )}
        style={{ backgroundColor: `hsla(${hue}, ${alpha})` }}
      >
        {bucket.n === 0 ? '·' : `${Math.round(bucket.winRate * 100)}`}
      </span>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t('clockTitle')} subtitle={t('clockSub')} widthClass="max-w-3xl">
      <div className="flex flex-col gap-5 p-5">
        {season ? (
          <>
            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('clockHours')}</p>
              <div className="grid grid-cols-8 gap-px sm:grid-cols-12">{season.hours.map((bucket) => cell(bucket, season.nowHour?.key === bucket.key))}</div>
            </div>
            <div>
              <p className="mb-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('clockDays')}</p>
              <div className="grid grid-cols-7 gap-px">
                {season.weekdays.map((bucket) => {
                  const label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][bucket.key];
                  return (
                    <span
                      key={bucket.key}
                      title={`${label} · n=${bucket.n} · ${t('clockWin')} ${Math.round(bucket.winRate * 100)} % · t=${bucket.t.toFixed(1)}`}
                      className={cn(
                        'flex h-9 flex-col items-center justify-center border font-mono text-2xs',
                        season.nowWeekday?.key === bucket.key ? 'border-primary text-fg' : 'border-line/40 text-muted',
                      )}
                      style={{
                        backgroundColor:
                          bucket.n === 0
                            ? undefined
                            : `hsla(${bucket.meanBps >= 0 ? '157, 100%, 50%' : '344, 100%, 59%'}, ${Math.min(0.55, Math.abs(bucket.t) / 4) * (bucket.significant ? 1 : 0.45)})`,
                      }}
                    >
                      {label}
                      <span className="tabular-nums">{bucket.n === 0 ? '·' : `${Math.round(bucket.winRate * 100)}%`}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <p
              className={cn(
                'border px-4 py-3 font-mono text-xs',
                season.nowHour?.significant ? 'border-primary/50 bg-primary/10 text-primary' : 'border-line/60 bg-surface/40 text-muted',
              )}
              role="status"
            >
              {season.nowHour?.significant
                ? t('clockNowYes', {
                    wr: Math.round((season.nowHour?.winRate ?? 0) * 100),
                    bps: Math.round(season.nowHour?.meanBps ?? 0),
                    n: season.nowHour?.n ?? 0,
                  })
                : t('clockNowNo')}
            </p>

            <p className="border-l border-primary/30 pl-4 text-xs leading-relaxed text-muted">{t('clockLegend')}</p>
          </>
        ) : (
          <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('clockNeed')}</p>
        )}
      </div>
    </Modal>
  );
}
