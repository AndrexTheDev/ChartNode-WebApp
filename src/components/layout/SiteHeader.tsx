// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Command, Menu, Terminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/useAppStore';
import { SmartSearch } from '@/components/search/SmartSearch';
import { Logo } from './Logo';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { Kbd } from '@/components/ui/Kbd';

interface NavItem {
  key: 'features' | 'layouts' | 'help';
  href: string;
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { key: 'features', href: '/#features', match: (p) => p === '/' },
  { key: 'layouts', href: '/#layouts', match: (p) => p === '/' },
  { key: 'help', href: ROUTES.help, match: (p) => p.startsWith('/help') },
];

export function SiteHeader() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const setPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

  const closeDrawer = () => setMobileOpen(false);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-header w-full">
      {/* hairline glow */}
      <div aria-hidden className="h-px w-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

      <div className="border-b border-line/70 bg-bg/80 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/60">
        <div className="container flex min-h-[var(--nc-header-h)] flex-wrap items-center gap-3 py-1.5">
          <Link href={ROUTES.home} className="shrink-0 rounded-none transition-[filter,opacity] duration-200 hover:brightness-125 active:opacity-80" aria-label="NodeChart">
            <Logo />
          </Link>

          <SmartSearch className="hidden w-full max-w-[13rem] md:block xl:max-w-sm" />

          <nav aria-label="Main" className="ml-2 hidden items-center gap-1 lg:flex">
            {NAV.map((item) => {
              const active = !item.href.includes('#') && item.match(pathname);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'nc-clip-sm relative px-3 py-2 font-mono text-2xs uppercase tracking-cyber transition-colors duration-200',
                    active ? 'text-primary hover:bg-elevated/70' : 'text-muted hover:bg-elevated hover:text-fg',
                  )}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Command palette trigger */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t('openPalette')}
              title={`${t('openPalette')} (⌘K)`}
              className="nc-clip-sm hidden h-9 items-center gap-2 border border-line bg-surface/70 px-2.5 text-muted transition-colors duration-200 hover:border-primary/60 hover:text-fg md:inline-flex"
            >
              <Command className="size-3.5" aria-hidden />
              <span className="hidden font-mono text-2xs uppercase tracking-cyber lg:inline">
                {t('openPalette')}
              </span>
              <Kbd className="hidden lg:inline-flex">K</Kbd>
            </button>

            <ThemeSwitcher />
            <LocaleSwitcher />

            <Link
              href={ROUTES.terminal}
              className={cn(
                'nc-clip-sm hidden h-9 items-center gap-2 bg-primary px-4 font-mono text-2xs uppercase tracking-cyber',
                'text-primary-fg shadow-neon-sm transition-all duration-200 hover:shadow-neon hover:brightness-110 sm:inline-flex',
              )}
            >
              <Terminal className="size-3.5" aria-hidden />
              {t('terminal')}
            </Link>

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? t('closeMenu') : t('openMenu')}
              className="nc-clip-sm inline-flex size-9 items-center justify-center border border-line bg-surface/70 text-muted transition-colors hover:border-primary/60 hover:text-fg lg:hidden"
            >
              {mobileOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          id="mobile-nav"
          className="animate-fade-up border-b border-line bg-bg/95 backdrop-blur-xl lg:hidden"
        >
          <nav aria-label="Mobile" className="container flex flex-col gap-1 py-4">
            <SmartSearch className="mb-2 w-full" />
            {NAV.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                onClick={closeDrawer}
                className="nc-clip-sm border border-line/60 bg-surface/50 px-4 py-3 font-mono text-xs uppercase tracking-cyber text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                {t(item.key)}
              </Link>
            ))}
            <Link
              href={ROUTES.terminal}
              onClick={closeDrawer}
              className="nc-clip-sm mt-2 flex items-center justify-center gap-2 bg-primary px-4 py-3 font-mono text-xs uppercase tracking-cyber text-primary-fg shadow-neon"
            >
              <Terminal className="size-4" aria-hidden />
              {t('launchTerminal')}
            </Link>
            <p className="mt-3 text-center font-mono text-2xs uppercase tracking-cyber text-faint">
              {t('freeForever')}
            </p>
          </nav>
        </div>
      )}
    </header>
  );
}
