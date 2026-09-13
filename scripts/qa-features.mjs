// Systematischer Feature-Sweep: JEDER Menü-Eintrag, jeder Toolbar-Toggle,
// alle Chart-Typen, Indikatoren (inkl. VWAP/AVWAP), Whale-Flow, Themes und
// die Palette werden live ausgeführt und per Store-State (?qa=1) sowie
// DOM-Effekt verifiziert. Dazu Landing-Check (Benefit-Block, Schlankheit).
//
// Nutzung: node scripts/qa-features.mjs
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, info = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${String(info).slice(0, 130)}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
await page.goto(`${BASE}/de/terminal?qa=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 30000 });
await wait(4500);
check('S0 QA-Hook exponiert Stores', await page.evaluate(() => !!window.__NC__));

/** stabiler State-Fingerprint (nur Primitive, keine Live-Preise/Candles) */
const snap = () =>
  page.evaluate(() => {
    const N = window.__NC__;
    const c = N.useChartStore.getState();
    const a = N.useAppStore.getState();
    const w = N.useWhaleStore.getState();
    const p = N.useProStore.getState();
    return {
      vpOn: c.vpOn, srOn: c.srOn, divOn: c.divOn, patternsOn: c.patternsOn, replayOn: c.replayOn,
      avwapArm: c.avwapArm, avwapAnchored: JSON.stringify(c.avwapAnchor ?? {}),
      indCount: Object.values(c.indicators ?? {}).reduce((n, list) => n + list.length, 0),
      tool: c.tool, syncTf: c.syncTimeframe, syncCross: c.syncCrosshair, syncZoom: c.syncZoom,
      chartType: a.chartType, layout: a.layout, theme: a.theme, palette: a.commandPaletteOpen,
      whale: w.enabled, proOpen: p.open,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      dialogTitle: document.querySelector('[role="dialog"] h2')?.textContent ?? null,
      panes: document.querySelectorAll('.font-mono.text-micro-10').length,
      url: location.pathname + location.search,
    };
  });

const diffKeys = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

async function clickMenu(triggerId, itemMatch) {
  await page.evaluate((id) => document.querySelector(`[data-menu-trigger="${id}"]`)?.click(), triggerId);
  await wait(320);
  const hit = await page.evaluate((m) => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      new RegExp(m, 'i').test((b.textContent ?? '').trim()));
    if (!item) return false;
    item.click();
    return (item.textContent ?? '').trim();
  }, itemMatch);
  await wait(900);
  return hit;
}

/* ---------------- S1: Chart-Typen via Dropdown ---------------- */
console.log('\n— S1: Chart-Typen-Dropdown —');
{
  const TYPES = ['candles', 'bars', 'line', 'area', 'heikinAshi', 'baseline', 'renko', 'lineBreak', 'kagi', 'pnf'];
  for (const type of TYPES) {
    const label = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) =>
        /candles|balken|bars|linie|fläche|area|heikin|baseline|renko|line break|kagi|point/i.test(b.getAttribute('aria-label') ?? ''));
      btn?.click();
      return btn?.getAttribute('aria-label');
    });
    await wait(350);
    const picked = await page.evaluate((t, types) => {
      const opt = [...document.querySelectorAll('[role="listbox"] [role="option"] button')][
        types.indexOf(t)
      ];
      opt?.click();
      return !!opt;
    }, type, TYPES);
    await wait(700);
    const now = await page.evaluate(() => window.__NC__.useAppStore.getState().chartType);
    check(`S1 Chart-Typ ${type} per Dropdown gesetzt`, picked && now === type, `store=${now} trigger=${label}`);
  }
  await page.evaluate(() => window.__NC__.useAppStore.getState().setChartType('candles'));
  await wait(500);
}

/* ---------------- S2: Indikatoren (VWAP + RSI) ---------------- */
console.log('\n— S2: Indikatoren live —');
{
  await page.evaluate(() => [...document.querySelectorAll('button[aria-label]')].find((b) => /^Indikatoren/.test(b.getAttribute('aria-label') ?? ''))?.click());
  await wait(900);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim().startsWith('VWAP'))?.click();
  });
  await wait(800);
  const ind1 = await page.evaluate(() => Object.values(window.__NC__.useChartStore.getState().indicators).flat().map((i) => i.kind));
  check('S2a VWAP landet im Chart-Store', ind1.some((k) => k.toLowerCase() === 'vwap'), ind1.join(','));
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim().startsWith('RSI'))?.click();
  });
  await wait(900);
  const st = await snap();
  check('S2b RSI öffnet eigenes Oszillator-Pane', st.panes >= 2 && st.indCount >= 2, `panes=${st.panes} ind=${st.indCount}`);
  await page.keyboard.press('Escape');
  await wait(400);
}

/* ---------------- S3: AVWAP arm + Anker ---------------- */
console.log('\n— S3: AVWAP —');
{
  const before = await snap();
  const hit = await clickMenu('analyse', 'AVWAP');
  const armed = await page.evaluate(() => window.__NC__.useChartStore.getState().avwapArm);
  check('S3a AVWAP-Menüitem armt das Werkzeug', !!hit && armed === true, `hit=${hit} arm=${armed}`);
  await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 }));
    cv.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 }));
    cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 }));
  });
  await wait(800);
  const anchored = await page.evaluate(() => Object.values(window.__NC__.useChartStore.getState().avwapAnchor).some((v) => v != null));
  check('S3b Chart-Klick setzt AVWAP-Anker', anchored);
  await clickMenu('analyse', 'AVWAP'); // disarm
  const after = await snap();
  check('S3c AVWAP-Toggle wechselt Zustand', diffKeys(before, after).length > 0);
}

/* ---------------- S4: Whale-Flow ---------------- */
console.log('\n— S4: Whale-Flow —');
{
  const w0 = await page.evaluate(() => window.__NC__.useWhaleStore.getState().enabled);
  const hit = await clickMenu('more', 'Whale');
  const w1 = await page.evaluate(() => window.__NC__.useWhaleStore.getState().enabled);
  check('S4a Whale-Toggle flippt den Stream', !!hit && w0 !== w1, `${w0} → ${w1}`);
  await clickMenu('more', 'Whale');
  const w2 = await page.evaluate(() => window.__NC__.useWhaleStore.getState().enabled);
  check('S4b zweiter Toggle stellt zurück', w2 === w0, String(w2));
}

/* ---------------- S5: kompletter Menü-Sweep ---------------- */
console.log('\n— S5: Menü-Sweep (jedes Item mit Effekt-Nachweis) —');
{
  const triggers = await page.evaluate(() =>
    [...document.querySelectorAll('[data-menu-trigger]')].map((el) => el.getAttribute('data-menu-trigger')));
  for (const id of triggers) {
    await page.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
    await wait(300);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent ?? '').trim()));
    await page.keyboard.press('Escape');
    await wait(200);
    for (let i = 0; i < items.length; i += 1) {
      const before = await snap();
      await page.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
      await wait(280);
      await page.evaluate((idx) => [...document.querySelectorAll('[role="menuitem"]')][idx]?.click(), i);
      await wait(900);
      const after = await snap();
      const changed = diffKeys(before, after);
      check(`S5 ${id}/${items[i] ?? i} bewirkt etwas`, changed.length > 0, changed.join(','));
      // Reset: Navigation rückgängig, Dialog zu, Toggle zurück, Layout normal
      if (after.url !== before.url) {
        await page.goto(`${BASE}/de/terminal?qa=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('canvas', { timeout: 30000 });
        await wait(3000);
      }
      if (after.dialogs > before.dialogs) { await page.keyboard.press('Escape'); await wait(350); }
      else if (changed.length === 1 && ['vpOn', 'srOn', 'divOn', 'patternsOn', 'replayOn', 'avwapArm', 'whale', 'proOpen', 'syncTf', 'syncCross', 'syncZoom'].includes(changed[0])) {
        await page.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
        await wait(260);
        await page.evaluate((idx) => [...document.querySelectorAll('[role="menuitem"]')][idx]?.click(), i);
        await wait(500);
      }
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__NC__.useAppStore.getState().setLayout('1x1'));
      await wait(350);
    }
  }
}

