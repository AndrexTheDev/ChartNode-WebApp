// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Messages } from 'next-intl';
import type en from '../../messages/en.json';

/**
 * Type-safe messages for next-intl.
 * `en.json` is the reference bundle – `scripts/check-i18n.mjs` guarantees the
 * other four locales have an identical key structure, so typing against it is
 * sound and every `t('…')` call is autocompleted + checked at build time.
 */
declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof en;
    Locale: 'en' | 'de' | 'es' | 'zh' | 'ru';
  }
}

export type AppMessages = typeof en;
export type { Messages };

/*
 * Vendor-prefixed WebAudio constructor on older Safari/iOS builds.
 * Declared once here so call sites need no `as unknown as` escape hatch –
 * the prefix is part of the platform surface, not a type error to hide.
 */
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
