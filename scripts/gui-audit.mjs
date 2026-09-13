// Systematischer GUI-Screenshot-Audit: jede Seite, jedes Menü, jedes
// Tool-Modal, Palette, Themes, Toolbar-Toggles — jeweils mit automatischer
// Prüfung auf Horizontal-Overflow und geclippten Text. Legt alle Shots unter
// artifacts/gui-audit/<viewport>/ ab und schreibt manifest.json.
//
// Nutzung: node scripts/gui-audit.mjs
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = join(root, 'artifacts', 'gui-audit');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'x';

const VPS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  mini: { width: 320, height: 568, isMobile: true, hasTouch: true },
};

const manifest = [];
let problems = 0;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  defaultViewport: VPS.desktop,
});

const probe = () => ({
  hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    ? document.documentElement.scrollWidth - window.innerWidth : 0,
  clipped: [...document.querySelectorAll('button, a, th, td, h1, h2, h3, h4, span, p, label, option')]
    .filter((el) => {
      if (el.children.length > 0) return false;
      const txt = (el.textContent ?? '').trim();
      if (!txt) return false;
      const st = getComputedStyle(el);
      return (st.overflow === 'hidden' || st.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2;
    })
    .slice(0, 6)
    .map((el) => `${(el.textContent ?? '').trim().slice(0, 30)}(${el.scrollWidth}>${el.clientWidth})`),
});

async function shot(page, vp, name, { fullPage = false } = {}) {
  const dir = join(OUT, vp);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path, fullPage, captureBeyondViewport: fullPage });
  const info = await page.evaluate(probe);
  const bytes = statSync(path).size;
  const blank = !fullPage && bytes < 4000;
  const bad = info.hOverflow > 0 || blank;
  if (bad) problems += 1;
  manifest.push({ vp, name, file: path.replace(root + '/', ''), bytes, hOverflow: info.hOverflow, clipped: info.clipped, blank });
  const flags = [];
  if (info.hOverflow > 0) flags.push(`H-OVERFLOW +${info.hOverflow}px`);
  if (blank) flags.push('BLANK?');
  if (info.clipped.length) flags.push(`clipped: ${info.clipped.join(', ')}`);
  console.log(`  [${vp}] ${name}${flags.length ? `  ⚠ ${flags.join(' | ')}` : ''}`);
}

async function newPage(vp) {
  const page = await browser.newPage();
  await page.setViewport(VPS[vp]);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return page;
}

async function gotoTerminal(page, locale = 'de') {
  await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(4500);
}

/* ============================ G1: Seiten ================================= */
console.log('\n=== G1: statische Seiten (alle Viewports, fullPage) ===');
const PAGES = [
  ['p-home', '/de'],
  ['p-help', '/de/help'],
  ['p-terms', '/de/legal/terms'],
  ['p-disclaimer', '/de/legal/disclaimer'],
  ['p-privacy', '/de/legal/privacy'],
  ['p-404', '/de/diese-seite-gibt-es-nicht'],
];
for (const vp of Object.keys(VPS)) {
  const page = await newPage(vp);
  for (const [name, path] of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1400);
    await shot(page, vp, name, { fullPage: true });
  }
  await page.close();
}
// EN-Spots
{
  const page = await newPage('desktop');
  for (const [name, path] of [['p-home-en', '/en'], ['p-help-en', '/en/help']]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1400);
    await shot(page, 'desktop', name, { fullPage: true });
  }
  await page.close();
}