/* ---------------- S6: Toolbar-Toggles ---------------- */
console.log('\n— S6: Toolbar-Toggles —');
{
  await page.evaluate(() => window.__NC__.useAppStore.getState().setLayout('2x1'));
  await wait(1200);
  const cases = [
    ['Zeitrahmen über Panes synchronisieren', 'syncTf'],
    ['Fadenkreuz über Panes synchronisieren', 'syncCross'],
    ['Zoom & Verschieben synchronisieren', 'syncZoom'],
  ];
  for (const [label, key] of cases) {
    const b0 = await snap();
    await page.evaluate((l) => [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label') === l)?.click(), label);
    await wait(500);
    const a0 = await snap();
    check(`S6 ${label} flippt ${key}`, b0[key] !== a0[key], `${b0[key]} → ${a0[key]}`);
    await page.evaluate((l) => [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label') === l)?.click(), label);
    await wait(300);
  }
  // Drawing-Tools
  for (const [label, tool] of [['Trendlinie', 'trendline'], ['Strahl', 'ray'], ['Horizontale Preislinie', 'horizontal'], ['Radierer', 'eraser']]) {
    const clicked = await page.evaluate((l) => {
      const btn = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label') === l);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    }, label);
    await wait(400);
    const now = await page.evaluate(() => window.__NC__.useChartStore.getState().tool);
    check(`S6 Tool ${label} → store.tool=${tool}`, clicked && now === tool, `clicked=${clicked} now=${now}`);
  }
  await page.evaluate(() => [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label') === 'Cursor / Auswahl')?.click());
  await wait(300);
  await page.evaluate(() => window.__NC__.useAppStore.getState().setLayout('1x1'));
  await wait(800);
}

/* ---------------- S7: Themes ---------------- */
console.log('\n— S7: Themes —');
{
  for (const id of ['acid', 'violet', 'light', 'matrix', 'miami']) {
    await page.evaluate((t) => window.__NC__.useAppStore.getState().setTheme(t), id);
    await wait(500);
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(`S7 setTheme(${id}) → data-theme`, attr === id, String(attr));
  }
  await page.evaluate(() => document.querySelector('button[aria-label="Design"]')?.click());
  await wait(500);
  await page.evaluate(() => {
    const list = [...document.querySelectorAll('[role="option"]')];
    (list[1]?.querySelector('button') ?? list[1])?.click();
  });
  await wait(700);
  const viaUi = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), store: window.__NC__.useAppStore.getState().theme }));
  check('S7 Theme-Picker-Klick setzt Theme (UI)', viaUi.attr === viaUi.store && viaUi.attr !== 'acid', JSON.stringify(viaUi));
  await page.evaluate(() => window.__NC__.useAppStore.getState().setTheme('acid'));
  await wait(400);
}

/* ---------------- S8: Palette ---------------- */
console.log('\n— S8: Palette —');
{
  const b = await snap();
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await wait(600);
  await page.keyboard.type('2x2');
  await wait(500);
  await page.keyboard.press('Enter');
  await wait(900);
  const a = await snap();
  check('S8 Palette-Befehl „2x2" setzt Layout', a.layout !== b.layout && a.panes >= 4, `${b.layout} → ${a.layout}`);
  await page.evaluate(() => window.__NC__.useAppStore.getState().setLayout('1x1'));
  await wait(400);
}

/* ---------------- S9: Landing schlank + Benefit ---------------- */
console.log('\n— S9: Landing —');
for (const loc of ['de', 'en']) {
  const land = await browser.newPage();
  await land.goto(`${BASE}/${loc}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1500);
  const info = await land.evaluate(() => ({
    features: !!document.querySelector('#features'),
    rows: document.querySelectorAll('#features li').length,
    faq: /h[a-z]liche fragen|frequently asked/i.test(document.body.innerText),
    survival: !!document.querySelector('#survival, section[id*="survival"], #faq'),
    len: document.body.innerText.length,
    cta: !!document.querySelector('a[href*="terminal"]'),
  }));
  check(`S9 ${loc}: Benefit-Block mit 18 Zeilen`, info.features && info.rows === 18, `rows=${info.rows}`);
  check(`S9 ${loc}: keine FAQ-/Story-Sektion, Text < 6k Zeichen`, !info.faq && !info.survival && info.len < 6000, `len=${info.len}`);
  check(`S9 ${loc}: Terminal-CTA vorhanden`, info.cta);
  await land.close();
}

check('S10 keine Page-Errors im Sweep', errors.length === 0, errors[0] ?? '');
await browser.close();
console.log(`\n${failures === 0 ? '✔' : '✖'} qa-features: ${failures === 0 ? 'alle Features verifiziert' : `${failures} Failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
