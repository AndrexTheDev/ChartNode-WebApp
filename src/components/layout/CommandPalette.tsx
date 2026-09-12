// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import {
  ArrowUpRight,
  Binary,
  FileText,
  HelpCircle,
  Home,
  LayoutGrid,
  Mail,
  Palette,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Sunset,
  Terminal,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { CONTACT, ROUTES } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { LOCALE_LIST } from '@/lib/locales';
import { Kbd } from '@/components/ui/Kbd';
import { ALL_THEMES } from '@/store/presets';
import { isPremiumTheme } from '@/lib/theme';
import { selectShareUnlocked, useViralStore } from '@/store/useViralStore';
import { selectCommandPaletteOpen, useAppStore } from '@/store/useAppStore';
import type { ThemeId } from '@/store/types';

type GroupId = 'navigation' | 'actions' | 'layout' | 'theme' | 'language';

interface Command {
  id: string;
  group: GroupId;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

const THEME_ICONS: Record<ThemeId, LucideIcon> = { acid: Zap, violet: Sparkles, light: Sun, matrix: Binary, miami: Sunset };

const LAYOUT_LABEL_KEYS = {
  '1x1': 'actions.layout1x1',
  '2x1': 'actions.layout2x1',
  '2x2': 'actions.layout2x2',
} as const;

/**
 * ⌘K / Ctrl+K command palette.
 *
 * Mount/unmount pattern: the dialog is only rendered while open, so its local
 * state (query, cursor) starts fresh every time — no reset effects needed.
 * Every entry either navigates (locale-aware) or writes to `useAppStore`,
 * which makes the palette a live proof that header, landing showcase and
 * terminal share one source of truth.
 */
export function CommandPalette() {
  const open = useAppStore(selectCommandPaletteOpen);
  return open ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const t = useTranslations('palette');
  const tt = useTranslations('theme');
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setLayout = useAppStore((s) => s.setLayout);
  const shareUnlocked = useViralStore(selectShareUnlocked);
  const requestTheme = useViralStore((s) => s.requestTheme);

  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as Locale;

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  const close = () => setOpen(false);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };

    const nav: Command[] = [
      { id: 'home', group: 'navigation', label: t('actions.goHome'), icon: Home, keywords: 'home start index', run: go(ROUTES.home) },
      { id: 'terminal', group: 'navigation', label: t('actions.goTerminal'), icon: Terminal, keywords: 'terminal charts trading', run: go(ROUTES.terminal) },
      { id: 'help', group: 'navigation', label: t('actions.goHelp'), icon: HelpCircle, keywords: 'help support faq docs', run: go(ROUTES.help) },
    ];

    const layouts: Command[] = (['1x1', '2x1', '2x2'] as const).map((id) => ({
      id: `layout-${id}`,
      group: 'layout',
      label: t(LAYOUT_LABEL_KEYS[id]),
      hint: id,
      icon: LayoutGrid,
      keywords: `layout grid ${id} split pane`,
      run: () => {
        setLayout(id);
        close();
      },
    }));

    const themes: Command[] = ALL_THEMES.map((id) => {
      const locked = isPremiumTheme(id) && !shareUnlocked;
      return {
        id: `theme-${id}`,
        group: 'theme',
        label: locked ? `${tt(id)} · ${tt('premium')}` : tt(id),
        hint: locked ? tt('premiumHint') : tt(`${id}Desc` as `${ThemeId}Desc`),
        icon: THEME_ICONS[id],
        keywords: `theme skin dark light neon ${id}`,
        run: () => {
          requestTheme(id);
          close();
        },
      };
    });

    const languages: Command[] = LOCALE_LIST.map((entry) => ({
      id: `locale-${entry.code}`,
      group: 'language',
      label: entry.nativeLabel,
      hint: entry.htmlLang,
      icon: Palette,
      keywords: `language locale ${entry.label} ${entry.code}`,
      run: () => {
        close();
        if (entry.code !== locale) router.replace(pathname, { locale: entry.code });
      },
    }));

