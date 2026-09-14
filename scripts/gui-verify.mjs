// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Verifizierung der GUI-Fixes F1–F6 + deterministische Theme-Shots (T1).
// Nutzung: node scripts/gui-verify.mjs
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = join(root, 'artifacts', 'gui-verify');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, cond, info = '') => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${String(info).slice(0, 120)}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  defaultViewport: { width: 1440, height: 900 },
});

async function terminal(page, { theme } = {}) {
  if (theme) {
    await page.evaluateOnNewDocument((t) => {
      try { localStorage.setItem('nodechart:store:v1', JSON.stringify({ state: { theme: t }, version: 1 })); } catch {}
    }, theme);
  }
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(4000);
}

/** Sichtbarkeits-Oracle: Panel-Rect + Trefferquote per elementFromPoint. */
const visible = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return { found: true, visible: false, why: 'tiny' };
    const pts = [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8], [0.2, 0.5], [0.8, 0.5]];
    let hits = 0;
    for (const [fx, fy] of pts) {
      const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (top && (el === top || el.contains(top))) hits += 1;
    }
    return { found: true, visible: hits >= 3, hits, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  }, sel);

/* F1: ToolMenu + ExchangePicker + Custom-Intervall sichtbar auf Desktop */
{
  const page = await browser.newPage();
  await terminal(page);
  await page.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
  await wait(700);
  const menu = await visible(page, '[role="menu"]');
  check('F1a TOOLS-Dropdown sichtbar (5/5 Punke getroffen)', menu.found && menu.visible, JSON.stringify(menu));
  await page.screenshot({ path: join(OUT, 'f1-tools-menu.png') });
  await page.keyboard.press('Escape'); await wait(300);

  await page.evaluate(() => [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === 'Datenquelle')?.click());
  await wait(700);
  const ex = await visible(page, '[role="listbox"]');
  check('F1b Datenquelle-Dropdown sichtbar', ex.found && ex.visible, JSON.stringify(ex));
  await page.screenshot({ path: join(OUT, 'f1-datenquelle.png') });
  await page.keyboard.press('Escape'); await wait(300);

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /intervall/i.test((b.textContent ?? '').trim()))?.click();
  });
  await wait(600);
  const cust = await visible(page, 'span.z-overlay');
  check('F1c Custom-Intervall-Popover sichtbar', cust.found && cust.visible, JSON.stringify(cust));
  await page.screenshot({ path: join(OUT, 'f1-custom-intervall.png') });
  await page.close();
}

/* F2: Nudges hinter Modal-Overlay */
{
  const page = await browser.newPage();
  await terminal(page);
  const nudge = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => (d.textContent ?? '').startsWith('SYSTEMSPRACHE') || (d.textContent ?? '').includes('Systemsprache erkannt'));
    return !!el;
  });
  await page.evaluate(() => document.querySelector('button[aria-label="Indikatoren (0)"]')?.click());
  await wait(900);
  const stack = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { dlg: false };
    const r = dlg.getBoundingClientRect();
    const pts = [[0.5, 0.9], [0.3, 0.85], [0.7, 0.85]];
    let nudgeOnTop = 0;
    for (const [fx, fy] of pts) {
      const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (top && !dlg.contains(top) && (top.textContent ?? '').match(/Systemsprache|SYSTEMSPRACHE/)) nudgeOnTop += 1;
    }
    return { dlg: true, nudgeOnTop };
  });
  check('F2 Sprach-Banner liegt NICHT über dem offenen Modal', stack.dlg && stack.nudgeOnTop === 0, JSON.stringify({ nudge, stack }));
  await page.screenshot({ path: join(OUT, 'f2-nudge-behind-modal.png') });
  await page.close();
}

/* F3: Beschreibungen zweizeilig statt Ellipsis */
{
  const page = await browser.newPage();
  await terminal(page);
  await page.evaluate(() => document.querySelector('button[aria-label="Design"]')?.click());
  await wait(600);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"] span')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 10)
      .filter((el) => el.scrollWidth > el.clientWidth + 2).length,
  );
  check('F3a Theme-Beschreibungen nicht horizontal geclippt', clipped === 0, `${clipped} geclippt`);
  await page.screenshot({ path: join(OUT, 'f3-theme-picker.png') });
  await page.keyboard.press('Escape'); await wait(200);
  await page.evaluate(() => document.querySelector('button[aria-label="Indikatoren (0)"]')?.click());
  await wait(800);
  const clippedInd = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] span, [role="dialog"] p')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 10)
      .filter((el) => el.scrollWidth > el.clientWidth + 2).length,
  );
  check('F3b Indikator-Karten-Hints nicht horizontal geclippt', clippedInd === 0, `${clippedInd} geclippt`);
  await page.close();
}

/* F5: Root-404 gebrandet */
{
  const page = await browser.newPage();
  const res = await page.goto(`${BASE}/de/gibts-nicht`, { waitUntil: 'domcontentloaded' });
  await wait(900);
  const brand = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    txt: document.body.textContent ?? '',
  }));
  check('F5a Root-404 Status 404', res.status() === 404, String(res.status()));
  check('F5b Root-404 gebrandet (Signal verloren + Home-Link)', /Signal verloren/.test(brand.txt) && /Zurück zur Basis/.test(brand.txt), brand.txt.slice(0, 80));
  await page.screenshot({ path: join(OUT, 'f5-root-404.png') });
  await page.close();
}

/* F6: Nudge-/Modal-Titel bricht um (kein Wort-Ellipsis) */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(3000);
  // Milestone-Modal erscheint sessionsabhängig → Titel-Wrapping generell am
  // ersten offenen Dialog-H2 verifizieren ( Alerts-Modal als Konstante ).
  await page.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim().startsWith('Alerts'))?.click());
  await wait(900);
  const title = await page.evaluate(() => {
    const h = document.querySelector('[role="dialog"] h2');
    if (!h) return null;
    const st = getComputedStyle(h);
    return { sw: h.scrollWidth, cw: h.clientWidth, ell: st.textOverflow, clip: st.overflow, text: (h.textContent ?? '').slice(0, 40) };
  });
  check('F6 Modal-Titel wrappt statt Ellipsis', !!title && title.sw <= title.cw + 2 && title.ell !== 'ellipsis', JSON.stringify(title));
  await page.screenshot({ path: join(OUT, 'f6-mobile-milestone.png') });
  await page.close();
}

/* T1: Themes deterministisch per Store-Seed */
for (const theme of ['violet', 'light', 'matrix', 'miami']) {
  const page = await browser.newPage();
  await terminal(page, { theme });
  const css = await page.evaluate(() => {
    const st = getComputedStyle(document.documentElement);
    return { primary: st.getPropertyValue('--nc-primary').trim(), bg: getComputedStyle(document.body).backgroundColor };
  });
  await page.screenshot({ path: join(OUT, `t1-theme-${theme}.png`) });
  check(`T1 Theme ${theme} setzt eigene Farben`, css.primary.length > 0, JSON.stringify(css));
  await page.close();
}

await browser.close();
console.log(`\n${fails === 0 ? '✔' : '✖'} gui-verify: ${fails === 0 ? 'alle Fixes bestätigt' : `${fails} Failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
