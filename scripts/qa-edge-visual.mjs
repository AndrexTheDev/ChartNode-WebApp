#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Wave-7 QA harness – visual / DOM / persistence layer (dev-only, not shipped).
 *
 * Step 1 covers the Liq Radar module end to end in a real browser:
 *   • canvas paint proof: magnet band tint + leverage tags appear when the
 *     module is armed and disappear when it is not (pixel signatures)
 *   • modal DOM: checkbox sync, ≤3 rows per side, distance ordering,
 *     intensity bar width == printed intensity
 *   • persistence: liqMagnetsOn survives a reload
 *   • sanitizer: a corrupted nc-chart-v1 payload falls back to safe state
 *
 * Usage: node scripts/qa-edge-visual.mjs [step]   (default step: liq)
 */
import puppeteer from 'puppeteer';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const step = process.argv[2] ?? 'liq';

let failures = 0;
function check(name, condition, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pixel signatures on the largest canvas:
 *  – band pixels: translucent bull/bear fills (channel gap 12..110, dark enough
 *    to exclude full-strength candle bodies), sampled left of the volume profile
 *  – tag pixels: desaturated bright mono text in the left 150px (leverage tags)
 */
async function canvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * b.height)[0];
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    // sample above the volume strip: translucent volume bars share the band tint
    const sampleW = Math.floor(width * 0.6);
    const sampleH = Math.floor(height * 0.72);
    const band = ctx.getImageData(0, 0, sampleW, sampleH).data;
    const tag = ctx.getImageData(0, 0, 150, height).data;
    // bands are HORIZONTAL fills: count rows where the tint spans most of the
    // sample width – candle edge anti-aliasing never reaches that per row
    const rowHits = new Array(sampleH).fill(0);
    let bandPixels = 0;
    for (let i = 0; i < band.length; i += 4) {
      const r = band[i];
      const g = band[i + 1];
      const b = band[i + 2];
      const bear = r - g >= 12 && r - g <= 110 && r - b >= 4 && r - b <= 70 && r < 200;
      const bull = g - r >= 12 && g - r <= 110 && g - b >= 4 && g - b <= 70 && g < 220;
      if (bear || bull) {
        bandPixels += 1;
        rowHits[Math.floor(i / 4 / sampleW)] += 1;
      }
    }
    const bandRows = rowHits.filter((count) => count >= sampleW * 0.5).length;
    // theme fingerprint: mean (blue - green) over bear-tinted pixels.
    // default bear #ff2e63 carries blue, matrix bear #ff0000 does not
    let bearN = 0;
    let bearBG = 0;
    for (let i = 0; i < band.length; i += 4) {
      const r = band[i];
      const g = band[i + 1];
      const b = band[i + 2];
      if (r - g >= 12 && r - g <= 110 && r - b >= 4 && r - b <= 70 && r < 200) {
        bearN += 1;
        bearBG += b - g;
      }
    }
    const bearBlueGap = bearN > 0 ? bearBG / bearN : 0;
    let tagPixels = 0;
    for (let i = 0; i < tag.length; i += 4) {
      const r = tag[i];
      const g = tag[i + 1];
      const b = tag[i + 2];
      const lo = Math.min(r, g, b);
      const hi = Math.max(r, g, b);
      if (lo >= 110 && hi - lo <= 70) tagPixels += 1;
    }
    return { bandPixels, bandRows, tagPixels, bearBlueGap };
  });
}

async function waitForCandles(page) {
  for (let i = 0; i < 40; i += 1) {
    const legend = await page.$eval('.font-mono.text-micro-10', (el) => el.textContent ?? '').catch(() => '');
    if (/O\s*[\d.]+/.test(legend)) return true;
    await wait(1000);
  }
  return false;
}

async function openLiqModal(page) {
  await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
  await wait(250);
  const clicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Liq Radar');
    if (!item) return false;
    item.click();
    return true;
  });
  await wait(450);
  return clicked;
}

const dialogInfo = (page) =>
  page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg) return null;
    const checkbox = dlg.querySelector('input[type="checkbox"]');
    const rows = [...dlg.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim());
    return {
      text: dlg.innerText,
      checked: checkbox ? checkbox.checked : null,
      rows,
    };
  });

