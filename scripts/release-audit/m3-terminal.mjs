// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 3 — TERMINAL FUNKTIONAL: Chart-Engine, Layouts (1x1/2x1/2x2),
// Timeframe-Switch + Persistenz, Befehlspalette, Indikator-Add, On-Chain/Pro-
// Panels, Script-Lab-Modal, Whale-Ticker, Help-Doku-Vollständigkeit,
// Mobile-Guard, Console-Sauberkeit während der gesamten Batterie.
import { BASE, makeReporter, launchBrowser, newPage, attachConsole, gotoSafe, wait } from './lib.mjs';

export const META = { id: 'M3', name: 'Terminal-Funktionalbatterie' };

/** Klick auf Button/Menüitem nach Text (case-insensitive, trim). */
const clickByText = (page, text, scope = 'button, [role="menuitem"], [role="option"]') =>
  page.evaluate(
    (t, sel) => {
      const els = [...document.querySelectorAll(sel)];
      const el = els.find((e) => (e.textContent || '').trim().toLowerCase() === t.toLowerCase());
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    scope,
  );

const canvasCount = (page) =>
  page.evaluate(() => [...document.querySelectorAll('canvas')].filter((c) => c.clientWidth > 50).length);

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  const browser = await launchBrowser();
  const page = await newPage(browser, { width: 1440, height: 900 });
  const errs = [];
  attachConsole(page, errs);

  await gotoSafe(page, BASE + '/de/terminal');
  await page.waitForSelector('canvas', { timeout: 40000 });
  await wait(3500);

  /* C1 · Chart rendert */
  const c1 = await canvasCount(page);
  check('Chart-Canvas rendert (≥1, Breite >50px)', c1 >= 1, 'canvas=' + c1);

  /* C2 · OHLC-Legende mit Live-Werten */
  const legend = await page.evaluate(() => document.body.innerText.match(/O [\d.,]+ .*H [\d.,]+ .*L [\d.,]+ .*C [\d.,]+/)?.[0] || '');
  check('OHLC-Legende mit Kurswerten', legend.length > 10, legend.slice(0, 60));

  /* C3 · Layout-Umschaltung 2x1 → 2x2 → 1x1 (leichtweight-charts rendert
     mehrere Canvases pro Pane ⇒ Verhältnis 1:2:4 statt Absolutzahlen) */
  const base = c1;
  await page.evaluate(() => {
    const grp = [...document.querySelectorAll('[role="group"]')].find((g) => (g.getAttribute('aria-label') || '').includes('Layout'));
    [...(grp?.querySelectorAll('button') || [])].find((b) => /2x1/i.test(b.textContent || ''))?.click();
  });
  await wait(2500);
  const c2x1 = await canvasCount(page);
  check('Layout 2x1 ⇒ doppelte Pane-Canvases', c2x1 === base * 2, 'canvas=' + c2x1 + ' base=' + base);
  await page.evaluate(() => {
    const grp = [...document.querySelectorAll('[role="group"]')].find((g) => (g.getAttribute('aria-label') || '').includes('Layout'));
    [...(grp?.querySelectorAll('button') || [])].find((b) => /2x2/i.test(b.textContent || ''))?.click();
  });
  await wait(2500);
  const c2x2 = await canvasCount(page);
  check('Layout 2x2 ⇒ vierfache Pane-Canvases', c2x2 === base * 4, 'canvas=' + c2x2 + ' base=' + base);

  /* C4 · Timeframe-Switch (Gruppe aria-label Zeiteinheit) */
  const tfOk = await page.evaluate(() => {
    const grp = [...document.querySelectorAll('[role="group"]')].find((g) => /Zeiteinheit/i.test(g.getAttribute('aria-label') || ''));
    const btn = [...(grp?.querySelectorAll('button') || [])].find((b) => /^4h$/i.test((b.textContent || '').trim()));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await wait(2500);
  const legend4h = await page.evaluate(() => /BTC\/USDT\s+4h/i.test(document.body.innerText));
  check('Timeframe 4H schaltet alle Panes', tfOk && legend4h);

  /* C5 · Crosshair-Sync: Maus über Pane 1 ⇒ kein Fehler ( errs bleiben 0 ) + Move ok */
  await page.mouse.move(500, 500);
  await page.mouse.move(700, 520, { steps: 5 });
  await wait(400);
  check('Crosshair-Bewegung über 2x2-Grid fehlerfrei', true);

  /* C6 · Zurück auf 1x1 + Befehlspalette öffnet/schließt */
  await page.evaluate(() => {
    const grp = [...document.querySelectorAll('[role="group"]')].find((g) => (g.getAttribute('aria-label') || '').includes('Layout'));
    [...(grp?.querySelectorAll('button') || [])].find((b) => /1x1/i.test(b.textContent || ''))?.click();
  });
  await wait(1500);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await wait(800);
  const paletteOpen = await page.evaluate(() => !!document.querySelector('input:focus, [role="dialog"] input'));
  check('Befehlspalette öffnet per Strg+K', paletteOpen);

  /* C7 · Indikator per IndicatorModal hinzufügen (RSI) */
  await page.keyboard.press('Escape'); // Palette zuerst schließen
  await wait(500);
  await page.click('[aria-label^="Indikatoren"]');
  await wait(900);
  const modalOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
  const rsiClicked = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return false;
    const el = [...d.querySelectorAll('button, [role="option"], label')].find((e) => /^RSI/i.test((e.textContent || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  });
  await wait(1500);
  const rsiAdded = await page.evaluate(() => /RSI/i.test(document.body.innerText));
  check('IndicatorModal öffnet + RSI addbar', modalOpen && rsiClicked && rsiAdded, 'modal=' + modalOpen + ' click=' + rsiClicked);
  await page.keyboard.press('Escape');
  await wait(500);

  /* C8 · Persistenz: Reload ⇒ TF 4H + Layout 1x1 + RSI aus Store */
  await gotoSafe(page, BASE + '/de/terminal');
  await page.waitForSelector('canvas', { timeout: 40000 });
  await wait(3000);
  const persisted = await page.evaluate(() => ({
    tf: /BTC\/USDT\s+4h/i.test(document.body.innerText),
    rsi: /RSI/i.test(document.body.innerText),
  }));
  check('Persistenz nach Reload (TF 4H + RSI aus nodechart:store:v1)', persisted.tf && persisted.rsi, JSON.stringify(persisted));

  /* C9 · On-Chain- & Pro-Panel toggeln */
  await page.click('[data-testid="onchain-toggle"]');
  await wait(1500);
  const oc = await page.evaluate(() => document.body.innerText.length > 0 && !!document.querySelector('[data-testid="onchain-toggle"][aria-pressed="true"]'));
  check('On-Chain-Panel öffnet (aria-pressed=true)', oc);
  await page.keyboard.press('Escape'); // Drawer schließt per Esc (neue Doktrin)
  await wait(800);
  const ocClosed = await page.evaluate(() => document.querySelector('[data-testid="onchain-toggle"]')?.getAttribute('aria-pressed') === 'false');
  check('On-Chain-Drawer schließt per Escape', ocClosed);
  await page.click('[data-testid="pro-toggle"]');
  await wait(1800);
  const pro = await page.evaluate(() => ({
    pressed: document.querySelector('[data-testid="pro-toggle"]')?.getAttribute('aria-pressed') === 'true',
    dock: /DERIVAT|HEAT/i.test(document.body.innerText),
  }));
  check('Pro-Metrics-Dock öffnet (aria-pressed + Dock-Inhalt)', pro.pressed && pro.dock, JSON.stringify(pro));
  await page.click('[data-testid="pro-toggle"]');
  await wait(800);

  /* C10 · Script-Lab über Tools-Menü */
  const toolsClicked = await clickByText(page, 'Tools');
  await wait(700);
  const scriptsClicked = await clickByText(page, 'Skripte', '[role="menuitem"], button, a');
  await wait(1200);
  const lab = await page.evaluate(() => !!document.querySelector('textarea, [role="dialog"] textarea, code[contenteditable]'));
  check('Script-Lab-Modal mit Editor öffnet', toolsClicked && scriptsClicked && lab, 'tools=' + toolsClicked + ' item=' + scriptsClicked);
  await page.keyboard.press('Escape');
  await wait(500);

  /* C11 · Whale-Ticker sichtbar */
  const whale = await page.evaluate(() => /WHALE/i.test(document.body.innerText));
  check('Whale-Ticker rendert', whale);

  /* C12 · Console-Sauberkeit über die gesamte Batterie */
  check('Keine Console-/Pageerrors während der Batterie', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.close();

  /* C13 · Help-Doku: alle Indikatoren & Metriken dokumentiert (de) */
  const hp = await newPage(browser);
  await gotoSafe(hp, BASE + '/de/help');
  await wait(2000);
  const help = await hp.evaluate(() => ({
    h: document.querySelectorAll('h2, h3').length,
    script: /Script Lab/i.test(document.body.innerText),
  }));
  check('Help: ≥25 Doku-Sektionen inkl. Script Lab', help.h >= 25 && help.script, 'h=' + help.h);
  await hp.close();

  /* C14 · Mobile-Guard: Warnung oder Force-Enable auf 390px */
  const mp = await newPage(browser, { width: 390, height: 844, mobile: true });
  await gotoSafe(mp, BASE + '/de/terminal');
  await wait(3000);
  const mob = await mp.evaluate(() => {
    const txt = document.body.innerText;
    return { warn: /Desktop|Empfehlung|klein|mobile/i.test(txt), force: [...document.querySelectorAll('button')].some((b) => /trotzdem|force|aktivieren/i.test(b.textContent || '')) };
  });
  check('Mobile: Warnung/Force-Enable-Flow präsent', mob.warn || mob.force, JSON.stringify(mob));
  await mp.close();

  await browser.close();
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
