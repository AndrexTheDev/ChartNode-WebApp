// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Gemeinsame Helfer für den modularen Release-Audit (scripts/release-audit/).
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
export const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];
export const ROUTES = ['/', '/help', '/terminal', '/legal/terms', '/legal/disclaimer', '/legal/privacy'];

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Headless-Artefakte + bekannte CORS-blinde Exchange-Hosts (Doktrin) filtern. */
export const ENV_NOISE = /SwiftShader|software WebGL|GroupMarkerNotSet|Fallback to SwiftShader/i;
export const CORS_BLIND = /api\.bybit\.com|api\.kucoin\.com|api-pub\.bitfinex\.com|api\.coinex\.com|geckoterminal\.com/i;
/** Chrome-interner Root-Request (tritt nur in Incognito-Kontexten auf, nie app-initiiert). */
export const CHROME_INTERNAL = /^https?:\/\/(www\.)?google\.com\/?$/;
export const isNoise = (text) => ENV_NOISE.test(text) || CORS_BLIND.test(text) || CHROME_INTERNAL.test(text);

/** Reporter pro Modul: check(name, ok, info) sammelt + loggt sofort. */
export function makeReporter(modId, modName) {
  const rows = [];
  let pass = 0;
  let fail = 0;
  const check = (name, ok, info = '') => {
    if (ok) pass += 1;
    else fail += 1;
    rows.push({ name, ok: !!ok, info: String(info).slice(0, 200) });
    console.log(`  ${ok ? '✔' : '✘'} [${modId}] ${name}${info ? ' — ' + String(info).slice(0, 160) : ''}`);
  };
  return { check, pass: () => pass, fail: () => fail, rows: () => rows, id: modId, name: modName };
}

export async function launchBrowser() {
  return puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
}

export async function newPage(browser, { width = 1440, height = 900, mobile = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  return page;
}

/** Console-/Pageerror-Sammler mit Noise-Filter. */
export function attachConsole(page, bucket) {
  page.on('pageerror', (e) => {
    const s = String(e && e.message ? e.message : e);
    if (!isNoise(s)) bucket.push('pageerror: ' + s);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const s = m.text();
    if (!isNoise(s)) bucket.push(m.type() + ': ' + s);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (isNoise(u)) return;
    // Nur Same-Origin-Fails sind Release-Blocker; Third-Party-Flakes (Sandbox-
    // Netz, CORS-blinde Börsen) deckt der Funktions-Check in M3 funktional ab.
    if (!u.startsWith(BASE)) return;
    bucket.push('requestfailed: ' + u.slice(0, 120));
  });
}

export const gotoSafe = (page, url, timeout = 90000) =>
  page.goto(url, { waitUntil: 'domcontentloaded', timeout });

/** RELEASE-AUDIT.md schreiben: Modulübersicht + alle Fails. */
export function writeReport(modules) {
  const totalP = modules.reduce((a, m) => a + m.pass, 0);
  const totalF = modules.reduce((a, m) => a + m.fail, 0);
  const lines = [
    '# RELEASE-AUDIT (modular)',
    '',
    `Stand: ${new Date().toISOString()} · **${totalP} PASS / ${totalF} FAIL**`,
    '',
    '| Modul | Bereich | PASS | FAIL |',
    '|---|---|---:|---:|',
    ...modules.map((m) => `| ${m.id} | ${m.name} | ${m.pass} | ${m.fail} |`),
    '',
  ];
  for (const m of modules) {
    if (!m.fail) continue;
    lines.push(`## ${m.id} — ${m.name}: Fails`, '');
    for (const r of m.rows.filter((x) => !x.ok)) lines.push(`- ✘ ${r.name}${r.info ? ' — ' + r.info : ''}`);
    lines.push('');
  }
  writeFileSync(resolve(ROOT, 'RELEASE-AUDIT.md'), lines.join('\n'));
  return { totalP, totalF };
}