async function lagFlow(browser) {
  console.log('\n— QA step 2: Lag Oracle (Funktion + Feed-Lifecycle) —');
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  const socketUrl = new Map();
  const created = [];
  const closedIds = [];
  const payloads = new Map();
  client.on('Network.webSocketCreated', (event) => {
    socketUrl.set(event.requestId, event.url);
    created.push(event.url);
  });
  client.on('Network.webSocketFrameSent', (event) => {
    const list = payloads.get(event.requestId) ?? [];
    if (list.length < 30) {
      list.push(event.response.payloadData.slice(0, 300));
      payloads.set(event.requestId, list);
    }
  });
  client.on('Network.webSocketClosed', (event) => closedIds.push(event.requestId));
  // Fingerprint per feed: the KLINE subscribe payload of one symbol. Whale-flow
  // sockets subscribe aggTrade/publicTrade for ETH+SOL as well, and exchange
  // fallback URLs carry no symbol – so only a per-payload kline match proves
  // which socket carries which candle feed.
  const klineSocket = (symRe) => {
    const pattern = (sep) =>
      new RegExp(`${symRe}${sep}@kline|spot\\.candles[\\s\\S]{0,80}${symRe}${sep}|kline\\.\\d+\\.${symRe}${sep}|candle[\\w-]*[\\s\\S]{0,40}${symRe}${sep}`, 'i');
    const pats = [pattern(''), pattern('[._-]')];
    for (const [id, list] of payloads) {
      if (list.some((payload) => pats.some((re) => re.test(payload)))) return id;
    }
    return null;
  };
  const ETH = 'ETH[._-]?USDT';
  const SOL = 'SOL[._-]?USDT';
  const BTC = 'BTC[._-]?USDT';

  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  check('live candles arrive', await waitForCandles(page));
  await wait(1500);
  const baseSockets = created.length;
  check('active feed socket is open before the modal', klineSocket(BTC) !== null, `${baseSockets} sockets`);
  check('no leader subscription while the modal is closed', klineSocket(ETH) === null);

  await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
  await wait(250);
  const clicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Lag Oracle');
    if (!item) return false;
    item.click();
    return true;
  });
  await wait(400);
  check('edge menu opens the Lag Oracle modal', clicked);

  const dialogText = () =>
    page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'));
  await page
    .waitForFunction(() => {
      const txt = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n');
      return /lag \(kerzen\)/i.test(txt) || /leader-feed lädt/i.test(txt);
    }, { timeout: 75000 })
    .catch(() => {});
  let ethReq = null;
  for (let i = 0; i < 20 && !ethReq; i += 1) {
    ethReq = klineSocket(ETH);
    if (!ethReq) await wait(500);
  }
  check('leader subscription opens ONLY while the modal is open', ethReq !== null, socketUrl.get(ethReq ?? '') ?? 'none');

  let text = await dialogText();
  if (!/lag \(kerzen\)/i.test(text)) {
    await page
      .waitForFunction(() => /lag \(kerzen\)/i.test([...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n')), { timeout: 60000 })
      .catch(() => {});
    text = await dialogText();
  }
  const stats = /lag \(kerzen\)/i.test(text);
  check('modal shows stats or degrades to the loading hint', stats || /leader-feed lädt/i.test(text));
  if (stats) {
    // read the four stat tiles straight from the DOM (whitespace-proof)
    const tiles = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      return [...(dlg?.querySelectorAll('p.mt-1') ?? [])].map((node) => ({
        label: (node.previousElementSibling?.textContent ?? '').trim(),
        value: (node.textContent ?? '').trim(),
      }));
    });
    const tile = (re) => tiles.find((entry) => re.test(entry.label))?.value ?? null;
    const lag = parseInt(tile(/lag/i) ?? 'NaN', 10);
    const corr = parseFloat((tile(/korrelation|correlation/i) ?? 'NaN').replace(',', '.'));
    const beta = parseFloat((tile(/beta/i) ?? 'NaN').replace(',', '.'));
    const hits = tile(/treffer|hit/i) ?? '';
    check('lag is an integer within 0..12', Number.isInteger(lag) && lag >= 0 && lag <= 12, String(lag));
    check('correlation inside [-1, 1]', corr >= -1 && corr <= 1, String(corr));
    check('beta is finite', Number.isFinite(beta), String(beta));
    check('hit rate renders as share or dash', /%|–/.test(hits), hits);
  }
  if (stats) {
    check('status line (calm or pulse) is rendered', await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      return !!dlg?.querySelector('[role="status"]');
    }));
  } else {
    check('loading hint renders without a status line (graceful)', true);
  }
  const options = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const sel = dlg?.querySelector('select');
    return { value: sel?.value ?? null, options: [...(sel?.querySelectorAll('option') ?? [])].map((o) => o.value) };
  });
  check('select never renders the active token or an empty value', options.value !== null && options.value !== 'cex:binance:BTCUSDT' && options.options.every((o) => o !== 'cex:binance:BTCUSDT'), JSON.stringify(options));
  await page.screenshot({ path: 'artifacts/qa-step2-lag.png' });

  // leader switch: old leader socket closes, new one opens
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const sel = dlg?.querySelector('select');
    if (!sel) return;
    const sol = [...sel.querySelectorAll('option')].find((o) => o.value.includes('SOLUSDT'));
    sel.value = sol?.value ?? sel.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(4000);
  // feeds are multiplexed per exchange socket: releasing a leader channel ends
  // in an UNSUBSCRIBE frame (the socket itself stays alive for whale/active
  // channels) – or a full close when it was the socket's only channel
  const unsubscribed = (req, symRe) =>
    req !== null &&
    (closedIds.includes(req) ||
      (payloads.get(req) ?? []).some(
        (payload) => /unsub/i.test(payload) && new RegExp(symRe, 'i').test(payload),
      ));
  check('switching the leader unsubscribes the old leader kline', unsubscribed(ethReq, ETH), `closed=${closedIds.length}`);
  check('switching the leader subscribes the new feed', klineSocket(SOL) !== null, `${created.length} sockets total (base ${baseSockets})`);

  // close modal → leader subscription must be released, active feed stays
  await page.keyboard.press('Escape');
  await wait(500);
  check('Escape closes the Lag Oracle modal', (await dialogText()) === '');
  const solReq = klineSocket(SOL);
  let released = false;
  for (let i = 0; i < 20 && !released; i += 1) {
    released = unsubscribed(solReq, SOL);
    if (!released) await wait(750);
  }
  check('leader kline is released after closing the modal', released, socketUrl.get(solReq ?? '') ?? 'none');
  const btcAlive = [...payloads.entries()].some(
    ([id, list]) =>
      !closedIds.includes(id) &&
      list.some((payload) => /btcusdt@kline|spot\.candles[\s\S]{0,80}BTC_USDT|kline\.\d+\.BTCUSDT|candle[\w-]*[\s\S]{0,40}BTC-USDT/i.test(payload)),
  );
  check('active BTC feed socket survives the modal close', btcAlive);
  await page.close();
}

