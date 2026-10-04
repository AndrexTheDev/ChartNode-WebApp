// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  OPEN_AD_SETTINGS_EVENT,
  hasVolatileAdDenial,
  setAdConsent,
  useAdConsent,
  useClientReady,
  type AdConsentChoice,
} from '@/lib/ads/consent';

/**
 * Non-modal, in-flow consent notice. No third-party ad code is loaded until
 * the visitor explicitly allows it; rejecting leaves chart/data features usable.
 */
export function AdConsentBanner() {
  const t = useTranslations('ads');
  const consent = useAdConsent();
  const hydrated = useClientReady();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousConsent = useRef(consent);

  useEffect(() => {
    const openSettings = () => {
      setSettingsOpen(true);
      window.setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        panelRef.current?.focus();
      }, 0);
    };
    window.addEventListener(OPEN_AD_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_AD_SETTINGS_EVENT, openSettings);
  }, []);

  useEffect(() => {
    // Tear down an already-running third-party context after a persisted
    // withdrawal. A volatile denial must not reload into a readable stale grant;
    // it stays fail-closed in this document and shows the storage warning.
    if (
      previousConsent.current === 'granted' &&
      consent !== 'granted' &&
      !(consent === 'denied' && hasVolatileAdDenial())
    ) {
      window.location.reload();
    }
    previousConsent.current = consent;
  }, [consent]);

  const choose = (choice: AdConsentChoice) => {
    if (!setAdConsent(choice)) {
      setStorageError(true);
      if (choice === 'denied') setSettingsOpen(true);
      return;
    }
    setStorageError(false);
    setSettingsOpen(false);
  };

  if (!hydrated || (consent !== 'unknown' && !settingsOpen)) return null;

  return (
    <section
      ref={(element) => {
        panelRef.current = element;
      }}
      role="region"
      aria-labelledby="nc-ad-consent-title"
      aria-live="polite"
      tabIndex={-1}
      className="border-y border-primary/35 bg-surface/95 shadow-neon-sm"
    >
      <div className="container grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <h2 id="nc-ad-consent-title" className="mb-1 font-mono text-xs font-bold uppercase tracking-cyber text-primary">
            {consent === 'unknown' ? t('consentTitle') : t('settingsTitle')}
          </h2>
          <p className="max-w-4xl text-sm leading-relaxed text-fg">{t('consentBody')}</p>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted">{t('consentNote')}</p>
          {consent !== 'unknown' && (
            <p className="mt-1 font-mono text-2xs uppercase tracking-cyber text-faint">
              {consent === 'granted' ? t('currentAllowed') : t('currentDenied')}
            </p>
          )}
          {storageError && (
            <p role="alert" className="mt-2 text-xs font-medium text-danger">
              {t('storageError')}
            </p>
          )}
          <Link
            href="/legal/privacy"
            className="mt-2 inline-flex min-h-10 items-center rounded-sm font-mono text-2xs uppercase tracking-cyber text-primary underline decoration-primary/50 underline-offset-4 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('privacyLink')}
          </Link>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row md:max-w-[32rem] md:flex-wrap md:justify-end" role="group" aria-label={t('consentActions')}>
          {settingsOpen && consent !== 'unknown' && (
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="min-h-11 rounded-sm border border-line px-4 py-2 font-mono text-2xs font-bold uppercase tracking-cyber text-fg transition-colors hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('closeSettings')}
            </button>
          )}
          <button
            type="button"
            onClick={() => choose('denied')}
            className="min-h-11 flex-1 rounded-sm border border-primary/60 bg-surface px-4 py-2 font-mono text-2xs font-bold uppercase tracking-cyber text-fg transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('rejectOptional')}
          </button>
          <button
            type="button"
            onClick={() => choose('granted')}
            className="min-h-11 flex-1 rounded-sm border border-primary/60 bg-surface px-4 py-2 font-mono text-2xs font-bold uppercase tracking-cyber text-primary transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('allowOptional')}
          </button>
        </div>
      </div>
    </section>
  );
}
