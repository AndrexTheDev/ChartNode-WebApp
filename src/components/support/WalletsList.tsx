// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/store/useToastStore';

export interface DonationWallet {
  chain: 'SOL' | 'BTC' | 'ETH';
  address: string;
  color: string;
}

/** The three donation wallets – public, key-less, copy-only. */
export const DONATION_WALLETS: DonationWallet[] = [
  { chain: 'SOL', address: '79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8', color: 'text-accent' },
  { chain: 'BTC', address: 'bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f', color: 'text-warning' },
  { chain: 'ETH', address: '0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7', color: 'text-secondary' },
];

export async function copyText(value: string): Promise<boolean> {
  // The async Clipboard API needs a secure context AND a granted permission;
  // skip straight to the legacy path where it cannot exist (http, old UA).
  if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // denied / not focused – fall through to the legacy path
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0;pointer-events:none;';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Shared wallet rows with copy-to-clipboard + neon feedback. */
export function WalletsList({ title, copyLabel, copiedLabel }: { title: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const t = useTranslations('support');
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{title}</p>
      {DONATION_WALLETS.map((wallet) => {
        const isCopied = copied === wallet.chain;
        return (
          <div
            key={wallet.chain}
            className={cn(
              'nc-clip-sm flex items-center gap-2 border px-2.5 py-2 transition-colors',
              isCopied ? 'border-bull/70 bg-bull/10' : 'border-line bg-surface/50',
            )}
          >
            <span className={cn('w-9 shrink-0 font-display text-xs font-bold', wallet.color)}>{wallet.chain}</span>
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={wallet.address}>
              {wallet.address}
            </code>
            <button
              type="button"
              onClick={() => {
                void copyText(wallet.address).then((ok) => {
                  // Silent failure would leave the user wondering – the neon
                  // check only appears on success, so a miss gets a toast.
                  if (ok) setCopied(wallet.chain);
                  else pushToast(t('copyFailed'), 'warn');
                });
              }}
              aria-label={`${copyLabel} ${wallet.chain}`}
              className={cn(
                'nc-clip-sm inline-flex h-7 shrink-0 items-center gap-1 border px-2 font-mono text-2xs uppercase tracking-cyber transition-colors',
                isCopied
                  ? 'border-bull/70 bg-bull/15 text-bull hover:bg-bull/25'
                  : 'border-line bg-elevated/60 text-muted hover:border-primary/60 hover:text-primary',
              )}
            >
              {isCopied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
              <span className="hidden sm:inline">{isCopied ? copiedLabel : copyLabel}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
