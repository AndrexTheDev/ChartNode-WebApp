// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
const USD_SMALL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 4,
});

const USD_BIG = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

/** Price formatting: tiny prices keep significant digits, big prices 2 dp. */
export function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.abs(value) < 1 ? USD_SMALL.format(value) : USD_BIG.format(value);
}

/** `$1.2M`, `$845K` – for notionals and volumes. */
export function compactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${COMPACT.format(value)}`;
}

export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return COMPACT.format(value);
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function clockTime(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Decimal places a price axis should show, derived from the price magnitude.
 * Matches what the exchanges print, so chart, order book and ticker agree:
 * 78 126.23 → 2, 145.32 → 2, 42.567 → 3, 0.4212 → 4, 0.00001234 → 8.
 */
export function pricePrecision(price: number | null | undefined): number {
  const value = Math.abs(price ?? 0);
  if (!Number.isFinite(value) || value === 0) return 2;
  if (value >= 100) return 2;
  if (value >= 10) return 3;
  if (value >= 0.1) return 4;
  if (value >= 0.01) return 5;
  if (value >= 0.001) return 6;
  if (value >= 0.0001) return 7;
  return 8;
}

/** Matching `minMove` for lightweight-charts `priceFormat`. */
export function minMoveFor(precision: number): number {
  return 1 / 10 ** precision;
}
