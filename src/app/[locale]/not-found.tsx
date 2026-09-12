// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { getTranslations } from 'next-intl/server';
import { HelpCircle, Home } from 'lucide-react';
import { NeonButton } from '@/components/ui/NeonButton';
import { GlitchText } from '@/components/ui/GlitchText';
import { ROUTES } from '@/lib/constants';

export default async function NotFound() {
  // `notFound()` inside a [locale] subtree still has the locale in scope, so
  // getTranslations() resolves without an explicit locale argument.
  const t = await getTranslations('notFound');

  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-6 py-24 text-center">
      <GlitchText
        as="p"
        text={t('code')}
        className="font-display text-[6rem] font-black leading-none text-primary neon-text sm:text-[9rem]"
      />
      <h1 className="text-3xl font-black sm:text-4xl">{t('title')}</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted">{t('body')}</p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <NeonButton href={ROUTES.home} size="lg" leading={<Home className="size-4" aria-hidden />}>
          {t('cta')}
        </NeonButton>
        <NeonButton
          href={ROUTES.help}
          size="lg"
          variant="outline"
          leading={<HelpCircle className="size-4" aria-hidden />}
        >
          {t('secondary')}
        </NeonButton>
      </div>
    </div>
  );
}
