// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Locale } from '@/i18n/routing';

export interface LocaleMeta {
  /** Route segment + next-intl locale code. */
  code: Locale;
  /** English name – used in `aria-label`s and og metadata. */
  label: string;
  /** Native name – what the user actually reads in the switcher. */
  nativeLabel: string;
  /** Exact BCP-47 tag for `<html lang>` (critical for screen readers + SEO). */
  htmlLang: string;
  /** Facebook/OpenGraph locale. */
  ogLocale: string;
  /** Short uppercase code shown in the collapsed switcher trigger. */
  short: string;
  /** Font stack hint – CJK needs system fallbacks, latin does not. */
  script: 'latin' | 'cyrillic' | 'cjk';
}

/**
 * Static metadata per locale. Kept out of the message bundles on purpose:
 * these values describe the language itself and must never be translated.
 */
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: {
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    htmlLang: 'en',
    ogLocale: 'en_US',
    short: 'EN',
    script: 'latin',
  },
  de: {
    code: 'de',
    label: 'German',
    nativeLabel: 'Deutsch',
    htmlLang: 'de-DE',
    ogLocale: 'de_DE',
    short: 'DE',
    script: 'latin',
  },
  es: {
    code: 'es',
    label: 'Spanish',
    nativeLabel: 'Español',
    htmlLang: 'es-ES',
    ogLocale: 'es_ES',
    short: 'ES',
    script: 'latin',
  },
  zh: {
    code: 'zh',
    label: 'Chinese (Simplified)',
    nativeLabel: '简体中文',
    htmlLang: 'zh-Hans',
    ogLocale: 'zh_CN',
    short: '中文',
    script: 'cjk',
  },
  ru: {
    code: 'ru',
    label: 'Russian',
    nativeLabel: 'Русский',
    htmlLang: 'ru-RU',
    ogLocale: 'ru_RU',
    short: 'RU',
    script: 'cyrillic',
  },
};

export const LOCALE_LIST: LocaleMeta[] = (Object.keys(LOCALE_META) as Locale[]).map(
  (code) => LOCALE_META[code],
);

/** Extra font fallbacks for scripts our latin/cyrillic webfonts do not cover. */
export const SCRIPT_FONT_FALLBACK: Record<LocaleMeta['script'], string> = {
  latin: '',
  cyrillic: '',
  cjk: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif',
};
