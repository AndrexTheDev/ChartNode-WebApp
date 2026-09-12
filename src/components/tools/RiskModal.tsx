// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { usd } from '@/lib/format';
import { computeRisk } from '@/lib/risk';

/**
 * Position-size & risk/reward calculator – the maths of TV's position tool
 * as a fast keyboard-first modal. Nothing leaves the browser.
 */

interface RiskModalProps {
  symbol: string;
  lastPrice: number | null;
  open: boolean;
  onClose: () => void;
}

export function RiskModal({ symbol, lastPrice, open, onClose }: RiskModalProps) {
  const t = useTranslations('tools');
  const [account, setAccount] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1);
  const [entry, setEntry] = useState(lastPrice ?? 0);
  const [stop, setStop] = useState(lastPrice ? lastPrice * 0.97 : 0);
  const [target, setTarget] = useState(lastPrice ? lastPrice * 1.06 : 0);
  const [leverage, setLeverage] = useState(1);

  // Seed entry/stop/target from the live price each time the modal opens –
  // useState alone would freeze the pre-feed null prices from first mount.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && lastPrice != null && lastPrice > 0) {
      setEntry(lastPrice);
      setStop(lastPrice * 0.97);
      setTarget(lastPrice * 1.06);
    }
    wasOpen.current = open;
  }, [open, lastPrice]);

  const result = useMemo(
    () => computeRisk({ accountUsd: account, riskPct, entry, stop, target, leverage }),
    [account, riskPct, entry, stop, target, leverage],
  );

  const field = (label: string, value: number, set: (value: number) => void, step = 0.01) => (
    <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        step={step}
        onChange={(event) => set(Number(event.target.value))}
        className="mt-1 w-full border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs tabular-nums text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm"
      />
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-xl" title={t('risk.title')} subtitle={symbol}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {field(t('risk.account'), account, setAccount, 100)}
        {field(t('risk.riskPct'), riskPct, setRiskPct, 0.25)}
        {field(t('risk.leverage'), leverage, setLeverage, 1)}
        {field(t('risk.entry'), entry, setEntry)}
        {field(t('risk.stop'), stop, setStop)}
        {field(t('risk.target'), target, setTarget)}
      </div>

      {result ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Out label={t('risk.riskUsd')} value={usd(result.riskUsd)} tone="bear" />
          <Out label={t('risk.rewardUsd')} value={usd(result.rewardUsd)} tone="bull" />
          <Out label={t('risk.rr')} value={result.rr != null ? `1 : ${result.rr.toFixed(2)}` : '—'} tone={result.rr != null && result.rr >= 2 ? 'bull' : undefined} />
          <Out label={t('risk.units')} value={result.positionUnits.toFixed(6)} />
          <Out label={t('risk.notional')} value={usd(result.positionNotionalUsd)} />
          <Out label={t('risk.margin')} value={usd(result.marginUsd)} />
          <Out label={t('risk.stopDist')} value={`${result.stopDistPct.toFixed(2)}%`} tone="bear" />
          <Out label={t('risk.targetDist')} value={`${result.targetDistPct.toFixed(2)}%`} tone="bull" />
          <Out label={t('risk.accountTarget')} value={`+${result.accountAtTargetPct.toFixed(2)}%`} tone="bull" />
        </div>
      ) : (
        <p className="mt-4 text-center font-mono text-2xs uppercase tracking-cyber text-faint">{t('risk.invalid')}</p>
      )}
      <p className="mt-3 font-mono text-2xs text-faint">{t('risk.hint')}</p>
    </Modal>
  );
}

function Out({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="nc-clip-sm border border-line/70 bg-bg/50 px-2 py-1.5">
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{label}</p>
      <p className={cn('font-mono text-sm tabular-nums', tone === 'bull' && 'text-bull', tone === 'bear' && 'text-bear', !tone && 'text-fg')}>{value}</p>
    </div>
  );
}
