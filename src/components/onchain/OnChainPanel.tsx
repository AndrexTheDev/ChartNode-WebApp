// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect } from 'react';
import {
  Bitcoin,
  Flame,
  Fuel,
  Landmark,
  Layers,
  Microscope,
  RefreshCw,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusLed } from '@/components/ui/StatusLed';
import { cn } from '@/lib/cn';
import { clockTime, compact, compactUsd, pct } from '@/lib/format';
import { selectActiveToken, useAppStore } from '@/store/useAppStore';
import { selectOnChainOpen, useOnChainStore, type SignalGroup } from '@/store/useOnChainStore';
import { TRACKED_EVM_CHAINS, type EvmChainSignals } from '@/api/onchain';

/**
 * Right-docked panel with live, keyless on-chain signals:
 *
 *   BTC mempool/fees/difficulty (mempool.space) · EVM gas+activity (Blockscout)
 *   Solana TPS (public RPC) · DeFi TVL (DeFiLlama) · DEX heat (GeckoTerminal +
 *   DexScreener boosts) · token forensics for the active DEX token (GoPlus).
 *
 * Fetching is driven by `tick()` on a 15 s interval while the panel is open –
 * a closed panel performs zero network requests. Every group fails soft:
 * unreachable providers show OFFLINE and keep their last good reading.
 */

const ALL_GROUPS: SignalGroup[] = ['btc', 'evm', 'solana', 'defi', 'dex', 'forensics'];

export function OnChainPanel() {
  const t = useTranslations('onchain');
  const open = useOnChainStore(selectOnChainOpen);
  const setOpen = useOnChainStore((s) => s.setOpen);
  const refresh = useOnChainStore((s) => s.refresh);
  const tick = useOnChainStore((s) => s.tick);
  const activeToken = useAppStore(selectActiveToken);

  // Drive the refresh loop only while open (mount + 15 s heartbeat).
  useEffect(() => {
    if (!open) return;
    const token =
      activeToken.venue === 'DEX' && activeToken.chain && activeToken.contract
        ? { chain: activeToken.chain, contract: activeToken.contract }
        : undefined;
    const boot = setTimeout(() => tick(token), 0);
    const interval = setInterval(() => tick(token), 15_000);
    return () => {
      clearTimeout(boot);
      clearInterval(interval);
    };
  }, [open, tick, activeToken]);

  // Drawer-Konvention: Escape schließt (der Toolbar-Toggle liegt unter dem
  // Overlay und ist deshalb bei offenem Panel nicht klickbar).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <aside
      aria-label={t('title')}
      className="fixed bottom-0 right-0 top-0 z-40 flex w-full animate-panel-in flex-col border-l border-line bg-bg/96 backdrop-blur-xl sm:top-header sm:w-[26rem]"
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-line/80 px-3 py-2.5">
        <span className="nc-clip-sm flex items-center gap-1.5 border border-primary/45 bg-primary/10 px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-primary">
          <Layers className="size-3" aria-hidden />
          {t('title')}
        </span>
        <button
          type="button"
          onClick={() => {
            const token =
              activeToken.venue === 'DEX' && activeToken.chain && activeToken.contract
                ? { chain: activeToken.chain, contract: activeToken.contract }
                : undefined;
            for (const group of ALL_GROUPS) void refresh(group, { force: true, token });
          }}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="nc-clip-sm inline-flex size-8 items-center justify-center border border-line bg-surface/60 text-muted transition-colors hover:border-primary/60 hover:text-primary"
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          className="nc-clip-sm ml-auto inline-flex size-8 items-center justify-center border border-line bg-surface/60 text-muted transition-colors hover:border-bear/60 hover:text-bear"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* groups */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-3">
          <BtcCard />
          <EvmCard />
          <SolanaCard />
          <DefiCard />
          <DexHeatCard />
          <ForensicsCard />
        </div>
        <p className="mt-3 font-mono text-2xs uppercase tracking-cyber text-faint">{t('sources')}</p>
      </div>
    </aside>
  );
}

