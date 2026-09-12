// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Binary, Lock, Sparkles, Sun, Sunset, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { DEFAULT_THEME, isPremiumTheme } from '@/lib/theme';
import { ALL_THEMES } from '@/store/presets';
import { selectShareUnlocked, useViralStore } from '@/store/useViralStore';
import { selectTheme, useAppStore } from '@/store/useAppStore';
import { useHydrated } from '@/store/useHydrated';
import type { ThemeId } from '@/store/types';

const ICONS: Record<ThemeId, typeof Zap> = {
  acid: Zap,
  violet: Sparkles,
  light: Sun,
  matrix: Binary,
  miami: Sunset,
};

/** Theme picker bound to `useAppStore.theme`. */
export function ThemeSwitcher() {
  const t = useTranslations('theme');
  const theme = useAppStore(selectTheme);
  const hydrated = useHydrated();
  const unlocked = useViralStore(selectShareUnlocked);
  const requestTheme = useViralStore((s) => s.requestTheme);

  // Before hydration the store still holds its default – render that instead of
  // a value that would mismatch the server HTML.
  const current = hydrated ? theme : DEFAULT_THEME;
  const CurrentIcon = ICONS[current];

  const items: DropdownItem[] = ALL_THEMES.map((id) => {
    const Icon = ICONS[id];
    // Share-to-unlock: locked premium skins open the share modal instead.
    const locked = isPremiumTheme(id) && !unlocked;
    return {
      id,
      label: locked ? `${t(id)} · ${t('premium')}` : t(id),
      hint: locked ? t('premiumHint') : t(`${id}Desc` as `${ThemeId}Desc`),
      icon: locked ? <Lock className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />,
      selected: id === current,
      onSelect: () => requestTheme(id),
    };
  });

  return (
    <Dropdown
      items={items}
      triggerLabel={t('label')}
      menuLabel={t('label')}
      triggerIcon={<CurrentIcon className="size-3.5" aria-hidden />}
      align="end"
      widthClass="w-64"
    />
  );
}
