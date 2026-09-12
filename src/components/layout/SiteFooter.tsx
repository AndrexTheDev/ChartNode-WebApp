// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { getTranslations } from 'next-intl/server';
import { ArrowUpRight, HelpCircle, Mail, Scale, ShieldAlert, FileText } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { APP_VERSION, CONTACT, ROUTES, SITE_NAME } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Logo } from './Logo';
import { StatusLed } from '@/components/ui/StatusLed';

type FooterLinkKey =
  | 'terminal'
  | 'features'
  | 'layouts'
  | 'terms'
  | 'disclaimer'
  | 'privacy'
  | 'help'
  | 'contact';

interface FooterLink {
  href: string;
  labelKey: FooterLinkKey;
  icon: typeof Mail;
  external?: boolean;
}

/**
 * Server component on purpose: every legal + support link is real, crawlable
 * HTML with a locale-prefixed href – no client-side hydration needed.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'footer' });
  const tn = await getTranslations({ locale, namespace: 'nav' });
  const year = new Date().getFullYear();

  const product: FooterLink[] = [
    { href: ROUTES.terminal, labelKey: 'terminal', icon: ArrowUpRight },
    { href: '/#features', labelKey: 'features', icon: ArrowUpRight },
    { href: '/#layouts', labelKey: 'layouts', icon: ArrowUpRight },
  ];

  const legal: FooterLink[] = [
    { href: ROUTES.terms, labelKey: 'terms', icon: Scale },
    { href: ROUTES.disclaimer, labelKey: 'disclaimer', icon: ShieldAlert },
    { href: ROUTES.privacy, labelKey: 'privacy', icon: FileText },
  ];

  const support: FooterLink[] = [
    { href: ROUTES.help, labelKey: 'help', icon: HelpCircle },
    { href: CONTACT.mailto, labelKey: 'contact', icon: Mail, external: true },
  ];

  const columnClass = 'flex flex-col gap-2.5';
  const linkClass =
    'nc-clip-sm group inline-flex w-fit items-center gap-2 px-2 py-1.5 -ml-2 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors duration-200 hover:bg-elevated hover:text-primary';

  return (
    /*
     * `--nc-dock-offset` is published by any fixed bottom bar on the page
     * (currently the whale ticker on /terminal). It defaults to 0px, so routes
     * without such a bar render exactly as before. Without it the fixed bar
     * covers the last line of footer copy.
     */
    <footer
      className="relative mt-24 border-t border-line/80 bg-bg/70 pb-[var(--nc-dock-offset,0px)] backdrop-blur-sm"
    >
      <div aria-hidden className="nc-hatch h-2 w-full opacity-40" />

      <div className="container grid gap-12 py-14 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        {/* Brand */}
        <div className="flex flex-col gap-5">
          <Logo />
          <p className="max-w-sm text-sm leading-relaxed text-muted">{t('blurb')}</p>

          <div className="flex flex-wrap items-center gap-3">
            <StatusLed tone="ok" label={t('statusOk')} />
            <span className="nc-chip">v{APP_VERSION}</span>
          </div>

          <a
            href={CONTACT.mailto}
            className={cn(
              'nc-clip-sm inline-flex w-fit items-center gap-2.5 border border-primary/40 bg-primary/5 px-4 py-2.5',
              'font-mono text-2xs uppercase tracking-cyber text-primary transition-all duration-200',
              'hover:border-primary hover:bg-primary/12 hover:shadow-neon-sm',
            )}
          >
            <Mail className="size-3.5" aria-hidden />
            <span className="flex flex-col items-start leading-tight">
              <span>{t('contact')}</span>
              <span className="normal-case tracking-normal text-faint">
                {t('contactVia', { handle: CONTACT.handle })}
              </span>
            </span>
          </a>
        </div>

        {/* Product */}
        <nav aria-label={t('productTitle')} className={columnClass}>
          <h2 className="mb-1 font-mono text-2xs uppercase tracking-mega text-faint">
            {t('productTitle')}
          </h2>
          {product.map(({ href, labelKey, icon: Icon }) => (
            <Link key={labelKey} href={href} className={linkClass}>
              <Icon className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              {t(labelKey)}
            </Link>
          ))}
        </nav>

        {/* Legal */}
        <nav aria-label={t('legalTitle')} className={columnClass}>
          <h2 className="mb-1 font-mono text-2xs uppercase tracking-mega text-faint">
            {t('legalTitle')}
          </h2>
          {legal.map(({ href, labelKey, icon: Icon }) => (
            <Link key={labelKey} href={href} className={linkClass}>
              <Icon className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              {t(labelKey)}
            </Link>
          ))}
        </nav>

        {/* Support */}
        <nav aria-label={t('supportTitle')} className={columnClass}>
          <h2 className="mb-1 font-mono text-2xs uppercase tracking-mega text-faint">
            {t('supportTitle')}
          </h2>
          {support.map(({ href, labelKey, icon: Icon, external }) =>
            external ? (
              <a
                key={labelKey}
                href={href}
                className={linkClass}
                rel="noopener noreferrer"
              >
                <Icon className="size-3" aria-hidden />
                {t(labelKey)}
              </a>
            ) : (
              <Link key={labelKey} href={href} className={linkClass}>
                <Icon className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                {t(labelKey)}
              </Link>
            ),
          )}

          <div className="mt-3">
            <span className="mb-2 block font-mono text-2xs uppercase tracking-mega text-faint">
              {tn('language')}
            </span>
            <LocaleSwitcher />
          </div>
        </nav>
      </div>

      <div className="nc-divider" />

      <div className="container flex flex-col gap-3 py-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p className="font-mono text-2xs uppercase tracking-cyber text-faint">
          © {year} {SITE_NAME}. {t('rights')} · {t('madeBy')} {CONTACT.handle}
        </p>
        <p className="font-mono text-2xs uppercase tracking-cyber text-faint">{t('builtWith')}</p>
      </div>

      <p className="container pb-8 text-center font-mono text-2xs text-faint/80 sm:text-left">
        {t('demoNotice')}
      </p>
    </footer>
  );
}
