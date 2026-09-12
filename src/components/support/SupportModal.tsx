// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useState } from 'react';
import { Coffee, Pizza, ShoppingBasket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { useViralStore } from '@/store/useViralStore';
import { DonatedFlow } from './DonatedFlow';
import { WalletsList } from './WalletsList';

/**
 * The tip jar. No paywall, no guilt-trip countdowns – just the honest story:
 * one dev, ads + donations, and three concrete slots your tip fills.
 * Declaring a donation grants the permanent SUPPORTER badge and starts the
 * ask-free grace window (48 h, or 5 days above $5 – see DonatedFlow).
 */

export function SupportModal() {
  const t = useTranslations('support');
  const open = useViralStore((s) => s.supportOpen);
  const close = useViralStore((s) => s.closeSupport);
  const [thanked, setThanked] = useState(false);

  const slots = [
    { icon: Coffee, text: t('slot1') },
    { icon: Pizza, text: t('slot2') },
    { icon: ShoppingBasket, text: t('slot3') },
  ];

  return (
    <Modal open={open} onClose={close} widthClass="max-w-lg" title={t('openTip')}>
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs leading-relaxed text-muted">{t('story1')}</p>
        <p className="font-mono text-xs leading-relaxed text-muted">{t('story2')}</p>

        <div className="nc-clip-sm border border-line/70 bg-bg/50 p-2.5">
          <p className="mb-1.5 font-mono text-2xs uppercase tracking-cyber text-faint">{t('monthly')}</p>
          <ul className="flex flex-col gap-1.5">
            {slots.map((slot) => (
              <li key={slot.text} className="flex items-center gap-2 font-mono text-2xs text-muted">
                <slot.icon className="size-3.5 shrink-0 text-secondary" aria-hidden />
                {slot.text}
              </li>
            ))}
          </ul>
        </div>

        <WalletsList copiedLabel={t('copied')} copyLabel={t('copy')} title={t('wallets')} />

        <DonatedFlow variant="block" onDone={() => setThanked(true)} />
        {thanked && <p className="text-center font-mono text-2xs text-bull">{t('thanks')}</p>}
        <p className="text-center font-mono text-2xs text-faint">{t('story3')}</p>
      </div>
    </Modal>
  );
}
