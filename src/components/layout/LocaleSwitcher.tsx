// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { LOCALE_LIST, LOCALE_META } from '@/lib/locales';
import { LOCALE_CHOICE_KEY } from './LocaleDetectBanner';

/**
 * Language menu. `router.replace(pathname, { locale })` keeps the user on the
 * exact same page and lets next-intl persist the NEXT_LOCALE cookie, so the
 * choice survives the next visit and overrides Accept-Language detection.
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const meta = LOCALE_META[locale];

  const items: DropdownItem[] = LOCALE_LIST.map((entry) => ({
    id: entry.code,
    label: entry.nativeLabel,
    hint: entry.label === entry.nativeLabel ? entry.htmlLang : entry.label,
    badge: entry.short,
    selected: entry.code === locale,
    onSelect: () => {
      if (entry.code === locale) return;
      // A manual choice permanently wins over automatic detection.
      try {
        localStorage.setItem(LOCALE_CHOICE_KEY, entry.code);
      } catch {
        /* storage blocked – the cookie set by next-intl is enough */
      }
      router.replace(pathname, { locale: entry.code });
    },
  }));

  return (
    <Dropdown
      items={items}
      triggerLabel={t('selectLanguage')}
      menuLabel={t('language')}
      triggerIcon={<Globe className="size-3.5" aria-hidden />}
      triggerText={meta.short}
    />
  );
}
