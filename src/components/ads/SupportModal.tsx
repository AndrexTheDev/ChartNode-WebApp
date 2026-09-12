// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { WalletsList } from '@/components/support/WalletsList';
import { DonatedFlow } from '@/components/support/DonatedFlow';
import { useViralStore } from '@/store/useViralStore';

/**
 * Ad-block soft-wall: "NodeChart is free. Support the rebellion."
 *
 * Never blocks functionality – it offers two exits ("I have donated" starts
 * the 48-h/5-day ask-free grace window plus the permanent badge, "Dismiss"
 * sleeps for 7 days) and the donation wallets with copy-to-clipboard + neon
 * feedback. While a donation grace is active this modal never opens at all
 * (see AdManager) – a donor is not asked again before the window expires.
 */
export function SupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('support');
  const dismissWall = useViralStore((s) => s.dismissWall);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" aria-hidden />
          {t('title')}
        </span>
      }
      subtitle={t('body')}
      widthClass="max-w-xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              dismissWall();
              onClose();
            }}
            className="nc-clip-sm border border-line bg-surface/60 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:text-fg"
          >
            {t('dismiss')}
          </button>
          <DonatedFlow onDone={onClose} />
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <WalletsList title={t('wallets')} copyLabel={t('copy')} copiedLabel={t('copied')} />
        <p className="mt-1 font-mono text-micro-10 leading-relaxed text-faint">{t('note')}</p>
      </div>
    </Modal>
  );
}
