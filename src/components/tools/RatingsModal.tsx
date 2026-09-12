// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { fetchRatingMatrix, type RatingScore } from '@/lib/ratings';
import type { ExchangeId } from '@/websockets/types';
import { useViralStore } from '@/store/useViralStore';

interface RatingsModalProps {
  exchange: ExchangeId;
  symbol: string;
  open: boolean;
  onClose: () => void;
}

const SUMMARY_STYLE: Record<string, string> = {
  strongBuy: 'text-bull border-bull/50 bg-bull/10',
  buy: 'text-bull border-bull/30 bg-bull/5',
  neutral: 'text-muted border-line bg-surface/40',
  sell: 'text-bear border-bear/30 bg-bear/5',
  strongSell: 'text-bear border-bear/50 bg-bear/10',
};

/**
 * Multi-timeframe technical ratings — six timeframes scored in parallel.
 * TradingView shows one gauge behind an ad break; this is a full matrix,
 * computed in the browser from live REST seeds.
 */
export function RatingsModal({ exchange, symbol, open, onClose }: RatingsModalProps) {
  const t = useTranslations('tools');
  const [rows, setRows] = useState<RatingScore[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    fetchRatingMatrix(exchange, symbol)
      .then((result) => setRows(result.length ? result : null))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exchange, symbol]);

  const overall = rows && rows.length ? rows.reduce((acc, row) => acc + row.score, 0) / rows.length : 0;
  const angle = -90 + ((overall + 2) / 4) * 180;

  return (
    <Modal open={open} onClose={onClose} title={t('ratings.title')} subtitle={`${symbol} · ${t('ratings.sub')}`}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-5">
          <svg viewBox="0 0 200 110" className="h-24 w-40 shrink-0" role="img" aria-label={t('ratings.sub')}>
            <path d="M10 100 A 90 90 0 0 1 190 100" fill="none" strokeWidth="10" strokeDasharray="141 283" opacity="0.7" style={{ stroke: 'hsl(var(--nc-bear))' }} />
            <path d="M100 10 A 90 90 0 0 1 190 100" fill="none" strokeWidth="10" strokeDasharray="141 283" opacity="0.7" style={{ stroke: 'hsl(var(--nc-bull))' }} />
            <line
              x1="100"
              y1="100"
              x2={100 + 78 * Math.sin((angle * Math.PI) / 180)}
              y2={100 - 78 * Math.cos((angle * Math.PI) / 180)}
              strokeWidth="3"
              style={{ stroke: 'hsl(var(--nc-fg))' }}
            />
            <circle cx="100" cy="100" r="5" style={{ fill: 'hsl(var(--nc-fg))' }} />
          </svg>
          <div className="min-w-0 flex-1">
            <p className={cn('border px-2 py-1 font-mono text-xs uppercase tracking-cyber', rows ? SUMMARY_STYLE[overall >= 1.5 ? 'strongBuy' : overall >= 0.5 ? 'buy' : overall <= -1.5 ? 'strongSell' : overall <= -0.5 ? 'sell' : 'neutral'] : 'text-muted border-line')}>
              {rows ? t(`ratings.gauge.${overall >= 1.5 ? 'strongBuy' : overall >= 0.5 ? 'buy' : overall <= -1.5 ? 'strongSell' : overall <= -0.5 ? 'sell' : 'neutral'}`) : '—'}
            </p>
            <p className="mt-2 text-2xs text-faint">{t('ratings.hint')}</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1 border border-line px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-muted hover:text-fg"
          >
            <RefreshCw size={11} className={cn(loading && 'animate-spin')} /> {t('ratings.refresh')}
          </button>
        </div>

        {error && <p className="font-mono text-2xs text-bear">{t('ratings.err')}</p>}
        {!error && !rows && loading && <p className="font-mono text-2xs text-faint">{t('ratings.loading')}</p>}

        {rows && (
          <table className="w-full border-collapse font-mono text-2xs">
            <thead>
              <tr className="border-b border-line text-left text-faint">
                <th className="py-1 pr-2 font-normal uppercase tracking-cyber">TF</th>
                <th className="py-1 pr-2 font-normal uppercase tracking-cyber">{t('ratings.buy')}</th>
                <th className="py-1 pr-2 font-normal uppercase tracking-cyber">{t('ratings.sell')}</th>
                <th className="py-1 pr-2 font-normal uppercase tracking-cyber">{t('ratings.neutral')}</th>
                <th className="py-1 font-normal uppercase tracking-cyber">{t('ratings.verdict')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.timeframe} className="border-b border-line/50">
                  <td className="py-1.5 pr-2 text-fg">{row.timeframe}</td>
                  <td className="py-1.5 pr-2 text-bull">{row.buys}</td>
                  <td className="py-1.5 pr-2 text-bear">{row.sells}</td>
                  <td className="py-1.5 pr-2 text-muted">{row.neutrals}</td>
                  <td className="py-1.5">
                    <span className={cn('border px-1.5 py-0.5 uppercase tracking-cyber', SUMMARY_STYLE[row.summary])}>
                      {t(`ratings.gauge.${row.summary}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button
          type="button"
          onClick={() => useViralStore.getState().openSupport()}
          className="self-start font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
        >
          {t('ratings.foot')}
        </button>
      </div>
    </Modal>
  );
}
