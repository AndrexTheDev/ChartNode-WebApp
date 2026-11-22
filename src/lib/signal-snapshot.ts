// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { quotaSnapshot } from '@/api/http';
import {
  bundleSignals,
  fundingDivergence,
  mempoolStress,
  oiRegime,
  volRegime,
  type DerivedSignal,
} from '@/lib/derived-signals';
import { realizedVolPct } from '@/lib/premium';
import type { Candle } from '@/websockets/types';
import type { OnChainStore } from '@/store/useOnChainStore';

/**
 * Signal-Snapshot – ein exportierbares Abbild aller lokal berechneten Signale.
 *
 * Warum das existiert: Wer Signale in einem Charting-Tool nur *sieht*, kann
 * sie nicht prüfen. Der Snapshot enthält deshalb jeden Wert mit
 * Herkunftskennzeichnung (`measured` / `derived` / `proxy`), den Zeitstempel
 * der zugrunde liegenden Reads und den Quota-Stand. Alles darin ist lokal
 * abgeleitet – der Export löst **keinen** Netzwerkaufruf aus.
 *
 * Die Exportform ist bewusst flach (eine Zeile pro Signal), damit sie sich in
 * Excel/Sheets/`jq` ohne Schema-Kenntnis öffnen lässt.
 */

export type SignalOrigin = 'measured' | 'derived' | 'proxy';

export interface SignalRow {
  group: string;
  key: string;
  label: string;
  value: number | null;
  unit: string;
  origin: SignalOrigin;
  /** Rohdaten-Zeitstempel der Quelle (ms), null wenn unbekannt. */
  asOf: number | null;
  /** Kurze Erklärung, was der Wert bedeutet – keine Prognose. */
  note: string;
}

export interface SignalSnapshot {
  generatedAt: string;
  symbol: string;
  base: string;
  rows: SignalRow[];
  quota: Array<{ key: string; label: string; used: number; max: number | null; windowMs: number | null }>;
  /** Signale, die ohne Daten nicht berechnet werden konnten. */
  missing: string[];
}

