// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { usd } from '@/lib/format';
import {
  journalCsv,
  journalStats,
  loadJournal,
  pnlOf,
  rOf,
  saveJournal,
  type JournalEntry,
} from '@/lib/journal';
import { useViralStore } from '@/store/useViralStore';

interface JournalModalProps {
  symbol: string;
  open: boolean;
  onClose: () => void;
}

const input =
  'mt-1 w-full border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs tabular-nums text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm';

/**
 * Trade journal with stats — TradingView has none at any price point.
 * Entries + stats live in localStorage; export reuses the CSV pipeline.
 */
export function JournalModal({ symbol, open, onClose }: JournalModalProps) {
  const t = useTranslations('tools');
  const [entries, setEntries] = useState<JournalEntry[]>(() => loadJournal());
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [size, setSize] = useState(1);
  const [entry, setEntry] = useState(0);
  const [exit, setExit] = useState(0);
  const [stop, setStop] = useState(0);
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');

  const stats = useMemo(() => journalStats(entries), [entries]);

  const commit = (next: JournalEntry[]) => {
    setEntries(next);
    saveJournal(next);
  };

  const add = () => {
    if (!(entry > 0) || !(exit > 0) || !(size > 0)) return;
    const record: JournalEntry = {
      id: `j-${Date.now()}`,
      symbol,
      side,
      size,
      entry,
      exit,
      stop: stop > 0 ? stop : undefined,
      note: note.trim(),
      tags: tags.split(/[,|]/).map((tag) => tag.trim()).filter(Boolean),
      closedAt: Date.now(),
    };
    commit([record, ...entries].slice(0, 500));
    setNote('');
    setTags('');
  };

  const exportCsv = () => {
    const blob = new Blob([journalCsv(entries)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `nodechart-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    useViralStore.getState().bumpTool();
  };

  const stat = (label: string, value: string, tone?: 'bull' | 'bear') => (
    <div className="border border-line/60 bg-surface/30 px-2 py-1.5">
      <p className="text-2xs uppercase tracking-cyber text-faint">{label}</p>
      <p className={cn('font-mono text-xs tabular-nums', tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-fg')}>{value}</p>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={t('journal.title')} subtitle={t('journal.sub')} widthClass="max-w-3xl">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {stat(t('journal.stats.count'), String(stats.count))}
          {stat(t('journal.stats.winRate'), `${Math.round(stats.winRate * 100)}%`, stats.winRate >= 0.5 ? 'bull' : 'bear')}
          {stat(t('journal.stats.pf'), stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2))}
          {stat(t('journal.stats.expectancy'), usd(stats.expectancy), stats.expectancy >= 0 ? 'bull' : 'bear')}
          {stat(t('journal.stats.avgR'), stats.avgR == null ? '—' : `${stats.avgR.toFixed(2)}R`)}
          {stat(t('journal.stats.best'), usd(stats.best), 'bull')}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.side')}
            <select value={side} onChange={(event) => setSide(event.target.value as 'long' | 'short')} className={input}>
              <option value="long">{t('journal.long')}</option>
              <option value="short">{t('journal.short')}</option>
            </select>
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.size')}
            <input type="number" step="0.01" value={size} onChange={(event) => setSize(Number(event.target.value))} className={input} />
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.entryP')}
            <input type="number" step="0.01" value={entry} onChange={(event) => setEntry(Number(event.target.value))} className={input} />
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.exitP')}
            <input type="number" step="0.01" value={exit} onChange={(event) => setExit(Number(event.target.value))} className={input} />
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.stop')}
            <input type="number" step="0.01" value={stop} onChange={(event) => setStop(Number(event.target.value))} className={input} />
          </label>
          <label className="col-span-2 font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.tags')}
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="breakout,news" className={input} />
          </label>
          <label className="col-span-2 font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('journal.note')}
            <input value={note} onChange={(event) => setNote(event.target.value)} className={input} />
          </label>
        </div>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 self-start border border-bull/50 bg-bull/10 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-bull hover:bg-bull/20"
        >
          <Plus size={12} /> {t('journal.save')}
        </button>

        {entries.length === 0 ? (
          <p className="py-4 text-center font-mono text-2xs text-faint">{t('journal.empty')}</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {entries.map((record) => {
              const pnl = pnlOf(record);
              const r = rOf(record);
              return (
                <li key={record.id} className="flex items-center gap-2 border border-line/60 bg-surface/30 px-2 py-1.5 font-mono text-2xs">
                  <span className={cn('uppercase', record.side === 'long' ? 'text-bull' : 'text-bear')}>{record.side}</span>
                  <span className="text-fg">{record.symbol}</span>
                  <span className="text-faint">
                    {record.entry} → {record.exit} · {record.size}
                  </span>
                  {record.tags.length > 0 && <span className="text-secondary">{record.tags.join('|')}</span>}
                  <span className={cn('ml-auto tabular-nums', pnl >= 0 ? 'text-bull' : 'text-bear')}>
                    {usd(pnl)}
                    {r != null ? ` (${r.toFixed(1)}R)` : ''}
                  </span>
                  <button
                    type="button"
                    aria-label={t('journal.del')}
                    onClick={() => commit(entries.filter((item) => item.id !== record.id))}
                    className="text-faint hover:text-bear"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={exportCsv}
            disabled={entries.length === 0}
            className="flex items-center gap-1 border border-line px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted hover:text-fg disabled:opacity-40"
          >
            <Download size={12} /> CSV
          </button>
          <button
            type="button"
            onClick={() => useViralStore.getState().openSupport()}
            className="font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
          >
            {t('journal.foot')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
