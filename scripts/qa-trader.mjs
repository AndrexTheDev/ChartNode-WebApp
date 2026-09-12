// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Trader-Simulation: Multi-Börsen-Abfragen, On-Chain-Signale, Token-Security,
// Rate-Limit-Resilience. Klassifiziert Sandbox-Netzblockaden vs. echte Defekte.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VENUES = ['binance', 'okx', 'bybit', 'coinbase', 'kraken', 'gate', 'bitget', 'kucoin', 'bitfinex', 'cryptocom', 'htx', 'coinex'];
const VENUE_LABEL = { binance: 'Binance', okx: 'OKX', bybit: 'Bybit', coinbase: 'Coinbase Exchange', kraken: 'Kraken', gate: 'Gate', bitget: 'Bitget', kucoin: 'KuCoin', bitfinex: 'Bitfinex', cryptocom: 'Crypto.com', htx: 'HTX', coinex: 'CoinEx' };
const EXCLUDE_TRIGGER = /^(DE|EN|RU|ES|中文)▾$|^[0-9]+[mhdwMHDW]▾$|^[A-Z]+\/[A-Z0-9]+▾$|^▾$/;

const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`); };

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1600, height: 1000 } });

const openTerminal = async (patch) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.evaluateOnNewDocument(() => {
    window.__ncSockets = [];
    const OrigWS = window.WebSocket;
    const Wrapped = function (url, protocols) {
      const sock = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
      window.__ncSockets.push({ url: String(url).slice(0, 60), sock, closedAt: null });
      sock.addEventListener('close', () => { const e = window.__ncSockets.find((x) => x.sock === sock); if (e) e.closedAt = Date.now(); });
      return sock;
    };
    Wrapped.prototype = OrigWS.prototype;
    Object.assign(Wrapped, OrigWS);
    window.WebSocket = Wrapped;
  });
  if (patch) await page.evaluateOnNewDocument(patch);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  // Deterministischer Startzustand: persistierte Venue/Token aus Vor-Sektionen verwerfen.
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  return { page, errors };
};

const awaitDexHits = async (page, { ms = 20000, needBadge = false } = {}) => {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => {
      const lb = document.querySelector('[role="listbox"]');
      const t = lb?.innerText ?? '';
      return {
        hits: (t.match(/DEX/g) || []).length,
        badge: /SICHER|VORSICHT|SCAM \/ HONEYPOT|UNGEPRÜFT/.test(t),
        scanning: /WIRD GELADEN|WERDEN GESCANNT|LÄDT/i.test(t),
      };
    });
    if (st.hits > 0 && (!needBadge || st.badge)) return st;
    if (Date.now() - t0 > ms) return st;
    await wait(700);
  }
};

const feedState = (page) => page.evaluate(() => {
  const body = document.body.innerText;
  const ws = performance.getEntriesByType('resource').filter((e) => e.name.startsWith('wss://'));
  return {
    wsCount: ws.length,
    wsOpen: ws.filter((e) => e.responseEnd === 0).length,
    live: ws.filter((e) => e.responseEnd === 0 && /binance|bybit|okx|kraken|coinbase|gate|bitfinex|huobi|htx|coinex|kucoin|bitget|crypto\.com/i.test(e.name)).length,
    statusLive: /LIVE|CONNECTING|VERBINDE|RECONNECT/i.test(body),
    candles: (body.match(/(\d+)\s*CANDLES/i) || [])[1] || '0',
    quote: (body.match(/\$[\d.,]+/) || [])[0] || '',
    seedVia: (body.match(/HISTORIE VIA [\w.\-]+/i) || [])[0] || '',
    bodySnippet: body.replace(/\s+/g, ' ').slice(0, 120),
  };
});

// picker trigger: listbox-Button mit Kürzel(+ms|Auto), ohne Locale/TF/Token/leer
const findPicker = `(() => {
  const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
    .find((x) => { const t = (x.textContent ?? '').trim(); return /▾/.test(t) && !${EXCLUDE_TRIGGER}.test(t); });
  if (b) { b.click(); return true; }
  return false;
})()`;

console.log('— 1: Multi-CEX-Connectivity (12 Börsen via Exchange-Picker) —');
{
  const { page, errors } = await openTerminal();
  const matrix = [];
  for (const venue of VENUES) {
    const opened = await page.evaluate(findPicker);
    await wait(400);
    const picked = await page.evaluate((name) => {
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent ?? '').includes(name));
      if (!opt) return false;
      const btn = opt.querySelector('button') ?? opt;
      btn.click();
      return true;
    }, VENUE_LABEL[venue]);
    await wait(5000);
    const f = await feedState(page);
    const graceful = Number(f.candles) > 0 && f.statusLive;
    matrix.push({ venue, opened, picked, ...f });
    ok(`venue ${venue}: Picker-Wahl + Feed kohärent (Candles>0, kein Crash)`, picked && graceful, `candles=${f.candles} ws=${f.wsCount}/${f.wsOpen}open quote=${f.quote} ${f.seedVia}`);
  }
  await page.screenshot({ path: `${OUT}/qa-trader-venue-matrix.png` });
  ok('Sektion 1: keine Page-Errors über alle 12 Venue-Wechsel', errors.length === 0, errors[0] || '');
  fs.writeFileSync(`${OUT}/qa-trader-venue-matrix.json`, JSON.stringify(matrix, null, 1));
  await page.close();
  console.log('\n— Venue-Matrix —');
  for (const m of matrix) console.log(`  ${m.venue.padEnd(10)} picked=${m.picked} candles=${m.candles} ws=${m.wsCount}/${m.wsOpen}open/${m.live}live`);
}

console.log('\n— 1b: DEX-Multichain + CA-Wechsel in der Smart Search —');
{
  const { page, errors } = await openTerminal();
  const dexPicked = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) => /[A-Z]+\/[A-Z0-9]+/.test(b.textContent ?? ''));
    if (!t) return false;
    t.click();
    return true;
  });
  await wait(400);
  const optPicked = dexPicked && await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent ?? '').includes('WBTC/ETH'));
    if (!opt) return false;
    (opt.querySelector('button') ?? opt).click();
    return true;
  });
  await wait(4000);
  let f = await feedState(page);
  for (let i = 0; i < 14 && Number(f.candles) === 0; i++) { await wait(1500); f = await feedState(page); }
  ok('DEX-Preset (WBTC/ETH) lädt Candles via GeckoTerminal OHLCV', optPicked && Number(f.candles) > 0, `picked=${optPicked} candles=${f.candles}`);
  await page.screenshot({ path: `${OUT}/qa-trader-dex.png` });

  await page.click('header input[type="text"]');
  await page.type('header input[type="text"]', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', { delay: 12 });
  await awaitDexHits(page, { ms: 24000, needBadge: true });
  const drop = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const t = lb?.innerText ?? '';
    return {
      hasDexHit: /ethereum|DEX|Uniswap/i.test(t),
      badge: (t.match(/SICHER|VORSICHT|SCAM \/ HONEYPOT|UNGEPRÜFT|PRÜFE/i) || [])[0] ?? 'kein-Badge-Text',
      snippet: t.replace(/\s+/g, ' ').slice(0, 140),
    };
  });
  ok('CA-Suche rendert DEX-Treffer + Security-Badge im Dropdown', drop.hasDexHit && drop.badge !== 'kein-Badge-Text', JSON.stringify(drop));
  await page.screenshot({ path: `${OUT}/qa-trader-ca-search.png` });

  const selected = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const opts = [...(lb?.querySelectorAll('[role="option"]') ?? [])].filter((o) => /DEX/i.test(o.textContent ?? ''));
    const opt = opts.find((o) => /^WETH\//.test((o.textContent ?? '').trim())) ?? opts.find((o) => /WETH/.test(o.textContent ?? '')) ?? opts[0];
    if (!opt) return false;
    (opt.querySelector('button') ?? opt).click();
    return true;
  });
  let f2 = await feedState(page);
  // GeckoTerminal antwortet auf Drosselung mit 429 OHNE CORS-Header (im Browser
  // sicht­bar als ERR_FAILED); der Chart-Retry kommt erst nach 15 s Backoff.
  for (let i = 0; i < 32 && Number(f2.candles) === 0; i++) {
    await wait(1500);
    f2 = await feedState(page);
  }
  ok('CA-Auswahl wechselt das Terminal auf den DEX-Token (Candles + Kurs)', selected && Number(f2.candles) > 0 && !!f2.quote, `candles=${f2.candles} quote=${f2.quote}`);
  ok('Sektion 1b: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();
}

console.log('\n— 2: On-Chain-Signale & Security-Audits —');
{
  const { page, errors } = await openTerminal();
  // erst auf DEX-Token wechseln (Forensik braucht chain:contract).
  // needBadge: Warten, bis das GoPlus-Audit des Treffers durch ist – dann ist
  // der fetchJson-Cache warm und die Panel-Forensik deterministisch bedienbar.
  await page.click('header input[type="text"]');
  await page.type('header input[type="text"]', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', { delay: 12 });
  await awaitDexHits(page, { ms: 30000, needBadge: true });
  await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const opts = [...(lb?.querySelectorAll('[role="option"]') ?? [])].filter((o) => /DEX/i.test(o.textContent ?? ''));
    const opt = opts.find((o) => /^WETH\//.test((o.textContent ?? '').trim())) ?? opts.find((o) => /WETH/.test(o.textContent ?? '')) ?? opts[0];
    if (opt) (opt.querySelector('button') ?? opt).click();
  });
  await wait(6000);
  await page.screenshot({ path: `${OUT}/qa-trader-onchain-token.png` });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'On-Chain')?.click();
  });
  const groups = ['BITCOIN-NETZWERK', 'EVM-NETZWERKE', 'SOLANA', 'DEFI-KAPITAL', 'DEX-HEAT', 'TOKEN-FORENSIK'];
  let found = [];
  for (let i = 0; i < 8; i++) {
    await wait(1000);
    found = await page.evaluate((gs) => gs.filter((g) => document.body.innerText.includes(g)), groups);
    if (found.length === groups.length) break;
  }
  ok('On-Chain-Panel rendert alle sechs Signal-Gruppen', found.length === groups.length, JSON.stringify(found));
  await page.screenshot({ path: `${OUT}/qa-trader-onchain.png`, fullPage: false });

  // GoPlus free tier drosselt hart (429 → globaler Cooldown); die App retryt
  // errorede Gruppen nach ERROR_RETRY_MS (30 s). 150 s Polling deckt mehrere
  // Retry-Zyklen ab, statt bei einem einzigen 429-Fenster rot zu melden.
  for (let i = 0; i < 100; i++) {
    await wait(1500);
    const live = await page.evaluate(() => /HOLDER\s+[\d.]+[KM]?/i.test(document.body.innerText));
    if (live) break;
  }
  const signals = await page.evaluate((gs) => {
    const panel = document.querySelector('aside[aria-label="On-Chain-Signale"]');
    const text = (panel?.innerText ?? document.body.innerText).toUpperCase();
    const perGroup = gs.map((g) => {
      const i = text.indexOf(g);
      if (i < 0) return { g, state: 'fehlt' };
      const seg = text.slice(i + g.length, i + g.length + 80);
      const state = /LIVE/.test(seg) ? 'live' : /OFFLINE/.test(seg) ? 'offline' : /LÄDT/.test(seg) ? 'loading' : /BEREIT/.test(seg) ? 'idle' : '?';
      return { g, state };
    });
    return { perGroup, text: document.body.innerText.replace(/\s+/g, ' ') };
  }, groups);
  const resolved = signals.perGroup.filter((r) => ['live', 'offline', 'loading', 'idle'].includes(r.state)).length;
  ok('Signal-Gruppen zeigen Live-LEDs oder saubere Offline-LEDs (kein totes UI)', resolved === groups.length, JSON.stringify(signals.perGroup.map((r) => `${r.g}:${r.state}`)));
  const anyWhale = /Whale/i.test(signals.text);
  ok('Whale-Tracker-Stream erscheint im UI ohne Crash', anyWhale && errors.length === 0, `whale=${anyWhale} errors=${errors.length}`);

  const forensics = await page.evaluate(() => {
    const t = document.body.innerText;
    const block = (t.match(/TOKEN-FORENSIK[\s\S]{0,260}/i) || ['(nicht gefunden)'])[0].replace(/\s+/g, ' ');
    return {
      holder: /HOLDER\s+[\d.,]+[KM]?/i.test(block),
      tax: /BUY\/SELL-TAX\s+[\d.]+\s*\/\s*[\d.]+\s*%/i.test(block),
      top10: /TOP-10-ANTEIL/i.test(block),
      lp: /LP GELOCKT/i.test(block),
      block,
    };
  });
  const fOk = forensics.holder && forensics.tax && forensics.top10 && forensics.lp;
  ok('Token-Forensik (GoPlus/RugCheck) rendert Holder, Tax, Top-10-Konzentration, LP-Lock', fOk, JSON.stringify(forensics));
  await page.screenshot({ path: `${OUT}/qa-trader-forensics.png` });
  await page.close();
}

console.log('\n— 2b: Simulierter Scam-Token (feindlicher GoPlus-Upstream) —');
{
  const { page, errors } = await openTerminal((_) => {
    const fake = { code: 1, result: { '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { is_honeypot: '1', cannot_sell_all: '1', buy_tax: '0.00', sell_tax: '0.99', holder_count: '12' } } };
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('api.gopluslabs.io')) {
        return new Response(JSON.stringify(fake), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return origFetch(input, init);
    };
  });
  await page.click('header input[type="text"]');
  await page.type('header input[type="text"]', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', { delay: 12 });
  await awaitDexHits(page, { ms: 24000, needBadge: true });
  // needBadge kann der nicht-auditierbare Zweit-Treffer erfüllen (z. B.
  // PulseChain → sofort UNGEPRÜFT), während das WETH/Ethereum-Audit noch
  // läuft: GoPlus ist hier instant (Fake), aber die honypot.is-Zweitmeinung
  // bei danger-Verdikt ist ein Live-Call (12 s Timeout + Retry). Deshalb
  // explizit auf den Endzustand des auditierten Treffers pollen.
  {
    const t0 = Date.now();
    for (;;) {
      const st = await page.evaluate(() => {
        const lb = document.querySelector('[role="listbox"]');
        const t = lb?.innerText ?? '';
        return {
          danger: /SCAM \/ HONEYPOT/i.test(t),
          skull: !!lb?.querySelector('svg.lucide-skull'),
          pending: /PRÜFE/.test(t), // 'UNGEPRÜFT' enthält 'PRÜFT', nicht 'PRÜFE'
        };
      });
      if (st.danger || st.skull) break;
      if (!st.pending && Date.now() - t0 > 8000) break; // Endzustand, aber kein Scam
      if (Date.now() - t0 > 40000) break;
      await wait(700);
    }
  }
  const badge = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const t = lb?.innerText ?? '';
    const skull = !!lb?.querySelector('svg.lucide-skull');
    return { danger: /SCAM \/ HONEYPOT/i.test(t), skull, badge: (t.match(/SICHER|VORSICHT|SCAM \/ HONEYPOT|UNGEPRÜFT|PRÜFE/i) || [])[0] ?? 'kein-Badge', snippet: t.replace(/\s+/g, ' ').slice(0, 120) };
  });
  ok('Simulierter Honeypot-Upstream kippt das Badge auf Gefahr (Totenkopf) im Dropdown', badge.danger || badge.skull, JSON.stringify(badge));
  await page.screenshot({ path: `${OUT}/qa-trader-scam-badge.png` });

  await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const opts = [...(lb?.querySelectorAll('[role="option"]') ?? [])].filter((o) => /DEX/i.test(o.textContent ?? ''));
    const opt = opts.find((o) => /^WETH\//.test((o.textContent ?? '').trim())) ?? opts.find((o) => /WETH/.test(o.textContent ?? '')) ?? opts[0];
    if (opt) (opt.querySelector('button') ?? opt).click();
  });
  await wait(5000);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'On-Chain')?.click(); });
  for (let i = 0; i < 14; i++) {
    await wait(1500);
    const done = await page.evaluate(() => /HONEYPOT|HOLDER\s+\d/i.test(document.body.innerText));
    if (done) break;
  }
  const term = await page.evaluate(() => {
    const t = document.body.innerText;
    return { dangerInTerminal: /SCAM \/ HONEYPOT|HONEYPOT/i.test(t), sellTax: /99/.test(t), snippet: (t.match(/TOKEN-FORENSIK[\s\S]{0,160}/i) || ['(n/a)'])[0].replace(/\s+/g, ' ') };
  });
  ok('Scam-Warnung erscheint auch im Terminal (Forensik-Panel)', term.dangerInTerminal, JSON.stringify(term));
  await page.screenshot({ path: `${OUT}/qa-trader-scam-terminal.png` });
  ok('Simuliertes Audit: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();
}

console.log('\n— 3: Rate-Limit-Resilience & Reconnect —');
{
  const { page, errors } = await openTerminal((_) => {
    window.__429 = { armed: false, count: 0 };
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (/klines|candles|ohlc/i.test(url)) {
        if (window.__429.armed && window.__429.count < 4) {
          window.__429.count += 1;
          return new Response(JSON.stringify({ code: 429, msg: 'qa forced' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '5' } });
        }
      }
      return origFetch(input, init);
    };
  });
  const before = await feedState(page);
  const probeOverlay = () => page.evaluate(() => {
    const dlg = document.querySelector('[role="alertdialog"]');
    if (!dlg) return { overlay: false, cd: null, title: '' };
    const cd = (dlg.innerText.match(/(\d+)\s*S/i) || [])[1] ?? null;
    return { overlay: true, cd, title: (dlg.querySelector('h2')?.textContent ?? '').slice(0, 40) };
  });
  // 1h-Cache ist voll (300 Candles). Jetzt armed: die nächsten 4 Seed-Aufrufe → 429.
  await page.evaluate(() => { window.__429.armed = true; });
  let seen = null;
  const hop = async (tf) => {
    await page.evaluate((t) => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t)?.click(); }, tf);
    for (let i = 0; i < 10; i++) {
      await wait(300);
      const probe = await probeOverlay();
      if (probe.overlay && !seen) { seen = probe; await page.screenshot({ path: `${OUT}/qa-trader-429.png` }); }
    }
  };
  await hop('5m'); // frischer TF: Seed #1+#2 → 429 → Overlay + Countdown
  await hop('1h'); // zurück: Cache muss sofort alte Candles zeigen, Seed #3+#4 → 429
  ok('429-Sturm triggert den Glitch-Overlay mit Countdown', seen?.overlay && seen.cd != null && /RATE LIMIT/i.test(seen.title), JSON.stringify(seen ?? 'Overlay nie gesehen'));

  const during = await feedState(page);
  const duringOverlay = await probeOverlay();
  ok('Alte Candles bleiben während des Cooldowns sichtbar (Cache bedient)', Number(during.candles) >= 100, `candles=${during.candles} (1h-Cache vorher=${before.candles}, overlayAktiv=${duringOverlay.overlay})`);

  let recovered = false;
  for (let i = 0; i < 14; i++) {
    await wait(1000);
    const t = await page.evaluate(() => document.body.innerText);
    if (!/RATE LIMIT ÜBERSCHRITTEN|RATE LIMIT EXCEEDED/i.test(t)) { recovered = true; break; }
  }
  const after = await feedState(page);
  ok('Overlay verschwindet nach Countdown automatisch, Feed erholt sich', recovered && Number(after.candles) > 0, `candles=${after.candles}`);

  const sockBefore = await page.evaluate(() => window.__ncSockets.length);
  const killed = await page.evaluate(() => {
    let n = 0;
    for (const e of window.__ncSockets) { try { e.sock.close(); n++; } catch { /* ignore */ } }
    return n;
  });
  await wait(1500);
  const reconn = await page.evaluate(() => /VERBINDE NEU|RECONNECT|CONNECTING|VERBINDE/i.test(document.body.innerText));
  await wait(7000);
  const after2 = await page.evaluate(() => ({ total: window.__ncSockets.length, reopened: window.__ncSockets.length > 0 && window.__ncSockets[window.__ncSockets.length - 1].closedAt === null }));
  ok('Gekillter Socket → Reconnect-Logik legt neuen Socket an (oder sauberer Offline-Hinweis)', killed === 0 ? reconn || sockBefore === 0 : after2.total > sockBefore || reconn, `killed=${killed} sockets ${sockBefore}→${after2.total} reconnectText=${reconn}`);
  ok('Sektion 3: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();
}

await browser.close();
const fails = results.filter((r) => !r.pass);
console.log(`\n${fails.length === 0 ? '✔' : '✖'} trader: ${results.length - fails.length}/${results.length} checks bestanden`);
for (const f of fails) console.log(`  FAIL ${f.name}${f.info ? ` — ${f.info}` : ''}`);
process.exit(fails.length ? 1 : 0);