    const legal: Command[] = [
      { id: 'terms', group: 'actions', label: t('actions.goTerms'), icon: Scale, keywords: 'terms agb legal tos', run: go(ROUTES.terms) },
      { id: 'disclaimer', group: 'actions', label: t('actions.goDisclaimer'), icon: ShieldAlert, keywords: 'disclaimer risk legal', run: go(ROUTES.disclaimer) },
      { id: 'privacy', group: 'actions', label: t('actions.goPrivacy'), icon: FileText, keywords: 'privacy datenschutz data', run: go(ROUTES.privacy) },
      {
        id: 'email',
        group: 'actions',
        label: t('actions.writeEmail'),
        hint: CONTACT.email,
        icon: Mail,
        keywords: 'contact mail email feedback bug',
        run: () => {
          close();
          window.location.href = CONTACT.mailto;
        },
      },
    ];

    return [...nav, ...layouts, ...themes, ...languages, ...legal];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tt, locale, pathname, router, setLayout, requestTheme, shareUnlocked, setOpen]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.includes(q) ||
        (c.hint ?? '').toLowerCase().includes(q),
    );
  }, [commands, query]);

  const grouped = useMemo(() => {
    const order: GroupId[] = ['navigation', 'layout', 'theme', 'language', 'actions'];
    return order
      .map((group) => ({ group, items: results.filter((c) => c.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [results]);

  const flat = grouped.flatMap((g) => g.items);
  // Keep the cursor inside the result set without an extra effect.
  const cursor = Math.min(active, Math.max(flat.length - 1, 0));
  const activeCommand = flat[cursor];

  // Focus the field once, right after mount. Ref-only work → allowed in effects.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Lock body scroll while open; restore on unmount.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => (i + 1) % Math.max(flat.length, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => (i - 1 + flat.length) % Math.max(flat.length, 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(Math.max(flat.length - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        activeCommand?.run();
        break;
    }
  }

  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-palette flex items-start justify-center px-4 pt-[12vh]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-bg/85 backdrop-blur-md" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        className="nc-clip relative w-full max-w-xl animate-fade-up border border-primary/40 bg-elevated/95 shadow-neon-lg"
        onKeyDown={onKeyDown}
      >
        {/* search field */}
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-primary" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder={t('placeholder')}
            aria-label={t('title')}
            aria-controls={`${uid}-list`}
            aria-activedescendant={activeCommand ? `${uid}-${activeCommand.id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 flex-1 bg-transparent font-mono text-sm text-fg placeholder:text-faint focus:outline-none"
          />
          <button type="button" onClick={close} aria-label="Close" className="text-faint transition-colors hover:text-fg">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* results */}
        <ul id={`${uid}-list`} role="listbox" aria-label={t('title')} className="nc-no-scrollbar max-h-[46vh] overflow-y-auto p-2">
          {flat.length === 0 && (
            <li className="px-3 py-8 text-center font-mono text-xs uppercase tracking-cyber text-faint">
              {t('empty')}
            </li>
          )}

          {grouped.map(({ group, items }) => (
            <li key={group} role="presentation">
              <p className="px-3 pb-1 pt-3 font-mono text-2xs uppercase tracking-mega text-faint">
                {t(`groups.${group}`)}
              </p>
              <ul role="group" aria-label={t(`groups.${group}`)} className="flex flex-col">
                {items.map((command) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const Icon = command.icon;
                  const isActive = index === cursor;
                  return (
                    <li key={command.id} role="presentation">
                      <button
                        id={`${uid}-${command.id}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        tabIndex={-1}
                        onMouseEnter={() => setActive(index)}
                        onClick={command.run}
                        className={cn(
                          'nc-clip-sm flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100',
                          isActive ? 'bg-primary/12 text-fg' : 'text-muted hover:bg-elevated/60 hover:text-fg',
                        )}
                      >
                        <Icon className={cn('size-4 shrink-0', isActive ? 'text-primary' : 'text-faint')} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{command.label}</span>
                          {command.hint && (
                            <span className="block truncate font-mono text-2xs text-faint">{command.hint}</span>
                          )}
                        </span>
                        {isActive && <ArrowUpRight className="size-3.5 shrink-0 text-primary" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-2xs text-faint">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t('hint')}
            <Kbd>{t('hintEnter')}</Kbd>
            <span aria-hidden>·</span>
            <Kbd>{t('hintEsc')}</Kbd>
            <span className="hidden sm:inline">{t('hintClose')}</span>
          </span>
          <span className="font-mono text-2xs uppercase tracking-cyber text-primary/70">{flat.length}</span>
        </div>
      </div>
    </div>
  );
}
