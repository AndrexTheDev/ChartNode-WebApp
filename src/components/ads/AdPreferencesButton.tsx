// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { openAdConsentSettings } from '@/lib/ads/consent';

export function AdPreferencesButton() {
  const t = useTranslations('ads');
  return (
    <button
      type="button"
      onClick={openAdConsentSettings}
      className="nc-clip-sm group inline-flex min-h-10 w-fit items-center gap-2 px-2 py-1.5 -ml-2 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors duration-200 hover:bg-elevated hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <SlidersHorizontal className="size-3.5" aria-hidden />
      {t('manage')}
    </button>
  );
}
