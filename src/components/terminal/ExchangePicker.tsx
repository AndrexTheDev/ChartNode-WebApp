// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useMemo } from 'react';
import { Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { probeAllExchanges } from '@/api/exchangeProbe';
import { cn } from '@/lib/cn';
import { EXCHANGE_META } from '@/lib/exchanges';
import { rankExchanges, type RankedExchange } from '@/lib/exchange-select';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { StatusLed } from '@/components/ui/StatusLed';
import { useExchangeStore, type Reachability } from '@/store/useExchangeStore';
import type { Timeframe } from '@/store/types';
import type { ExchangeId } from '@/websockets/types';

interface ExchangePickerProps {
  symbol: string;
  timeframe: Timeframe;
  /** Venue currently feeding the chart. */
  selected: ExchangeId;
  /** True when the token's own venue had to be replaced (region / pair). */
  rerouted?: boolean;
  className?: string;
}

const LED_TONE: Record<Reachability, 'ok' | 'warn' | 'error' | 'idle'> = {
  ok: 'ok',
  slow: 'warn',
  blocked: 'error',
  error: 'error',
  probing: 'idle',
  unknown: 'idle',
};

/**
 * Region-aware venue picker.
 *
 * Shows which exchange is feeding the chart, how fast it answered the last
 * probe, and why an alternative was chosen. Picking a venue stores it per
 * symbol; "Auto" hands the decision back to the measured ranking.
 */
export function ExchangePicker({ symbol, timeframe, selected, rerouted, className }: ExchangePickerProps) {
  const tx = useTranslations('exchanges');

  const country = useExchangeStore((s) => s.country);
  const countrySource = useExchangeStore((s) => s.countrySource);
  const reach = useExchangeStore((s) => s.reach);
  const unsupported = useExchangeStore((s) => s.unsupported);
  const preferred = useExchangeStore((s) => s.preferred);
  const probing = useExchangeStore((s) => s.probing);
  const setPreferred = useExchangeStore((s) => s.setPreferred);

  const ranked = useMemo(
    () => rankExchanges({ symbol, timeframe, country, reach, unsupported, preferred }),
    [symbol, timeframe, country, reach, unsupported, preferred],
  );

  const manual = preferred[symbol];
  const meta = EXCHANGE_META[selected];
  const selectedReach = reach[selected];
  const status: Reachability = probing && !selectedReach ? 'probing' : (selectedReach?.status ?? 'unknown');

  function hintFor(entry: RankedExchange): string {
    const parts: string[] = [];
    const reachability = entry.reach?.status ?? 'unknown';
    parts.push(tx(`status.${reachability}`));
    if (entry.reach?.ms != null) parts.push(`${entry.reach.ms} ms`);
    if (!entry.supportedTimeframe) parts.push(tx('flags.unsupportedTimeframe', { timeframe }));
    else if (!entry.listsPair) parts.push(tx('flags.unlisted'));
    else if (entry.restricted) parts.push(tx('flags.restricted'));
    return parts.join(' · ');
  }

  const items: DropdownItem[] = [
    {
      id: 'auto',
      label: tx('auto'),
      hint: tx('autoHint'),
      selected: !manual,
      onSelect: () => setPreferred(symbol, null),
    },
    ...ranked.map((entry) => ({
      id: entry.id,
      label: EXCHANGE_META[entry.id].name,
      hint: hintFor(entry),
      badge: entry.reach?.ms != null ? `${entry.reach.ms}ms` : undefined,
      selected: entry.id === selected,
      onSelect: () => setPreferred(symbol, entry.id),
    })),
    {
      id: 'reprobe',
      label: tx('reprobe'),
      hint: tx('reprobeHint', { count: ranked.length }),
      onSelect: () => void probeAllExchanges({ symbol, timeframe }),
    },
  ];

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Dropdown
        items={items}
        align="start"
        widthClass="w-[19rem]"
        triggerLabel={tx('label')}
        menuLabel={country ? tx('region', { country }) : tx('regionUnknown')}
        title={
          rerouted
            ? tx('rerouted')
            : (meta?.note ?? tx('label')) + (countrySource ? ` · ${tx(`regionSource.${countrySource}`)}` : '')
        }
        triggerIcon={<StatusLed tone={LED_TONE[status]} pulse={status === 'probing'} />}
        triggerText={
          <span className="flex items-center gap-1.5">
            <span className="font-display text-2xs font-bold uppercase tracking-cyber">
              {meta?.name ?? selected}
            </span>
            {manual && (
              <span
                className="nc-chip shrink-0 border-accent/50 px-1 py-0 text-micro-9 text-accent"
                title={tx('manualHint')}
              >
                {tx('manualShort')}
              </span>
            )}
            {selectedReach?.ms != null && (
              <span className="font-mono text-micro-9 tabular-nums text-faint">{selectedReach.ms}ms</span>
            )}
          </span>
        }
      />
      {rerouted && (
        <span className="nc-chip hidden shrink-0 border-warning/50 text-warning lg:inline-flex" title={tx('rerouted')}>
          <Radar className="size-3" aria-hidden />
          {tx('reroutedShort')}
        </span>
      )}
    </div>
  );
}
