// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 12 — HTTP-/SSR-Baseline: lokal ausführbar ohne Browser oder Drittanbieter.
// Benötigt einen laufenden Next-Produktionsserver über BASE_URL.
import { BASE, makeReporter } from './lib.mjs';

export const META = { id: 'M12', name: 'HTTP/SSR-Baseline (Header, OG, Fonts, Privacy)' };

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  let home;
  let homeHtml = '';
  try {
    home = await fetch(`${BASE}/de`);
    homeHtml = await home.text();
  } catch (error) {
    check('Produktionsserver erreichbar', false, String(error?.message || error));
    return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
  }

  check('GET /de liefert 200 + HTML', home.status === 200 && (home.headers.get('content-type') || '').includes('text/html'));
  check('X-Content-Type-Options: nosniff', home.headers.get('x-content-type-options') === 'nosniff');
  check('Referrer-Policy vorhanden', (home.headers.get('referrer-policy') || '').length > 4, home.headers.get('referrer-policy') || 'missing');
  check('Permissions-Policy schränkt Kamera ein', (home.headers.get('permissions-policy') || '').includes('camera=()'));
  check('X-Powered-By nicht offengelegt', !home.headers.has('x-powered-by'));

  const locales = ['de', 'en', 'es', 'ru', 'zh'];
  const fontHrefs = new Set();
  for (const locale of locales) {
    let response;
    let html = '';
    try {
      response = locale === 'de' ? home : await fetch(`${BASE}/${locale}`);
      html = locale === 'de' ? homeHtml : await response.text();
    } catch (error) {
      check(`${locale} Font-Preload`, false, String(error?.message || error));
      continue;
    }
    const links = html.match(/<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="font")[^>]*>/gi) || [];
    const href = links[0]?.match(/\bhref="([^"]+)"/)?.[1];
    if (href) fontHrefs.add(new URL(href, BASE).href);
    check(`${locale} hat exakt einen Font-Preload`, response.status === 200 && links.length === 1 && Boolean(href), `status=${response.status}; count=${links.length}`);
  }
  let fontAssetsOk = fontHrefs.size > 0;
  const fontDetails = [];
  for (const href of fontHrefs) {
    try {
      const response = await fetch(href);
      const contentType = response.headers.get('content-type') || '';
      const ok = response.status === 200 && contentType.includes('font/woff2');
      fontAssetsOk &&= ok;
      fontDetails.push(`${response.status} ${contentType}`);
    } catch (error) {
      fontAssetsOk = false;
      fontDetails.push(String(error?.message || error));
    }
  }
  check('Preload-WOFF2-Assets liefern HTTP 200', fontAssetsOk, fontDetails.join('; '));

  try {
    const normal = await fetch(`${BASE}/api/og?ticker=SOL&price=150`);
    const normalBody = await normal.text();
    const image = (normal.headers.get('content-type') || '').includes('svg') || (normal.headers.get('content-type') || '').includes('png');
    check('OG-Endpunkt liefert 200-Bild ohne Script-Markup', normal.status === 200 && image && !/<script\b/i.test(normalBody));

    const malicious = await fetch(`${BASE}/api/og?ticker=%3Csvg%20onload%3Dalert(1)%3E&price=150`);
    const maliciousBody = await malicious.text();
    const maliciousImage = (malicious.headers.get('content-type') || '').includes('svg') || (malicious.headers.get('content-type') || '').includes('png');
    check('OG-Endpunkt escaped aktives Markup aus Query-Input', malicious.status === 200 && maliciousImage && !/<script\b|onload\s*=/i.test(maliciousBody));
  } catch (error) {
    check('OG-Endpunkt HTTP-Smoke', false, String(error?.message || error));
  }

  try {
    const privacy = await fetch(`${BASE}/de/legal/privacy`);
    const body = await privacy.text();
    check('Privacy-SSR nennt Locale-Cookie und Ad-Partner', privacy.status === 200 && body.includes('NEXT_LOCALE') && /Adsterra|Ad-Partner/i.test(body));
  } catch (error) {
    check('Privacy-SSR HTTP-Smoke', false, String(error?.message || error));
  }

  try {
    const invalid = await fetch(`${BASE}/xx/terminal`, { redirect: 'manual' });
    check('Ungültige Locale endet mit 404 oder Redirect, nicht 5xx', invalid.status === 404 || (invalid.status >= 300 && invalid.status < 400), `HTTP ${invalid.status}`);
  } catch (error) {
    check('Invalid-Locale HTTP-Smoke', false, String(error?.message || error));
  }

  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
