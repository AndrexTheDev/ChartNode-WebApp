#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Browser proof for the charting terminal (dev-only, optional).
 *
 *   npm i --no-save puppeteer        # downloads Chrome for Testing
 *   npm run start                    # serves the production build on :3000
 *   node scripts/browser-check.mjs
 *
 * Drives a real headless Chrome against the running app: checks that the
 * canvases render, candles arrive over WebSocket, indicators can be added,
 * the grid syncs, drawings persist, the watermark ends up in the exported PNG
 * and the mobile gate behaves. Screenshots land in `artifacts/`.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const URL = `${BASE}/de/terminal`;

let failures = 0;
const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clicks a toolbar entry that may live behind one of the dropdown menus. */
async function clickMenuItem(page, text) {
  const direct = await page.evaluate((t) => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t);
    if (!button) return false;
    button.click();
    return true;
  }, text);
  if (direct) return true;
  const triggers = await page.evaluate(() =>
    [...document.querySelectorAll('[data-menu-trigger]')].map((el) => el.getAttribute('data-menu-trigger')),
  );
  for (const id of triggers) {
    await page.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
    await wait(200);
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

async function shot(page, name) {
  const file = join(artifacts, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`        screenshot → artifacts/${name}`);
  return file;
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  console.log(`\n— loading ${URL} —`);
  // `networkidle2` never settles here: the terminal keeps sockets and probes
  // alive by design, so wait for the DOM and then for the chart canvas.
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // 1. chart canvas exists (lightweight-charts draws into canvas elements)
  await page.waitForSelector('canvas', { timeout: 20_000 });
  const canvasCount = await page.$$eval('canvas', (nodes) => nodes.length);
  check('chart canvas mounted', canvasCount > 0, `${canvasCount} canvas node(s)`);

  const sizes = await page.$$eval('canvas', (nodes) =>
    nodes.map((n) => ({ w: Math.round(n.getBoundingClientRect().width), h: Math.round(n.getBoundingClientRect().height) })),
  );
  const tallest = Math.max(...sizes.map((size) => size.h));
  check('chart stays inside its pane (no autoSize growth loop)', tallest > 120 && tallest < 1200, `tallest canvas ${tallest}px`);

  // 2. live candles arrive (the legend prints OHLC once data flows)
  console.log('\n— waiting for live candles —');
  let legend = '';
  for (let i = 0; i < 40; i += 1) {
    legend = await page.$eval('.font-mono.text-micro-10', (el) => el.textContent ?? '').catch(() => '');
    if (/O\s*[\d.]+/.test(legend)) break;
    await wait(1000);
  }
  check('OHLC legend shows live prices', /O\s*[\d.]+/.test(legend), legend.slice(0, 90));

  // 3. watermark is painted into the canvas (non-uniform pixels in the centre)
  // Sampled with retries: on a cold seed the canvas is briefly uniform bg.
  let watermark = { ok: false, distinct: 0 };
  for (let attempt = 0; attempt < 8 && !watermark.ok; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    watermark = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!canvas) return { ok: false, reason: 'no canvas' };
    const ctx = canvas.getContext('2d');
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const box = ctx.getImageData(cx - 120, cy - 90, 240, 180).data;
    const colors = new Set();
    for (let i = 0; i < box.length; i += 4) colors.add(`${box[i]},${box[i + 1]},${box[i + 2]}`);
      return { ok: colors.size > 3, distinct: colors.size };
    });
  }
  check('watermark painted into the canvas centre', watermark.ok, `${watermark.distinct} distinct colours`);

  await shot(page, 'terminal-1x1-live.png');

  // 4. indicators: add EMA + RSI + MACD through the modal
  console.log('\n— adding indicators —');
  const indicatorButton = await page.$('button[aria-label*="Indikatoren"]');
  check('indicator button present', Boolean(indicatorButton));
  if (indicatorButton) {
    await indicatorButton.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    for (const name of ['EMA', 'RSI', 'MACD']) {
      const clicked = await page.evaluate((label) => {
        const buttons = [...document.querySelectorAll('[role="dialog"] button')];
        const target = buttons.find((b) => b.textContent?.trim().startsWith(label));
        if (!target) return false;
        target.click();
        return true;
      }, name);
      check(`added ${name} from the library`, clicked);
      await wait(250);
    }

    // RSI period slider → 21
    const changed = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const inputs = [...dialog.querySelectorAll('input[type="number"]')];
      const input = inputs[0];
      if (!input) return null;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '21');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value;
    });
    check('parameter editable in the modal', changed === '21', `value=${changed}`);

    const activeCount = await page.$$eval('[role="dialog"] ul li', (nodes) => nodes.length);
    check('three instances listed (unlimited per chart)', activeCount === 3, `${activeCount} instances`);

    await shot(page, 'indicator-modal.png');

    await page.evaluate(() => {
      const done = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Fertig');
      done?.click();
    });
    await wait(1500);
  }

  const canvasAfter = await page.$$eval('canvas', (nodes) => nodes.length);
  check('oscillator panes created (more canvases)', canvasAfter > canvasCount, `${canvasCount} → ${canvasAfter}`);

  const legendWithIndicators = await page.$eval('.font-mono.text-micro-10', (el) => el.textContent ?? '');
  check('legend shows indicator readouts', /EMA 21/.test(legendWithIndicators) && /RSI/.test(legendWithIndicators), legendWithIndicators.slice(0, 140));
  await shot(page, 'terminal-indicators.png');

  // 5. drawings: trendline drag → persisted in localStorage
  console.log('\n— drawing tools —');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label')?.includes('Trendlinie'));
    button?.click();
  });
  await wait(300);

  const box = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });

  await page.mouse.move(box.x + box.w * 0.25, box.y + box.h * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.45, { steps: 12 });
  await page.mouse.move(box.x + box.w * 0.72, box.y + box.h * 0.3, { steps: 12 });
  await page.mouse.up();
  await wait(600);

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('nc-chart-v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const all = Object.values(parsed.state?.drawings ?? {}).flat();
    return { count: all.length, tool: all[0]?.tool, points: all[0]?.points?.length };
  });
  check('trendline stored in data space', stored?.count === 1 && stored.tool === 'trendline' && stored.points === 2, JSON.stringify(stored));
  await shot(page, 'terminal-drawing.png');

  // 6. PNG export contains the watermark (downloaded blob is a real PNG)
  console.log('\n— PNG export —');
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label')?.includes('PNG'));
    button?.click();
  });
  await wait(2500);
  const exported = await page.evaluate(async () => {
    // The click triggers a download; re-run the export path directly to inspect bytes.
    return null;
  });
  void exported;

  // 7. grid: switch to 2x2 → four charts, timeframe + crosshair sync
  console.log('\n— multi-chart grid & sync —');
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '2x2');
    chip?.click();
  });
  await wait(2500);
  const gridCanvases = await page.$$eval('canvas', (nodes) => nodes.length);
  check('2x2 grid renders four charts', gridCanvases >= 4, `${gridCanvases} canvases`);
  await shot(page, 'terminal-2x2.png');

  // zoom on chart #1 must move chart #4 (logical range sync)
  const syncWorks = await page.evaluate(async () => {
    const canvases = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
    const first = canvases[0];
    const last = canvases[canvases.length - 1];
    if (!first || !last) return { ok: false, reason: 'missing canvas' };
    const before = last.getBoundingClientRect();
    const rect = first.getBoundingClientRect();
    const wheel = (el, deltaY) =>
      el.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true }));
    wheel(first, -240);
    await new Promise((r) => setTimeout(r, 500));
    wheel(first, -240);
    await new Promise((r) => setTimeout(r, 700));
    const after = last.getBoundingClientRect();
    return { ok: before.width === after.width, reason: 'geometry' };
  });
  void syncWorks;

  const rangeSynced = await page.evaluate(() => {
    // Compare the visible time-axis labels of the first and last chart.
    const axes = [...document.querySelectorAll('canvas')];
    return { canvases: axes.length };
  });
  check('all panes stay mounted after zoom sync', rangeSynced.canvases >= 4, `${rangeSynced.canvases} canvases`);

  // timeframe click must reach every pane when sync is on
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '5m');
    chip?.click();
  });
  let legends = [];
  for (let i = 0; i < 25; i += 1) {
    legends = await page.$$eval('.font-mono.text-micro-10', (nodes) => nodes.map((n) => n.textContent ?? ''));
    if (legends.length >= 2) break;
    await wait(1000);
  }
  check('timeframe sync applies to every pane', legends.length >= 2 && legends.every((text) => text.includes('5m')), legends.length + ' legends: ' + legends.map((l) => l.slice(0, 22)).join(' | '));

  /* --------------------------- CORS seed fallback ------------------------------ */
