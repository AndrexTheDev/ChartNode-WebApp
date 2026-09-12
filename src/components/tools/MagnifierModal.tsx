// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { usd } from '@/lib/format';
import { useViralStore } from '@/store/useViralStore';
import type { Candle } from '@/websockets/types';

interface AggTrade {
  p: string;
  q: string;
  T: number;
  m: boolean; // buyer is maker → sell-side aggression
}

interface MagnifierModalProps {
  symbol: string;
  /** ms length of one bar, derived from the active interval. */
  barMs: number;
  candles: Candle[];
  open: boolean;
  onClose: () => void;
}

interface TapeStats {
  count: number;
  volume: number;
  notional: number;
  delta: number;
  buys: number;
  sells: number;
  large: Array<{ price: number; qty: number; notional: number; buy: boolean; at: number }>;
  curve: number[];
}

/**
 * Bar magnifier (TradingView: Premium). Inspects the raw trade tape inside
 * one candle via Binance aggTrades (CORS-open): prints, taker delta and a
 * cumulative-delta curve for the selected bar.
 */
export function MagnifierModal({ symbol, barMs, candles, open, onClose }: MagnifierModalProps) {
  const t = useTranslations('tools');
  const closed = useMemo(() => candles.slice(0, -1), [candles]);
  const [offset, setOffset] = useState(1);
  const [stats, setStats] = useState<TapeStats | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const bar = closed[closed.length - offset];

  const target = bar;
  useEffect(() => {
    if (!open || !target) return undefined;
    let alive = true;
    const timer = setTimeout(run, 0);
    function run() {
      setLoading(true);
      setError(false);
    const pair = symbol.replace('/', '');
    const start = target!.t;
    const binance = fetch(
      `https://api.binance.com/api/v3/aggTrades?symbol=${encodeURIComponent(pair)}&startTime=${start}&endTime=${start + barMs - 1}&limit=1000`,
    ).then((response) => (response.ok ? response.json() : Promise.reject(new Error('http'))));
    const okx = fetch(`https://www.okx.com/api/v5/market/trades?instId=${encodeURIComponent(symbol.replace('/', '-'))}&limit=300`).then(
      (response) => (response.ok ? response.json() : Promise.reject(new Error('http'))),
    );
    binance
      .catch(() =>
        okx.then((payload: unknown) => {
          const list = (payload as { data?: Array<Record<string, string>> })?.data ?? [];
          return list
            .filter((trade) => Number(trade.ts) >= start && Number(trade.ts) < start + barMs)
            .map((trade) => ({ p: trade.px, q: trade.sz, T: Number(trade.ts), m: trade.side !== 'buy' }));
        }),
      )
      .then((data: unknown) => {
        if (!alive) return;
        if (!Array.isArray(data) || data.length === 0) {
          setStats(null);
          return;
        }
        const trades = data as AggTrade[];
        let volume = 0;
        let notional = 0;
        let buyVol = 0;
        let buys = 0;
        let sells = 0;
        const curve: number[] = [];
        let running = 0;
        const prints: TapeStats['large'] = [];
        for (const trade of trades) {
          const price = Number(trade.p);
          const qty = Number(trade.q);
          const notion = price * qty;
          const buy = !trade.m;
          volume += qty;
          notional += notion;
          if (buy) {
            buyVol += qty;
            buys += 1;
          } else sells += 1;
          running += buy ? qty : -qty;
          curve.push(running);
          if (notion >= 100_000) prints.push({ price, qty, notional, buy, at: trade.T });
        }
        prints.sort((a, b) => b.notional - a.notional);
        setStats({
          count: trades.length,
          volume,
          notional,
          delta: 2 * buyVol - volume,
          buys,
          sells,
          large: prints.slice(0, 8),
          curve,
        });
      })
      .catch(() => alive && setError(true))
        .finally(() => alive && setLoading(false));
    }
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, target, barMs, symbol]);

  const curvePath = useMemo(() => {
    if (!stats || stats.curve.length < 2) return null;
    const min = Math.min(...stats.curve);
    const max = Math.max(...stats.curve);
    const span = max - min || 1;
    return stats.curve
      .map((value, i) => `${i === 0 ? 'M' : 'L'}${((i / (stats.curve.length - 1)) * 100).toFixed(2)},${(30 - ((value - min) / span) * 28).toFixed(2)}`)
      .join(' ');
  }, [stats]);

  return (
    <Modal open={open} onClose={onClose} title={t('magnifier.title')} subtitle={t('magnifier.sub')}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-mono text-2xs">
          <button
            type="button"
            aria-label={t('magnifier.prev')}
            onClick={() => setOffset((value) => Math.min(closed.length, value + 1))}
            className="border border-line px-1.5 py-1 text-muted hover:text-fg"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="border border-line bg-surface/40 px-2 py-1 text-fg">
            {bar ? new Date(bar.t).toLocaleString() : '—'}
          </span>
          <button
            type="button"
            aria-label={t('magnifier.next')}
            onClick={() => setOffset((value) => Math.max(1, value - 1))}
            className="border border-line px-1.5 py-1 text-muted hover:text-fg"
          >
            <ChevronRight size={12} />
          </button>
          {loading && <span className="text-faint">…</span>}
        </div>

        {error && <p className="font-mono text-2xs text-bear">{t('magnifier.err')}</p>}
        {!error && bar && !stats && !loading && <p className="font-mono text-2xs text-faint">{t('magnifier.empty')}</p>}

        {stats && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[
                [t('magnifier.trades'), String(stats.count)],
                [t('magnifier.vol'), stats.volume.toFixed(2)],
                [t('magnifier.notional'), usd(stats.notional)],
                [t('magnifier.buys'), String(stats.buys)],
                [t('magnifier.sells'), String(stats.sells)],
                [t('magnifier.delta'), `${stats.delta >= 0 ? '+' : ''}${stats.delta.toFixed(2)}`],
              ].map(([label, value]) => (
                <div key={label} className="border border-line/60 bg-surface/30 px-2 py-1.5">
                  <p className="text-2xs uppercase tracking-cyber text-faint">{label}</p>
                  <p className="font-mono text-xs tabular-nums text-fg">{value}</p>
                </div>
              ))}
            </div>
            {curvePath && (
              <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-16 w-full border border-line/60 bg-surface/30">
                <path d={curvePath} fill="none" strokeWidth="0.8" style={{ stroke: 'hsl(var(--nc-bull))' }} />
              </svg>
            )}
            {stats.large.length > 0 && (
              <ul className="flex flex-col gap-1">
                {stats.large.map((print) => (
                  <li key={`${print.at}-${print.notional}`} className="flex items-center gap-2 font-mono text-2xs">
                    <span className={cn(print.buy ? 'text-bull' : 'text-bear')}>{print.buy ? 'BUY' : 'SELL'}</span>
                    <span className="text-fg">{print.price}</span>
                    <span className="text-faint">× {print.qty.toFixed(3)}</span>
                    <span className="ml-auto text-warning">{usd(print.notional)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => useViralStore.getState().openSupport()}
          className="self-start font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
        >
          {t('magnifier.foot')}
        </button>
      </div>
    </Modal>
  );
}
