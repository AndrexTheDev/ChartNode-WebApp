// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Languages, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { LOCALE_META } from '@/lib/locales';
import { NeonButton } from '@/components/ui/NeonButton';

/** Set by <LocaleSwitcher> as soon as the user picks a language manually. */
export const LOCALE_CHOICE_KEY = 'nodechart:locale-chosen';
const DISMISS_KEY = 'nodechart:locale-banner-dismissed';

/**
 * Second layer of automatic language detection.
 *
 * The proxy already redirects `/` based on the `Accept-Language` header. But
 * two real-world cases slip through:
 *   1. the header is missing/stripped (some privacy proxies, in-app browsers)
 *   2. the browser UI language differs from the OS language reported by
 *      `navigator.languages`
 *
 * In those cases we ask once per session instead of force-redirecting — a hard
 * redirect here would fight the router and hurt SEO signals.
 */
export function LocaleDetectBanner() {
  const locale = useLocale() as Locale;
  const t = useTranslations('detect');
  const router = useRouter();
  const pathname = usePathname();
  const [suggestion, setSuggestion] = useState<Locale | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    try {
      if (localStorage.getItem(LOCALE_CHOICE_KEY)) return;
      if (sessionStorage.getItem(DISMISS_KEY)) return;
    } catch {
      return; // storage blocked (private mode) – stay silent
    }

    const candidates = navigator.languages ?? [navigator.language];
    for (const candidate of candidates) {
      const code = candidate.toLowerCase().split('-')[0] ?? '';
      if (isLocale(code) && code !== locale) {
        // `navigator` only exists in the browser, so this state is inherently
        // client-only: surfacing it requires exactly one post-hydration update.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSuggestion(code);
        return;
      }
    }
  }, [locale]);

  if (!suggestion) return null;

  const next: Locale = suggestion;
  const target = LOCALE_META[next];
  const current = LOCALE_META[locale];

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setSuggestion(null);
  }

  function accept() {
    try {
      localStorage.setItem(LOCALE_CHOICE_KEY, next);
    } catch {
      /* ignore */
    }
    router.replace(pathname, { locale: next });
  }

  return (
    <div
      role="status"
      className="container flex justify-center px-4 pt-3"
    >
      <div className="nc-clip pointer-events-auto flex w-full max-w-lg animate-fade-up flex-col gap-3 border border-primary/45 bg-elevated/95 p-4 shadow-neon-lg backdrop-blur-md sm:flex-row sm:items-center">
        <span className="flex size-9 shrink-0 items-center justify-center border border-primary/40 bg-primary/10 text-primary">
          <Languages className="size-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-2xs uppercase tracking-cyber text-primary">{t('title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t('body', { language: target.nativeLabel })}
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap sm:shrink-0">
          <NeonButton size="sm" onClick={accept}>
            {t('switch', { language: target.short })}
          </NeonButton>
          <NeonButton size="sm" variant="ghost" onClick={dismiss}>
            {t('keep', { current: current.short })}
          </NeonButton>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('dismiss')}
            className="text-faint transition-colors hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
