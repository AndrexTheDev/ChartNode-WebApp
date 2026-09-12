// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, BellOff, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { beepAlert, notificationGranted, requestNotificationPermission } from '@/lib/notifications';
import { useChartStore } from '@/store/useChartStore';
import { useViralStore } from '@/store/useViralStore';

interface AlertsPanelModalProps {
  symbol: string;
  lastPrice: number | null;
  open: boolean;
  onClose: () => void;
}

const input =
  'mt-1 w-full border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs tabular-nums text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm';

/**
 * Alert manager: unlimited, persisted, never expiring, multi-condition
 * (TradingView: 1 free / 400 Premium / non-expiring Premium / multi Plus),
 * with optional browser notifications + beep.
 */
export function AlertsPanelModal({ symbol, lastPrice, open, onClose }: AlertsPanelModalProps) {
  const t = useTranslations('tools');
  const alerts = useChartStore((state) => state.alerts);
  const addAlertFull = useChartStore((state) => state.addAlertFull);
  const removeAlert = useChartStore((state) => state.removeAlert);

  const [kind, setKind] = useState<'price' | 'pct'>('price');
  const [dir, setDir] = useState<'above' | 'below'>('above');
  const [value, setValue] = useState(0);
  const [cond2On, setCond2On] = useState(false);
  const [cond2Dir, setCond2Dir] = useState<'above' | 'below'>('below');
  const [cond2Value, setCond2Value] = useState(0);
  const [note, setNote] = useState('');
  const [perm, setPerm] = useState(notificationGranted());

  const create = () => {
    const base = lastPrice ?? 0;
    if (kind === 'price' && !(value > 0)) return;
    if (kind === 'pct' && !(value > 0)) return;
    const price = kind === 'price' ? value : base * (1 + (dir === 'above' ? value : -value) / 100);
    addAlertFull({
      symbol,
      price,
      dir,
      kind: 'price',
      base: kind === 'pct' ? base : undefined,
      pct: kind === 'pct' ? value : undefined,
      cond2: cond2On && cond2Value > 0 ? { dir: cond2Dir, price: cond2Value } : undefined,
      note: note.trim() || (kind === 'pct' ? `${dir === 'above' ? '+' : '-'}${value}% @ ${base.toFixed(2)}` : undefined),
    });
    setNote('');
    setCond2On(false);
    useViralStore.getState().bumpTool();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('alerts.title')} subtitle={t('alerts.sub')}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void requestNotificationPermission().then(setPerm);
            }}
            className={cn(
              'flex items-center gap-1 border px-2 py-1 font-mono text-2xs uppercase tracking-cyber',
              perm ? 'border-bull/50 text-bull' : 'border-line text-muted hover:text-fg',
            )}
          >
            {perm ? <Bell size={11} /> : <BellOff size={11} />} {perm ? t('alerts.permOn') : t('alerts.permOff')}
          </button>
          <button
            type="button"
            onClick={() => beepAlert()}
            className="border border-line px-2 py-1 font-mono text-2xs uppercase tracking-cyber text-muted hover:text-fg"
          >
            {t('alerts.testbeep')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('alerts.kind')}
            <select value={kind} onChange={(event) => setKind(event.target.value as 'price' | 'pct')} className={input}>
              <option value="price">{t('alerts.price')}</option>
              <option value="pct">{t('alerts.pct')}</option>
            </select>
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('alerts.dir')}
            <select value={dir} onChange={(event) => setDir(event.target.value as 'above' | 'below')} className={input}>
              <option value="above">{t('alerts.above')}</option>
              <option value="below">{t('alerts.below')}</option>
            </select>
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {kind === 'price' ? t('alerts.value') : t('alerts.pctValue')}
            <input type="number" step="0.01" value={value} onChange={(event) => setValue(Number(event.target.value))} className={input} />
          </label>
          <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('alerts.note')}
            <input value={note} onChange={(event) => setNote(event.target.value)} className={input} />
          </label>
        </div>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-2xs uppercase tracking-cyber text-muted">
          <input type="checkbox" checked={cond2On} onChange={() => setCond2On((value) => !value)} className="accent-bull" />
          {t('alerts.addCond2')}
        </label>
        {cond2On && (
          <div className="grid grid-cols-2 gap-2">
            <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
              {t('alerts.dir')}
              <select value={cond2Dir} onChange={(event) => setCond2Dir(event.target.value as 'above' | 'below')} className={input}>
                <option value="above">{t('alerts.above')}</option>
                <option value="below">{t('alerts.below')}</option>
              </select>
            </label>
            <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
              {t('alerts.value')}
              <input type="number" step="0.01" value={cond2Value} onChange={(event) => setCond2Value(Number(event.target.value))} className={input} />
            </label>
          </div>
        )}
        <button
          type="button"
          onClick={create}
          className="flex items-center gap-1 self-start border border-bull/50 bg-bull/10 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-bull hover:bg-bull/20"
        >
          <Plus size={12} /> {t('alerts.create')}
        </button>

        {alerts.length === 0 ? (
          <p className="py-4 text-center font-mono text-2xs text-faint">{t('alerts.empty')}</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-center gap-2 border border-line/60 bg-surface/30 px-2 py-1.5 font-mono text-2xs">
                <span className={cn(alert.fired ? 'text-faint' : 'text-warning')}>{alert.fired ? '●' : '◌'}</span>
                <span className="text-fg">{alert.symbol}</span>
                <span className="text-muted">
                  {alert.dir === 'above' ? '≥' : '≤'} {alert.price}
                  {alert.cond2 ? ` & ${alert.cond2.dir === 'above' ? '≥' : '≤'} ${alert.cond2.price}` : ''}
                </span>
                {alert.note && <span className="truncate text-secondary">{alert.note}</span>}
                <span className="ml-auto text-faint">
                  {alert.fired && alert.firedAt ? new Date(alert.firedAt).toLocaleTimeString() : t(alert.fired ? 'alerts.fired' : 'alerts.armed')}
                </span>
                <button type="button" aria-label={t('alerts.del')} onClick={() => removeAlert(alert.id)} className="text-faint hover:text-bear">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => useViralStore.getState().openSupport()}
          className="self-start font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
        >
          {t('alerts.foot')}
        </button>
      </div>
    </Modal>
  );
}