export function buildSignalSnapshot(input: {
  symbol: string;
  base: string;
  candles: Candle[];
  onchain: Pick<OnChainStore, 'btc' | 'defi' | 'forensics' | 'hl' | 'liq'>;
}): SignalSnapshot {
  const { symbol, base, candles, onchain } = input;
  const rows: SignalRow[] = [];
  const missing: string[] = [];

  const push = (row: SignalRow) => {
    if (row.value == null) {
      missing.push(`${row.group}.${row.key}`);
      return;
    }
    rows.push(row);
  };

  /* ------------------------------- order book ------------------------------ */
  if (onchain.liq) {
    const book = onchain.liq;
    push({
      group: 'book',
      key: 'mid',
      label: `${book.coin} mid`,
      value: book.spot,
      unit: 'price',
      origin: 'measured',
      asOf: book.fetchedAt,
      note: 'Mid aus dem L2-Buch (Hyperliquid).',
    });
    push({
      group: 'book',
      key: 'support',
      label: 'nearest bid wall',
      value: book.nearestSupport?.price ?? null,
      unit: 'price',
      origin: 'measured',
      asOf: book.fetchedAt,
      note: 'Nächste gemessene BID-Wand – Liquidität, keine Prognose.',
    });
    push({
      group: 'book',
      key: 'resistance',
      label: 'nearest ask wall',
      value: book.nearestResistance?.price ?? null,
      unit: 'price',
      origin: 'measured',
      asOf: book.fetchedAt,
      note: 'Nächste gemessene ASK-Wand.',
    });
    const strongest = book.walls.reduce<(typeof book.walls)[number] | null>(
      (best, wall) => (best == null || wall.intensity > best.intensity ? wall : best),
      null,
    );
    push({
      group: 'book',
      key: 'strongestWall',
      label: 'strongest wall',
      value: strongest?.notionalUsd ?? null,
      unit: 'usd',
      origin: 'measured',
      asOf: book.fetchedAt,
      note: 'Größter kumulierter Level im ±8 %-Fenster.',
    });
  } else {
    missing.push('book');
  }

  /* ----------------------------- hyperliquid ------------------------------ */
  const hl = onchain.hl;
  if (hl) {
    const market = hl.active;
    push({
      group: 'perp',
      key: 'fundingAnnual',
      label: `${market?.coin ?? base} funding`,
      value: market?.fundingAnnualPct ?? null,
      unit: '%/a',
      origin: 'measured',
      asOf: hl.fetchedAt,
      note: 'Stündliche Rate annualisiert; positiv = Longs zahlen.',
    });
    push({
      group: 'perp',
      key: 'openInterest',
      label: 'open interest',
      value: hl.totalOpenInterestUsd ?? null,
      unit: 'usd',
      origin: 'measured',
      asOf: hl.fetchedAt,
      note: 'Summe über alle Hyperliquid-Perps.',
    });
    push({
      group: 'perp',
      key: 'positiveFundingShare',
      label: 'markets with positive funding',
      value: hl.positiveFundingPct,
      unit: '%',
      origin: 'measured',
      asOf: hl.fetchedAt,
      note: 'Breite der Funding-Positionierung über alle Perps.',
    });
    push({
      group: 'perp',
      key: 'premium',
      label: `${market?.coin ?? base} mark–oracle premium`,
      value: market?.premiumPct ?? null,
      unit: '%',
      origin: 'measured',
      asOf: hl.fetchedAt,
      note: 'Markpreis über/unter Oracle – Index-Abweichung.',
    });
  } else {
    missing.push('perp');
  }

  /* --------------------------- derived signals ---------------------------- */
  const btc = onchain.btc;
  const defi = onchain.defi;
  const forensics = onchain.forensics;

  // Preisänderung über die letzten 24 Kerzen – Grundlage für Funding- und
  // OI-Divergenz. Bewusst dieselbe Spanne wie im On-Chain-Panel.
  const window = candles.slice(-24);
  const firstClose = window[0]?.c ?? null;
  const lastClose = window[window.length - 1]?.c ?? null;
  const priceChangePct =
    firstClose != null && lastClose != null && firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : null;

  const signals: Array<{ key: string; label: string; signal: DerivedSignal; note: string }> = [
    {
      key: 'mempoolStress',
      label: 'mempool stress',
      signal: mempoolStress(btc ?? null),
      note: '0..100 aus Backlog (60 %) + Fee-Multiple (40 %); ≥70 = Stau.',
    },
    {
      key: 'fundingDivergence',
      label: 'funding vs price',
      signal: fundingDivergence(
        hl?.active || hl
          ? {
              fundingAnnualPct: hl?.active?.fundingAnnualPct ?? null,
              priceChangePct,
              openInterestUsd: hl?.active?.openInterestUsd ?? hl?.totalOpenInterestUsd ?? null,
            }
          : null,
      ),
      note: 'Funding hoch + Preis fällt ⇒ Long-Squeeze-Risiko.',
    },
    {
      key: 'oiRegime',
      label: 'OI/price regime',
      signal: oiRegime(
        hl?.active
          ? {
              // Die API liefert den OI-Stand, nicht seine Änderung; die
              // Änderung wäre ein zweiter Read. Deshalb wird hier ehrlich
              // `null` übergeben, statt eine Schein-Änderung zu erfinden.
              openInterestChangePct: null,
              priceChangePct,
            }
          : null,
      ),
      note: 'Vier Quadranten aus OI- und Preisänderung (braucht einen OI-Zeitverlauf).',
    },
    {
      key: 'volRegime',
      label: 'realised vol regime',
      signal: volRegime({ candles, realizedVolPct: realizedVolPct(candles) }),
      note: 'Perzentil der 20-Bar-Realisierte-Volatilität.',
    },
  ];

  for (const entry of signals) {
    push({
      group: 'derived',
      key: entry.key,
      label: entry.label,
      value: entry.signal.value,
      unit: 'score',
      origin: 'derived',
      asOf: Date.now(),
      note: entry.note,
    });
  }

  const bundle = bundleSignals(signals.map((entry) => entry.signal));
  push({
    group: 'derived',
    key: 'bundle',
    label: 'composite bias',
    value: bundle.composite,
    unit: 'score',
    origin: 'derived',
    asOf: Date.now(),
    note: `Konfidenzgewichteter Composite (−100..100); ${bundle.bullCount} bull / ${bundle.bearCount} bear.`,
  });

  // Rohkontext, der nirgends sonst im Export landet.
  if (defi) {
    push({
      group: 'context',
      key: 'stablecoinSupply',
      label: 'stablecoin supply',
      value: defi.stablecoinSupplyUsd,
      unit: 'usd',
      origin: 'measured',
      asOf: null,
      note: 'DeFiLlama-Stablecoin-Supply (gemessen).',
    });
  }
  if (forensics) {
    push({
      group: 'context',
      key: 'tokenRisk',
      label: 'token risk flags',
      // Top-10-Holder-Konzentration ist der einzige vergleichbare 0..100-Wert
      // im Forensik-Paket; Honeypot/Mintable sind boolesch und werden in der
      // Notiz mitgeführt statt als Zahl verfälscht.
      value: forensics.top10Pct,
      unit: '%',
      origin: 'measured',
      asOf: null,
      note: `Top-10-Holder${forensics.isHoneypot ? ' · Honeypot-Flag' : ''}${forensics.isMintable ? ' · mintable' : ''}; null = kein Contract (CEX).`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    symbol,
    base,
    rows,
    quota: quotaSnapshot().map((entry) => ({
      key: entry.key,
      label: entry.label,
      used: entry.weightUsed ?? entry.used,
      max: entry.weightMax ?? entry.max,
      windowMs: entry.windowMs,
    })),
    missing,
  };
}

/** CSV mit stabiler Spaltenreihenfolge – Semikolon vermeidet Excel-DE-Bruch. */
export function snapshotToCsv(snapshot: SignalSnapshot): string {
  const header = ['group', 'key', 'label', 'value', 'unit', 'origin', 'as_of', 'note'];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [header.join(';')];
  for (const row of snapshot.rows) {
    lines.push(
      [
        row.group,
        row.key,
        escape(row.label),
        row.value == null ? '' : String(row.value),
        row.unit,
        row.origin,
        row.asOf == null ? '' : new Date(row.asOf).toISOString(),
        escape(row.note),
      ].join(';'),
    );
  }
  return lines.join('\n');
}

/**
 * Browser-Download ohne Server: Blob + temporärer Anker. Bewusst ohne
 * `URL.revokeObjectURL`-Verzögerungstrick – der Klick ist synchron.
 */
export function downloadSnapshot(snapshot: SignalSnapshot, format: 'json' | 'csv'): void {
  const content = format === 'json' ? JSON.stringify(snapshot, null, 2) : snapshotToCsv(snapshot);
  const mime = format === 'json' ? 'application/json' : 'text/csv';
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = snapshot.generatedAt.replace(/[:.]/g, '-').slice(0, 19);
  anchor.href = url;
  anchor.download = `nodechart-signals-${snapshot.base || 'market'}-${stamp}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Erst nach dem Klick freigeben, sonst bricht Safari den Download ab.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
