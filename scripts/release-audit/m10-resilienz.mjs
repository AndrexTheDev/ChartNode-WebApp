// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 10 — DATEN-RESILIENZ & SESSION: Total-Outage aller Feed-Hosts,
// Malformed-Payloads, Offline→Online-Reconnect, Export-Dateien (CSV/PNG)
// inkl. Wasserzeichen-Größe, Heap-Wachstum über 40 Layout/TF-Zyklen,
// Two-Tab-Betrieb, OG-Edge × Locales.
import { mkdirSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, makeReporter, launchBrowser, newPage, attachConsole, gotoSafe, wait, isNoise } from './lib.mjs';

export const META = { id: 'M10', name: 'Daten-Resilienz & Session' };

const FEED_RE = /api\.(binance|coinbase|kraken|gateio|bitget|huobi|okx|bybit|kucoin|coinex)|api-pub\.bitfinex|geckoterminal|dexscreener|llama|goplus|rpc\.|solana\.com/i;
const DL = '/tmp/nc-dl';

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  const browser = await launchBrowser();

  /* R1 · Total-Outage: alle Feed-Hosts blockiert ⇒ Placeholder, kein Crash */
  {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await p.setRequestInterception(true);
    p.on('request', (req) => (FEED_RE.test(req.url()) ? req.abort() : req.continue()));
    await gotoSafe(p, BASE + '/de/terminal');
    await wait(6000);
    const state = await p.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      body: document.body.innerText.length > 200,
    }));
    check('Total-Outage: Terminal rendert weiterhin (Placeholder-States)', state.canvases >= 1 && state.body, JSON.stringify(state));
    check('Total-Outage: keine unkonditionierten Page-Errors', errs.filter((e) => !e.startsWith('requestfailed') && !/Failed to load resource|net::/.test(e)).length === 0, errs.slice(0, 1).join('|'));
    await p.close();
  }

  /* R2 · Malformed-Payloads (invalid JSON / null) ⇒ graceful */
  {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await p.setRequestInterception(true);
    p.on('request', (req) => {
      if (/klines|candles|OHLC|history_kline|candlesticks/i.test(req.url()) && FEED_RE.test(req.url())) {
        return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{kaputt' });
      }
      return FEED_RE.test(req.url()) ? req.abort() : req.continue();
    });
    await gotoSafe(p, BASE + '/de/terminal');
    await wait(5000);
    const alive = await p.evaluate(() => document.querySelectorAll('canvas').length >= 1);
    check('Malformed Kline-Payloads: graceful Degradation', alive && errs.filter((e) => e.startsWith('pageerror')).length === 0, errs.slice(0, 1).join('|'));
    await p.close();
  }

  /* R3 · Offline → Online: Reconnect auf Live, Preise ticken weiter */
  {
    const p = await newPage(browser);
    await gotoSafe(p, BASE + '/de/terminal');
    await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(4000);
    await p.setOfflineMode(true);
    await wait(4000);
    const down = await p.evaluate(() => /reconnect|offline|getrennt/i.test(document.body.innerText));
    await p.setOfflineMode(false);
    await wait(8000);
    const up = await p.evaluate(() => ({
      live: /LIVE/i.test(document.body.innerText),
      legend: document.body.innerText.match(/C [\d.,]+/)?.[0] || '',
    }));
    check('Offline: Status zeigt Reconnecting/Getrennt', down === true);
    check('Online-Comeback: Status LIVE + Legend-Werte präsent', up.live && up.legend.length > 3, JSON.stringify(up));
    await p.close();
  }

  /* R4 · Exporte: CSV parse-bar, PNG = echtes Bild mit Substanz */
  {
    rmSync(DL, { recursive: true, force: true });
    mkdirSync(DL, { recursive: true });
    const p = await newPage(browser);
    const client = await p.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => null);
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true, browserContextId: undefined }).catch(() => null);
    await gotoSafe(p, BASE + '/de/terminal');
    await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(4000);
    const clickBy = (re) =>
      p.evaluate((rs) => {
        const b = [...document.querySelectorAll('button')].find((x) => new RegExp(rs, 'i').test(x.getAttribute('aria-label') || x.getAttribute('title') || ''));
        if (!b) return false;
        b.click();
        return true;
      }, re.source);
    const csvClicked = await clickBy(/CSV/);
    await wait(3500);
    const files1 = readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));
    const csv = files1.find((f) => f.endsWith('.csv'));
    let csvOk = false;
    let csvInfo = 'kein file';
    if (csv) {
      const lines = readFileSync(join(DL, csv), 'utf8').trim().split('\n');
      csvOk = lines.length > 10 && /time|open|close/i.test(lines[0]);
      csvInfo = lines.length + ' Zeilen, Header: ' + lines[0].slice(0, 40);
    }
    check('CSV-Export: Datei parse-bar (Header + >10 Reihen)', csvClicked && csvOk, csvInfo);
    const pngClicked = await clickBy(/PNG/);
    await wait(4000);
    const files2 = readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));
    const png = files2.find((f) => f.endsWith('.png'));
    let pngOk = false;
    let pngInfo = 'kein file';
    if (png) {
      const buf = readFileSync(join(DL, png));
      pngOk = buf.subarray(1, 4).toString() === 'PNG' && statSync(join(DL, png)).size > 20000;
      pngInfo = statSync(join(DL, png)).size + ' Bytes';
    }
    check('PNG-Export: echtes Bild >20 KB (Wasserzeichen-Canvas)', pngClicked && pngOk, pngInfo);
    await p.close();
  }

  /* R5 · Heap-Wachstum über 40 Layout/TF-Zyklen */
  {
    const p = await newPage(browser);
    await gotoSafe(p, BASE + '/de/terminal');
    await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(4000);
    const m0 = (await p.metrics()).JSHeapUsedSize;
    for (let i = 0; i < 40; i++) {
      await p.evaluate((n) => {
        const grp = [...document.querySelectorAll('[role="group"]')].find((g) => (g.getAttribute('aria-label') || '').includes('Layout'));
        const btns = [...(grp?.querySelectorAll('button') || [])];
        btns.find((b) => (n % 2 ? /2x2/i : /2x1/i).test(b.textContent || ''))?.click();
      }, i);
      await wait(120);
      await p.evaluate(() => {
        const grp = [...document.querySelectorAll('[role="group"]')].find((g) => /Zeiteinheit/i.test(g.getAttribute('aria-label') || ''));
        [...(grp?.querySelectorAll('button') || [])].find((b) => /^1h$/i.test((b.textContent || '').trim()))?.click();
      });
      await wait(120);
    }
    await p.evaluate(() => {
      const grp = [...document.querySelectorAll('[role="group"]')].find((g) => (g.getAttribute('aria-label') || '').includes('Layout'));
      [...(grp?.querySelectorAll('button') || [])].find((b) => /1x1/i.test(b.textContent || ''))?.click();
    });
    await wait(2500);
    const m1 = (await p.metrics()).JSHeapUsedSize;
    const growthMb = Math.round((m1 - m0) / 1048576);
    check('Heap: Wachstum über 40 Zyklen < 80 MB', growthMb < 80, growthMb + ' MB');
    await p.close();
  }

  /* R6 · Two-Tab-Betrieb im selben Kontext */
  {
    const ctx = await browser.createBrowserContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await a.goto(BASE + '/de/terminal', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await b.goto(BASE + '/en/terminal', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await a.waitForSelector('canvas', { timeout: 40000 });
    await b.waitForSelector('canvas', { timeout: 40000 });
    await wait(3000);
    await a.evaluate(() => {
      const grp = [...document.querySelectorAll('[role="group"]')].find((g) => (g.getAttribute('aria-label') || '').includes('Layout'));
      [...(grp?.querySelectorAll('button') || [])].find((x) => /2x1/i.test(x.textContent || ''))?.click();
    });
    await wait(2500);
    const alive = await Promise.all([a, b].map((pg) => pg.evaluate(() => document.querySelectorAll('canvas').length)));
    check('Two Tabs: beide Terminals überleben Cross-Tab-Storage-Events', alive[0] >= 2 && alive[1] >= 1, JSON.stringify(alive));
    await ctx.close();
  }

  /* R7 · OG-Edge × Locales + Params */
  for (const qs of ['?ticker=SOL&price=150&locale=de', '?ticker=ETH&locale=zh', '?locale=ru']) {
    const r = await fetch(BASE + '/api/og' + qs);
    const body = await r.text();
    const ok = r.status === 200 && (Buffer.from(body.slice(0, 8), 'binary').subarray(1, 4).toString() === 'PNG' || r.headers.get('content-type')?.includes('svg'));
    check('/api/og' + qs + ': 200 + PNG|SVG (Doktrin)', ok, 'status=' + r.status);
  }

  await browser.close();
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
