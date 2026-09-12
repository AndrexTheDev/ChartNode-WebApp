// Live-Tests für Module, die bisher nur indirekt oder gar nicht geprüft
// wurden: Alerts/Notifications, CSV-Export, locale-param-404s, Journal,
// Backtest, Script Lab, Chart-Sync, Keyboard-Map, Kommandopalette und der
// Storage-Degradation-Pfad. Läuft gegen :3000 (Production-Build).
//
// Nutzung: node scripts/qa-modules.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DL = join(root, 'artifacts', 'dl');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, info = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${String(info).slice(0, 140)}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});

async function openTerminal(page, { init } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(4000);
  return errors;
}

async function clickMenuItem(page, text) {
  const triggers = await page.evaluate(() =>
    [...document.querySelectorAll('[data-menu-trigger]')].map((el) => el.getAttribute('data-menu-trigger')),
  );
  for (const id of triggers) {
    await page.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
    await wait(220);
    const hit = await page.evaluate((t) => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t);
      if (!item) return false;
      item.click();
      return true;
    }, text);
    if (hit) return true;
    await page.keyboard.press('Escape');
    await wait(150);
  }
  return false;
}

const legendPrice = (page) =>
  page.evaluate(() => {
    const m = (document.querySelector('.font-mono.text-micro-10')?.textContent ?? '').match(/C\s*([\d.]+)/);
    return m ? Number(m[1]) : null;
  });

/* ========================================================================== */
console.log('\n— S1: Alerts + Notifications (Browser-Notify + Beep + Persistenz) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page, {
    init: () => {
      window.__notifs = [];
      window.__osc = 0;
      class FakeNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        constructor(title, options) {
          window.__notifs.push({ title, body: options?.body ?? '' });
        }
      }
      window.Notification = FakeNotification;
      const RealAC = window.AudioContext;
      window.AudioContext = class extends RealAC {
        createOscillator() {
          window.__osc += 1;
          return super.createOscillator();
        }
      };
    },
  });

  const price = await legendPrice(page);
  check('S1a Live-Preis für Alert-Test lesbar', price != null && price > 0, String(price));
  check('S1b Alert-Manager öffnet per Menü', await clickMenuItem(page, 'Alerts'));
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });

  // dir = below, Level = price*1.05 → Bedingung ist sofort wahr → muss feuern
  const level = String(Math.round(price * 1.05 * 100) / 100);
  await page.evaluate(() => {
    const selects = [...document.querySelectorAll('[role="dialog"] select')];
    selects[1].value = 'below';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  const numInput = await page.$('[role="dialog"] input[type="number"]');
  await numInput.click({ clickCount: 3 });
  await page.keyboard.type(level);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').includes('Alert anlegen'))?.click();
  });
  await wait(600);
  const rowUp = await page.evaluate((lv) => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes(lv), level);
  check('S1c Alert-Zeile erscheint nach „Alert anlegen"', rowUp, level);

  let fired = false;
  for (let i = 0; i < 20; i += 1) {
    await wait(1000);
    const state = await page.evaluate(() => ({ n: window.__notifs.length, osc: window.__osc }));
    if (state.n >= 1) { fired = true; break; }
  }
  const fireState = await page.evaluate(() => ({ n: window.__notifs.length, osc: window.__osc, first: window.__notifs[0] ?? null }));
  check('S1d Alert feuert: Browser-Notification + Zwei-Ton-Beep', fired && fireState.osc >= 2, JSON.stringify(fireState).slice(0, 120));
  check('S1e Notification trägt Symbol + Preis', !!fireState.first && /ALERT/.test(fireState.first.title) && /BTC/.test(fireState.first.title), JSON.stringify(fireState.first));

  // Persistenz über Reload + Delete
  await page.keyboard.press('Escape');
  await wait(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  // Menü-Label trägt jetzt den Zähler („Alerts · 1") → Prefix-Match
  await page.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
  await wait(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim().startsWith('Alerts'))?.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const persisted = await page.evaluate((lv) => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes(lv), level);
  check('S1f Alert überlebt den Reload (persistiert, nie verfallend)', persisted);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button[aria-label]')].find((b) => /lösch/i.test(b.getAttribute('aria-label') ?? ''))?.click();
  });
  await wait(500);
  const gone = await page.evaluate((lv) => !(document.querySelector('[role="dialog"]')?.textContent ?? '').includes(lv), level);
  check('S1g Alert-Delete entfernt die Zeile', gone);
  check('S1h Sektion 1: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S2: CSV-Export (echter Download) —');
{
  rmSync(DL, { recursive: true, force: true });
  mkdirSync(DL, { recursive: true });
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  const csvLabel = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label]')].find((b) => /CSV/i.test(b.getAttribute('aria-label') ?? ''));
    if (!btn) return null;
    btn.click();
    return btn.getAttribute('aria-label');
  });
  check('S2a CSV-Button gefunden + geklickt', csvLabel !== null, String(csvLabel));
  let file = null;
  for (let i = 0; i < 15; i += 1) {
    await wait(700);
    file = readdirSync(DL).find((f) => f.endsWith('.csv')) ?? null;
    if (file) break;
  }
  check('S2b Download landet als .csv-Datei', file !== null, String(file));
  if (file) {
    const content = readFileSync(join(DL, file), 'utf8');
    const lines = content.trim().split('\n');
    check('S2c Header exakt time,open,high,low,close,volume', lines[0] === 'time,open,high,low,close,volume', lines[0]);
    check('S2d ≥ 50 Candle-Zeilen, ISO-Zeitstempel', lines.length >= 50 && /^\d{4}-\d{2}-\d{2}T/.test(lines[1]), `${lines.length} Zeilen`);
    check('S2e Dateiname trägt Symbol + Timeframe', /nodechart-BTC-USDT-\w+\.csv/.test(file), file);
  }
  check('S2f Sektion 2: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S3: locale-param-Gate (HTTP-404s) —');
{
  const cases = [
    ['/fr/terminal', 404], ['/xx/help', 404], ['/de-DE/terminal', 404],
    ['/de/terminal', 200], ['/zh/help', 200], ['/en/terminal?ticker=ETH', 200],
  ];
  for (const [path, expected] of cases) {
    const res = await fetch(`${BASE}${path}`);
    check(`S3 ${path} → ${expected}`, res.status === expected, String(res.status));
  }
}

