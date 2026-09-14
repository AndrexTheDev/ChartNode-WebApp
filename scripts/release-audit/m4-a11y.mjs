// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 4 — A11Y & UX-SEMANTIK: zugängliche Namen für alle Buttons/Links,
// Icon-Controls mit aria-label, Inputs beschriftet, keine doppelten Ids,
// Heading-Hierarchie ohne Sprünge, Landmarks (header/main/footer), img-alt,
// Dialog-Rollen, Tastatur-Erreichbarkeit (Tab-Seqenz), de + en × 3 Routen.
import { BASE, makeReporter, launchBrowser, newPage, gotoSafe, wait } from './lib.mjs';

export const META = { id: 'M4', name: 'A11y & UX-Semantik' };

const A11Y_FN =
  '(' +
  function () {
    const bad = { unnamed: [], dupIds: [], heads: [], noAlt: [], inputs: [] };
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
      if (!name) bad.unnamed.push(el.tagName + '.' + String(el.className).slice(0, 40));
    }
    const ids = {};
    for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
    bad.dupIds = Object.keys(ids).filter((k) => ids[k] > 1);
    let last = 0;
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const lvl = Number(h.tagName[1]);
      if (last && lvl > last + 1) bad.heads.push('h' + last + '→h' + lvl);
      last = lvl;
    }
    for (const img of document.querySelectorAll('img')) if (!img.getAttribute('alt')) bad.noAlt.push(img.src.slice(-40));
    for (const inp of document.querySelectorAll('input, select, textarea')) {
      const id = inp.getAttribute('id');
      const labelled =
        inp.getAttribute('aria-label') ||
        inp.getAttribute('placeholder') ||
        (id && document.querySelector('label[for="' + id + '"]')) ||
        inp.closest('label');
      if (!labelled) bad.inputs.push(inp.name || inp.type);
    }
    return {
      bad,
      landmarks: {
        header: !!document.querySelector('header'),
        main: !!document.querySelector('main'),
        footer: !!document.querySelector('footer'),
      },
      dialogs: [...document.querySelectorAll('[role="dialog"]')].every((d) => d.getAttribute('aria-modal') === 'true' || d.hasAttribute('aria-label')),
    };
  }.toString() +
  ')()';

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  const browser = await launchBrowser();

  for (const locale of ['de', 'en']) {
    for (const route of ['/', '/help', '/terminal']) {
      const page = await newPage(browser);
      await gotoSafe(page, BASE + '/' + locale + (route === '/' ? '' : route));
      await wait(route === '/terminal' ? 4000 : 2000);
      const tag = locale + route;
      const r = await page.evaluate(A11Y_FN);
      check(tag + ': alle Buttons/Links mit zugänglichem Namen', r.bad.unnamed.length === 0, r.bad.unnamed.slice(0, 2).join(', '));
      check(tag + ': keine doppelten Ids', r.bad.dupIds.length === 0, r.bad.dupIds.slice(0, 3).join(', '));
      check(tag + ': Heading-Hierarchie ohne Sprünge', r.bad.heads.length === 0, r.bad.heads.slice(0, 2).join(', '));
      check(tag + ': alle img mit alt', r.bad.noAlt.length === 0, r.bad.noAlt.slice(0, 2).join(', '));
      check(tag + ': alle Inputs beschriftet', r.bad.inputs.length === 0, r.bad.inputs.slice(0, 2).join(', '));
      check(tag + ': Landmarks header/main/footer', r.landmarks.header && r.landmarks.main && r.landmarks.footer);
      check(tag + ': Dialoge mit aria-modal/label', r.dialogs === true);

      /* Tastatur: 12 Tabs ⇒ Fokus wandert sichtbar durch Controls */
      await page.evaluate(() => document.body.focus());
      const seen = new Set();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const cur = await page.evaluate(() => {
          const a = document.activeElement;
          return a && a !== document.body ? a.tagName + ':' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 20) : '';
        });
        if (cur) seen.add(cur);
      }
      check(tag + ': Tab-Sequenz erreicht ≥6 verschiedene Controls', seen.size >= 6, 'n=' + seen.size);
      await page.close();
    }
  }
  await browser.close();
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
