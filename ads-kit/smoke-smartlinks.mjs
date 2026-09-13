/**
 * QA-Smoke-Test für das Adsterra-Smartlink-Kit (Demo-Seite, headless).
 * Lauf:  npm run qa:smartlinks   (benötigt installierte puppeteer-Chrome-Libs)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve('ads-kit');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'smartlinks-demo.html' : req.url.split('?')[0]);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4173, r));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 30000 });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let pass = 0, fail = 0;
const t = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}`); };

await page.goto('http://127.0.0.1:4173/smartlinks-demo.html', { waitUntil: 'networkidle0' });

await page.evaluate(() => {
  window.__sl = [];
  for (const ev of ['sl:opened', 'sl:blocked', 'sl:capped', 'sl:toast']) {
    document.addEventListener(ev, (e) => window.__sl.push({ ev, ...e.detail }));
  }
});

t('CTA/Card-Badges injiziert (>=4)', await page.$$eval('.nc-sl-cta > .nc-sl-badge, .nc-sl-card > .nc-sl-badge', (n) => n.length) >= 4);
const anchor = await page.$eval('a[data-smartlink]', (a) => ({ href: a.href, target: a.target, rel: a.rel }));
t('Anker-CTA: href=Smartlink (nicht #)', anchor.href.includes('globalimmaturelunatic.com'));
t('Anker-CTA: target=_blank + rel=sponsored noopener', anchor.target === '_blank' && anchor.rel === 'sponsored noopener');
t('Sponsor-Strip: 3 Anker-Buttons mit rel=sponsored', await page.$$eval('#sponsor-strip .nc-sl-strip-btn', (n) => n.length === 3 && n.every((a) => a.rel.includes('sponsored'))));
t('remaining() initial = 3', await page.evaluate(() => window.SmartlinksApp.remaining()) === 3);

await page.click('.js-export-chart');
t('noch kein Toast unmittelbar nach Feature-Klick', await page.$('.nc-sl-toast') === null);
await new Promise((r) => setTimeout(r, 1200));
t('Offer-Toast erscheint nach Delay (mit Badge)', await page.$('.nc-sl-toast .nc-sl-badge') !== null);
t('sl:toast-Event feuerte', await page.evaluate(() => window.__sl.some((x) => x.ev === 'sl:toast')));

await page.$eval('.nc-sl-toast-cta', (a) => { a.href = '#sl-test-fired'; a.target = '_self'; });
await page.click('.nc-sl-toast-cta');
await new Promise((r) => setTimeout(r, 400));
t('sl:opened feuert bei Toast-CTA-Klick (Quelle action)', await page.evaluate(() => window.__sl.some((x) => x.ev === 'sl:opened' && x.source === 'action:.js-export-chart')));
t('remaining() nach Fire = 2', await page.evaluate(() => window.SmartlinksApp.remaining()) === 2);

await page.click('.js-export-chart');
await new Promise((r) => setTimeout(r, 1200));
t('kein zweiter Toast innerhalb des 10-min-Intervals', await page.$('.nc-sl-toast') === null);

const opened = await page.evaluate(() => window.SmartlinksApp.open('about:blank', 'test-direct'));
await new Promise((r) => setTimeout(r, 300));
const hasModal = await page.$('.nc-sl-modal-backdrop');
t('open(): Fenster offen ODER Fallback-Modal', opened === true || hasModal !== null);
if (hasModal) {
  t('Modal: Badge + Direkt-Anker (rel=sponsored)', await page.$eval('.nc-sl-modal a.nc-sl-btn-primary', (a) => a.rel.includes('sponsored')) && await page.$('.nc-sl-modal .nc-sl-badge') !== null);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  t('Modal per Escape schließbar', await page.$('.nc-sl-modal-backdrop') === null);
}

t('Landing-API vorhanden (open/toast/refresh/remaining)', await page.evaluate(() => ['open', 'toast', 'refresh', 'remaining'].every((k) => typeof window.SmartlinksLanding[k] === 'function')));
t('keine JS-Fehler (pageerror)', errors.length === 0);
if (errors.length) console.log('FEHLER:', errors);

for (const p of await browser.pages()) { if (p !== page) await p.close().catch(() => {}); }
await browser.close();
server.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
