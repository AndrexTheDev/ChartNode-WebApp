// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Gauge, ShieldCheck } from 'lucide-react';
import { quotaSnapshot } from '@/api/http';
import type { QuotaUsage } from '@/api/quota';
import { cn } from '@/lib/cn';

/**
 * Free-Tier-Leiste: zeigt live, wie viel der lokal budgetierten keyless
 * Quellen (GeckoTerminal, CoinGecko, GoPlus, Hyperliquid, RPCs) im aktuellen
 * Minutenfenster verbraucht sind – reine Zähler aus `http.ts`, keine
 * Provider-Daten, kein zusätzlicher Netzwerkaufruf.
 *
 * Warum das ein Feature ist: Genau diese Grenzen sind der Grund, warum
 * Premium-Tools Quota hinter Abos verstecken. Sichtbar zu machen, wann die App
 * bewusst auf Cache/Fallback umschaltet, ist ehrlicher als stilles Drosseln –
 * und es zeigt, dass NodeChart auch im Free-Modus planbar bleibt.
 *
 * Die Leiste pollt nur den In-Memory-Zähler alle 2 s; das ist keine
 * Netzwerklast und endet mit dem Panel.
 */

const POLL_MS = 2_000;

function barTone(used: number, max: number): string {
  const ratio = max > 0 ? used / max : 0;
  if (ratio >= 0.9) return 'bg-bear';
  if (ratio >= 0.6) return 'bg-warning';
  return 'bg-primary/80';
}

export function QuotaBar({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('quota');
  const [usage, setUsage] = useState<QuotaUsage[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setUsage(quotaSnapshot());
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const rows = compact ? usage.slice(0, 4) : usage;

  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-cyber text-faint">
        <ShieldCheck className="size-3 text-primary" aria-hidden />
        {t('idle')}
      </p>
    );
  }

  return (
    <div data-testid="quota-bar" className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 font-mono text-micro-9 uppercase tracking-cyber text-faint">
        <Gauge className="size-3 text-primary" aria-hidden />
        {t('title')}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((entry) => {
          /*
           * Zwei Limits pro Provider: Request-Zähler (`max`) und – bei
           * Binance/Hyperliquid & Co. – zusätzlich Weight. Angezeigt wird das
           * jeweils *engere* Limit: nur so sieht man wirklich, wie nah man an
           * der Drosselung ist. Die Zahl rechts nennt immer den Zähler, der
           * auch den Balken füllt.
           */
          const requestUsed = entry.used;
          const requestMax = entry.max;
          const weightUsed = entry.weightUsed ?? 0;
          const weightMax = entry.weightMax ?? null;
          const requestRatio = requestMax != null && requestMax > 0 ? requestUsed / requestMax : 0;
          const weightRatio = weightMax != null && weightMax > 0 ? weightUsed / weightMax : 0;
          const useWeight = weightRatio > requestRatio;
          const used = useWeight ? weightUsed : requestUsed;
          const limit = useWeight ? (weightMax ?? 0) : (requestMax ?? 0);
          const pctUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
          return (
            <li key={entry.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate font-mono text-micro-9 uppercase text-muted" title={entry.key}>
                {entry.label}
              </span>
              <span className="h-1.5 min-w-0 flex-1 bg-line/50">
                <span className={cn('block h-full', barTone(used, limit))} style={{ width: `${Math.max(3, pctUsed)}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-micro-9 tabular-nums text-fg">
                {Math.round(used)}/{Math.round(limit)}
                {useWeight && <span className="text-faint">w</span>}
              </span>
              {entry.resetInMs != null && (
                <span className="w-9 shrink-0 text-right font-mono text-micro-9 tabular-nums text-faint">
                  {Math.ceil(entry.resetInMs / 1000)}s
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="font-mono text-micro-9 text-faint">{t('hint')}</p>
    </div>
  );
}