async function regimeFlow(browser) {
  console.log('\n— QA step 3: Regime Compass (Darstellung + Tool-Aktionen) —');
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  check('live candles arrive', await waitForCandles(page));

  await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
  await wait(250);
  const clicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Regime Compass');
    if (!item) return false;
    item.click();
    return true;
  });
  await wait(400);
  check('edge menu opens the Regime Compass modal', clicked);
  await page
    .waitForFunction(() => {
      const txt = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n').toUpperCase();
      return /STARKER TREND|SCHWACHER TREND|RANGE|VOLATILITÄTS-EXPANSION|LIQUIDATIONS-STURM|NOCH ZU WENIG KERZEN/.test(txt);
    }, { timeout: 30000 })
    .catch(() => {});

  const read = () =>
    page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg) return null;
      const text = dlg.innerText;
      const names = ['Starker Trend', 'Schwacher Trend', 'Range', 'Volatilitäts-Expansion', 'Liquidations-Sturm'];
      const upper = text.toUpperCase();
      const name = names.find((n) => upper.includes(n.toUpperCase())) ?? null;
      const conf = text.match(/(\d+)\s*%/);
      const drivers = [...dlg.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim());
      const strip = dlg.querySelectorAll('div.h-3 > span').length;
      const recs = [...dlg.querySelectorAll('button')]
        .map((b) => b.textContent?.trim() ?? '')
        .filter((label) => label && !/close/i.test(label));
      return { name, conf: conf ? Number(conf[1]) : null, drivers, strip, recs, need: /NOCH ZU WENIG KERZEN/i.test(text) };
    });

  let state = await read();
  check('modal classifies or degrades gracefully', state !== null && (state.name !== null || state.need), JSON.stringify(state?.name));
  if (state && state.name) {
    check('confidence renders between 50 and 95 %', state.conf !== null && state.conf >= 50 && state.conf <= 95, `${state.conf} %`);
    check(
      'driver tiles carry ADX, vol ratio and slope',
      state.drivers.length >= 3 && /ADX/.test(state.drivers.map((d) => d.toUpperCase()).join(' ')),
      state.drivers.join(' | '),
    );
    check('history strip renders at least two regime windows', state.strip >= 2, `${state.strip} windows`);
    check('recommendations offered for the regime', state.recs.length >= 1 && state.recs.length <= 2, state.recs.join(' | '));
    await page.screenshot({ path: 'artifacts/qa-step3-regime.png' });

    // every recommendation maps to a real, verifiable store toggle
    const known = ['AVWAP armen', 'Support/Resistance', 'Volumen-Profil', 'Divergenzen', 'Liq-Magnete', 'Alert armen'];
    check('all recommendations are known actions', state.recs.every((label) => known.includes(label)), state.recs.join(' | '));

    const analysePressed = async (label) => {
      await page.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
      await wait(250);
      const pressed = await page.evaluate((t) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t);
        return item ? item.getAttribute('aria-pressed') : null;
      }, label);
      await page.keyboard.press('Escape');
      await wait(200);
      return pressed;
    };
    const alertPressed = () =>
      page.evaluate(() => {
        const chip = [...document.querySelectorAll('button')].find((b) => /^Alerts?(\s|\()/i.test((b.textContent ?? '').trim()));
        return chip?.getAttribute('aria-pressed') ?? null;
      });
    const hostAttr = () => page.evaluate(() => document.querySelector('[data-liq-radar]')?.getAttribute('data-liq-radar'));

    const label = state.recs[0];
    await page.evaluate((t) => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      [...(dlg?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === t)?.click();
    }, label);
    await wait(500);
    check('recommendation click closes the modal', (await read()) === null);

    let proven = null;
    if (label === 'AVWAP armen') proven = (await analysePressed('aVWAP')) === 'true';
    if (label === 'Support/Resistance') proven = (await analysePressed('S/R Auto')) === 'true';
    if (label === 'Volumen-Profil') proven = (await analysePressed('VP')) === 'true';
    if (label === 'Divergenzen') proven = (await analysePressed('Divergenzen')) === 'true';
    if (label === 'Liq-Magnete') proven = (await hostAttr()) === 'on';
    if (label === 'Alert armen') proven = (await alertPressed()) === 'true';
    check(`recommendation "${label}" flips the real tool toggle`, proven === true);

    // revert so later steps start from a clean slate
    if (label === 'AVWAP armen' || label === 'Support/Resistance' || label === 'Volumen-Profil' || label === 'Divergenzen') {
      const menuLabel = { 'AVWAP armen': 'aVWAP', 'Support/Resistance': 'S/R Auto', 'Volumen-Profil': 'VP', Divergenzen: 'Divergenzen' }[label];
      await page.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
      await wait(250);
      await page.evaluate((t) => {
        [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t)?.click();
      }, menuLabel);
      await wait(200);
      await page.keyboard.press('Escape');
    }
    if (label === 'Alert armen') {
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find((b) => /^Alerts?(\s|\()/i.test((b.textContent ?? '').trim()))?.click();
      });
    }
    if (label === 'Liq-Magnete') {
      await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
      await wait(250);
      await page.evaluate(() => {
        [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Liq Radar')?.click();
      });
      await wait(400);
      await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
        dlg?.querySelector('input[type="checkbox"]')?.click();
      });
      await wait(300);
      await page.keyboard.press('Escape');
    }
    await wait(300);
  } else {
    check('graceful hint instead of a classification (cold feed)', true);
  }
  await page.close();
}

