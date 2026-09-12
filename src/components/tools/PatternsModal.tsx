// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { detectPatterns } from '@/lib/patterns';
import { useChartStore } from '@/store/useChartStore';
import { useViralStore } from '@/store/useViralStore';
import type { Candle } from '@/websockets/types';

interface PatternsModalProps {
  candles: Candle[];
  open: boolean;
  onClose: () => void;
}

/**
 * Auto chart-pattern scanner (TradingView: Ultimate-only). Lists every
 * detection with bias + confidence and toggles the on-chart markers.
 */
export function PatternsModal({ candles, open, onClose }: PatternsModalProps) {
  const t = useTranslations('tools');
  const patternsOn = useChartStore((state) => state.patternsOn);
  const togglePatterns = useChartStore((state) => state.togglePatterns);
  const patterns = useMemo(() => (open ? detectPatterns(candles, 12) : []), [open, candles]);

  return (
    <Modal open={open} onClose={onClose} title={t('patterns.title')} subtitle={t('patterns.sub')}>
      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer items-center justify-between border border-line bg-surface/40 px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-cyber text-muted">{t('patterns.toggle')}</span>
          <input type="checkbox" checked={patternsOn} onChange={() => togglePatterns()} className="accent-bull" />
        </label>

        {patterns.length === 0 ? (
          <p className="py-6 text-center font-mono text-2xs text-faint">{t('patterns.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {patterns.map((pattern) => (
              <li key={pattern.id} className="flex items-center gap-3 border border-line/60 bg-surface/30 px-3 py-2 font-mono text-2xs">
                <span
                  className={cn(
                    'border px-1.5 py-0.5 uppercase tracking-cyber',
                    pattern.bias === 'bull' ? 'border-bull/50 text-bull' : 'border-bear/50 text-bear',
                  )}
                >
                  {t(`patterns.kinds.${pattern.kind}`)}
                </span>
                <span className="text-faint">{new Date(pattern.time).toLocaleString()}</span>
                <span className="ml-auto flex items-center gap-2 text-muted">
                  <span className="inline-block h-1 w-16 bg-line">
                    <span
                      className={cn('block h-1', pattern.bias === 'bull' ? 'bg-bull' : 'bg-bear')}
                      style={{ width: `${Math.round(pattern.confidence * 100)}%` }}
                    />
                  </span>
                  {Math.round(pattern.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => useViralStore.getState().openSupport()}
          className="self-start font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
        >
          {t('patterns.foot')}
        </button>
      </div>
    </Modal>
  );
}
