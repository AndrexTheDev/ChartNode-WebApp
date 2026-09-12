/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Wave-4 trade journal — TradingView has no native journal at any price
 * point. Entries live in localStorage, stats are computed client-side and
 * exports go through the same CSV pipeline as the screener.
 */
export interface JournalEntry {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entry: number;
  exit: number;
  /** Optional stop used to derive R-multiples. */
  stop?: number;
  note: string;
  tags: string[];
  closedAt: number;
}

export interface JournalStats {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  avgR: number | null;
  best: number;
  worst: number;
  byTag: Array<{ tag: string; count: number; pnl: number }>;
}

const KEY = 'nc-journal-v1';

export function pnlOf(entry: JournalEntry): number {
  const dir = entry.side === 'long' ? 1 : -1;
  return (entry.exit - entry.entry) * entry.size * dir;
}

export function rOf(entry: JournalEntry): number | null {
  if (!entry.stop || entry.stop === entry.entry) return null;
  const risk = Math.abs(entry.entry - entry.stop) * entry.size;
  if (risk <= 0) return null;
  return pnlOf(entry) / risk;
}

export function loadJournal(): JournalEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveJournal(entries: JournalEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 500)));
  } catch {
    /* storage full / private mode — journal stays in-memory */
  }
}

export function journalStats(entries: JournalEntry[]): JournalStats {
  const pnls = entries.map(pnlOf);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const rs = entries.map(rOf).filter((r): r is number => r != null);
  const tags = new Map<string, { count: number; pnl: number }>();
  entries.forEach((entry, i) => {
    for (const tag of entry.tags.length ? entry.tags : ['—']) {
      const bucket = tags.get(tag) ?? { count: 0, pnl: 0 };
      bucket.count += 1;
      bucket.pnl += pnls[i]!;
      tags.set(tag, bucket);
    }
  });
  return {
    count: entries.length,
    wins: wins.length,
    losses: losses.length,
    winRate: entries.length ? wins.length / entries.length : 0,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    expectancy: entries.length ? pnls.reduce((a, b) => a + b, 0) / entries.length : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    best: pnls.length ? Math.max(...pnls) : 0,
    worst: pnls.length ? Math.min(...pnls) : 0,
    byTag: [...tags.entries()].map(([tag, value]) => ({ tag, ...value })).sort((a, b) => b.pnl - a.pnl),
  };
}

export function journalCsv(entries: JournalEntry[]): string {
  const head = 'symbol,side,size,entry,exit,stop,pnl,r,tags,note,closedAt';
  const rows = entries.map((entry) =>
    [
      entry.symbol,
      entry.side,
      entry.size,
      entry.entry,
      entry.exit,
      entry.stop ?? '',
      pnlOf(entry).toFixed(2),
      rOf(entry)?.toFixed(2) ?? '',
      `"${entry.tags.join('|')}"`,
      `"${entry.note.replace(/"/g, '""')}"`,
      new Date(entry.closedAt).toISOString(),
    ].join(','),
  );
  return [head, ...rows].join('\n');
}