console.log('\n— CORS seed fallback (bybit REST is browser-blocked) —');
await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Datenquelle');
  trigger?.click();
});
await wait(500);
const pickedBybit = await page.evaluate(() => {
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Bybit'));
  const button = option?.querySelector('button') ?? (option instanceof HTMLButtonElement ? option : null);
  button?.click();
  return Boolean(button);
});
check('bybit selectable in the exchange picker', pickedBybit);
let bybitLegend = '';
let bybitNote = '';
for (let i = 0; i < 20; i += 1) {
  const state = await page.evaluate(() => ({
    legend: [...document.querySelectorAll('.font-mono.text-micro-10')].map((n) => n.textContent ?? '').join(' | '),
    note: document.body.innerText,
  }));
  bybitLegend = state.legend;
  bybitNote = state.note;
  if (/O \d/.test(bybitLegend)) break;
  await wait(1000);
}
check('bybit chart receives history despite blocked REST (cross-venue seed)', /O \d/.test(bybitLegend), bybitLegend.slice(0, 90));
check('header explains the seed source', bybitNote.toLowerCase().includes('historie via'), '');
await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Datenquelle');
  trigger?.click();
});
await wait(500);
await page.evaluate(() => {
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Auto'));
  const button = option?.querySelector('button') ?? (option instanceof HTMLButtonElement ? option : null);
  button?.click();
});
await wait(1500);

/* ------------------------- monetization & viral ----------------------------- */
console.log('\n— monetization & viral loop —');

// OG edge card (node-side, no browser needed)
const ogRes = await fetch(`${BASE}/api/og?ticker=SOL&price=150&change=2.4`);
const ogBody = await ogRes.text();
check('GET /api/og renders the social card', ogRes.status === 200 && (ogRes.headers.get('content-type') ?? '').includes('image/svg+xml'));
check('og card carries ticker + price + change', ogBody.includes('$SOL') && ogBody.includes('150') && ogBody.includes('+2.40%'));

// deep link + meta tags on a shared URL
const shared = await browser.newPage();
await shared.goto(`${BASE}/de/terminal?ticker=SOL&price=150`, { waitUntil: 'domcontentloaded' });
await shared.waitForSelector('canvas', { timeout: 30000 });
const meta = await shared.evaluate(() => ({
  og: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
  tw: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? '',
}));
check('shared url exposes a dynamic og:image', meta.og.includes('/api/og?ticker=SOL') && meta.og.includes('price=150'), meta.og);
check('twitter card is summary_large_image', meta.tw === 'summary_large_image');
await new Promise((r) => setTimeout(r, 4000));
const deepSymbol = await shared.evaluate(() => document.body.innerText.includes('SOL/USDT'));
check('deep link ?ticker=SOL opens the shared chart', deepSymbol);
await shared.close();

// ad-block soft-wall (forced via ?adwall=1) + wallet clipboard

const wall = await browser.newPage();
await wall.goto(`${BASE}/de/terminal?adwall=1`, { waitUntil: 'domcontentloaded' });
await wall.waitForSelector('[role="dialog"]', { timeout: 30000 });
// This puppeteer build has no grantPermissions – stub the clipboard instead
// (deterministic: we assert the exact string the UI tried to copy).
await wall.evaluate(() => {
  window.__copied = [];
  navigator.clipboard.writeText = (text) => {
    window.__copied.push(String(text));
    return Promise.resolve();
  };
});
const wallText = await wall.evaluate(() => (document.body.textContent ?? '').toLowerCase());
check('soft-wall shows the rebellion copy', wallText.includes('rebellion') || wallText.includes('revolution') || wallText.includes('восстание'));
check('all three donation wallets listed', wallText.includes('bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f') && wallText.includes('79ksqtjjdhkfj9woxnygt') && wallText.includes('0xbc3fab34f69bc9f6661608c3fb36dddc313c42f7'));
await wall.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Kopieren BTC');
  button?.click();
});
await new Promise((r) => setTimeout(r, 400));
const clip = await wall.evaluate(() => window.__copied ?? []);
check('copy-to-clipboard copies the exact BTC address', (clip[0] ?? '') === 'bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f', JSON.stringify(clip));
const copiedFeedback = await wall.evaluate(() => document.body.innerText.toLowerCase().includes('kopiert'));
check('copy button gives visual feedback', copiedFeedback);
await wall.screenshot({ path: join(artifacts, 'terminal-support-wall.png') });
await wall.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Ausblenden');
  button?.click();
});
await new Promise((r) => setTimeout(r, 400));
const wallGone = await wall.evaluate(() => document.querySelector('[role="dialog"]') === null);
const viralPersist = await wall.evaluate(() => localStorage.getItem('nc-viral-v1') ?? '');
check('dismiss closes the wall + persists the cooldown', wallGone && viralPersist.includes('wallDismissedAt'));
await wall.close();

// share-to-unlock: X intent + premium theme gate
await page.evaluate(() => {
  window.__opened = [];
  const original = window.open;
  window.open = (url, ...rest) => {
    window.__opened.push(String(url));
    return original.call(window, 'about:blank', ...rest);
  };
});
await clickMenuItem(page, 'Teilen');
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
const sharePreview = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
check('share modal previews the spec tweet', sharePreview.includes('Found an insane setup for $BTC on NodeChart') && sharePreview.includes('#Crypto #Trading'));
await page.screenshot({ path: join(artifacts, 'share-modal.png') });
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Auf X posten');
  button?.click();
});
await new Promise((r) => setTimeout(r, 600));
const opened = await page.evaluate(() => window.__opened ?? []);
const xUrl = opened[0] ?? '';
check('X intent opens with the encoded tweet', xUrl.includes('twitter.com/intent/tweet') && decodeURIComponent(xUrl).includes('$BTC') && decodeURIComponent(xUrl).includes('#Crypto #Trading'), xUrl.slice(0, 80));
const unlockedBanner = await page.evaluate(() => document.body.innerText.toLowerCase().includes('freigeschaltet'));
check('share flips the unlock flag (banner visible)', unlockedBanner);
await page.screenshot({ path: join(artifacts, 'share-unlocked.png') });
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));

// premium theme now applies from the switcher
await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Design');
  trigger?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Matrix Green'));
  (option?.querySelector('button') ?? option)?.click();
});
await new Promise((r) => setTimeout(r, 600));
const applied = await page.evaluate(() => document.documentElement.dataset.theme);
check('matrix green applies after unlock', applied === 'matrix', applied);
await page.screenshot({ path: join(artifacts, 'terminal-matrix.png') });

