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

  // 5) toter ALERT-Chip entfernt (funktionierender Weg: Tools → Alerts)
  const alertChip = await page.evaluate(() =>
    [...document.querySelectorAll('.sticky button, .sticky label')]
      .filter((el) => (el.textContent ?? '').trim().toLowerCase() === 'alert').length,
  );
  check(`${name}: kein toter ALERT-Chip in der Toolbar`, alertChip === 0, `gefunden: ${alertChip}`);

  // 6) kein natives <select> mehr in der Toolbar (Compare ist jetzt Design-Dropdown)
  const nativeSelects = await page.evaluate(() => document.querySelectorAll('.sticky select').length);
  check(`${name}: kein natives Select in der Toolbar`, nativeSelects === 0, `gefunden: ${nativeSelects}`);

  // 7) Compare-Dropdown öffnet sich im Design-System und passt in die Ansicht
  await page.evaluate(() =>
    [...document.querySelectorAll('.sticky button[aria-haspopup="listbox"]')]
      .find((b) => /vergleich|compare/i.test(b.getAttribute('aria-label') ?? ''))?.click(),
  );
  await wait(600);
  fit = await panelFit(page);
  check(`${name}: Compare-Dropdown vollständig in Ansicht`, fit.found && fit.inView, JSON.stringify(fit));
  check(`${name}: Escape schließt Compare-Dropdown`, await closePanels(page));

  // 8) Börse/Chain als Klartext im Pane-Header sichtbar (Datenquelle eindeutig)
  const VENUES = ['Binance','Bybit','OKX','Bitfinex','KuCoin','Coinbase','Gate','Kraken','MEXC','Bitget','BingX','Crypto.com','Solana','Ethereum','Base','BNB Chain'];
  const headerVenue = await page.evaluate((names) => {
    const paneHead = [...document.querySelectorAll('div,span')].find((el) => el.className.includes?.('nc-chip') && names.some((n) => (el.textContent ?? '') === n));
    return paneHead ? (paneHead.textContent ?? '') : null;
  }, VENUES);
  check(`${name}: Venue-Klartext-Chip im Pane-Header`, headerVenue != null, headerVenue ?? 'kein Chip');

  // 9) ExchangePicker-Trigger zeigt vollen Börsennamen (nicht nur Kürzel)
  const pickerName = await page.evaluate((names) => {
    const b = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label') === 'Datenquelle');
    const txt = b?.textContent ?? '';
    return names.find((n) => txt.includes(n)) ?? null;
  }, VENUES);
  check(`${name}: Datenquelle-Trigger zeigt Börsen-Klartext`, pickerName != null, pickerName ?? 'kein Name');

  // 10) Smart-Search: Börsen-Filter greift (nur desktop, braucht Such-Panel)
  if (name === 'desktop') {
    await page.click('input[role="combobox"]');
    await page.type('input[role="combobox"]', 'btc', { delay: 40 });
    await wait(1500);
    await page.evaluate(() =>
      [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((b) => (b.getAttribute('aria-label') ?? '') === 'Börse filtern')?.click(),
    );
    await wait(400);
    await page.evaluate(() =>
      [...document.querySelectorAll('[role="listbox"] button, [role="menu"] button')]
        .find((b) => (b.textContent ?? '').trim() === 'Bybit')?.click(),
    );
    await wait(900);
    const filterState = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#smart-search-listbox [role="option"] .nc-chip')]
        .map((c) => (c.textContent ?? '').trim());
      return { rows: document.querySelectorAll('#smart-search-listbox [role="option"]').length, chips };
    });
    check('desktop: Smart-Search-Filter „Bybit" zeigt nur Bybit-CEX-Treffer (+ DEX)', filterState.rows > 0 && filterState.chips.filter((c) => !['Bybit'].includes(c)).every((c) => c !== 'Binance' && c !== 'OKX'), JSON.stringify(filterState));
    await page.screenshot({ path: join(OUT, 'desktop-search-bybit.png') });
    await page.keyboard.press('Escape');
  }

  await page.close();
}

await browser.close();
console.log(`\n${fails === 0 ? '✔' : '✖'} fit-check: ${fails === 0 ? 'alle Menüs sitzen in der Ansicht' : `${fails} Failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