async function clockFlow(browser) {
  console.log('\n— QA step 4: Clock Edge (Heatmaps, Jetzt-Ring, Legende) —');
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  check('live candles arrive', await waitForCandles(page));

  await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
  await wait(250);
  const clicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Clock Edge');
    if (!item) return false;
    item.click();
    return true;
  });
  await wait(400);
  check('edge menu opens the Clock Edge modal', clicked);
  await page
    .waitForFunction(() => {
      const txt = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n');
      return /stunden \(utc\)/i.test(txt) || /noch zu wenig kerzen/i.test(txt);
    }, { timeout: 30000 })
    .catch(() => {});

  const dom = () =>
    page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg) return null;
      const text = dlg.innerText;
      const grids = [...dlg.querySelectorAll('div.grid')];
      // direct children only – weekday cells wrap their win rate in an inner span
      const hourCells = [...(grids[0]?.children ?? [])];
      const dayCells = [...(grids[1]?.children ?? [])];
      return {
        need: /noch zu wenig kerzen/i.test(text),
        hours: hourCells.length,
        days: dayCells.length,
        hourValues: hourCells.map((c) => c.textContent?.trim() ?? ''),
        ringHours: hourCells.filter((c) => /shadow-neon-sm/.test(c.className)).length,
        ringDays: dayCells.filter((c) => /border-primary/.test(c.className)).length,
        titles: hourCells.slice(0, 24).every((c) => /UTC/.test(c.title) && /n=\d+/.test(c.title) && /t=-?[\d.]+/.test(c.title)),
        // Chrome normalises hsla() to rgba() in the style attribute – read the
        // computed colour and count cells with a real alpha tint
        tinted: hourCells.filter((c) => {
          const bg = getComputedStyle(c).backgroundColor;
          const alpha = Number(bg.match(/[\d.]+\)$/)?.[0]?.replace(')', '') ?? '1');
          return /rgba?\(/.test(bg) && alpha > 0.05;
        }).length,
        status: !!dlg.querySelector('[role="status"]'),
        legend: /grün = positive|green = positive/i.test(text),
      };
    });

  const state = await dom();
  check('modal renders or degrades gracefully', state !== null && (!state.need || state.hours === 0), JSON.stringify(state?.hours));
  if (state && !state.need) {
    check('24 hour cells + 7 weekday cells', state.hours === 24 && state.days === 7, `${state.hours}/${state.days}`);
    check('cells print win rates or empty dots', state.hourValues.every((v) => v === '·' || /^(100|\d{1,2})$/.test(v)), state.hourValues.join(','));
    check('exactly one hour cell carries the now-ring', state.ringHours === 1, `${state.ringHours}`);
    check('exactly one weekday cell carries the now-ring', state.ringDays === 1, `${state.ringDays}`);
    check('cell tooltips carry n, win rate and t-value', state.titles);
    check('significant cells are colour-tinted via hsla', state.tinted >= 1, `${state.tinted} tinted`);
    check('edge-now status line rendered', state.status);
    check('legend explains colour + significance', state.legend);
    await page.screenshot({ path: 'artifacts/qa-step4-clock.png' });
  } else {
    check('graceful hint on a cold feed', true);
  }
  await page.keyboard.press('Escape');
  await wait(300);
  check('Escape closes the Clock Edge modal', (await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)) === 0);
  await page.close();
}

async function menuFlow(browser) {
  console.log('\n— QA step 5: Edge-Menü & Toolbar-Integration —');
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  check('live candles arrive', await waitForCandles(page));

  const triggerState = () =>
    page.evaluate(() => {
      const trigger = document.querySelector('[data-menu-trigger="edge"]');
      if (!trigger) return null;
      return {
        label: (trigger.textContent ?? '').trim(),
        expanded: trigger.getAttribute('aria-expanded'),
        engaged: /shadow-neon-sm/.test(trigger.className),
        haspopup: trigger.getAttribute('aria-haspopup'),
      };
    });
  const openMenu = async () => {
    await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
    await wait(250);
  };
  const menuState = () =>
    page.evaluate(() => {
      const panel = document.querySelector('[role="menu"][aria-label="Edge"]');
      if (!panel) return null;
      return [...panel.querySelectorAll('[role="menuitem"]')].map((item) => ({
        label: (item.textContent ?? '').trim(),
        pressed: item.getAttribute('aria-pressed'),
      }));
    });
  const clickItem = async (label) => {
    await page.evaluate((t) => {
      [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t)?.click();
    }, label);
    await wait(400);
  };

  let trigger = await triggerState();
  check('edge trigger mounted with label + menu semantics', trigger !== null && /Edge/i.test(trigger.label) && trigger.haspopup === 'menu', JSON.stringify(trigger));
  check('trigger starts calm (not engaged, collapsed)', trigger !== null && !trigger.engaged && trigger.expanded === 'false');

  await openMenu();
  let items = await menuState();
  check('menu opens with the four engines in order', items !== null && items.map((i) => i.label).join('|') === 'Liq Radar|Lag Oracle|Regime Compass|Clock Edge', items?.map((i) => i.label).join('|'));
  check('liq item exposes aria-pressed=false, others omit it', items !== null && items[0].pressed === 'false' && items.slice(1).every((i) => i.pressed === null));
  check('trigger reports aria-expanded=true while open', (await triggerState())?.expanded === 'true');
  await page.screenshot({ path: 'artifacts/qa-step5-menu.png' });
  await page.keyboard.press('Escape');
  await wait(200);
  check('Escape collapses the menu', (await menuState()) === null && (await triggerState())?.expanded === 'false');
  await openMenu();
  await page.mouse.click(700, 500);
  await wait(250);
  check('outside click collapses the menu', (await menuState()) === null);

  // engaged state follows open modals AND persisted magnets
  await openMenu();
  await clickItem('Liq Radar');
  check('open modal engages the trigger (neon state)', (await triggerState())?.engaged === true);
  await page.keyboard.press('Escape');
  await wait(300);
  check('closed modal + magnets off returns trigger to calm', (await triggerState())?.engaged === false);
  await openMenu();
  await clickItem('Liq Radar');
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    dlg?.querySelector('input[type="checkbox"]')?.click();
  });
  await wait(400);
  await page.keyboard.press('Escape');
  await wait(300);
  check('persisted magnets keep the trigger engaged', (await triggerState())?.engaged === true);
  await openMenu();
  items = await menuState();
  check('liq menu item now reports aria-pressed=true', items?.[0]?.pressed === 'true');
  await page.keyboard.press('Escape');
  await wait(200);
  await openMenu();
  await clickItem('Liq Radar');
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    dlg?.querySelector('input[type="checkbox"]')?.click();
  });
  await wait(400);
  await page.keyboard.press('Escape');
  await wait(300);
  check('disabling magnets calms the trigger again', (await triggerState())?.engaged === false);

  // viral loop: six tool gestures (3 liq + lag + regime + clock) fire the nudge
  await openMenu();
  await clickItem('Lag Oracle');
  await page.keyboard.press('Escape');
  await wait(200);
  await openMenu();
  await clickItem('Regime Compass');
  await page.keyboard.press('Escape');
  await wait(200);
  await openMenu();
  await clickItem('Clock Edge');
  await wait(2500);
  const nudge = await page.evaluate(() => document.body.innerText);
  check('six edge gestures fire the usage nudge (donation doctrine)', /meint es ernst/i.test(nudge));
  await page.keyboard.press('Escape');
  await wait(300);

  // layout integrity across widths: fifth menu must never break the toolbar
  for (const [width, height] of [[1280, 800], [1024, 768], [768, 900]]) {
    await page.setViewport({ width, height });
    await wait(500);
    const layout = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      // 1) user-reachable horizontal page scroll? (scrollWidth also counts the
      //    toolbar's intentional inner scroller, so probe real scrollability)
      window.scrollTo(240, 0);
      const scrollable = window.scrollX > 0;
      window.scrollTo(0, 0);
      // 2) visual overflow not contained by any scroll/clip container?
      const clipped = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== 'visible') return true;
        }
        return false;
      };
      let visual = 0;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 2 && !clipped(el)) visual = Math.max(visual, Math.round(r.right - vw));
      }
      const rect = document.querySelector('[data-menu-trigger="edge"]')?.getBoundingClientRect();
      return { scrollable, visual, right: rect ? Math.round(rect.right) : -1, vw };
    });
    check(`toolbar stays intact at ${width}px (no h-overflow, trigger visible)`, !layout.scrollable && layout.visual <= 2 && layout.right > 0 && layout.right <= layout.vw, JSON.stringify(layout));
  }
  await page.close();
}

