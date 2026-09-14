// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 9 — SECURITY & INPUT-HARDENING: Security-Header, Cookie-Inventar,
// npm-audit-Bewertung (prod high/critical), XSS-Param-Matrix (ticker/price/OG),
// korrupte localStorage-Seeds, invalid Locales/Token, Git-Historien-Secret-Scan,
// Privacy-Faktencheck (NEXT_LOCALE + Ad-Partner disclosures).
import { execSync } from 'node:child_process';
import { BASE, makeReporter, launchBrowser, newPage, attachConsole, gotoSafe, wait } from './lib.mjs';

export const META = { id: 'M9', name: 'Security & Input-Hardening' };

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  const browser = await launchBrowser();

  /* S1 · Security-Header-Baseline */
  const res = await fetch(BASE + '/de');
  const h = (k) => res.headers.get(k) || '';
  check('Header: X-Content-Type-Options nosniff', h('x-content-type-options') === 'nosniff');
  check('Header: Referrer-Policy gesetzt', h('referrer-policy').length > 4, h('referrer-policy'));
  check('Header: Permissions-Policy (camera/mic/geo/payment aus)', h('permissions-policy').includes('camera=()'), h('permissions-policy').slice(0, 60));
  check('Header: kein x-powered-by', !res.headers.get('x-powered-by'));

  /* S2 · Cookie-Inventar: nur funktionales NEXT_LOCALE */
  const cookies = [...(await (await fetch(BASE + '/de/terminal')).headers.getSetCookie?.() || [])];
  const names = cookies.map((c) => c.split('=')[0]);
  check('Cookies: höchstens NEXT_LOCALE (funktional)', names.every((n) => n === 'NEXT_LOCALE'), names.join(',') || 'keine');

  /* S3 · npm audit: PROD-Muss 0 high/critical; Dev-Befund als Info
     (extract-zip 2.0.1 = upstream-latest, Advisory ohne Fix, nur puppeteer-Kette) */
  let prodBad = 1;
  let devInfo = '';
  try {
    const prod = JSON.parse(execSync('npm audit --omit=dev --json', { cwd: process.cwd(), encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }));
    prodBad = (prod.metadata?.vulnerabilities?.high || 0) + (prod.metadata?.vulnerabilities?.critical || 0);
    try {
      const all = JSON.parse(execSync('npm audit --json', { cwd: process.cwd(), encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }));
      devInfo = 'all: ' + JSON.stringify(all.metadata?.vulnerabilities);
    } catch (e2) {
      try { devInfo = 'all: ' + JSON.stringify(JSON.parse(String(e2.stdout)).metadata?.vulnerabilities); } catch { /* offline */ }
    }
  } catch (e) {
    try {
      const j = JSON.parse(String(e.stdout));
      prodBad = (j.metadata?.vulnerabilities?.high || 0) + (j.metadata?.vulnerabilities?.critical || 0);
    } catch { /* Registry offline ⇒ Info */ }
  }
  check('npm audit PROD: 0 high/critical', prodBad === 0, devInfo.slice(0, 120));

  /* S4 · XSS-Param-Matrix Terminal */
  for (const qs of [
    '?ticker=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    '?ticker=%22%20onerror%3Dalert(1)&price=%3Csvg%20onload%3Dalert(2)%3E',
    '?price=NaN%3Bfetch(%27x%27)',
  ]) {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await gotoSafe(p, BASE + '/de/terminal' + qs);
    await wait(3000);
    const bad = await p.evaluate(() => ({
      injected: !!document.querySelector('script:not([src])')?.textContent?.includes('alert(1)'),
      svgExec: !!document.querySelector('svg[onload]'),
      title: document.title,
    }));
    check(`XSS-Param ${decodeURIComponent(qs).slice(0, 34)}: keine Injection`, !bad.injected && !bad.svgExec && errs.length === 0, bad.title.slice(0, 40));
    await p.close();
  }

  /* S5 · OG-Edge mit malicious Params: PNG oder 4xx, nie HTML-Reflection */
  // Doktrin (src/app/api/og/route.ts): SVG heute (Telegram/Discord/Reddit
  // renden es), PNG-Upgrade = dokumentierter Weg. Muss: escaping, nie Reflection.
  for (const qs of ['?ticker=SOL&price=150', '?ticker=%3Csvg%20onload%3Dalert(1)%3E']) {
    const r = await fetch(BASE + '/api/og' + qs);
    const body = await r.text();
    const isPng = Buffer.from(body.slice(0, 8), 'binary').subarray(1, 4).toString() === 'PNG';
    const isSvg = body.trimStart().startsWith('<svg') || r.headers.get('content-type')?.includes('svg');
    const reflected = /onload=alert|<script/i.test(body);
    check(`/api/og${qs.slice(0, 24)}: 200 PNG|SVG ohne Reflection`, r.status === 200 && (isPng || isSvg) && !reflected, 'status=' + r.status + ' png=' + isPng);
  }

  /* S6 · Korrupte localStorage-Seeds ⇒ kein Crash */
  {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await p.evaluateOnNewDocument(() => {
      localStorage.setItem('nodechart:store:v1', '{definitiv::kaputt');
      localStorage.setItem('nc-viral-v1', 'null');
      localStorage.setItem('nc_sl_fire_log', '[[');
    });
    await gotoSafe(p, BASE + '/de/terminal');
    await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(3000);
    const alive = await p.evaluate(() => document.querySelectorAll('canvas').length >= 1);
    check('Korrupte Store-Seeds: App bootet mit Defaults', alive && errs.length === 0, errs.slice(0, 1).join('|'));
    await p.close();
  }

  /* S7 · Invalid Locale + unbekannter Token */
  const r404 = await fetch(BASE + '/xx/terminal');
  check('Invalid Locale /xx: 404 oder Redirect (nie 5xx)', r404.status === 404 || (r404.status >= 300 && r404.status < 400), 'status=' + r404.status);
  {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await gotoSafe(p, BASE + '/de/terminal?ticker=ZZZZZZZZ');
    await wait(3500);
    const ok = await p.evaluate(() => document.querySelectorAll('canvas').length >= 1);
    check('Unbekannter Token ZZZZZZZZ: graceful (kein Crash)', ok && errs.length === 0, errs.slice(0, 1).join('|'));
    await p.close();
  }

  /* S8 · Git-Historie: keine Secret-Blobs */
  let secretHit = '';
  try {
    secretHit = execSync(
      `git grep -I -E "BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{36}|sk_live_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}" $(git rev-list --all | head -50) -- 2>/dev/null | head -3`,
      { cwd: process.cwd(), encoding: 'utf8', timeout: 120000, shell: '/bin/bash' },
    ).trim();
  } catch { /* grep findet nichts ⇒ exit 1 ⇒ ok */ }
  check('Git-Historie (letzte 50 Commits): keine Secret-Blobs', secretHit === '', secretHit.slice(0, 80));

  /* S9 · Privacy-Disclosure live: NEXT_LOCALE + Ad-Partner */
  {
    const p = await newPage(browser);
    await gotoSafe(p, BASE + '/de/legal/privacy');
    await wait(1500);
    const txt = await p.evaluate(() => document.body.innerText);
    check('Privacy nennt NEXT_LOCALE + Ad-Partner-IP-Disclosure', txt.includes('NEXT_LOCALE') && /Adsterra|Ad-Partner/i.test(txt));
    await p.close();
  }

  await browser.close();
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
