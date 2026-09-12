// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { fetchScreenerRows, type ScreenerRow } from '@/api/prometrics';
import { cn } from '@/lib/cn';
import { TOKEN_INDEX } from '@/lib/constants';
import { downloadCsv } from '@/lib/export';
import { compactUsd, pct, usd } from '@/lib/format';
import { selectActiveToken, useAppStore } from '@/store/useAppStore';
import type { Token } from '@/store/types';

/**
 * Market screener over every quoted Gate USDT pair (~2 000 rows) – sortable,
 * filterable, searchable, CSV-exportable, and every row opens a real chart
 * (ad-hoc symbols included). TradingView meter-gates refresh and export;
 * NodeChart does neither.
 */

type SortKey = 'quoteVolumeUsd' | 'changePct' | 'rangePos' | 'last';
type FilterId = 'all' | 'gainers' | 'losers' | 'whales' | 'nearHigh';

const FILTERS: { id: FilterId; test: (row: ScreenerRow) => boolean }[] = [
  { id: 'all', test: () => true },
  { id: 'gainers', test: (row) => row.changePct > 3 },
  { id: 'losers', test: (row) => row.changePct < -3 },
  { id: 'whales', test: (row) => row.quoteVolumeUsd > 25_000_000 },
  { id: 'nearHigh', test: (row) => (row.rangePos ?? 0) > 0.9 },
];

export function ScreenerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('tools');
  const setActiveToken = useAppStore((s) => s.setActiveToken);
  const activeToken = useAppStore(selectActiveToken);
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolumeUsd');
  const [desc, setDesc] = useState(true);
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      fetchScreenerRows().then((data) => {
        if (alive && data.length > 0) setRows(data);
      });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  const view = useMemo(() => {
    const test = FILTERS.find((entry) => entry.id === filter)?.test ?? (() => true);
    const q = query.trim().toUpperCase();
    return rows
      .filter(test)
      .filter((row) => (q ? row.pair.includes(q) : true))
      .sort((a, b) => {
        const av = sortKey === 'rangePos' ? (a.rangePos ?? -1) : a[sortKey];
        const bv = sortKey === 'rangePos' ? (b.rangePos ?? -1) : b[sortKey];
        return desc ? bv - av : av - bv;
      })
      .slice(0, 150);
  }, [rows, filter, query, sortKey, desc]);

  function openChart(row: ScreenerRow): void {
    const known = Object.values(TOKEN_INDEX).find((token) => token.symbol === row.pair && token.venue === 'CEX');
    const token: Token =
      known ?? {
        id: `cex:screener:${row.base}USDT`,
        symbol: row.pair,
        base: row.base,
        quote: 'USDT',
        venue: 'CEX',
      };
    setActiveToken(token);
    onClose();
  }

  const header = (key: SortKey, label: string, right = true) => (
    <th
      className={cn('cursor-pointer px-2 py-1.5 select-none', right ? 'text-right' : 'text-left')}
      onClick={() => {
        if (sortKey === key) setDesc(!desc);
        else {
          setSortKey(key);
          setDesc(true);
        }
      }}
    >
      {label}
      {sortKey === key ? (desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-4xl" title={t('screener.title')} subtitle={t('screener.subtitle', { n: rows.length })}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            className={cn(
              'nc-clip-sm inline-flex h-7 items-center border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors',
              filter === entry.id
                ? 'border-secondary/70 bg-secondary/12 text-secondary'
                : 'border-line bg-surface/50 text-muted hover:text-fg',
            )}
          >
            {t(`screener.filters.${entry.id}`)}
          </button>
        ))}
        <label className="ml-auto flex h-7 items-center gap-1.5 border border-line bg-surface/50 px-2">
          <Search className="size-3 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('screener.search')}
            aria-label={t('screener.search')}
            className="w-28 bg-transparent font-mono text-2xs uppercase text-fg outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              'nodechart-screener.csv',
              ['pair', 'last', 'change_pct', 'volume_usd', 'high_24h', 'low_24h'],
              view.map((row) => [row.pair, row.last, row.changePct.toFixed(2), row.quoteVolumeUsd.toFixed(0), row.high24h ?? '', row.low24h ?? '']),
            )
          }
          className="nc-clip-sm inline-flex h-7 items-center gap-1 border border-line px-2 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-secondary/60 hover:text-secondary"
        >
          <Download className="size-3" aria-hidden />
          CSV
        </button>
      </div>

      <div className="max-h-[52vh] overflow-y-auto border border-line/70">
        <table className="w-full font-mono text-2xs">
          <thead className="sticky top-0 z-10 bg-surface/95 text-faint">
            <tr>
              {header('last', t('screener.pair'), false)}
              {header('last', t('screener.last'))}
              {header('changePct', t('screener.chg'))}
              {header('quoteVolumeUsd', t('screener.vol'))}
              {header('rangePos', t('screener.range'))}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr
                key={row.pair}
                onClick={() => openChart(row)}
                className={cn(
                  'cursor-pointer border-t border-line/40 transition-colors hover:bg-secondary/8',
                  row.pair === activeToken.symbol && 'bg-secondary/10',
                )}
              >
                <td className="px-2 py-1 font-bold text-fg">{row.pair}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted">{usd(row.last)}</td>
                <td className={cn('px-2 py-1 text-right tabular-nums', row.changePct >= 0 ? 'text-bull' : 'text-bear')}>{pct(row.changePct, 2)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted">{compactUsd(row.quoteVolumeUsd)}</td>
                <td className="px-2 py-1">
                  <span className="relative ml-auto block h-1.5 w-16 bg-line/50">
                    <span
                      className="absolute top-0 h-full w-0.5 bg-secondary"
                      style={{ left: `${Math.min(100, Math.max(0, (row.rangePos ?? 0.5) * 100)).toFixed(0)}%` }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-2xs text-faint">{t('screener.hint')}</p>
    </Modal>
  );
}
