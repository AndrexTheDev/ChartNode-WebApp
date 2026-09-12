// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { EXCHANGE_META } from './exchanges';
import type { ExchangeId } from '@/websockets/types';

/** Cookie written by `proxy.ts` from Cloudflare's `cf-ipcountry` request header. */
export const COUNTRY_COOKIE = 'nc_country';

/**
 * Timezone → ISO-3166 alpha-2, used when the edge cookie is missing (local dev,
 * non-Cloudflare hosting, or a visitor who blocked cookies). Only the zones that
 * map to a single country are listed; ambiguous ones (e.g. `CET`) are skipped
 * and simply return `null` – a wrong guess would be worse than no guess.
 */
const ZONE_TO_COUNTRY: Record<string, string> = {
  'Europe/Madrid': 'ES', 'Europe/Barcelona': 'ES', 'Atlantic/Canary': 'ES',
  'Europe/Berlin': 'DE', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH',
  'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Luxembourg': 'LU', 'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT',
  'Atlantic/Madeira': 'PT', 'Europe/Dublin': 'IE', 'Europe/London': 'GB',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Bratislava': 'SK',
  'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG',
  'Europe/Athens': 'GR', 'Europe/Helsinki': 'FI', 'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Tallinn': 'EE',
  'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT', 'Europe/Zagreb': 'HR',
  'Europe/Ljubljana': 'SI', 'Europe/Belgrade': 'RS', 'Europe/Kyiv': 'UA',
  'Europe/Chisinau': 'MD', 'Europe/Minsk': 'BY', 'Europe/Moscow': 'RU',
  'Europe/Istanbul': 'TR', 'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM',
  'Asia/Dubai': 'AE', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW',
  'Asia/Bahrain': 'BH', 'Asia/Riyadh': 'SA', 'Asia/Jerusalem': 'IL',
  'Asia/Tehran': 'IR', 'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN',
  'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP',
  'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Jakarta': 'ID',
  'Asia/Makassar': 'ID', 'Asia/Manila': 'PH', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Singapore': 'SG', 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW',
  'Asia/Almaty': 'KZ', 'Asia/Tashkent': 'UZ', 'Asia/Baku': 'AZ',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ', 'America/Sao_Paulo': 'BR', 'America/Rio_Branco': 'BR',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Santiago': 'CL',
  'America/Lima': 'PE', 'America/Bogota': 'CO', 'America/Caracas': 'VE',
  'America/Mexico_City': 'MX', 'America/Guatemala': 'GT', 'America/Costa_Rica': 'CR',
  'America/Panama': 'PA', 'America/New_York': 'US', 'America/Chicago': 'US',
  'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA',
  'Africa/Nairobi': 'KE', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN', 'Africa/Accra': 'GH',
};

/** ISO code from the edge (`proxy.ts` → cookie), else `null`. */
export function readCountryCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = /(?:^|;\s*)nc_country=([A-Za-z]{2})/.exec(document.cookie);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/** Best-effort country from the IANA timezone (single-country zones only). */
export function countryFromTimezone(timeZone?: string | null): string | null {
  const zone = timeZone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null);
  if (!zone) return null;
  return ZONE_TO_COUNTRY[zone] ?? null;
}

export interface RegionInfo {
  /** ISO-3166 alpha-2, or null when unknown. */
  country: string | null;
  source: 'edge' | 'timezone' | null;
}

/**
 * Region detection, cheapest and most accurate source first:
 *   1. `cf-ipcountry` — Cloudflare sets this on every request and `proxy.ts`
 *      mirrors it into a cookie, so it works on prerendered static pages too.
 *   2. IANA timezone — single-country zones only (no guessing on `CET` & co).
 */
export function detectRegion(): RegionInfo {
  const cookie = readCountryCookie();
  if (cookie) return { country: cookie, source: 'edge' };
  const zone = countryFromTimezone();
  if (zone) return { country: zone, source: 'timezone' };
  return { country: null, source: null };
}

/** True when the venue is known to refuse service in that country. */
export function isRestrictedIn(exchange: ExchangeId, country: string | null): boolean {
  if (!country) return false;
  return EXCHANGE_META[exchange]?.restricted.includes(country.toUpperCase()) ?? false;
}

/** Exchanges expected to be blocked for this visitor – used to pre-rank. */
export function restrictedExchanges(country: string | null): ExchangeId[] {
  if (!country) return [];
  return (Object.keys(EXCHANGE_META) as ExchangeId[]).filter((id) => isRestrictedIn(id, country));
}
