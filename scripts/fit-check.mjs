// Viewport-Fit-Check: jedes Dropdown/Menu muss vollständig in die Ansicht
// passen (notfalls mit internem Scroll) – über breite UND niedrige Viewports.
// Nutzung: node scripts/fit-check.mjs
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = join(root, 'artifacts', 'fit-check');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Escape + Outside-Click-Fallback: schließt jedes offene Panel deterministisch. */
async function closePanels(page) {
  await page.keyboard.press('Escape');
  await wait(300);
  const still = await page.evaluate(() => document.querySelectorAll('[role="menu"],[role="listbox"]').length);
  if (still > 0) {
    // neutraler Punkt: Chart-Mitte (kein Navigations-Element)
    const vp = page.viewport();
    await page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height * 0.6));
    await wait(300);
  }
  return page.evaluate(() => document.querySelectorAll('[role="menu"],[role="listbox"]').length === 0);
}
let fails = 0;
const check = (name, cond, info = '') => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${String(info).slice(0, 120)}` : ''}`);
};

const VPS = [
  ['desktop', 1440, 900],
  ['laptop-low', 1280, 620],
  ['short', 1024, 500],
  ['tablet', 834, 1112],
  ['mobile', 390, 844],
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});

const panelFit = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[role="menu"], [role="listbox"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    return {
      found: true,
      inView: r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1,
      scrollable: el.scrollHeight > el.clientHeight + 2,
      maxH: getComputedStyle(el).maxHeight,
      rect: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) },
      vh, vw,
    };
  });

for (const [name, width, height] of VPS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(4000);

  // 1) ToolMenu (längstes Menü: 8 Items)
  await page.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
  await wait(600);
  let fit = await panelFit(page);
  check(`${name}: TOOLS-Menü vollständig in Ansicht`, fit.found && fit.inView, JSON.stringify(fit));
  await page.screenshot({ path: join(OUT, `${name}-tools.png`) });
  check(`${name}: Escape/Outside schließt das Menü`, await closePanels(page));

  // 2) Datenquelle/ExchangePicker (6 Items + Hints)
  await page.evaluate(() => [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === 'Datenquelle')?.click());
  await wait(600);
  fit = await panelFit(page);
  check(`${name}: Datenquelle-Menü vollständig in Ansicht`, fit.found && fit.inView, JSON.stringify(fit));
  check(`${name}: Escape/Outside schließt Datenquelle`, await closePanels(page));

  // 3) Chart-Typ-Dropdown (10 Items)
  await page.evaluate(() => {
    [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
      .find((b) => /candles|renko|linie|point/i.test(b.getAttribute('aria-label') ?? ''))?.click();
  });
  await wait(600);
  fit = await panelFit(page);
  check(`${name}: Chart-Typ-Menü vollständig in Ansicht`, fit.found && fit.inView, JSON.stringify(fit));
  if (height <= 620) await page.screenshot({ path: join(OUT, `${name}-charttypes.png`) });
  await closePanels(page);

  // 4) Coin-Picker-Dropdown NICHT mehr in der Toolbar
  const pickers = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
      .filter((b) => /symbol/i.test(b.getAttribute('aria-label') ?? ''));
    return {
      total: triggers.length,
      inToolbar: triggers.filter((b) => b.closest('.sticky')).length,
      inPane: triggers.filter((b) => !b.closest('.sticky')).length,
    };
  });
  check(`${name}: kein Coin-Dropdown in Toolbar, Chart-Header-Picker bleibt`, pickers.inToolbar === 0 && pickers.inPane >= 1, JSON.stringify(pickers));

  await page.close();
}

await browser.close();
console.log(`\n${fails === 0 ? '✔' : '✖'} fit-check: ${fails === 0 ? 'alle Menüs sitzen in der Ansicht' : `${fails} Failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
