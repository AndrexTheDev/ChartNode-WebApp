// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
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

async function openControls(page, compact) {
  if (!compact) return;
  const isOpen = await page.evaluate(() => Boolean(document.querySelector('[data-mobile-controls-sheet]')));
  if (isOpen) return;
  await page.evaluate(() => document.querySelector('[data-mobile-controls-trigger]')?.click());
  await wait(400);
}

async function expandMobileSection(page, key) {
  await page.evaluate((sectionKey) => {
    const section = document.querySelector(`[data-mobile-section="${sectionKey}"]`);
    const trigger = section?.querySelector('button[aria-controls]');
    if (trigger?.getAttribute('aria-expanded') !== 'true') trigger?.click();
  }, key);
  await wait(150);
}

const controlsFit = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const body = dialog?.querySelector('.overscroll-contain');
    if (!dialog || !body) return { found: false };
    const r = dialog.getBoundingClientRect();
    return {
      found: true,
      inView: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1,
      scrollable: body.scrollHeight > body.clientHeight + 2,
      rect: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) },
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
  });

for (const [name, width, height] of VPS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(4000);
  const compact = width < 1280;
  const customTimeframe = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
      .find((button) => !button.hasAttribute('data-mobile-controls-trigger')
        && button.getBoundingClientRect().width > 0);
    if (!trigger) return { found: false, linked: false, id: '' };
    trigger.click();
    const id = trigger.getAttribute('aria-controls') ?? '';
    const popover = id ? document.getElementById(id) : null;
    return { found: true, linked: Boolean(id && popover?.getAttribute('role') === 'dialog'), id };
  });
  check(`${name}: custom timeframe popover has an associated dialog id`, customTimeframe.found && customTimeframe.linked);
  await wait(120);
  await page.keyboard.press('Escape');
  await wait(120);
  check(`${name}: Escape dismisses custom timeframe popover and restores focus`, await page.evaluate((popoverId) => {
    const trigger = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
      .find((button) => !button.hasAttribute('data-mobile-controls-trigger')
        && button.getBoundingClientRect().width > 0);
    return trigger?.getAttribute('aria-expanded') === 'false'
      && document.activeElement === trigger
      && !document.getElementById(popoverId);
  }, customTimeframe.id));

  // 1) Desktop: eight-item ToolMenu. Compact layouts: the organized controls sheet.
  let fit;
  if (compact) {
    await openControls(page, compact);
    fit = await controlsFit(page);
    check(`${name}: controls sheet stays in view and scrolls internally`, fit.found && fit.inView && fit.scrollable, JSON.stringify(fit));
    await page.screenshot({ path: join(OUT, `${name}-controls.png`) });
    await expandMobileSection(page, 'tools');
    const hasAlerts = await page.evaluate(() => {
      const button = document.querySelector('[data-mobile-controls-sheet] [data-mobile-action="alerts-manager"]');
      if (!button) return false;
      button.click();
      return true;
    });
    check(`${name}: mobile tools expose Alerts`, hasAlerts);
    await wait(450);
    check(`${name}: selecting Alerts opens its panel`, await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length > 0));
    await page.keyboard.press('Escape');
    await wait(400);
    await openControls(page, compact);
    await page.keyboard.press('Escape');
    await wait(300);
    check(`${name}: Escape closes the controls sheet with expanded sections`, await page.evaluate(() => !document.querySelector('[data-mobile-controls-sheet]')));
  } else {
    await page.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
    await wait(600);
    fit = await panelFit(page);
    check(`${name}: TOOLS-Menü vollständig in Ansicht`, fit.found && fit.inView, JSON.stringify(fit));
    await page.screenshot({ path: join(OUT, `${name}-tools.png`) });
    check(`${name}: Escape/Outside schließt das Menü`, await closePanels(page));
  }

  // 2) Datenquelle/ExchangePicker (6 Items + Hints)
  await openControls(page, compact);
  await page.evaluate((useSheet) => {
    const selector = useSheet
      ? '[data-mobile-controls-sheet] [data-testid="market-data-source"] button[aria-haspopup="listbox"]'
      : '.sticky button[aria-label="Datenquelle"]';
    document.querySelector(selector)?.click();
  }, compact);
  await wait(600);
  fit = await panelFit(page);
  check(`${name}: Datenquelle-Menü vollständig in Ansicht`, fit.found && fit.inView, JSON.stringify(fit));
  check(`${name}: Escape/Outside schließt Datenquelle`, await closePanels(page));

  // 3) Chart-Typ-Dropdown (10 Items)
  await openControls(page, compact);
  await page.evaluate((useSheet) => {
    const selector = useSheet
      ? '[data-mobile-controls-sheet] [data-testid="chart-type-control"] button[aria-haspopup="listbox"]'
      : '.sticky [data-testid="chart-type-control"] button[aria-haspopup="listbox"]';
    document.querySelector(selector)?.click();
  }, compact);
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

  // 7) Compare-Dropdown lives in the compact controls sheet below xl.
  await openControls(page, compact);
  await page.evaluate((useSheet) => {
    const selector = useSheet
      ? '[data-mobile-controls-sheet] [data-testid="compare-control"] button[aria-haspopup="listbox"]'
      : '.sticky [data-testid="compare-control"] button[aria-haspopup="listbox"]';
    document.querySelector(selector)?.click();
  }, compact);
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
  await openControls(page, compact);
  const pickerName = await page.evaluate((names, useSheet) => {
    const selector = useSheet
      ? '[data-mobile-controls-sheet] [data-testid="market-data-source"] button[aria-haspopup="listbox"]'
      : '.sticky button[aria-label="Datenquelle"]';
    const b = document.querySelector(selector);
    const txt = b?.textContent ?? '';
    return names.find((n) => txt.includes(n)) ?? null;
  }, VENUES, compact);
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
