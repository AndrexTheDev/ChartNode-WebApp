// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Building2, Droplets, Loader2, ScanSearch, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { auditTokens, isAuditableChain } from '@/api/security';
import type { ChainId } from '@/lib/chains';
import { smartSearch, type SmartSearchResult } from '@/api/search';
import type { SearchHit, SecurityAudit } from '@/api/types';
import { Kbd } from '@/components/ui/Kbd';
import { SecurityBadge } from './SecurityBadge';
import { useRouter } from '@/i18n/navigation';
import { classifyQuery, QUERY_KIND_LABEL } from '@/lib/address';
import { CEX_UNIVERSE, cexToToken } from '@/lib/cex-universe';
import { cn } from '@/lib/cn';
import { compactUsd, usd } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';
import { isCexExchange } from '@/store/useExchangeSelection';
import { useDismiss } from '@/lib/hooks/useDismiss';
import type { Token } from '@/store/types';

type DexHit = Extract<SearchHit, { kind: 'dex' }>;

/**
 * Top-nav Smart Search.
 *
 *  - token names/symbols → instant CEX universe match + live DEX aggregation
 *  - pasted contract address (EVM `0x…` or Solana base58) → direct token lookup
 *  - every DEX result is audited in the background (GoPlus / RugCheck) and the
 *    row flips to a glowing green "Safe" or a red skull "Scam / Honeypot" chip
 */