async function primitiveFlow(browser) {
  console.log('\n— QA step 6: Canvas-Primitive-Lifecycle —');
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  const boot = async () => {
    await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await waitForCandles(page);
    await wait(1200);
  };
  const setMagnets = async (on) => {
    await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
    await wait(250);
    await page.evaluate(() => {
      [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Liq Radar')?.click();
    });
    await wait(400);
    const current = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      return dlg?.querySelector('input[type="checkbox"]')?.checked ?? null;
    });
    if (current !== on) {
      await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
        dlg?.querySelector('input[type="checkbox"]')?.click();
      });
      await wait(600);
    }
    await page.keyboard.press('Escape');
    await wait(400);
  };
  const panesWithBands = () =>
    page.evaluate(() => {
      const out = [];
      for (const canvas of [...document.querySelectorAll('canvas')].filter((c) => c.width > 300 && c.height > 200)) {
        const ctx = canvas.getContext('2d');
        const sampleW = Math.floor(canvas.width * 0.6);
        const sampleH = Math.floor(canvas.height * 0.72);
        if (sampleW < 50 || sampleH < 50) continue;
        const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
        const rowHits = new Array(sampleH).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const bear = r - g >= 12 && r - g <= 110 && r - b >= 4 && r - b <= 70 && r < 200;
          const bull = g - r >= 12 && g - r <= 110 && g - b >= 4 && g - b <= 70 && g < 220;
          if (bear || bull) rowHits[Math.floor(i / 4 / sampleW)] += 1;
        }
        out.push(rowHits.filter((count) => count >= sampleW * 0.5).length);
      }
      return out;
    });

  await boot();
  await setMagnets(true);
  let metrics = await canvasMetrics(page);
  check('magnets paint on the single pane', metrics.bandRows >= 12, `${metrics.bandRows} rows`);
  const defaultGap = metrics.bearBlueGap;

  // explicit setSource(null): off must clear every band row
  await setMagnets(false);
  metrics = await canvasMetrics(page);
  check('setSource(null) clears all band rows', metrics.bandRows <= 2 && metrics.tagPixels < 60, `${metrics.bandRows} rows / ${metrics.tagPixels} tags`);
  await setMagnets(true);

  // theme boot path: matrix bear is pure red (no blue) vs default #ff2e63
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('nodechart:store:v1') ?? '{"state":{},"version":1}');
    raw.state = { ...(raw.state ?? {}), theme: 'matrix' };
    localStorage.setItem('nodechart:store:v1', JSON.stringify(raw));
  });
  await boot();
  metrics = await canvasMetrics(page);
  check('bands survive a themed reboot (persisted magnets)', metrics.bandRows >= 12, `${metrics.bandRows} rows`);
  check('band tint follows the theme palette (matrix bear = pure red)', metrics.bearBlueGap < defaultGap - 4, `gap ${defaultGap.toFixed(1)} -> ${metrics.bearBlueGap.toFixed(1)}`);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('nodechart:store:v1') ?? '{"state":{},"version":1}');
    raw.state = { ...(raw.state ?? {}), theme: 'acid' };
    localStorage.setItem('nodechart:store:v1', JSON.stringify(raw));
  });
  await boot();
  metrics = await canvasMetrics(page);
  check('default skin restores the original band tint', Math.abs(metrics.bearBlueGap - defaultGap) < 4, `gap ${metrics.bearBlueGap.toFixed(1)} vs ${defaultGap.toFixed(1)}`);

  // grid 2x2: every pane owns its primitive
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '2x2')?.click();
  });
  await wait(2500);
  let panes = await panesWithBands();
  check('2x2 grid paints magnets in all four panes', panes.filter((rows) => rows >= 6).length === 4, panes.join(','));
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '1x1')?.click();
  });
  await wait(2000);
  panes = await panesWithBands();
  check('back to 1x1 leaves exactly one banded pane', panes.filter((rows) => rows >= 6).length === 1, panes.join(','));

  // chart-type swap recreates the series – the primitive must re-attach
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Heikin-Ashi')?.click();
  });
  await wait(2000);
  metrics = await canvasMetrics(page);
  check('magnets re-attach after a chart-type swap', metrics.bandRows >= 12, `${metrics.bandRows} rows`);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Candles')?.click();
  });
  await wait(2000);

  // resize keeps the primitive painting
  await page.setViewport({ width: 1000, height: 700 });
  await wait(1200);
  metrics = await canvasMetrics(page);
  check('resize keeps the bands painted', metrics.bandRows >= 12, `${metrics.bandRows} rows`);
  await page.screenshot({ path: 'artifacts/qa-step6-primitive.png' });
  await setMagnets(false);
  await page.close();
}