/* ------------------------------ shared bits -------------------------------- */

function CardShell({
  group,
  icon: Icon,
  label,
  children,
}: {
  group: SignalGroup;
  icon: typeof Bitcoin;
  label: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('onchain');
  const status = useOnChainStore((s) => s.status[group]);
  const updatedAt = useOnChainStore((s) => s.updatedAt[group]);
  const tone = status === 'ok' ? 'ok' : status === 'error' ? 'error' : status === 'loading' ? 'warn' : 'idle';
  const led =
    status === 'ok' ? t('live') : status === 'error' ? t('offline') : status === 'loading' ? t('loading') : t('idle');

  return (
    <section aria-label={label} className="nc-clip-sm border border-line bg-surface/40 p-2.5">
      <header className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 text-primary" aria-hidden />
        <h3 className="font-display text-xs font-bold uppercase tracking-cyber text-fg">{label}</h3>
        <StatusLed tone={tone} label={led} className="ml-auto" pulse={status === 'ok'} />
        {updatedAt > 0 && <span className="font-mono text-2xs text-faint">{clockTime(updatedAt)}</span>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' | 'warn' }) {
  return (
    <div className="nc-clip-sm border border-line/70 bg-bg/50 px-2 py-1.5">
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
      <p
        className={cn(
          'font-mono text-sm tabular-nums',
          tone === 'bull' && 'text-bull',
          tone === 'bear' && 'text-bear',
          tone === 'warn' && 'text-warning',
          !tone && 'text-fg',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="py-1 text-center font-mono text-2xs uppercase tracking-cyber text-faint">{text}</p>;
}

/* --------------------------------- cards ----------------------------------- */

function BtcCard() {
  const t = useTranslations('onchain');
  const btc = useOnChainStore((s) => s.btc);
  return (
    <CardShell group="btc" icon={Bitcoin} label={t('groups.btc')}>
      {!btc ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat
              label={t('btc.fast')}
              value={`${btc.fastestFee}`}
              tone={btc.fastestFee > 50 ? 'bear' : btc.fastestFee > 15 ? 'warn' : 'bull'}
            />
            <Stat label={t('btc.half')} value={`${btc.halfHourFee}`} />
            <Stat label={t('btc.eco')} value={`${btc.economyFee}`} tone="bull" />
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Stat label={t('btc.unconfirmed')} value={compact(btc.unconfirmed)} />
            <Stat label={t('btc.mempool')} value={`${Math.round(btc.vsize / 1e6)} MB`} />
            <Stat
              label={t('btc.difficulty')}
              value={`${btc.difficultyChangePct >= 0 ? '+' : ''}${btc.difficultyChangePct.toFixed(2)}%`}
              tone={btc.difficultyChangePct >= 0 ? 'bull' : 'bear'}
            />
            <Stat label={t('btc.blocks')} value={`${Math.round(btc.timeAvgSec / 1000)}s`} />
          </div>
          <p className="mt-1.5 font-mono text-2xs text-faint">{t('btc.feeUnit')}</p>
        </>
      )}
    </CardShell>
  );
}

const EVM_LABEL: Record<string, string> = {
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
};

function EvmCard() {
  const t = useTranslations('onchain');
  const evm = useOnChainStore((s) => s.evm);
  const chains = TRACKED_EVM_CHAINS.map((chain) => evm[chain]).filter(
    (entry): entry is EvmChainSignals => Boolean(entry),
  );
  return (
    <CardShell group="evm" icon={Layers} label={t('groups.evm')}>
      {chains.length === 0 ? (
        <Placeholder text={t('loading')} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {chains.map((entry) => (
            <li
              key={entry.chain}
              className="nc-clip-sm flex flex-wrap items-center gap-x-3 gap-y-1 border border-line/70 bg-bg/50 px-2 py-1.5"
            >
              <span className="font-display text-xs font-bold uppercase tracking-cyber text-fg">
                {EVM_LABEL[entry.chain] ?? entry.chain}
              </span>
              {entry.gasAverage != null && (
                <span className="inline-flex items-center gap-1 font-mono text-2xs text-muted">
                  <Fuel className="size-3 text-warning" aria-hidden />
                  {entry.gasAverage.toFixed(2)} {t('evm.gwei')}
                  {entry.gasFast != null && <span className="text-faint">→ {entry.gasFast.toFixed(1)}</span>}
                </span>
              )}
              {entry.utilizationPct != null && (
                <span
                  className={cn(
                    'font-mono text-2xs tabular-nums',
                    entry.utilizationPct > 85 ? 'text-bear' : entry.utilizationPct > 60 ? 'text-warning' : 'text-bull',
                  )}
                >
                  {t('evm.util', { value: `${entry.utilizationPct.toFixed(0)}%` })}
                </span>
              )}
              {entry.txToday != null && (
                <span className="font-mono text-2xs text-muted">
                  {t('evm.txToday', { value: compact(entry.txToday) })}
                </span>
              )}
              {entry.coinChange24hPct != null && (
                <span
                  className={cn(
                    'ml-auto font-mono text-2xs tabular-nums',
                    entry.coinChange24hPct >= 0 ? 'text-bull' : 'text-bear',
                  )}
                >
                  {pct(entry.coinChange24hPct)}
                </span>
              )}
              {entry.tvlUsd != null && (
                <span className="font-mono text-2xs text-faint">{t('evm.tvl', { value: compactUsd(entry.tvlUsd) })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function SolanaCard() {
  const t = useTranslations('onchain');
  const solana = useOnChainStore((s) => s.solana);
  return (
    <CardShell group="solana" icon={Zap} label={t('groups.solana')}>
      {!solana ? (
        <Placeholder text={t('loading')} />
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          <Stat
            label={t('solana.tps')}
            value={compact(Math.round(solana.tps))}
            tone={solana.nonVoteTps > 800 ? 'warn' : 'bull'}
          />
          <Stat label={t('solana.nonVote')} value={compact(Math.round(solana.nonVoteTps))} />
          <Stat label={t('solana.slot')} value={compact(solana.slot)} />
        </div>
      )}
    </CardShell>
  );
}

function DefiCard() {
  const t = useTranslations('onchain');
  const defi = useOnChainStore((s) => s.defi);
  return (
    <CardShell group="defi" icon={Landmark} label={t('groups.defi')}>
      {!defi ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label={t('defi.total')} value={compactUsd(defi.totalTvlUsd)} />
            <Stat
              label={t('defi.change')}
              value={defi.tvlChange24hPct != null ? pct(defi.tvlChange24hPct) : '—'}
              tone={defi.tvlChange24hPct == null ? undefined : defi.tvlChange24hPct >= 0 ? 'bull' : 'bear'}
            />
            <Stat label={t('defi.stables')} value={compactUsd(defi.stablecoinSupplyUsd)} />
            <Stat label={t('defi.chains')} value={`${defi.topChains.length}`} />
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {defi.topChains.map((chain) => {
              const max = defi.topChains[0]?.tvlUsd || 1;
              return (
                <li key={chain.name} className="flex items-center gap-2">
                  <span className="w-20 truncate font-mono text-2xs uppercase text-muted">{chain.name}</span>
                  <span className="h-1.5 flex-1 bg-line/50">
                    <span
                      className="block h-full bg-primary/70 shadow-neon-sm"
                      style={{ width: `${Math.max(4, (chain.tvlUsd / max) * 100)}%` }}
                    />
                  </span>
                  <span className="w-14 text-right font-mono text-2xs tabular-nums text-fg">
                    {compactUsd(chain.tvlUsd)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </CardShell>
  );
}

function DexHeatCard() {
  const t = useTranslations('onchain');
  const dex = useOnChainStore((s) => s.dex);
  return (
    <CardShell group="dex" icon={Flame} label={t('groups.dex')}>
      {!dex || (dex.pools.length === 0 && dex.boosts.length === 0) ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <p className="mb-1 font-mono text-2xs uppercase tracking-cyber text-faint">{t('dex.trending')}</p>
          <ul className="flex flex-col gap-1">
            {dex.pools.slice(0, 8).map((pool, index) => (
              <li
                key={`${pool.chain}-${pool.name}-${index}`}
                className="flex items-center gap-2 border-b border-line/40 pb-1"
              >
                <span className="nc-chip shrink-0 px-1 py-0 text-2xs uppercase">{pool.chain}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg">{pool.name}</span>
                {pool.volume24hUsd != null && (
                  <span className="shrink-0 font-mono text-2xs text-muted">{compactUsd(pool.volume24hUsd)}</span>
                )}
                {pool.change24hPct != null && (
                  <span
                    className={cn(
                      'w-14 shrink-0 text-right font-mono text-2xs tabular-nums',
                      pool.change24hPct >= 0 ? 'text-bull' : 'text-bear',
                    )}
                  >
                    {pct(pool.change24hPct, 1)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {dex.boosts.length > 0 && (
            <>
              <p className="mb-1 mt-2 font-mono text-2xs uppercase tracking-cyber text-faint">{t('dex.boosts')}</p>
              <ul className="flex flex-wrap gap-1">
                {dex.boosts.map((boost) => (
                  <li
                    key={`${boost.chainId}-${boost.address}`}
                    title={boost.description || undefined}
                    className="nc-chip gap-1 px-1.5 py-0.5 text-2xs"
                  >
                    <span className="uppercase text-muted">{boost.chainId}</span>
                    <span className="text-fg">
                      {boost.address.slice(0, 6)}…{boost.address.slice(-4)}
                    </span>
                    <span className="text-secondary">{compact(boost.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </CardShell>
  );
}

function ForensicsCard() {
  const t = useTranslations('onchain');
  const forensics = useOnChainStore((s) => s.forensics);
  const forensicsKey = useOnChainStore((s) => s.forensicsKey);
  const activeToken = useAppStore(selectActiveToken);
  const isDex = activeToken.venue === 'DEX' && Boolean(activeToken.chain) && Boolean(activeToken.contract);

  return (
    <CardShell group="forensics" icon={Microscope} label={t('groups.forensics')}>
      {!isDex ? (
        <Placeholder text={t('forensics.hint')} />
      ) : !forensics || forensicsKey !== `${activeToken.chain}:${activeToken.contract}` ? (
        <Placeholder text={t('loading')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat
              label={t('forensics.holders')}
              value={forensics.holderCount != null ? compact(forensics.holderCount) : '—'}
            />
            <Stat
              label={t('forensics.taxes')}
              value={`${forensics.buyTaxPct != null ? forensics.buyTaxPct.toFixed(1) : '?'} / ${forensics.sellTaxPct != null ? forensics.sellTaxPct.toFixed(1) : '?'}%`}
              tone={(forensics.buyTaxPct ?? 0) > 5 || (forensics.sellTaxPct ?? 0) > 5 ? 'bear' : undefined}
            />
            <Stat
              label={t('forensics.top10')}
              value={forensics.top10Pct != null ? `${forensics.top10Pct.toFixed(1)}%` : '—'}
              tone={forensics.top10Pct != null && forensics.top10Pct > 40 ? 'warn' : undefined}
            />
            <Stat
              label={t('forensics.lp')}
              value={forensics.lpLockedPct != null ? `${forensics.lpLockedPct.toFixed(0)}%` : '—'}
              tone={forensics.lpLockedPct != null && forensics.lpLockedPct < 50 ? 'warn' : 'bull'}
            />
          </div>
          {(forensics.isMintable || forensics.isHoneypot) && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-cyber text-bear">
              <ShieldAlert className="size-3.5" aria-hidden />
              {forensics.isHoneypot ? t('forensics.honeypot') : t('forensics.mintable')}
            </p>
          )}
        </>
      )}
    </CardShell>
  );
}
