// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * Client-side CSV export (TradingView charges for this). Builds the file in
 * memory and hands it to a temporary anchor – no backend, no blob URL leak.
 */

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  if (typeof document === 'undefined') return;
  const body = [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[^\w.\-]+/g, '_');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
