// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { notFound } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/routing';

/**
 * Route params always arrive as `string`. This narrows them to the supported
 * `Locale` union – which is what next-intl's typed `getTranslations` requires –
 * and renders the 404 for anything else (e.g. `/fr/…`).
 *
 * Server Components only.
 */
export function assertLocale(value: string): Locale {
  if (!isLocale(value)) notFound();
  return value;
}
