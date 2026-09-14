// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 2 — ROUTING & SEO: 5 Locales × 6 Routen = 30 Seiten gegen den
// Production-Build: HTTP-Status, <html lang>, genau 1 H1, Title/OG/Canonical/
// Hreflang-Vollständigkeit, keine Missing-Translation-Artefakte, JSON-LD auf
// der Landing parse-bar, Console-/Pageerror-Scan (CORS-Blinde gefiltert).
import { LOCALES, ROUTES, BASE, makeReporter, launchBrowser, newPage, attachConsole, gotoSafe, wait } from './lib.mjs';

export const META = { id: 'M2', name: 'Routing & SEO (30 Seiten)' };

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  const browser = await launchBrowser();

  for (const locale of LOCALES) {
    const page = await newPage(browser);
    const errs = [];
    attachConsole(page, errs);
    for (const route of ROUTES) {
      const url = BASE + '/' + locale + (route === '/' ? '' : route);
      const res = await gotoSafe(page, url);
      await wait(1200);
      const tag = locale + route;
      const status = res ? res.status() : 0;
      check(tag + ': HTTP 200', status === 200, 'status=' + status);
      const meta = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        return {
          lang: q('html')?.getAttribute('lang'),
          h1: document.querySelectorAll('h1').length,
          title: document.title,
          canonical: q('link[rel="canonical"]')?.getAttribute('href') || '',
          hreflangs: [...document.querySelectorAll('link[hreflang]')].map((l) => l.getAttribute('hreflang')),
          og: !!q('meta[property="og:title"]') && !!q('meta[property="og:description"]'),
          robots: q('meta[name="robots"]')?.getAttribute('content') || '',
          jsonldBad: [...document.querySelectorAll('script[type="application/ld+json"]')].filter((s) => {
            try { JSON.parse(s.textContent || ''); return false; } catch { return true; }
          }).length,
          missing: /MISSING_MESSAGE|MISSING_FORMAT/i.test(document.body.innerText),
        };
      });
      const path = '/' + locale + (route === '/' ? '' : route);
      check(tag + ': html lang korrekt (BCP-47-Präfix)', (meta.lang || '').startsWith(locale), 'lang=' + meta.lang);
      check(tag + ': genau 1 H1', meta.h1 === 1, 'h1=' + meta.h1);
      check(tag + ': Title gesetzt', meta.title.length > 8, meta.title.slice(0, 40));
      check(tag + ': Canonical = eigener Pfad', meta.canonical.includes(path), meta.canonical.slice(-40));
      check(tag + ': Hreflang = 5 Locales + x-default', meta.hreflangs.length >= LOCALES.length + 1, 'n=' + meta.hreflangs.length);
      check(tag + ': OG-Tags vorhanden', meta.og === true);
      check(tag + ': nicht auf noindex', !/noindex/.test(meta.robots), meta.robots);
      check(tag + ': JSON-LD parse-bar', meta.jsonldBad === 0, 'bad=' + meta.jsonldBad);
      check(tag + ': keine Missing-Translation-Artefakte', meta.missing === false);
      if (route === '/') {
        const hasLd = await page.evaluate(() => document.querySelectorAll('script[type="application/ld+json"]').length > 0);
        check(tag + ': Landing trägt JSON-LD', hasLd);
      }
    }
    check(locale + ': keine Console-/Pageerrors über 6 Routen', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  await browser.close();
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