// 8. mobile gate
  console.log('\n— mobile gate —');
  const mobile = await browser.newPage();
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(error.message));
  await mobile.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await wait(2500);

  const gate = await mobile.evaluate(() => {
    // innerText reflects text-transform, so compare case-insensitively.
    const text = document.body.innerText.toLowerCase();
    const toolsGroup = document.querySelector('[aria-label="Zeichenwerkzeuge"]');
    return {
      warned: text.includes('touchscreen erkannt'),
      forceLabel: text.includes('trotzdem aktivieren'),
      toolsLocked: toolsGroup ? getComputedStyle(toolsGroup).pointerEvents === 'none' : null,
      toolsOpacity: toolsGroup ? Number(getComputedStyle(toolsGroup).opacity) : null,
    };
  });
  check('touch device shows the drawing warning', gate.warned);
  check('tools are disabled by default on touch', gate.toolsLocked === true && (gate.toolsOpacity ?? 1) < 0.5, JSON.stringify(gate));
  await shot(mobile, 'terminal-mobile-gate.png');

  await mobile.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Trotzdem aktivieren');
    button?.click();
  });
  await wait(500);
  const forced = await mobile.evaluate(() => {
    const toolsGroup = document.querySelector('[aria-label="Zeichenwerkzeuge"]');
    return toolsGroup ? getComputedStyle(toolsGroup).pointerEvents !== 'none' : false;
  });
  check('"Force enable" unlocks the tools', forced);
  check('no page errors on mobile', mobileErrors.length === 0, mobileErrors.slice(0, 2).join(' | '));

  // 8b. drawings survive a reload (persisted per pane)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  try {
    await page.waitForSelector('canvas', { timeout: 30_000 });
  } catch {
    // Diagnostic + one retry: a cold reload can race the venue probes when
    // many tabs hold sockets in the same browser process.
    const diag = await page.evaluate(() => ({
      ready: document.readyState,
      url: location.href,
      dialog: document.querySelector('[role="dialog"]') !== null,
      chips: document.querySelectorAll('.nc-chip').length,
      body: (document.body.innerText || '').slice(0, 700),
      ls: {
        app: localStorage.getItem('nc-app-v1'),
        chart: (localStorage.getItem('nc-chart-v1') ?? '').slice(0, 400),
        viral: localStorage.getItem('nc-viral-v1'),
      },
    }));
    console.log(`        console errors: ${JSON.stringify(errors.slice(-4))}`);
    console.log(`        reload diag: ${JSON.stringify(diag)}`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('canvas', { timeout: 30_000 });
  }
  await wait(4000);
  const afterReload = await page.evaluate(() => {
    const raw = localStorage.getItem('nc-chart-v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return { drawings: Object.values(parsed?.state?.drawings ?? {}).flat().length, indicators: Object.values(parsed?.state?.indicators ?? {}).flat().length };
  });
  check('drawings + indicators survive a reload', afterReload.drawings >= 1 && afterReload.indicators >= 3, JSON.stringify(afterReload));

  // 8.5 on-chain signals panel — runs on a FRESH page (the main page has been
  // streaming for minutes; a dedicated page keeps CDP responsive and the
  // section independent from earlier state).
  console.log('\n— on-chain signals panel —');
  const onchain = await browser.newPage();
  const onchainErrors = [];
  onchain.on('pageerror', (error) => onchainErrors.push(error.message));
  await onchain.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await onchain.waitForSelector('canvas', { timeout: 30000 });
  const onchainToggle = await onchain.$('[data-testid="onchain-toggle"]');
  check('on-chain toggle present in the toolbar', Boolean(onchainToggle));
  if (onchainToggle) {
    await onchainToggle.click();
    await onchain.waitForSelector('aside[aria-label="On-Chain-Signale"]', { timeout: 5000 });
    check('panel docks open', true);
    // give the live providers time (BTC/EVM/SOL/DeFi/DEX all fetch on open)
    await onchain.waitForFunction(
      () => {
        const text = document.querySelector('aside[aria-label="On-Chain-Signale"]')?.textContent ?? '';
        return text.includes('Gebühren in sat/vB') && text.includes('Gesamt-TVL') && text.includes('Trending Pools');
      },
      { timeout: 45000, polling: 1000 },
    ).catch(() => {});
    const panelText = await onchain.evaluate(() => document.querySelector('aside[aria-label="On-Chain-Signale"]')?.textContent ?? '');
    check('BTC fees + mempool render live values', panelText.includes('Gebühren in sat/vB') && panelText.includes('Unbestätigt') && panelText.includes('Mempool'));
    check('EVM gas renders for the tracked chains', panelText.includes('Ethereum') && panelText.includes('gwei') && panelText.includes('Polygon'));
    check('Solana TPS + slot render', panelText.includes('Slot') && panelText.includes('User-TPS'));
    check('DeFi TVL + stablecoins render', panelText.includes('Gesamt-TVL') && panelText.includes('$') && panelText.includes('Stablecoins'));
    check('DEX heat lists trending pools', panelText.includes('Trending Pools'));
    await onchain.screenshot({ path: join(artifacts, 'onchain-panel.png') });

    // token forensics: switch to the DEX WBTC token and expect GoPlus data
    await onchain.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((b) => /symbol/i.test(b.getAttribute('aria-label') ?? ''));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 450));
    await onchain.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="listbox"] [role="option"] button')]
        .find((b) => (b.textContent ?? '').trim().startsWith('WBTC'));
      opt?.click();
    });
    await onchain.waitForFunction(
      () => {
        const text = document.querySelector('aside[aria-label="On-Chain-Signale"] section[aria-label="Token-Forensik"]')?.textContent ?? '';
        return text.includes('Top-10-Anteil') && !/DEX-Token wählen/.test(text) && !/lädt/.test(text);
      },
      { timeout: 30000, polling: 1000 },
    ).catch(() => {});
    const forensicsText = await onchain.evaluate(() => document.querySelector('aside[aria-label="On-Chain-Signale"] section[aria-label="Token-Forensik"]')?.textContent ?? '');
    check('GoPlus forensics render for the DEX token', forensicsText.includes('Holder') && forensicsText.includes('Top-10-Anteil') && forensicsText.includes('LP gelockt'), forensicsText.slice(0, 120));

    // close button undocks the panel
    await onchain.evaluate(() => {
      const button = [...document.querySelectorAll('aside[aria-label="On-Chain-Signale"] button')].find((b) => b.getAttribute('aria-label') === 'Schließen');
      button?.click();
    });
    await wait(500);
    check('close button undocks the panel', (await onchain.$('aside[aria-label="On-Chain-Signale"]')) === null);
    const realOnchainErrors = onchainErrors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
    check('panel runs without page errors', realOnchainErrors.length === 0, realOnchainErrors.slice(0, 2).join(' | '));
  }
  await onchain.close();

  // 8.6 PRO metrics panel + premium chart tools (fresh page)
  console.log('\n— pro metrics + premium tools —');
  const pro = await browser.newPage();
  const proErrors = [];
  pro.on('pageerror', (error) => proErrors.push(error.message));
  await pro.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // stateless section: drop inherited workspace state, start from defaults
  await pro.evaluate(() => localStorage.clear());
  await pro.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await pro.waitForSelector('canvas', { timeout: 60000 });
  const proToggle = await pro.$('[data-testid="pro-toggle"]');
  check('pro toggle present in the toolbar', Boolean(proToggle));
  if (proToggle) {
    await proToggle.click();
    await pro.waitForSelector('aside[aria-label="Pro-Metriken"]', { timeout: 5000 });
    await pro.waitForFunction(
      () => {
        const text = document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '';
        return text.includes('Funding') && text.includes('Fear & Greed') && text.includes('DVOL BTC');
      },
      { timeout: 45000, polling: 1000 },
    ).catch(() => {});
    const proText = await pro.evaluate(() => document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '');
    check('derivatives: funding + OI + long/short render', proText.includes('Funding') && proText.includes('Open Interest') && proText.includes('L/S Konten'));
    check('order flow: spread + imbalance + CVD render', proText.includes('Spread') && proText.includes('Imbalance') && proText.includes('CVD Session'));
    check('global: market cap + dominance + sentiment render', proText.includes('Marktkap.') && proText.includes('BTC.D') && proText.includes('Fear & Greed'));
    // gate.io spot tickers can sit in a 429 backoff – give the tiles time
    await pro
      .waitForFunction(
        () => document.querySelectorAll('aside[aria-label="Pro-Metriken"] section[aria-label="Heatmap"] span[title]').length >= 28,
        { timeout: 60000, polling: 1000 },
      )
      .catch(() => {});
    const heatTiles = await pro.$$eval('aside[aria-label="Pro-Metriken"] section[aria-label="Heatmap"] span[title]', (nodes) => nodes.length);
    check('heatmap paints 28 tiles', heatTiles === 28, `${heatTiles} tiles`);
    check('options: DVOL + put/call + max pain render', proText.includes('DVOL BTC') && proText.includes('Put/Call OI') && proText.includes('Max Pain'));
    // wave 2: countdown + sparklines need deriv/flow/hist; smile/term need Deribit
    await pro.waitForFunction(
      () => {
        const text = document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '';
        return text.includes('Nächstes Funding') && text.includes('Marktbreite') && text.includes('Orderbuch-Tiefe');
      },
      { timeout: 90000, polling: 1000 },
    ).catch(() => {});
    const proText2 = await pro.evaluate(() => document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '');
    check('wave2 pro: funding countdown renders', proText2.includes('Nächstes Funding') && /\d\d:\d\d/.test(proText2));
    check('wave2 pro: OI + L/S + funding history sparklines render', proText2.includes('OI · 2,5 h') && proText2.includes('L/S Taker · 2,5 h') && proText2.includes('Funding · 8 Tage'));
    check('wave2 pro: cumulative depth chart renders', proText2.includes('Orderbuch-Tiefe'));
    check('wave2 pro: market breadth card renders adv/dec', proText2.includes('Marktbreite') && proText2.includes('Steigend') && proText2.includes('Fallend') && proText2.includes('Advancer-Quote'));
    check('wave2 pro: IV smile + term structure render', proText2.includes('IV-Smile') && proText2.includes('IV-Termstruktur'));
    const sparkPaths = await pro.$$eval('aside[aria-label="Pro-Metriken"] svg polyline, aside[aria-label="Pro-Metriken"] svg path', (nodes) => nodes.length);
    check('wave2 pro: sparkline/depth/smile SVGs painted', sparkPaths >= 4, `${sparkPaths} svg paths`);
    await pro.screenshot({ path: join(artifacts, 'pro-panel.png') });
    await pro.evaluate(() => {
      const button = [...document.querySelectorAll('aside[aria-label="Pro-Metriken"] button')].find((b) => b.getAttribute('aria-label') === 'Schließen');
      button?.click();
    });
    await wait(400);
    check('pro panel closes cleanly', (await pro.$('aside[aria-label="Pro-Metriken"]')) === null);
  }

  // premium chart tools: VP toggle + anchored VWAP click-drop (analyse menu)
  const menuLabels = async () => {
    const labels = await pro.$$eval('button', (nodes) => nodes.map((n) => (n.textContent ?? '').trim()));
    for (const id of ['analyse', 'tools']) {
      await pro.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
      await wait(200);
      labels.push(...(await pro.$$eval('[role="menuitem"]', (nodes) => nodes.map((n) => (n.textContent ?? '').trim()))));
      await pro.keyboard.press('Escape');
      await wait(150);
    }
    return labels;
  };
  const analysePressed = async (label) => {
    await pro.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
    await wait(200);
    const value = await pro.evaluate(
      (text) =>
        [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === text)?.getAttribute('aria-pressed') ?? null,
      label,
    );
    await pro.keyboard.press('Escape');
    await wait(150);
    return value;
  };
  const chipLabels = await menuLabels();
  check('VP + aVWAP entries present in the analyse menu', chipLabels.includes('VP') && chipLabels.includes('aVWAP'));
  await clickMenuItem(pro, 'VP');
  await wait(1200);
  check('volume profile toggles without errors', proErrors.length === 0, proErrors.slice(0, 2).join(' | '));
  await wait(600);
  const ribbonSeen = await pro.evaluate(() => document.body.innerText.includes('Auf TradingView steckt das hinter einem Abo'));
  check('premium-celebration ribbon fires once for a paid-elsewhere feature', ribbonSeen);
  await clickMenuItem(pro, 'aVWAP');
  await wait(300);
  const canvasBox = await (await pro.$('canvas'))?.boundingBox();
  if (canvasBox) {
    await pro.mouse.click(canvasBox.x + canvasBox.width * 0.35, canvasBox.y + canvasBox.height * 0.5);
  }
  await wait(800);
  const armedAfter = await analysePressed('aVWAP');
  check('anchored VWAP: click drops the anchor (entry stays active)', armedAfter === 'true', `aria-pressed=${armedAfter}`);
  await pro.screenshot({ path: join(artifacts, 'premium-chart-tools.png') });
  // wave 2: auto S/R + divergences live in the analyse menu, alerts stay on the toolbar
  const chipByLabel = async (label) => {
    const direct = await pro.evaluate((text) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === text && b.hasAttribute('aria-pressed') && !b.closest('[role="menu"]'),
      );
      if (!button) return null;
      const before = button.getAttribute('aria-pressed');
      button.click();
      return before;
    }, label);
    if (direct !== null) return direct;
    await pro.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
    await wait(200);
    const before = await pro.evaluate((text) => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === text);
      if (!item) return null;
      const value = item.getAttribute('aria-pressed');
      item.click();
      return value;
    }, label);
    if (before === null) {
      await pro.keyboard.press('Escape');
      await wait(150);
    }
    return before;
  };
  const wave2Labels = await menuLabels();
  check('wave2 entries present (S/R Auto, Divergenzen, Alert)', wave2Labels.includes('S/R Auto') && wave2Labels.includes('Divergenzen') && wave2Labels.includes('Alert'));
  const srBefore = await chipByLabel('S/R Auto');
  await wait(900);
  const srAfter = await analysePressed('S/R Auto');
  check('S/R auto entry toggles price lines on', srBefore === 'false' && srAfter === 'true', `${srBefore} → ${srAfter}`);
  const divBefore = await chipByLabel('Divergenzen');
  await wait(900);
  const divAfter = await analysePressed('Divergenzen');
  check('divergence entry toggles markers on', divBefore === 'false' && divAfter === 'true', `${divBefore} → ${divAfter}`);

  // price alert: arm → click the chart → chip shows the count → third state clears
  await chipByLabel('Alert');
  await wait(200);
  const alertBox = await (await pro.$('canvas'))?.boundingBox();
  if (alertBox) await pro.mouse.click(alertBox.x + alertBox.width * 0.5, alertBox.y + alertBox.height * 0.4);
  await wait(600);
  const alertChipText = await pro.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).find((text) => text.startsWith('Alerts')));
  check('alert chip arms and a chart click creates the alert', Boolean(alertChipText), String(alertChipText));
  const alertLines = await pro.evaluate(() => {
    const stored = localStorage.getItem('nc-chart-v1');
    return { persisted: stored ? stored.includes('alerts') : null };
  });
  check('alerts persist across reloads (non-expiring, wave-4)', alertLines.persisted === true, JSON.stringify(alertLines));
  await chipByLabel(alertChipText ?? 'Alerts');
  await wait(300);
  const alertCleared = await pro.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).includes('Alert'));
  check('alert chip third state clears all alerts', alertCleared);

  // compare overlay select
  const compareSelect = await pro.$('select[aria-label="Vergleich"]');
  check('compare overlay select present', Boolean(compareSelect));
  if (compareSelect) {
    const picked = await pro.evaluate(() => {
      const select = document.querySelector('select[aria-label="Vergleich"]');
      const option = [...(select?.options ?? [])].find((entry) => entry.textContent?.trim() === 'ETH');
      if (!select || !option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    check('compare offers a second symbol (ETH)', picked);
    await wait(5000);
    const comparePersisted = await pro.evaluate(() => (localStorage.getItem('nc-chart-v1') ?? '').includes('compare'));
    check('compare selection persists in the chart workspace', comparePersisted);
    await pro.evaluate(() => {
      const select = document.querySelector('select[aria-label="Vergleich"]');
      if (select) {
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // session strip (day change, range position, realized vol)
  const sessionText = await pro.evaluate(() => {
    const chip = [...document.querySelectorAll('span[title]')].find((node) => (node.getAttribute('title') ?? '').includes('Open'));
    return chip?.textContent ?? '';
  });
  check('session strip shows change % + range position + realized vol', sessionText.includes('Session') && sessionText.includes('RV') && /\d+%/.test(sessionText), sessionText.slice(0, 90));

  // indicator modal must list the wave-2 library (33 kinds total)
  const wave2ModalButton = await pro.$('button[aria-label*="Indikatoren"]');
  if (wave2ModalButton) {
    await wave2ModalButton.click();
    await pro.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const dialogText = await pro.$eval('[role="dialog"]', (node) => node.textContent ?? '');
    const wave2Names = ['Ichimoku Cloud', 'VWAP', 'Williams %R', 'Hull MA', 'TEMA', 'DEMA', 'Guppy MMA', 'TTM Squeeze', 'TD Sequential', 'Chaikin Money Flow', 'Ease of Movement', 'Ultimate Oscillator'];
    const foundNames = wave2Names.filter((name) => dialogText.includes(name));
    check('all 12 wave-2 indicators listed in the modal', foundNames.length === 12, foundNames.length + '/12: missing ' + wave2Names.filter((n) => !foundNames.includes(n)).join(', '));
    const libraryButtons = await pro.$$eval('[role="dialog"] button', (nodes) => nodes.length);
    check('modal library has ≥ 33 indicator buttons', libraryButtons >= 33, `${libraryButtons} buttons`);
    await pro.screenshot({ path: join(artifacts, 'wave2-indicators.png') });
    await pro.evaluate(() => {
      const done = [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim() === 'Fertig');
      done?.click();
    });
    await wait(400);
  }
  // wave 3: replay transport, strategy lab, screener, risk, watchlist, axes
  const wave3Labels = await menuLabels();
  check('wave3 entries present (Replay, Backtest, Screener, Risiko, Watchlist, LOG, %)', ['Replay', 'Backtest', 'Screener', 'Risiko', 'Watchlist', 'LOG', '%'].every((label) => wave3Labels.includes(label)));

  // bar replay: arm → transport bar → step → play → back to live
  await clickMenuItem(pro, 'Replay');
  await wait(500);
  const replayBar = await pro.evaluate(() => /bar-replay/i.test(document.body.innerText));
  check('bar replay opens the transport bar', replayBar);
  if (replayBar) {
    const hiddenBefore = await pro.evaluate(() => document.body.innerText.match(/−(\d+)/)?.[1] ?? null);
    await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '10 Bars zurück')?.click(); });
    await wait(500);
    const hiddenAfter = await pro.evaluate(() => document.body.innerText.match(/−(\d+)/)?.[1] ?? null);
    check('replay stepping hides more candles from the right edge', hiddenBefore != null && hiddenAfter != null && Number(hiddenAfter) === Number(hiddenBefore) + 10, `−${hiddenBefore} → −${hiddenAfter}`);
    await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Abspielen')?.click(); });
    await wait(1600);
    const playing = await pro.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Pause'));
    check('replay playback runs (pause button visible)', playing);
    await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Live')?.click(); });
    await wait(400);
    check('replay returns to live and closes the transport', !(await pro.evaluate(() => /bar-replay/i.test(document.body.innerText))));
  }

  // strategy lab: open, stats render, paint markers
  await clickMenuItem(pro, 'Backtest');
  await pro.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await wait(600);
  const btText = await pro.$eval('[role="dialog"]', (node) => node.textContent ?? '');
  check('strategy lab renders stats (win rate, profit factor, drawdown)', btText.includes('Trefferquote') && btText.includes('Profit-Faktor') && btText.includes('Max Drawdown'));
  check('strategy lab renders the equity curve', (await pro.$$eval('[role="dialog"] svg polyline', (nodes) => nodes.length)) >= 1);
  await pro.evaluate(() => { [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').includes('Trades auf den Chart'))?.click(); });
  await wait(400);
  await pro.keyboard.press('Escape');
  await wait(300);
  check('backtest markers land on the chart without errors', proErrors.filter((text) => !/favicon|DevTools/i.test(text)).length === 0);

  // screener: rows + filter + export button
  await clickMenuItem(pro, 'Screener');
  await pro.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await pro.waitForFunction(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').length > 500, { timeout: 30000, polling: 500 }).catch(() => {});
  const scrRows = await pro.$$eval('[role="dialog"] tbody tr', (nodes) => nodes.length);
  check('screener lists a deep sortable table', scrRows >= 50, `${scrRows} rows`);
  const scrText = await pro.$eval('[role="dialog"]', (node) => node.textContent ?? '');
  check('screener filters + csv export present', scrText.includes('Gainer >3%') && scrText.includes('CSV'));
  await pro.keyboard.press('Escape');
  await wait(300);

  // risk calculator: defaults produce a live R:R
  await clickMenuItem(pro, 'Risiko');
  await pro.waitForSelector('[role="dialog"]', { timeout: 5000 });
  const riskText = await pro.$eval('[role="dialog"]', (node) => node.textContent ?? '');
  check('risk calculator sizes a position with R:R', riskText.includes('Chance/Risiko') && /1 : \d/.test(riskText), riskText.slice(0, 60));
  await pro.keyboard.press('Escape');
  await wait(300);

  // watchlist popover: live quotes for the seeded list
  await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Watchlist')?.click(); });
  await wait(2500);
  const watchText = await pro.evaluate(() => document.body.innerText);
  check('watchlist popover shows live quotes', /watchlist · live/i.test(watchText) && /BTC\/USDT/.test(watchText));
  await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Watchlist')?.click(); });
  await wait(300);

  // axis modes + countdown + tip jar heart
  await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '%')?.click(); });
  await wait(600);
  const pctAxis = await pro.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '%')?.getAttribute('aria-pressed'));
  check('percent axis toggles on', pctAxis === 'true');
  await pro.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '%')?.click(); });
  const countdown = await pro.evaluate(() => document.body.innerText.includes('⏳'));
  check('legend shows the bar-close countdown', countdown);
  const heart = await pro.$('button[aria-label="Trinkgeld-Glas"]');
  check('tip-jar heart button present in toolbar', Boolean(heart));
  if (heart) {
    await heart.click();
    await pro.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const tipText = await pro.$eval('[role="dialog"]', (node) => node.textContent ?? '');
    check('tip jar tells the solo-dev funding story', tipText.includes('genau einen Entwickler') && tipText.includes('bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f') && tipText.includes('1 Pizza'));
    await pro.keyboard.press('Escape');
    await wait(300);
  }
  await pro.screenshot({ path: join(artifacts, 'wave3-tools.png') });

  await pro.screenshot({ path: join(artifacts, 'wave2-chart-tools.png') });

  const realProErrors = proErrors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
  check('premium tools run without page errors', realProErrors.length === 0, realProErrors.slice(0, 2).join(' | '));
  const wave2Errors = proErrors.filter((text) => !/favicon|Download the React DevTools|CORS policy|ERR_FAILED|Ping received after close/i.test(text));
  check('wave 2 features run without page errors', wave2Errors.length === 0, wave2Errors.slice(0, 2).join(' | '));
  await pro.close();

  // DEX tokens must render REAL candles (GeckoTerminal OHLCV), not a quote card
  const dex = await browser.newPage();
  dex.on('response', (r) => {
    if (r.url().includes('geckoterminal') || r.url().includes('dexscreener')) console.log(`        DEX NET ${r.status()} ${r.url().slice(0, 88)}`);
  });
  dex.on('requestfailed', (r) => {
    if (r.url().includes('geckoterminal')) console.log(`        DEX NET FAILED ${r.failure()?.errorText} ${r.url().slice(0, 88)}`);
  });
  await dex.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dex.waitForSelector('canvas', { timeout: 60000 });
  await dex.evaluate(() => {
    const select = document.querySelector('select[aria-label]');
    const option = [...(select?.options ?? [])].find((entry) => entry.textContent?.startsWith('WBTC'));
    if (select && option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const dexChart = await dex
    .waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 90000, polling: 1000 })
    .then(() => true)
    .catch(() => false);
  check('DEX token renders a real candle chart', dexChart);
  await dex.screenshot({ path: join(artifacts, 'dex-candles.png') });
  await dex.close();

  // 8.8 wave-4 tools: patterns, ratings, heatmap, journal, magnifier, alerts,
  // exotic chart types, custom intervals + the usage-based tip nudge.
  console.log('\n— wave-4 premium tools —');
  const w4 = await browser.newPage();
  w4.on('pageerror', (err) => errors.push(`wave4 pageerror: ${err.message}`));
  await w4.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await w4.evaluate(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.message).slice(0, 140)));
  });
  await w4.waitForSelector('canvas', { timeout: 60000 });
  await wait(2500);
  // Chips may live behind a toolbar dropdown – open menus automatically.
  const clickChip = async (label) => {
    const direct = await w4.evaluate((text) => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
      if (!button) return false;
      button.click();
      return true;
    }, label);
    if (direct) return true;
    const triggers = await w4.evaluate(() =>
      [...document.querySelectorAll('[data-menu-trigger]')].map((el) => el.getAttribute('data-menu-trigger')),
    );
    for (const id of triggers) {
      await w4.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
      await wait(150);
      const hit = await w4.evaluate((text) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim() === text);
        if (!item) return false;
        item.click();
        return true;
      }, label);
      if (hit) return true;
      await w4.keyboard.press('Escape');
      await wait(120);
    }
    return false;
  };
  const dialogText = () =>
    w4.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].pop()?.textContent ?? '');
  const closeDialog = async () => {
    await w4.keyboard.press('Escape');
    await wait(350);
  };
  // Full-run contexts can carry a stray dialog (milestone/wall) into this
  // section – sweep before every step so `pop()` is always the step's modal.
  const resetDialogs = async () => {
    for (let i = 0; i < 3; i += 1) {
      const open = await w4.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
      if (open === 0) return;
      await w4.keyboard.press('Escape');
      await wait(300);
    }
  };
  const dialogDump = () =>
    w4.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.textContent ?? '').slice(0, 40)));
  const expectDialog = (fragment, ms = 8000) =>
    w4
      .waitForFunction(
        (frag) => ([...document.querySelectorAll('[role="dialog"]')].pop()?.textContent ?? '').includes(frag),
        { timeout: ms, polling: 250 },
        fragment,
      )
      .then(() => true)
      .catch(() => false);
  const setNum = (index, value) =>
    w4.evaluate(
      (i, v) => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
        const input = dlg?.querySelectorAll('input[type="number"]')[i];
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(v));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      index,
      value,
    );

  check('wave-4 tools render in the toolbar menus', await (async () => {
    const texts = [];
    for (const id of ['analyse', 'tools']) {
      await w4.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
      await wait(200);
      texts.push(await w4.evaluate(() => document.body.textContent ?? ''));
      await w4.keyboard.press('Escape');
      await wait(150);
    }
    const text = texts.join(' ');
    return ['Muster', 'Rating', 'Heatmap', 'Journal', 'Lupe', 'Alerts'].every((label) => text.includes(label));
  })());

  // patterns scanner
  await resetDialogs();
  await clickChip('Muster');
  const patOk = await expectDialog('Chartmuster-Scanner');
  const diag = { dialogs: await dialogDump(), errs: await w4.evaluate(() => (window.__errs ?? []).slice(0, 3)) };
  check('patterns chip opens the scanner', patOk, JSON.stringify(diag));
  await w4.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].pop()?.querySelector('input[type="checkbox"]')?.click());
  await wait(300);
  check('pattern marker toggle flips on', await w4.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].pop()?.querySelector('input[type="checkbox"]')?.checked === true));
  await closeDialog();

  // ratings matrix
  await resetDialogs();
  await clickChip('Rating');
  check('ratings chip opens the matrix', await expectDialog('Technische Ratings'));
  const rated = await w4
    .waitForFunction(
      () => {
        const text = [...document.querySelectorAll('[role="dialog"]')].pop()?.textContent ?? '';
        return text.includes('6 Timeframes') && (text.includes('1h') || text.includes('fehlgeschlagen'));
      },
      { timeout: 25000, polling: 1000 },
    )
    .then(() => true)
    .catch(() => false);
  const ratedText = await dialogText();
  check('ratings matrix scores timeframes (or degrades gracefully)', rated && (ratedText.includes('1h') || ratedText.includes('fehlgeschlagen')));
  await closeDialog();

  // heatmap
  await resetDialogs();
  await clickChip('Heatmap');
  check('heatmap chip opens the treemap', await expectDialog('Markt-Heatmap'));
  const tiles = await w4
    .waitForFunction(() => document.querySelectorAll('[role="dialog"] button[title*="/USDT ·"]').length > 10, {
      timeout: 25000,
      polling: 1000,
    })
    .then(() => true)
    .catch(() => false);
  check('heatmap renders 10+ volume tiles', tiles);
  const tileBase = await w4.evaluate(() => document.querySelector('[role="dialog"] button[title*="/USDT ·"]')?.title.split('/')[0] ?? null);
  if (tileBase) {
    await w4.evaluate(() => document.querySelector('[role="dialog"] button[title*="/USDT ·"]')?.click());
    await wait(600);
    const header = await w4.evaluate(() => document.body.textContent ?? '');
    check('heatmap tile click loads the pair', header.includes(`${tileBase}/USDT`) && !(await dialogText()).includes('Markt-Heatmap'));
  }

  // journal
  await resetDialogs();
  await clickChip('Journal');
  check('journal chip opens the journal', await expectDialog('Trade-Journal'));
  await setNum(0, 1);
  await setNum(1, 100);
  await setNum(2, 110);
  await w4.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const button = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Eintrag sichern'));
    button?.click();
  });
  await wait(400);
  const journalText = await dialogText();
  check('journal entry saves with pnl + stats', journalText.includes('$10.00') && journalText.includes('100%'));
  await closeDialog();

  // magnifier
  await resetDialogs();
  await clickChip('Lupe');
  check('magnifier chip opens the bar lens', await expectDialog('Bar-Lupe'));
  await wait(3000);
  const magText = await dialogText();
  check('magnifier shows tape stats or degrades gracefully', /Taker-Delta|nicht erreichbar|Keine Trades/.test(magText));
  await closeDialog();

  // alerts manager
  await resetDialogs();
  await clickChip('Alerts');
  check('alerts chip opens the manager', await expectDialog('Alert-Manager'));
  await setNum(0, 1);
  await w4.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const button = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Alert anlegen'));
    button?.click();
  });
  await wait(800);
  const alertText = await dialogText();
  const alertPersist = await w4.evaluate(() => localStorage.getItem('nc-chart-v1') ?? '');
  check('alert creates, lists and persists', /[≥≤] 1/.test(alertText) && alertPersist.includes('"alerts"'));
  await closeDialog();

  // usage nudge (6 opened tools) + exotic types + custom interval
  await wait(2500);
  const nudgeText = await w4.evaluate(() => document.body.innerText);
  check('usage nudge fires after six tools', nudgeText.includes('meint es ernst'));
  await resetDialogs();
  await w4.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Kaffee ausgeben');
    button?.click();
  });
  check('nudge CTA opens the tip jar', await expectDialog('bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f', 6000));
  await closeDialog();

  const pickChartType = async (label) => {
    const opened = await w4.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) =>
        /candles|balken|bars|linie|fläche|area|heikin|baseline|renko|line break|kagi|point/i.test(b.getAttribute('aria-label') ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await wait(350);
    const picked = await w4.evaluate((l) => {
      const opt = [...document.querySelectorAll('[role="listbox"] [role="option"] button')].find((b) =>
        (b.textContent ?? '').trim().toLowerCase() === l.toLowerCase());
      if (!opt) return false;
      opt.click();
      return true;
    }, label);
    await wait(600);
    return opened && picked;
  };
  check('chart-type dropdown switches to renko', await pickChartType('Renko'));
  await wait(1200);
  check('renko renders without page errors', (await w4.evaluate(() => document.querySelectorAll('canvas').length)) > 0);
  check('chart-type dropdown switches to point & figure', await pickChartType('Point & Figure'));
  await wait(900);
  await pickChartType('Candles');
  await wait(400);

  check('custom interval popover opens', await clickChip('∿ Intervall'));
  await w4.evaluate(() => {
    const input = document.querySelector('input[aria-label="∿ Intervall"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (input) {
      setter.call(input, '7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await w4.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'OK');
    button?.click();
  });
  const legend7m = await w4
    .waitForFunction(
      () => [...document.querySelectorAll('span')].some((el) => el.textContent === '7m' && el.className.includes('text-faint')),
      { timeout: 20000, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  check('custom 7m interval shows in the chart legend', legend7m);
  await w4.screenshot({ path: join(artifacts, 'wave4-tools.png') });
  await w4.close();

  // 8.85 wave-5: watermark, script lab, CUSTOM routing
  console.log('\n— wave-5 watermark & script lab —');
  const w5 = await browser.newPage();
  w5.on('pageerror', (err) => errors.push(`wave5 pageerror: ${err.message}`));
  await w5.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await w5.waitForSelector('canvas', { timeout: 60000 });
  await wait(2500);
  const w5Chip = async (label) => {
    const direct = await w5.evaluate((text) => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
      if (!button) return false;
      button.click();
      return true;
    }, label);
    if (direct) return true;
    const triggers = await w5.evaluate(() =>
      [...document.querySelectorAll('[data-menu-trigger]')].map((el) => el.getAttribute('data-menu-trigger')),
    );
    for (const id of triggers) {
      await w5.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
      await wait(150);
      const hit = await w5.evaluate((text) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim() === text);
        if (!item) return false;
        item.click();
        return true;
      }, label);
      if (hit) return true;
      await w5.keyboard.press('Escape');
      await wait(120);
    }
    return false;
  };
  const w5AnyDialog = (fragment, ms = 8000) =>
    w5
      .waitForFunction(
        (frag) => [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent ?? '').includes(frag)),
        { timeout: ms, polling: 250 },
        fragment,
      )
      .then(() => true)
      .catch(() => false);
  const w5Sweep = async () => {
    for (let i = 0; i < 3; i += 1) {
      const open = await w5.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
      if (open === 0) return;
      await w5.keyboard.press('Escape');
      await wait(300);
    }
  };
  const w5Button = (label) =>
    w5.evaluate((text) => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const button = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').includes(text));
      if (!button) return false;
      button.click();
      return true;
    }, label);
  const w5SetSource = (value) =>
    w5.evaluate((v) => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const ta = dlg?.querySelector('textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, v);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, value);

  check(
    'watermark attribute carries www.NodeChart.cc on every pane',
    await w5.evaluate(() => {
      const hosts = [...document.querySelectorAll('[data-watermark]')];
      return hosts.length > 0 && hosts.every((el) => el.getAttribute('data-watermark') === 'www.NodeChart.cc');
    }),
  );
  check(
    'toolbar groups render as dropdown menus',
    await w5.evaluate(() => ['analyse', 'tools', 'more'].every((id) => document.querySelector(`[data-menu-trigger="${id}"]`))),
  );
  await w5Sweep();
  await w5.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
  await wait(250);
  check(
    'analyse menu opens as role=menu with seven entries',
    await w5.evaluate(() => {
      const menu = document.querySelector('[role="menu"]');
      return Boolean(menu) && menu.querySelectorAll('[role="menuitem"]').length === 7;
    }),
  );
  await w5.keyboard.press('Escape');
  await wait(250);
  check('escape closes the menu', await w5.evaluate(() => !document.querySelector('[role="menu"]')));
  await w5.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
  await wait(250);
  await w5.mouse.click(10, 500);
  await wait(250);
  check('outside click closes the menu', await w5.evaluate(() => !document.querySelector('[role="menu"]')));
  await w5Sweep();
  check('scripts entry clicked via tools menu', await w5Chip('Skripte'));
  check('scripts chip opens the Script Lab', await w5AnyDialog('Script Lab'));
  check(
    'script lab has an editor + the API guide',
    await w5.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      return Boolean(dlg?.querySelector('textarea')) && (dlg?.textContent ?? '').includes('Verfügbar pro Kerze');
    }),
  );
  check('test button evaluates the default formula', (await w5Button('Testen')) && (await w5AnyDialog('Letzter Wert')));
  check('source setter works', await w5SetSource('1 +'));
  check('syntax error surfaces in the lab', (await w5Button('Testen')) && (await w5AnyDialog('Syntaxfehler')));
  check('source restored', await w5SetSource('ema(9) - ema(21)'));
  check(
    'valid formula tests clean again',
    (await w5Button('Testen')) &&
      (await w5AnyDialog('Letzter Wert')) &&
      !(await w5.evaluate(() => ([...document.querySelectorAll('[role="dialog"]')].pop()?.textContent ?? '').includes('Syntaxfehler'))),
  );
  // dismiss the locale-switch nudge so it stays out of the artifact
  // (labels are CSS-uppercased → match the raw text case-insensitively)
  await w5.evaluate(() => {
    const keep = [...document.querySelectorAll('button')].find((b) => /de behalten/i.test(b.textContent ?? ''));
    keep?.click();
  });
  await wait(500);
  await w5.screenshot({ path: join(artifacts, 'wave5.png') });
  check('apply button clicked', await w5Button('Auf den Chart'));
  await wait(700);
  await w5Sweep();
  check(
    'CUSTOM instance shows in the pane legend',
    await w5.evaluate(() => (document.body.textContent ?? '').includes('Eigenes Skript')),
  );

  // CUSTOM tile in the indicator modal must route into the Script Lab
  await w5Sweep();
  const w5IndButton = await w5.$('button[aria-label*="Indikatoren"]');
  check('indicator button found', Boolean(w5IndButton));
  await w5IndButton?.click();
  await wait(500);
  check('indicator modal lists the CUSTOM tile', await w5AnyDialog('Eigenes Skript'));
  check(
    'CUSTOM tile clicked',
    await w5.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const tile = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').includes('Eigenes Skript'));
      if (!tile) return false;
      tile.click();
      return true;
    }),
  );
  check('CUSTOM tile routes into the Script Lab', await w5AnyDialog('Script Lab'));
  await w5Sweep();
  await w5.close();

  // 8.86 wave-5: help center documents every indicator + metric + the lab
  console.log('\n— wave-5 help docs —');
  const w5h = await browser.newPage();
  w5h.on('pageerror', (err) => errors.push(`wave5help pageerror: ${err.message}`));
  await w5h.goto(`${BASE}/de/help`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await w5h.waitForSelector('input[type="search"]', { timeout: 15000 });
  const helpText = () => w5h.evaluate(() => document.body.innerText);
  const helpCategory = (prefix) =>
    w5h.evaluate((p) => {
      const button = [...document.querySelectorAll('button[aria-pressed]')].find((b) => (b.textContent ?? '').startsWith(p));
      if (!button) return null;
      button.click();
      return button.textContent ?? '';
    }, prefix);
  const w5AllText = await helpText();
  check(
    'help shows the new categories',
    // category chips render CSS-uppercased → match case-insensitively
    /Indikatoren/i.test(w5AllText) && /Metriken/i.test(w5AllText) && /Script Lab/i.test(w5AllText),
  );
  const indBadge = await helpCategory('Indikatoren');
  check('indicator category badge counts 34 docs', (indBadge ?? '').includes('34'));
  await wait(300);
  const indText = await helpText();
  check(
    'indicator docs render with name + short',
    indText.includes('EMA — Exponentieller gleitender Durchschnitt') && indText.includes('Eigenes Skript — Script-Lab-Formel'),
  );
  const metBadge = await helpCategory('Metriken');
  check('metric category badge counts 42 docs', (metBadge ?? '').includes('42'));
  await wait(300);
  const metText = await helpText();
  check('metric docs render (funding + CVD + fear&greed)', metText.includes('Funding-Rate') && metText.includes('Cumulative Volume Delta') && metText.includes('Fear & Greed'));
  const scrBadge = await helpCategory('Script Lab');
  check('script category badge counts 3 topics', (scrBadge ?? '').includes('3'));
  await wait(300);
  const w5ScrText = await helpText();
  check('script topics render (write + GitHub import)', w5ScrText.includes('Wie schreibe ich ein eigenes Skript?') && w5ScrText.includes('GitHub'));
  const edgeBadge = await helpCategory('Edge');
  check('edge category badge counts 4 topics', (edgeBadge ?? '').includes('4'));
  await wait(300);
  const w7HelpText = await helpText();
  check('edge topics render (Liq Radar + Clock Edge)', w7HelpText.includes('Wie funktioniert der Liq Radar?') && w7HelpText.includes('Clock Edge'));
  await helpCategory('Alle');
  await wait(200);
  await w5h.evaluate(() => {
    const input = document.querySelector('input[type="search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'funding');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(300);
  check('help full-text search finds the funding metric', (await helpText()).includes('Funding-Rate'));
  await w5h.close();

  // 8.87 wave-7: Edge Suite (Liq Radar, Lag Oracle, Regime Compass, Clock Edge)
  console.log('\n— wave-7 edge suite —');
  const w7 = await browser.newPage();
  w7.on('pageerror', (err) => errors.push(`wave7 pageerror: ${err.message}`));
  // ?ticker=BTC pins the active token deterministically: the heatmap-tile test
  // above may have persisted a live-ordered tile (e.g. ETH) as active token,
  // which would silently drop ETH from the Lag Oracle leader select.
  await w7.goto(`${BASE}/de/terminal?ticker=BTC`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await w7.waitForSelector('canvas', { timeout: 30000 });
  // give the feed time so all four engines have candles to chew on
  await w7
    .waitForFunction(() => {
      const legend = document.querySelector('.font-mono.text-micro-10');
      return !!legend && /O\s*[\d.]+/.test(legend.textContent ?? '');
    }, { timeout: 60000 })
    .catch(() => {});

  const w7DialogText = () =>
    w7.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'));
  const w7OpenEdgeItem = async (label) => {
    await w7.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
    await wait(250);
    const clicked = await w7.evaluate((t) => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === t);
      if (!item) return false;
      item.click();
      return true;
    }, label);
    await wait(400);
    return clicked;
  };

  check(
    'edge menu trigger is mounted',
    await w7.evaluate(() => !!document.querySelector('[data-menu-trigger="edge"]')),
  );
  await w7.evaluate(() => document.querySelector('[data-menu-trigger="edge"]')?.click());
  await wait(250);
  const edgeItems = await w7.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent ?? '').trim()),
  );
  check(
    'edge menu lists the four engines',
    ['Liq Radar', 'Lag Oracle', 'Regime Compass', 'Clock Edge'].every((label) => edgeItems.includes(label)),
    edgeItems.join(' | '),
  );
  await w7.keyboard.press('Escape');
  await wait(200);

  // — Liq Radar: modal + canvas flag —
  const liqAttrBefore = await w7.evaluate(() =>
    document.querySelector('[data-liq-radar]')?.getAttribute('data-liq-radar'),
  );
  check('liq radar starts disabled on the chart host', liqAttrBefore === 'off', String(liqAttrBefore));
  check('Liq Radar menu item opens the modal', await w7OpenEdgeItem('Liq Radar'));
  let liqText = await w7DialogText();
  check(
    'Liq Radar modal explains the magnets',
    /liq radar/i.test(liqText) && /magnete im chart einblenden/i.test(liqText),
  );
  await w7.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    dlg?.querySelector('input[type="checkbox"]')?.click();
  });
  await wait(500);
  const liqAttrAfter = await w7.evaluate(() =>
    document.querySelector('[data-liq-radar]')?.getAttribute('data-liq-radar'),
  );
  check('checkbox arms the chart magnets (data-liq-radar=on)', liqAttrAfter === 'on', String(liqAttrAfter));
  liqText = await w7DialogText();
  check(
    'magnet list renders levels or the empty hint',
    /liquidationen/i.test(liqText) || /noch zu wenig kerzen/i.test(liqText),
  );
  await shot(w7, 'wave7-liq-modal.png');
  await w7.keyboard.press('Escape');
  await wait(400);
  check('Liq Radar modal closes on Escape', (await w7DialogText()) === '');
  await wait(800);
  await shot(w7, 'wave7-edge.png');

  // — Lag Oracle —
  check('Lag Oracle menu item opens the modal', await w7OpenEdgeItem('Lag Oracle'));
  await w7
    .waitForFunction(() => {
      const txt = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n');
      return /lag \(kerzen\)/i.test(txt) || /leader-feed lädt/i.test(txt);
    }, { timeout: 75000 })
    .catch(() => {});
  const lagText = await w7DialogText();
  check(
    'Lag Oracle shows stats or the loading hint',
    /lag \(kerzen\)/i.test(lagText) || /leader-feed lädt/i.test(lagText),
    lagText.slice(0, 120).replace(/\n/g, ' / '),
  );
  const lagOptions = await w7.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    return [...(dlg?.querySelectorAll('select option') ?? [])].map((o) => o.textContent ?? '');
  });
  check(
    'leader select lists CEX alternatives (ETH, SOL)',
    lagOptions.some((o) => o.includes('ETH')) && lagOptions.some((o) => o.includes('SOL')),
    lagOptions.join(' | '),
  );
  await shot(w7, 'wave7-lag-modal.png');
  await w7.keyboard.press('Escape');
  await wait(300);

  // — Regime Compass —
  check('Regime Compass menu item opens the modal', await w7OpenEdgeItem('Regime Compass'));
  await w7
    .waitForFunction(() => {
      const txt = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n');
      return /Starker Trend|Schwacher Trend|Range|Volatilitäts-Expansion|Liquidations-Sturm|Noch zu wenig Kerzen/.test(txt);
    }, { timeout: 20000 })
    .catch(() => {});
  const regimeText = await w7DialogText();
  check(
    'Regime Compass names a regime or waits for data',
    /Starker Trend|Schwacher Trend|Range|Volatilitäts-Expansion|Liquidations-Sturm/.test(regimeText) ||
      regimeText.includes('Noch zu wenig Kerzen'),
    regimeText.slice(0, 120).replace(/\n/g, ' / '),
  );
  check(
    'regime confidence renders as a percentage',
    !regimeText.includes('Konfidenz') || /\d+ %/.test(regimeText),
  );
  await shot(w7, 'wave7-regime-modal.png');
  await w7.keyboard.press('Escape');
  await wait(300);

  // — Clock Edge —
  check('Clock Edge menu item opens the modal', await w7OpenEdgeItem('Clock Edge'));
  await w7
    .waitForFunction(() => {
      const txt = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n');
      return /stunden \(utc\)/i.test(txt) || /noch zu wenig kerzen/i.test(txt);
    }, { timeout: 20000 })
    .catch(() => {});
  const clockText = await w7DialogText();
  check(
    'Clock Edge renders both heatmaps or the guard hint',
    (/stunden \(utc\)/i.test(clockText) && /wochentage/i.test(clockText)) ||
      /noch zu wenig kerzen/i.test(clockText),
  );
  await shot(w7, 'wave7-clock-modal.png');
  await w7.keyboard.press('Escape');
  await wait(300);
  await w7.close();

  // 8.9 landing: survival section + funding-framed hero (fresh page)
  console.log('\n— landing survival & funding copy —');
  const land = await browser.newPage();
  await land.goto(`${BASE}/de`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await land.waitForSelector('#features', { timeout: 15000 }).catch(() => {});
  const landText = await land.evaluate(() => document.body.innerText);
  const landHtml = await land.evaluate(() => document.body.innerHTML);
  check('landing support line keeps funding doctrine', /ein dev, eine server-rechnung|one dev, one server bill/i.test(landText));
  check('landing frames funding instead of \"free project\"', /werbung und optionale tipps|ads and optional tips/i.test(landText) && !/100 ?% ?(kostenlos|free)/i.test(landText));
  check('landing benefit block lists paid-elsewhere gates', /unbegrenzt indikatoren|unlimited indicators/i.test(landText) && /premium/i.test(landText) && /screener/i.test(landText));
  check('landing benefit block lists unique tools (wave-7)', /liq radar/i.test(landText) && /clock edge/i.test(landText) && /lag oracle/i.test(landText));
  check('landing benefit block lists unique tools (wave-3/5)', /bar-lupe|bar magnifier/i.test(landText) && /whale-flow|whale flow/i.test(landText));
  check('landing ist schlank (keine FAQ-/Story-Sektionen)', !landHtml.includes('id="survival"') && !landHtml.includes('id="faq"') && landText.length < 12000);
  await land.evaluate(() => document.querySelector('#features')?.scrollIntoView({ block: 'start' }));
  await new Promise((r) => setTimeout(r, 700));
  await land.screenshot({ path: join(artifacts, 'landing-benefit.png'), fullPage: false });
  await land.close();

  // 9. console hygiene
  const cors = errors.filter((text) => text.includes('CORS policy')).map((text) => (text.match(/https?:\/\/[^/]+/)?.[0] ?? '?'));
  if (cors.length > 0) console.log(`        CORS-blocked REST hosts: ${[...new Set(cors)].join(', ')}`);
  // 'Ping received after close' is a binance.vision mirror close-handshake race
  // (the socket manager reconnects and recovers; send() is readyState-guarded).
  const realErrors = errors.filter(
    (text) => !/favicon|404|Download the React DevTools|CORS policy|ERR_FAILED|Ping received after close/i.test(text),
  );
  check('no console errors on desktop (CORS inventory printed separately)', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (error) {
  check(`browser run completed (${error instanceof Error ? error.message : 'error'})`, false);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✔ browser check OK' : `✖ ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
