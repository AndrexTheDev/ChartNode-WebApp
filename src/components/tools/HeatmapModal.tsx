// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { fetchHeatmap } from '@/api/prometrics';
import { useViralStore } from '@/store/useViralStore';

interface TickerRow {
  symbol: string;
  base: string;
  changePct: number | null;
  quoteVolume: number;
  source: 'gate' | 'okx';
}

interface Rect {
  row: TickerRow;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified-ish treemap: rows of tiles with balanced aspect ratios. */
function treemap(rows: TickerRow[], width: number, height: number): Rect[] {
  const total = rows.reduce((acc, row) => acc + row.quoteVolume, 0);
  if (total <= 0) return [];
  const out: Rect[] = [];
  let y = 0;
  let remaining = [...rows];
  while (remaining.length > 0) {
    const remTotal = remaining.reduce((acc, row) => acc + row.quoteVolume, 0);
    // Take a row of tiles whose combined weight keeps aspect ratios sane.
    const take = Math.max(1, Math.round(Math.sqrt(remaining.length)));
    const chunk = remaining.slice(0, take);
    remaining = remaining.slice(take);
    const chunkWeight = chunk.reduce((acc, row) => acc + row.quoteVolume, 0);
    const rowHeight = (chunkWeight / remTotal) * (height - y);
    let x = 0;
    for (const row of chunk) {
      const w = (row.quoteVolume / chunkWeight) * width;
      out.push({ row, x, y, w, h: rowHeight });
      x += w;
    }
    y += rowHeight;
  }
  return out;
}

function colorFor(change: number | null): string {
  if (change == null) return 'hsl(var(--nc-muted) / 0.16)';
  const clamped = Math.max(-8, Math.min(8, change));
  if (clamped >= 0) {
    const intensity = clamped / 8;
    return `hsl(var(--nc-bull) / ${0.16 + intensity * 0.6})`;
  }
  const intensity = -clamped / 8;
  return `hsl(var(--nc-bear) / ${0.16 + intensity * 0.6})`;
}

interface HeatmapModalProps {
  open: boolean;
  onClose: () => void;
  onPick: (symbol: string) => boolean;
}

/**
 * Market heatmap over the top USDT pairs by quote volume. The shared market
 * data adapter tries Gate first and falls back to OKX, with bounded fetch,
 * cache, and cancellation. Tile area = volume, colour = 24h change.
 */
export function HeatmapModal({ open, onClose, onPick }: HeatmapModalProps) {
  const t = useTranslations('tools');
  const [rows, setRows] = useState<TickerRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const controller = new AbortController();

    void fetchHeatmap(controller.signal, 64)
      .then((tiles) => {
        if (!alive) return;
        const parsed: TickerRow[] = tiles.map((tile) => ({
          symbol: tile.pair.replace('/', ''),
          base: tile.pair.split('/')[0] ?? tile.pair,
          changePct: tile.changePct,
          quoteVolume: tile.quoteVolumeUsd,
          source: tile.source,
        }));
        if (parsed.length === 0) {
          setError(true);
          return;
        }
        setError(false);
        setRows(parsed);
      })
      .catch(() => alive && setError(true));

    return () => {
      alive = false;
      controller.abort();
    };
  }, [open]);

  const rects = useMemo(() => (rows ? treemap(rows, 100, 100) : []), [rows]);

  return (
    <Modal open={open} onClose={onClose} title={t('heatmap.title')} subtitle={t('heatmap.sub')} widthClass="max-w-5xl">
      <div className="flex flex-col gap-3">
        {error && <p className="font-mono text-2xs text-bear">{t('heatmap.err')}</p>}
        {!error && !rows && <p className="font-mono text-2xs text-faint">{t('heatmap.loading')}</p>}
        {rows && (
          <div className="relative aspect-[16/9] w-full overflow-hidden border border-line bg-surface/40">
            {rects.map((rect) => (
              <button
                key={rect.row.symbol}
                type="button"
                title={`${rect.row.base}/USDT · ${rect.row.changePct == null ? '—' : `${rect.row.changePct.toFixed(2)}%`}`}
                onClick={() => {
                  if (onPick(`${rect.row.base}/USDT`)) onClose();
                }}
                className="absolute flex flex-col items-center justify-center border border-black/40 font-mono leading-tight transition-transform hover:z-10 hover:scale-[1.03]"
                style={{
                  left: `${rect.x}%`,
                  top: `${rect.y}%`,
                  width: `${rect.w}%`,
                  height: `${rect.h}%`,
                  background: colorFor(rect.row.changePct),
                }}
              >
                {rect.w > 7 && rect.h > 9 && (
                  <>
                    <span className="text-micro-10 font-bold text-fg">{rect.row.base}</span>
                    <span className={`text-micro-9 ${rect.row.changePct == null ? 'text-faint' : rect.row.changePct >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {rect.row.changePct == null
                        ? '—'
                        : `${rect.row.changePct >= 0 ? '+' : ''}${rect.row.changePct.toFixed(1)}%`}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-2xs text-faint">{t('heatmap.click')}</p>
          {rows?.[0] && (
            <span className="font-mono text-2xs text-faint">
              {t('screener.source', { venue: rows[0].source.toUpperCase() })}
            </span>
          )}
          <button
            type="button"
            onClick={() => useViralStore.getState().openSupport()}
            className="font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
          >
            {t('heatmap.foot')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