/* ========================================================================== */
console.log('\n— S4: Trade-Journal (CRUD + Persistenz) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  check('S4a Journal öffnet per Menü', await clickMenuItem(page, 'Journal'));
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const nums = await page.$$('[role="dialog"] input[type="number"]');
  check('S4b Journal-Formular hat Size/Entry/Exit/Stop-Felder', nums.length >= 4, `${nums.length} Nummer-Felder`);
  const values = ['0.5', '60000', '61000', '59000'];
  for (let i = 0; i < 4; i += 1) {
    await nums[i].click({ clickCount: 3 });
    await page.keyboard.type(values[i]);
  }
  const tagInput = await page.$('[role="dialog"] input[placeholder="breakout,news"]');
  if (tagInput) await tagInput.type('qa-tag');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="dialog"] button')];
    const add = btns.find((b) => /sichern|anlegen|hinzufügen|speichern/i.test(b.textContent ?? ''));
    add?.click();
  });
  await wait(600);
  const entry = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('qa-tag'));
  check('S4c Eintrag erscheint mit Tag im Journal', entry);
  await page.keyboard.press('Escape');
  await wait(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(2000);
  await clickMenuItem(page, 'Journal');
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const persisted = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('qa-tag'));
  check('S4d Journal-Eintrag überlebt Reload', persisted);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button[aria-label]')].find((b) => /lösch|delete/i.test(b.getAttribute('aria-label') ?? ''))?.click();
  });
  await wait(500);
  const deleted = await page.evaluate(() => !(document.querySelector('[role="dialog"]')?.textContent ?? '').includes('qa-tag'));
  check('S4e Journal-Delete wirkt', deleted);
  check('S4f Sektion 4: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S5: Strategy-Lab-Backtest (live gerechnet) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  check('S5a Backtest öffnet per Menü', await clickMenuItem(page, 'Backtest'));
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await wait(2500);
  const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  const hasStats = /trades|winrate|win-rate|gewinne|treffer/i.test(text) && /\d/.test(text);
  check('S5b Backtest liefert Kennzahlen (Trades/Winrate) aus Live-Candles', hasStats, text.slice(0, 90));
  // Strategie wechseln → andere Kennzahlen
  const before = text;
  await page.evaluate(() => {
    const sel = document.querySelector('[role="dialog"] select');
    if (sel && sel.options.length > 1) {
      sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await wait(2000);
  const after = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  check('S5c Strategiewechsel rechnet neu (Inhalt ändert sich)', after !== before);
  check('S5d Sektion 5: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S6: Script Lab (eigene Scripts + Fehlerpfad) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  check('S6a Script Lab öffnet per Menü', await clickMenuItem(page, 'Skripte'));
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const editor = await page.$('[role="dialog"] textarea');
  check('S6b Script-Editor (Textarea) vorhanden', editor !== null);
  // Lauf mit dem mitgelieferten Beispiel-Script
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.querySelector('svg.lucide-play, [class*="lucide-play"]'))?.click();
  });
  await wait(1500);
  const runOk = await page.evaluate(() => {
    const t = document.querySelector('[role="dialog"]')?.textContent ?? '';
    return /werte|plots|punkte|values|output|ergebnisse/i.test(t) || /\d+\.\d+/.test(t);
  });
  check('S6c Beispiel-Script läuft und liefert Werte', runOk);
  // Fehlerpfad: kaputtes Script → freundliche Fehlermeldung, kein Crash
  await editor.click({ clickCount: 3 });
  await page.keyboard.type('this is ( not valid js');
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.querySelector('svg.lucide-play, [class*="lucide-play"]'))?.click();
  });
  await wait(1000);
  const errShown = await page.evaluate(() => {
    const t = document.querySelector('[role="dialog"]')?.textContent ?? '';
    return /fehler|error|compile|syntax/i.test(t);
  });
  check('S6d kaputtes Script → Fehlermeldung statt Crash', errShown);
  check('S6e Sektion 6: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S7: Chart-Sync live (TF-Sync über 2x2-Panes) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  await page.keyboard.press('3'); // Layout 2x2
  await wait(2500);
  const panesBefore = await page.evaluate(() => document.querySelectorAll('.font-mono.text-micro-10').length);
  check('S7a Layout 2x2 rendert 4 Panes', panesBefore >= 4, String(panesBefore));
  // TF im ersten Pane umstellen → Sync zieht alle mit
  await page.evaluate(() => {
    const tf = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === '5m');
    tf[0]?.click();
  });
  await wait(2500);
  const legends = await page.evaluate(() =>
    [...document.querySelectorAll('.font-mono.text-micro-10')].map((el) => el.textContent ?? ''),
  );
  const with5m = legends.filter((t) => t.includes('5m')).length;
  check('S7b TF-Sync: alle Panes übernehmen 5m', with5m >= 4, `${with5m}/${legends.length} Legenden mit 5m`);
  check('S7c Sektion 7: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S8: Keyboard-Map (README §10 live) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  await page.keyboard.press('2');
  await wait(1500);
  const panes2 = await page.evaluate(() => document.querySelectorAll('.font-mono.text-micro-10').length);
  check('S8a Taste „2" → Layout 2x1 (2 Panes)', panes2 === 2, String(panes2));
  await page.keyboard.press('1');
  await wait(1200);
  const panes1 = await page.evaluate(() => document.querySelectorAll('.font-mono.text-micro-10').length);
  check('S8b Taste „1" → zurück auf 1x1', panes1 === 1, String(panes1));
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await wait(700);
  const palette = await page.evaluate(() => !!document.querySelector('[role="dialog"] input, [role="combobox"], [cmdk-input]'));
  check('S8c Ctrl+K öffnet die Kommandopalette', palette);
  await page.keyboard.press('Escape');
  await wait(400);
  const paletteGone = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0);
  check('S8d Esc schließt die Palette', paletteGone);
  check('S8e Sektion 8: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S9: Kommandopalette führt Befehle aus (Sprachwechsel) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await wait(700);
  await page.keyboard.type('English');
  await wait(600);
  await page.keyboard.press('Enter');
  await wait(2500);
  const url = page.url();
  check('S9a Paletten-Befehl wechselt die Sprache (URL /en/)', url.includes('/en/'), url.slice(0, 80));
  const lang = await page.evaluate(() => document.documentElement.lang);
  check('S9b <html lang> zieht nach', lang === 'en', lang);
  check('S9c Sektion 9: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S10: Storage-Degradation (localStorage blockiert) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page, {
    init: () => {
      const boom = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { configurable: true, get: boom });
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: boom });
    },
  });
  await wait(4000);
  const alive = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('S10a Terminal rendert trotz blockierter Storage', alive >= 1, String(alive));
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Design')?.click();
  });
  await wait(400);
  const usable = await page.evaluate(() => document.querySelectorAll('[role="option"]').length > 0);
  await page.keyboard.press('Escape');
  check('S10b UI bleibt ohne Storage bedienbar', usable);
  check('S10c Sektion 10: keine Page-Errors (fail-open-Pfad)', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* ========================================================================== */
console.log('\n— S11: Lupe (Magnifier) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  check('S11a Lupe öffnet per Menü', await clickMenuItem(page, 'Lupe'));
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await wait(1200);
  const state = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return {
      text: (dlg?.textContent ?? '').slice(0, 200),
      canvases: dlg?.querySelectorAll('canvas').length ?? 0,
      svgs: dlg?.querySelectorAll('svg').length ?? 0,
      buttons: dlg?.querySelectorAll('button').length ?? 0,
    };
  });
  check('S11b Lupen-Modal rendert Inhalt (Zoom-Fläche + Controls)', state.buttons >= 2 && (state.canvases >= 1 || state.svgs >= 1 || state.text.length > 40), JSON.stringify(state).slice(0, 120));
  // Zoom-Regler/Stufen bedienen → kein Crash
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    [...(dlg?.querySelectorAll('button') ?? [])].slice(0, 4).forEach((b) => b.click());
  });
  await wait(800);
  check('S11c Lupen-Controls klicken ohne Fehler', errors.length === 0, errors[0] ?? '');
  await page.keyboard.press('Escape');
  await wait(400);
  check('S11d Esc schließt die Lupe', await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0));
  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '✔' : '✖'} qa-modules: alle Sektionen — ${failures === 0 ? '0 Failures' : `${failures} Failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
