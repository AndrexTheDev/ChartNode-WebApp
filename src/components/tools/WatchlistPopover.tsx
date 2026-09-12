// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { StarOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fetchScreenerRows, type ScreenerRow } from '@/api/prometrics';
import { cn } from '@/lib/cn';
import { TOKEN_INDEX } from '@/lib/constants';
import { pct, usd } from '@/lib/format';
import { selectActiveToken, selectWatchlist, useAppStore } from '@/store/useAppStore';

/**
 * Live watchlist quotes – TradingView caps free watchlists at 1 list / 30
 * symbols; this one is unlimited and priced from the cached ticker sweep
 * (the same response the breadth + screener features use: zero extra calls).
 */

export function WatchlistPopover({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('tools');
  const watchlist = useAppStore(selectWatchlist);
  const activeToken = useAppStore(selectActiveToken);
  const setActiveToken = useAppStore((s) => s.setActiveToken);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);
  const [rows, setRows] = useState<ScreenerRow[]>([]);

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

  const quoteByBase = useMemo(() => {
    const map = new Map<string, ScreenerRow>();
    for (const row of rows) map.set(row.base, row);
    return map;
  }, [rows]);

  if (!open) return null;

  return (
    <div className="nc-clip absolute right-0 top-full z-40 mt-2 w-72 border border-secondary/40 bg-bg/97 shadow-volt backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-line/70 px-2.5 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-cyber text-secondary">{t('watch.title')}</span>
        <span className="font-mono text-2xs tabular-nums text-faint">{watchlist.length}</span>
      </header>
      <ul className="max-h-80 overflow-y-auto">
        {watchlist.length === 0 && <li className="px-2.5 py-3 text-center font-mono text-2xs text-faint">{t('watch.empty')}</li>}
        {watchlist.map((tokenId) => {
          const token = TOKEN_INDEX[tokenId];
          if (!token) return null;
          const quote = quoteByBase.get(token.base);
          return (
            <li key={tokenId}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActiveToken(token);
                  onClose();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setActiveToken(token);
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border-b border-line/40 px-2.5 py-1.5 transition-colors hover:bg-secondary/8',
                  token.id === activeToken.id && 'bg-secondary/10',
                )}
              >
                <span className="w-20 truncate font-mono text-2xs font-bold text-fg">{token.symbol}</span>
                <span className="ml-auto font-mono text-2xs tabular-nums text-muted">{quote ? usd(quote.last) : '—'}</span>
                <span className={cn('w-14 text-right font-mono text-2xs tabular-nums', (quote?.changePct ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>
                  {quote ? pct(quote.changePct, 2) : '—'}
                </span>
                <button
                  type="button"
                  aria-label={t('watch.remove')}
                  title={t('watch.remove')}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleWatchlist(tokenId);
                  }}
                  className="text-faint transition-colors hover:text-bear"
                >
                  <StarOff className="size-3" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-2.5 py-1.5 font-mono text-2xs text-faint">{t('watch.hint')}</p>
    </div>
  );
}