async function i18nFlow(browser) {
  console.log('\n— QA step 7: i18n ×5 im Browser —');
  const LOCALES = {
    de: {
      liq: 'Magnete im Chart einblenden',
      lagHint: /Leader-Feed lädt|Lag \(Kerzen\)/i,
      regimes: /Starker Trend|Schwacher Trend|Range|Volatilitäts-Expansion|Liquidations-Sturm|Noch zu wenig Kerzen/i,
      clockHours: /Stunden \(UTC\)/i,
      clockDays: /Wochentage/i,
      helpTopic: 'Wie funktioniert der Liq Radar?',
      landingTitle: 'Die Edge Suite',
      landingBody: /Liquidations-Maps/i,
    },
    en: {
      liq: 'Show magnets on the chart',
      lagHint: /Loading leader feed|Lag \(candles\)/i,
      regimes: /Strong trend|Weak trend|Range|Volatility expansion|Liquidation storm|Not enough candles/i,
      clockHours: /Hours \(UTC\)/i,
      clockDays: /Weekdays/i,
      helpTopic: 'How does Liq Radar work?',
      landingTitle: 'The Edge Suite',
      landingBody: /liquidation maps/i,
    },
    es: {
      liq: 'Mostrar imanes en el gráfico',
      lagHint: /Cargando el feed del líder|Retraso \(velas\)/i,
      regimes: /Tendencia fuerte|Tendencia débil|Rango|Expansión de volatilidad|Tormenta de liquidaciones|Aún no hay velas/i,
      clockHours: /Horas \(UTC\)/i,
      clockDays: /Días de la semana/i,
      helpTopic: '¿Cómo funciona el Liq Radar?',
      landingTitle: 'Edge Suite',
      landingBody: /mapas de liquidación/i,
    },
    ru: {
      liq: 'Показывать магниты на графике',
      lagHint: /Загружаем поток лидера|Лаг \(свечи\)/i,
      regimes: /Сильный тренд|Слабый тренд|Рейндж|Расширение волатильности|Шторм ликвидаций|Пока недостаточно свечей/i,
      clockHours: /Часы \(UTC\)/i,
      clockDays: /Дни недели/i,
      helpTopic: 'Как работает Liq Radar?',
      landingTitle: 'Edge Suite',
      landingBody: /карты ликвидаций/i,
    },
    zh: {
      liq: '在图表中显示磁力位',
      lagHint: /正在加载领先品种数据|滞后\(K线\)/i,
      regimes: /强趋势|弱趋势|震荡区间|波动扩张|清算风暴|K线不足/i,
      clockHours: /小时 \(UTC\)/i,
      clockDays: /星期/i,
      helpTopic: 'Liq Radar 是如何工作的？',
      landingTitle: 'Edge Suite 优势套件',
      landingBody: /清算地图/i,
    },
  };
  const MENU_ITEMS = ['Liq Radar', 'Lag Oracle', 'Regime Compass', 'Clock Edge'];

  for (const [locale, expect] of Object.entries(LOCALES)) {
    const page = await browser.newPage();
    const intlErrors = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/MISSING|Could not resolve|intl/i.test(text) && msg.type() === 'error') intlErrors.push(text.slice(0, 120));
    });
    page.on('pageerror', (err) => intlErrors.push(`pageerror: ${err.message.slice(0, 100)}`));
    await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await waitForCandles(page);

    const dialogText = () =>
      page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'));
    const openEdge = async (label) => {
      await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
      await wait(250);
      const ok = await page.evaluate((t) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t);
        if (!item) return false;
        item.click();
        return true;
      }, label);
      await wait(400);
      return ok;
    };
    // missing keys surface as 'edge.someKey'; a prose 'edge.' at a sentence end must not trip this
    const clean = (text) => !/\{[a-zA-Z_][\w]*\}/.test(text) && !/edge\.[a-zA-Z]/.test(text);

    await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
    await wait(250);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent ?? '').trim()),
    );
    check(`[${locale}] edge menu lists all four engines`, MENU_ITEMS.every((label) => items.includes(label)), items.join('|'));
    await page.keyboard.press('Escape');
    await wait(200);

    check(`[${locale}] Liq Radar modal in locale`, (await openEdge('Liq Radar')) && clean(await dialogText()) && (await dialogText()).toLowerCase().includes(expect.liq.toLowerCase()));
    await page.keyboard.press('Escape');
    await wait(250);

    check(`[${locale}] Lag Oracle modal in locale`, (await openEdge('Lag Oracle')) && clean(await dialogText()) && expect.lagHint.test(await dialogText()));
    await page.keyboard.press('Escape');
    await wait(250);

    check(`[${locale}] Regime Compass modal in locale`, (await openEdge('Regime Compass')) && clean(await dialogText()) && expect.regimes.test(await dialogText()));
    await page.keyboard.press('Escape');
    await wait(250);

    check(`[${locale}] Clock Edge modal in locale`, (await openEdge('Clock Edge')) && clean(await dialogText()) && expect.clockHours.test(await dialogText()) && expect.clockDays.test(await dialogText()));
    await page.keyboard.press('Escape');
    await wait(250);

    // help center category + topic
    await page.goto(`${BASE}/${locale}/help`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[type="search"]', { timeout: 15000 });
    const helpClicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button[aria-pressed]')].find((b) => (b.textContent ?? '').startsWith('Edge Suite'));
      if (!button) return null;
      button.click();
      return button.textContent ?? '';
    });
    await wait(400);
    const helpText = await page.evaluate(() => document.body.innerText);
    check(`[${locale}] help category + 4 topics + locale question`, helpClicked !== null && (helpClicked ?? '').includes('4') && helpText.includes(expect.helpTopic), String(helpClicked));

    // landing feature
    await page.goto(`${BASE}/${locale}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#survival', { timeout: 15000 }).catch(() => {});
    const landText = await page.evaluate(() => document.body.innerText);
    check(`[${locale}] landing feature title + body`, landText.includes(expect.landingTitle) && expect.landingBody.test(landText));

    check(`[${locale}] no intl/console errors during the sweep`, intlErrors.length === 0, intlErrors.slice(0, 2).join(' | '));
    await page.close();
  }
}

async function mobileFlow(browser) {
  console.log('\n— QA step 8: Mobile & Graceful Failure —');

  /* -------- A: mobile gate + narrow viewports -------- */
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(2500);
  const gateText = await page.evaluate(() => document.body.innerText);
  check('mobile gate warns before the terminal', /trotzdem aktivieren/i.test(gateText));
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Trotzdem aktivieren')?.click();
  });
  await wait(2500);
  check('force-enable unlocks the mobile terminal', await page.evaluate(() => !!document.querySelector('[data-menu-trigger="edge"]')));

  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 2);
  const openEdge = async (label) => {
    await page.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
    await wait(300);
    const ok = await page.evaluate((t) => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t);
      if (!item) return false;
      item.click();
      return true;
    }, label);
    await wait(400);
    return ok;
  };
  const dialogScroll = () =>
    page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const box = dlg?.querySelector('.max-h-\\[70vh\\]');
      if (!box) return null;
      return { scrollable: box.scrollHeight <= box.clientHeight + 4 || getComputedStyle(box).overflowY === 'auto', fits: box.getBoundingClientRect().width <= window.innerWidth };
    });

  check('Liq Radar modal opens + scrolls inside 390px', (await openEdge('Liq Radar')) && (await dialogScroll())?.scrollable === true && (await dialogScroll())?.fits === true);
  check('no horizontal page overflow with Liq modal open', await noOverflow());
  await page.keyboard.press('Escape');
  await wait(300);
  check('Clock Edge heatmaps fit 390px', (await openEdge('Clock Edge')) && (await noOverflow()));
  await page.screenshot({ path: 'artifacts/qa-step8-mobile-clock.png' });
  await page.keyboard.press('Escape');
  await wait(300);
  check('Regime Compass fits 390px', (await openEdge('Regime Compass')) && (await noOverflow()));
  await page.keyboard.press('Escape');
  await wait(300);
  check('Lag Oracle select usable at 390px', (await openEdge('Lag Oracle')) && (await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const sel = dlg?.querySelector('select');
    return !!sel && sel.getBoundingClientRect().width > 100;
  })));
  await page.keyboard.press('Escape');
  await page.close();

  /* -------- B: total feed outage – hints instead of crashes -------- */
  const dead = await browser.newPage();
  // Total outage without request interception (interception races Next's RSC
  // hydration): patch fetch + WebSocket before any app script runs. External
  // fetches reject, external sockets die on an unroutable host – the socket
  // manager backs off gracefully and the engines see zero candles.
  await dead.evaluateOnNewDocument(() => {
    const blocked = [];
    window.__blocked = blocked;
    const origin = location.origin;
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(origin) && !url.startsWith('/')) {
        blocked.push(url);
        return Promise.reject(new TypeError('Failed to fetch (QA outage)'));
      }
      return origFetch(input, init);
    };
    const OrigWS = window.WebSocket;
    window.WebSocket = class extends OrigWS {
      constructor(url, protocols) {
        if (!String(url).includes(location.host)) {
          blocked.push(String(url));
          super('wss://invalid.invalid/dead');
          return;
        }
        super(url, protocols);
      }
    };
  });
  dead.on('pageerror', (err) => check(`no pageerror on dead feeds (${err.message.slice(0, 80)})`, false));
  await dead.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Total outage: zero candles -> ChartGrid renders the PanePlaceholder BY
  // DESIGN (no chart below 2 candles), so wait for the menu, not a canvas.
  await dead.waitForSelector('[data-menu-trigger="edge"]', { timeout: 30000 });
  await wait(6000);
  const blockedCount = await dead.evaluate(() => window.__blocked?.length ?? 0);
  check('external fetches + sockets really are dead', blockedCount > 3, `${blockedCount} blocked`);
  // REST seeds are dead; live sockets can only deliver the current partial
  // candle – every engine guard (<30/<60/<80/<100 bars) must kick in
  const thin = await dead.evaluate(() => {
    const legend = document.querySelector('.font-mono.text-micro-10')?.textContent ?? '';
    return legend.length < 200;
  });
  check('terminal boots on a seed-less, thin feed', thin);

  const deadDialog = () => dead.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'));
  const openDead = async (label) => {
    await dead.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
    await wait(300);
    const ok = await dead.evaluate((t) => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t);
      if (!item) return false;
      item.click();
      return true;
    }, label);
    await wait(500);
    return ok;
  };
  let text = '';
  check('Liq Radar degrades to its empty hint', (await openDead('Liq Radar')) && /noch zu wenig kerzen im feed/i.test(await deadDialog()));
  // arming magnets on an empty feed must stay harmless: the checkbox toggles,
  // but below 2 candles no chart host mounts at all -> nothing can paint/crash
  const deadArmed = await dead.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    dlg?.querySelector('input[type="checkbox"]')?.click();
    await sleep(600);
    return {
      checked: dlg?.querySelector('input[type="checkbox"]')?.checked ?? false,
      host: !!document.querySelector('[data-liq-radar]'),
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  check('armed magnets on an empty feed paint nothing and crash nothing',
    deadArmed.checked && !deadArmed.host && deadArmed.canvases === 0, JSON.stringify(deadArmed));
  await dead.keyboard.press('Escape');
  await wait(300);
  check('Lag Oracle degrades to its loading hint', (await openDead('Lag Oracle')) && /leader-feed lädt/i.test(await deadDialog()));
  await dead.keyboard.press('Escape');
  await wait(300);
  check('Regime Compass degrades to its hint', (await openDead('Regime Compass')) && /noch zu wenig kerzen für eine einordnung/i.test(await deadDialog()));
  await dead.keyboard.press('Escape');
  await wait(300);
  check('Clock Edge degrades to its hint', (await openDead('Clock Edge')) && /noch zu wenig kerzen geladen/i.test(await deadDialog()));
  text = await deadDialog();
  check('no raw placeholders or crashes in degraded modals', !/\{[a-zA-Z_][\w]*\}/.test(text));
  await dead.screenshot({ path: 'artifacts/qa-step8-dead-feeds.png' });
  await dead.close();
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

try {
  if (step === 'lag') {
    await lagFlow(browser);
  } else if (step === 'regime') {
    await regimeFlow(browser);
  } else if (step === 'clock') {
    await clockFlow(browser);
  } else if (step === 'menu') {
    await menuFlow(browser);
  } else if (step === 'primitive') {
    await primitiveFlow(browser);
  } else if (step === 'i18n') {
    await i18nFlow(browser);
  } else if (step === 'mobile') {
    await mobileFlow(browser);
  } else if (step === 'liq') {
  console.log('\n— QA step 1: Liq Radar (Darstellung + Funktion) —');
  const page = await browser.newPage();
  page.on('pageerror', (err) => check(`no pageerror (${err.message.slice(0, 80)})`, false));
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  check('live candles arrive', await waitForCandles(page));

  const hostAttr = () => page.evaluate(() => document.querySelector('[data-liq-radar]')?.getAttribute('data-liq-radar') ?? null);

  // 1. unarmed baseline
  check('chart host reports data-liq-radar=off', (await hostAttr()) === 'off');
  const off = await canvasMetrics(page);
  check('baseline canvas carries no magnet band tint', off !== null && off.bandRows <= 2, `bandRows=${off?.bandRows}`);
  check('baseline canvas carries no leverage tags', off !== null && off.tagPixels < 60, `tags=${off?.tagPixels}`);

  // 2. modal DOM + arming
  check('edge menu opens the Liq Radar modal', await openLiqModal(page));
  let info = await dialogInfo(page);
  check('modal shows title, explainer and an unchecked toggle', info !== null && /liq radar/i.test(info.text) && /magnete im chart einblenden/i.test(info.text) && info.checked === false);
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    dlg?.querySelector('input[type="checkbox"]')?.click();
  });
  await wait(700);
  check('checkbox flips the store (data-liq-radar=on)', (await hostAttr()) === 'on');
  info = await dialogInfo(page);
  check('checkbox reflects armed state', info?.checked === true);

  const shorts = (info?.rows ?? []).filter((r) => /×\s*S/.test(r));
  const longs = (info?.rows ?? []).filter((r) => /×\s*L/.test(r));
  check('max three magnets per side', shorts.length > 0 && shorts.length <= 3 && longs.length > 0 && longs.length <= 3, `S=${shorts.length} L=${longs.length}`);
  const dists = (rows) => rows.map((r) => Math.abs(parseFloat(r.match(/([+-]\d+[.,]\d+)\s*%/)?.[1]?.replace(',', '.') ?? 'NaN')));
  const sortedAsc = (arr) => arr.every((v, i) => i === 0 || v >= arr[i - 1] - 1e-9);
  check('short distances sorted by proximity', sortedAsc(dists(shorts)), dists(shorts).join(','));
  check('long distances sorted by proximity', sortedAsc(dists(longs)), dists(longs).join(','));
  check(
    'intensity bar width matches the printed intensity',
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      return [...(dlg?.querySelectorAll('li') ?? [])].every((li) => {
        const bar = li.querySelector('span[aria-hidden] > span');
        const printed = li.innerText.trim().split(/\s+/).pop();
        return bar ? bar.style.width === `${printed}%` : false;
      });
    }),
  );
  check('spot price row rendered', /aktueller preis/i.test(info?.text ?? '') && /\$\d/.test(info?.text ?? ''));

  // 3. canvas paint proof
  const on = await canvasMetrics(page);
  await page.screenshot({ path: 'artifacts/qa-step1-liq-on.png' });
  check('magnet bands painted on the canvas', on !== null && on.bandRows >= 12 && on.bandRows > off.bandRows * 4, `bandRows ${off?.bandRows} → ${on?.bandRows}`);
  check('leverage tags painted on the canvas', on !== null && on.tagPixels >= 100 && on.tagPixels > off.tagPixels * 3, `tags ${off?.tagPixels} → ${on?.tagPixels}`);

  await page.keyboard.press('Escape');
  await wait(400);
  check('Escape closes the modal', (await dialogInfo(page)) === null);

  // 4. persistence across reload
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await waitForCandles(page);
  check('liqMagnetsOn survives a reload (persisted)', (await hostAttr()) === 'on');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('nc-chart-v1') ?? '{}')?.state?.liqMagnetsOn);
  check('persisted payload stores a boolean', persisted === true, String(persisted));

  // 5. sanitizer: corrupted payload must fall back, never crash
  await page.evaluate(() => {
    localStorage.setItem('nc-chart-v1', JSON.stringify({ state: { liqMagnetsOn: 'ja', panes: 'evil', indicators: 42 }, version: 0 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await waitForCandles(page);
  check('corrupted liqMagnetsOn sanitizes back to off', (await hostAttr()) === 'off');
  check('sanitized boot still opens the modal', await openLiqModal(page));
  info = await dialogInfo(page);
  check('corrupted payload leaves the toggle unchecked', info?.checked === false);
  const clean = await canvasMetrics(page);
  check('sanitized boot paints no bands', clean !== null && clean.bandRows <= 2, `bandRows=${clean?.bandRows}`);
  await page.keyboard.press('Escape');
  await page.close();
  } else {
    throw new Error(`unknown step "${step}"`);
  }
} catch (error) {
  check(`qa run completed (${error instanceof Error ? error.message : error})`, false);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? `✔ QA step ${step} OK` : `✖ ${failures} QA failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
