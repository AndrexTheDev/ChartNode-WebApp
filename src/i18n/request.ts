// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * Resolved once per request (or once per prerendered page in SSG).
 * `locale` MUST be returned explicitly – next-intl 4 relies on it downstream.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    timeZone: 'UTC',
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