export function SmartSearch({ className }: { className?: string }) {
  const t = useTranslations('search');
  const router = useRouter();
  const setActiveToken = useAppStore((s) => s.setActiveToken);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SmartSearchResult | null>(null);
  const [cursor, setCursor] = useState(0);
  const [audits, setAudits] = useState<Record<string, SecurityAudit | 'pending' | null>>({});

  const auditsRef = useRef<Record<string, SecurityAudit | 'pending' | null>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const kind = classifyQuery(query);

  /* ------------------------------ debounced fetch ----------------------------- */
  useEffect(() => {
    const trimmed = query.trim();
    // Short queries render no panel at all (derived below) – no state churn.
    if (trimmed.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void smartSearch(trimmed, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setResults(result);
          setCursor(0);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300); // Audit-Vorgabe: ≥300 ms Debounce auf alle Such-API-Calls

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  /* --------------------------- background security audit ---------------------- */
  useEffect(() => {
    if (!results) return;
    let cancelled = false;

    // Group the burst by chain and audit in ONE batched GoPlus call per chain
    // (10 hits ⇒ 1 request instead of 10) – keeps the page under public rate
    // limits; a 429 storm here would park every downstream signal in cooldown.
    const byChain = new Map<string, string[]>();
    for (const hit of results.hits) {
      if (hit.kind !== 'dex') continue;
      const { pair } = hit;
      if (!isAuditableChain(pair.chain)) continue;

      const key = `${pair.chain}:${pair.baseAddress.toLowerCase()}`;
      if (key in auditsRef.current) continue;
      auditsRef.current[key] = 'pending';
      setAudits((prev) => ({ ...prev, [key]: 'pending' }));

      const list = byChain.get(pair.chain) ?? [];
      list.push(pair.baseAddress);
      byChain.set(pair.chain, list);
    }

    for (const [chain, contracts] of byChain) {
      void auditTokens(chain as ChainId, contracts).then((audits) => {
        if (cancelled) return;
        setAudits((prev) => {
          const next = { ...prev };
          for (const contract of contracts) {
            const key = `${chain}:${contract.toLowerCase()}`;
            const audit = audits.get(contract.toLowerCase()) ?? null;
            auditsRef.current[key] = audit;
            next[key] = audit;
          }
          return next;
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [results]);

  // Derived gate: stale results from a previous longer query must not leak
  // into the panel while the input is (nearly) empty.
  const queryActive = query.trim().length >= 2;
  const hits = queryActive ? (results?.hits ?? []) : [];

  /* --------------------------------- selection -------------------------------- */
  function tokenFor(hit: SearchHit): Token | null {
    if (hit.kind === 'cex') {
      const instrument = CEX_UNIVERSE.find((entry) => `${entry.base}/${entry.quote}` === hit.symbol);
      if (!instrument) return null;
      return cexToToken(instrument, isCexExchange(hit.exchange) ? hit.exchange : 'binance');
    }
    const { pair } = hit;
    return {
      id: `dex:${pair.chain}:${pair.baseAddress.toLowerCase()}`,
      symbol: `${pair.baseSymbol}/${pair.quoteSymbol}`,
      base: pair.baseSymbol,
      quote: pair.quoteSymbol,
      venue: 'DEX',
      chain: pair.chain,
      contract: pair.baseAddress,
    };
  }

  function select(hit: SearchHit) {
    const token = tokenFor(hit);
    if (!token) return;
    setActiveToken(token);
    setOpen(false);
    setQuery(token.symbol);
    router.push('/terminal');
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setCursor((c) => (c + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[cursor];
      if (hit) select(hit);
    }
  }

  const showPanel = open && queryActive;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* input */}
      <div
        className={cn(
          'nc-clip-sm flex h-9 items-center gap-2 border border-line bg-surface/70 px-2.5',
          'transition-[border-color,box-shadow] duration-200 hover:border-primary/45 focus-within:border-primary focus-within:shadow-neon-sm',
        )}
      >
        <ScanSearch className="size-3.5 shrink-0 text-primary" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('placeholder')}
          aria-label={t('label')}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="smart-search-listbox"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
        />

        {kind !== 'text' && query.trim().length > 0 && (
          <span className="nc-chip hidden shrink-0 border-accent/50 px-1.5 py-0 text-micro-9 text-accent sm:inline-flex">
            {QUERY_KIND_LABEL[kind]}
          </span>
        )}

        {loading && queryActive ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults(null);
              inputRef.current?.focus();
            }}
            aria-label={t('clear')}
            className="shrink-0 text-faint transition-colors hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : (
          <Kbd className="hidden shrink-0 lg:inline-flex">/</Kbd>
        )}
      </div>

      {/* dropdown */}
      {showPanel && (
        <div
          id="smart-search-listbox"
          role="listbox"
          aria-label={t('label')}
          className={cn(
            'nc-clip absolute left-0 top-[calc(100%+6px)] z-overlay w-[min(92vw,26rem)]',
            'animate-fade-up border border-line bg-elevated/95 shadow-[0_24px_70px_-20px_rgb(0_0_0/0.95)] backdrop-blur-md',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line/70 px-3 py-2">
            <span className="font-mono text-2xs uppercase tracking-cyber text-faint">
              {results ? t('results', { count: hits.length }) : t('scanning')}
            </span>
            <span className="font-mono text-2xs text-faint">{t('providers')}</span>
          </div>

          {hits.length === 0 && !(loading && queryActive) ? (
            <p className="px-3 py-8 text-center font-mono text-2xs uppercase tracking-cyber text-faint">
              {t('empty', { query })}
            </p>
          ) : (
            <ul className="nc-no-scrollbar max-h-[22rem] overflow-y-auto p-1">
              {hits.map((hit, index) => {
                const active = index === cursor;
                return (
                  <li key={hit.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => select(hit)}
                      onMouseEnter={() => setCursor(index)}
                      className={cn(
                        'nc-clip-sm flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors duration-100',
                        active ? 'bg-primary/12' : 'hover:bg-elevated/60',
                      )}
                    >
                      {hit.kind === 'cex' ? (
                        <>
                          <span className="flex size-7 shrink-0 items-center justify-center border border-primary/35 bg-primary/8 text-primary">
                            <Building2 className="size-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs font-bold text-fg">
                              {hit.symbol}
                            </span>
                            <span className="block truncate font-mono text-2xs text-faint">
                              {hit.name}
                            </span>
                          </span>
                          <span className="nc-chip shrink-0 px-1.5 py-0 text-micro-9">{t('cex')}</span>
                        </>
                      ) : (
                        <DexRow hit={hit} audit={auditFor(audits, hit)} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line/70 px-3 py-1.5">
            <span className="flex items-center gap-1 font-mono text-2xs text-faint">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <Kbd>↵</Kbd>
            </span>
            {results && (
              <span className="font-mono text-2xs text-faint">{results.tookMs} ms</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DexRow({ hit, audit }: { hit: DexHit; audit: SecurityAudit | 'pending' | null | undefined }) {
  const t = useTranslations('search');
  const { pair } = hit;

  return (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center border border-secondary/40 bg-secondary/10 text-secondary">
        <Droplets className="size-3.5" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-xs font-bold text-fg">
            {pair.baseSymbol}/{pair.quoteSymbol}
          </span>
          <SecurityBadge audit={audit === 'pending' ? null : audit} pending={audit === 'pending'} />
        </span>
        <span className="block truncate font-mono text-2xs text-faint">
          {pair.chain} · {pair.dex} · {t('liq')} {compactUsd(pair.liquidityUsd)}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-mono text-xs text-primary">{usd(pair.priceUsd)}</span>
        <span className="nc-chip px-1.5 py-0 text-micro-9">{t('dex')}</span>
      </span>
    </>
  );
}

function auditFor(
  audits: Record<string, SecurityAudit | 'pending' | null>,
  hit: DexHit,
): SecurityAudit | 'pending' | null | undefined {
  return audits[`${hit.pair.chain}:${hit.pair.baseAddress.toLowerCase()}`];
}