/* ==================== G2: Terminal Desktop — Basis ======================= */
console.log('\n=== G2: Terminal Desktop (Layouts, Menüs, Features, Palette, Themes) ===');
{
  const page = await newPage('desktop');
  await gotoTerminal(page);
  await shot(page, 'desktop', 't-base-1x1');
  await page.keyboard.press('2'); await wait(1600);
  await shot(page, 'desktop', 't-layout-2x1');
  await page.keyboard.press('3'); await wait(1800);
  await shot(page, 'desktop', 't-layout-2x2');
  await page.keyboard.press('1'); await wait(1500);
  await shot(page, 'desktop', 't-layout-back-1x1');

  // --- Menü-Inventur: alle Trigger + Items durchgehen ---
  const triggers = await page.evaluate(() =>
    [...document.querySelectorAll('[data-menu-trigger]')].map((el) => ({
      id: el.getAttribute('data-menu-trigger'),
      label: (el.textContent ?? '').trim(),
    })),
  );
  console.log(`  Menü-Trigger: ${triggers.map((t) => `${t.id}(${t.label})`).join(', ')}`);

  for (const trig of triggers) {
    await page.evaluate((id) => document.querySelector(`[data-menu-trigger="${id}"]`)?.click(), trig.id);
    await wait(400);
    await shot(page, 'desktop', `t-menu-${trig.id}`);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent ?? '').trim()),
    );
    await page.keyboard.press('Escape'); await wait(250);
    console.log(`    ${trig.id}: ${items.length} Items → ${items.join(' | ').slice(0, 120)}`);

    for (let i = 0; i < items.length; i += 1) {
      const urlBefore = page.url();
      await page.evaluate((id) => document.querySelector(`[data-menu-trigger="${id}"]`)?.click(), trig.id);
      await wait(300);
      const clicked = await page.evaluate((idx) => {
        const it = [...document.querySelectorAll('[role="menuitem"]')][idx];
        if (!it) return false;
        it.click();
        return true;
      }, i);
      if (!clicked) { await page.keyboard.press('Escape'); continue; }
      await wait(1100);
      const hasDialog = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
      await shot(page, 'desktop', `t-feat-${trig.id}-${i}-${slug(items[i] ?? String(i))}`);
      if (hasDialog) {
        await page.keyboard.press('Escape'); await wait(400);
      } else if (page.url() !== urlBefore) {
        await page.goto(urlBefore, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('canvas', { timeout: 30000 }); await wait(2500);
      } else {
        // Toggle-Zustand zurücksetzen: Item noch einmal klicken
        await page.evaluate((id) => document.querySelector(`[data-menu-trigger="${id}"]`)?.click(), trig.id);
        await wait(280);
        await page.evaluate((idx) => [...document.querySelectorAll('[role="menuitem"]')][idx]?.click(), i);
        await wait(500);
        await page.keyboard.press('Escape'); await wait(200);
      }
      await page.keyboard.press('1'); await wait(400); // Layout normalisieren
    }
  }

  // --- Kommandopalette ---
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await wait(800);
  await shot(page, 'desktop', 't-palette-open');
  await page.keyboard.type('rsi');
  await wait(700);
  await shot(page, 'desktop', 't-palette-search');
  await page.keyboard.press('Escape'); await wait(400);

  // --- Themes ---
  const themeBtn = await page.$('button[aria-label="Design"]');
  if (themeBtn) {
    await themeBtn.click(); await wait(500);
    await shot(page, 'desktop', 't-theme-picker');
    const optCount = await page.evaluate(() => document.querySelectorAll('[role="option"]').length);
    for (let i = 0; i < optCount; i += 1) {
      const label = await page.evaluate((idx) => {
        const o = [...document.querySelectorAll('[role="option"]')][idx];
        o?.click();
        return (o?.textContent ?? '').trim();
      }, i);
      await wait(900);
      await shot(page, 'desktop', `t-theme-${i}-${slug(label)}`);
      // evtl. Unlock-Dialog (Premium-Themes) → schließen + Picker neu öffnen
      const dlg = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
      if (dlg) { await page.keyboard.press('Escape'); await wait(300); await page.evaluate(() => document.querySelector('button[aria-label="Design"]')?.click()); await wait(400); }
      else { await page.evaluate(() => document.querySelector('button[aria-label="Design"]')?.click()); await wait(400); }
    }
    await page.keyboard.press('Escape'); await wait(300);
    // Theme zurücksetzen auf acid
    await page.evaluate(() => { try { localStorage.setItem('nodechart:store:v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('nodechart:store:v1') ?? '{}'), state: { ...JSON.parse(localStorage.getItem('nodechart:store:v1') ?? '{}').state, theme: 'acid' }, version: 0 })); } catch {} });
  } else {
    console.log('  ⚠ Theme-Button (aria-label=Design) nicht gefunden');
  }

  // --- Toolbar-Toggles per aria-label ---
  const SKIP = /share|tweet|telegram|x\.com|whatsapp/i;
  const labels = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('button[aria-label]')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => b.getAttribute('aria-label') ?? ''))],
  );
  console.log(`  Toolbar-aria-labels (${labels.length}): ${labels.join(' | ').slice(0, 300)}`);
  for (const label of labels) {
    if (SKIP.test(label) || label === 'Design') continue;
    const before = page.url();
    await page.evaluate((l) => [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === l)?.click(), label);
    await wait(800);
    await shot(page, 'desktop', `t-tb-${slug(label)}`);
    const dlg = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    if (dlg) await page.keyboard.press('Escape');
    else if (page.url() !== before) { await page.goto(before, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('canvas', { timeout: 30000 }); }
    await wait(500);
    // Toggle zurück
    await page.evaluate((l) => [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === l)?.click(), label);
    await wait(350);
    await page.keyboard.press('Escape');
    await wait(250);
  }
  await page.close();
}

/* ================= G3: Terminal Mobile/Tablet ============================ */
console.log('\n=== G3: Terminal Mobile + Tablet ===');
for (const vp of ['tablet', 'mobile', 'mini']) {
  const page = await newPage(vp);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(2500);
  await shot(page, vp, `t-${vp}-initial`); // ggf. Mobile-Warnung
  // Force-Enable falls Warnung aktiv
  const forced = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /trotzdem|force|aktivieren|enable/i.test((b.textContent ?? '') + (b.getAttribute('aria-label') ?? '')));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (forced) {
    await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {});
    await wait(4500);
    await shot(page, vp, `t-${vp}-forced`);
  }
  // Ein Menü öffnen
  await page.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
  await wait(400);
  await shot(page, vp, `t-${vp}-menu-tools`);
  // Alerts-Modal (repräsentatives Modal mit Formular)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim().startsWith('Alerts'))?.click());
  await wait(1000);
  await shot(page, vp, `t-${vp}-alerts-dialog`);
  await page.keyboard.press('Escape'); await wait(350);
  // Palette
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await wait(700);
  await shot(page, vp, `t-${vp}-palette`);
  await page.keyboard.press('Escape');
  await page.close();
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
console.log(`\n${manifest.length} Shots → artifacts/gui-audit/  |  Auto-Befunde (Overflow/Blank): ${problems}`);
console.log('Clipped-Text-Hinweise:', manifest.filter((m) => m.clipped.length).length, 'Shots');
