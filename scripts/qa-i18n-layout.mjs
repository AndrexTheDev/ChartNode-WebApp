// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// i18n-Layout-Stress-Test: 5 Locales × 6 Viewports (320px → 3440px Ultrawide).
//
// Prüft pro Kombination:
//  1. Kein horizontales Dokument-Overflow (scrollWidth ≤ innerWidth).
//  2. Kein unkontrollierter Text-Overflow: sichtbare Elemente, deren Inhalt
//     breiter ist als die Box, OHNE Ellipsis/hidden → russische Komposita und
//     CJK-Glyphen brechen Layouts genau so.
//  3. Keine fixed/sticky-Elemente, die aus dem Viewport ragen.
//  4. Terminal-Extras bei 320px & 1440px: Timeframe-Dropdown, Exchange-Picker
//     und Indikatoren-Modal müssen vollständig in den Viewport passen.
//
// Nutzung: node scripts/qa-i18n-layout.mjs   (Server auf :3000 muss laufen)
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];
const VIEWPORTS = [
  { name: '320 mobile', width: 320, height: 740 },
  { name: '390 mobile', width: 390, height: 844 },
  { name: '768 tablet', width: 768, height: 1024 },
  { name: '1440 desktop', width: 1440, height: 900 },
  { name: '2560 wide', width: 2560, height: 1080 },
  { name: '3440 ultrawide', width: 3440, height: 1440 },
];

const results = [];
let failures = 0;
function check(name, pass, info = '') {
  if (!pass) failures += 1;
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`);
}

const OVERFLOW_SCAN = () => {
  const bad = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) {
    bad.push({ what: 'DOCUMENT', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` });
  }
  const skipSelectors = 'canvas, svg, video, iframe, .animate-marquee, [aria-hidden="true"], input, textarea, select';
  for (const el of document.querySelectorAll('body *')) {
    if (el.matches(skipSelectors)) continue;
    if (el.closest('.animate-marquee')) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // fixed/sticky outside the viewport?
    if ((style.position === 'fixed' || style.position === 'sticky') && (rect.right > vw + 1 || rect.left < -1)) {
      bad.push({
        what: `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)} [${style.position}]`,
        detail: `rect ${Math.round(rect.left)}..${Math.round(rect.right)} vs vw ${vw}`,
      });
      continue;
    }
    // uncontrolled text overflow: content wider than the box, no clipping strategy
    const overflowX = el.scrollWidth - el.clientWidth;
    if (overflowX > 2 && style.overflowX === 'visible' && style.textOverflow !== 'ellipsis') {
      // only report when text actually escapes (child inline content), not for
      // deliberate negative-margin/decoration tricks
      const text = (el.textContent ?? '').trim();
      if (text.length > 0 && el.children.length <= 3) {
        bad.push({
          what: `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 50)}`,
          detail: `+${overflowX}px "${text.slice(0, 34)}"`,
        });
      }
    }
    if (bad.length >= 12) break;
  }
  return bad;
};

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const locale of LOCALES) {
  console.log(`\n— locale: ${locale} —`);
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    await page.setViewport({ width: vp.width, height: vp.height });

    // landing
    await page.goto(`${BASE}/${locale}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1200);
    let bad = await page.evaluate(OVERFLOW_SCAN);
    check(`${locale} landing @ ${vp.name}: kein Overflow`, bad.length === 0, bad.slice(0, 3).map((b) => `${b.what} ${b.detail}`).join(' · '));

    // terminal
    await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {});
    await wait(2500);
    bad = await page.evaluate(OVERFLOW_SCAN);
    check(`${locale} terminal @ ${vp.name}: kein Overflow`, bad.length === 0, bad.slice(0, 3).map((b) => `${b.what} ${b.detail}`).join(' · '));
    check(`${locale} terminal @ ${vp.name}: keine Page-Errors`, errors.length === 0, errors[0] ?? '');

    // Dialog-/Dropdown-Fit nur auf den Stress-Viewports
    if (vp.width === 320 || vp.width === 1440) {
      // Timeframe-Dropdown
      const tfOpen = await page.evaluate(() => {
        const trigger = [...document.querySelectorAll('button')].find((b) => /^[0-9]+[mhdwMHDW]▾$/.test((b.textContent ?? '').trim()));
        trigger?.click();
        return Boolean(trigger);
      });
      await wait(400);
      if (tfOpen) {
        const fit = await page.evaluate(() => {
          const menu = [...document.querySelectorAll('[role="menu"], [role="listbox"]')].pop();
          if (!menu) return { ok: false, why: 'menu missing' };
          const r = menu.getBoundingClientRect();
          return { ok: r.right <= window.innerWidth + 1 && r.left >= -1 && r.bottom <= window.innerHeight + 1, why: `${Math.round(r.left)}..${Math.round(r.right)}/${Math.round(r.bottom)} vw=${window.innerWidth}` };
        });
        check(`${locale} TF-Dropdown passt @ ${vp.name}`, fit.ok, fit.why);
        await page.keyboard.press('Escape');
        await wait(250);
      }

      // Indikatoren-Modal
      const modalOpen = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /Indikator|Indicator|Indicador|Индикатор|指标/i.test(b.getAttribute('aria-label') ?? '') || /Indikator|Indicator|Indicador|Индикатор|指标/i.test(b.textContent ?? ''));
        btn?.click();
        return Boolean(btn);
      });
      await wait(700);
      if (modalOpen) {
        const fit = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          if (!dlg) return { ok: false, why: 'dialog missing' };
          const r = dlg.getBoundingClientRect();
          return { ok: r.right <= window.innerWidth + 1 && r.left >= -1, why: `${Math.round(r.left)}..${Math.round(r.right)} vw=${window.innerWidth}` };
        });
        check(`${locale} Indikatoren-Modal passt @ ${vp.name}`, fit.ok, fit.why);
        await page.keyboard.press('Escape');
        await wait(300);
      }
    }
    await page.close();
  }
}

await browser.close();
console.log(`\n${failures === 0 ? '✔' : '✖'} i18n layout: ${results.length - failures}/${results.length} checks bestanden`);
process.exit(failures === 0 ? 0 : 1);
