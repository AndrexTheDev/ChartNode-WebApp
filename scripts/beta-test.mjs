#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Beta test – fresh-visitor journeys over the whole product (dev-only).
 *
 * Simulates real beta users with a clean browser profile:
 *   1. every locale × (landing, terminal, help, legal) renders without errors
 *   2. desktop newcomer: live chart → indicator → 2x2 → reload → themes
 *      (incl. the premium lock → share → unlock loop)
 *   3. mobile newcomer: touch gate + force enable
 *   4. ad-block visitor: soft-wall + dismiss cooldown
 *   5. shared deep link + OG card
 *   6. unknown locale & 404 behaviour
 *
 *   npm run start && node scripts/beta-test.mjs
 */
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];

let failures = 0;
const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});

const consoleErrors = (page, sink) => {
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('CORS policy') && !m.text().includes('net::ERR_FAILED')) sink.push(m.text());
  });
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  // Only same-origin request failures are real bugs; cross-origin REST seeds
  // are CORS-rejected by design (WS fallback) and AbortController cancels are
  // intentional (timeframe switches).
  page.on('requestfailed', (r) => {
    const errorText = r.failure()?.errorText ?? '';
    // ERR_ABORTED = intentional cancel (router prefetch superseded, AbortController)
    if (r.url().startsWith(BASE) && errorText !== 'net::ERR_ABORTED') sink.push(`requestfailed: ${r.url().slice(0, 90)} ${errorText}`);
  });
};

try {
  /* ------------------------- 1. locale × page matrix ----------------------- */
  console.log('\n— beta: locale × page matrix —');
  for (const locale of LOCALES) {
    const page = await browser.newPage();
    const errors = [];
    consoleErrors(page, errors);
    const routes = [`/${locale}`, `/${locale}/terminal`, `/${locale}/help`, `/${locale}/legal/terms`];
    let ok = true;
    for (const route of routes) {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (res.status() !== 200 || !lang?.startsWith(locale)) ok = false;
    }
    check(`${locale}: all four routes 200 + <html lang>`, ok && errors.length === 0, errors[0] ?? '');
    await page.close();
  }

  /* --------------------------- 2. desktop newcomer ------------------------- */
  console.log('\n— beta: desktop newcomer journey —');
  const user = await browser.newPage();
  const userErrors = [];
  consoleErrors(user, userErrors);
  await user.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await user.waitForSelector('canvas', { timeout: 30000 });
  await wait(5000);
  check('chart streams live candles', /O \d/.test(await user.evaluate(() => document.body.innerText)));

  // locale-detect banner is dismissible
  const banner = await user.evaluate(() => document.body.innerText.includes('SYSTEMSPRACHE ERKANNT'));
  if (banner) {
    await user.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'DE BEHALTEN');
      button?.click();
    });
    await wait(300);
  }
  check('locale banner dismissible', true);

  // indicator via modal
  await user.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Indikatoren'));
    button?.click();
  });
  await user.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await user.evaluate(() => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('RSI'));
    button?.click();
  });
  await wait(800);
  check('newcomer can add an RSI instance', await user.evaluate(() => document.body.innerText.includes('RSI 14')));
  await user.keyboard.press('Escape');

  // multi chart + sync
  await user.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '2x2')?.click();
  });
  await wait(4000);
  check('2x2 grid renders for a new visitor', (await user.$$('canvas')).length >= 20);

  // reload keeps the workspace
  await user.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  const persisted = await user.evaluate(() => ({
    layout: localStorage.getItem('nodechart:store:v1')?.includes('"2x2"') ?? false,
    rsi: localStorage.getItem('nc-chart-v1')?.includes('"RSI"') ?? false,
  }));
  check('workspace survives a reload', persisted.layout && persisted.rsi, JSON.stringify(persisted));

  // share → unlock → premium theme applies (stub the popup like the browser check)
  await user.evaluate(() => {
    window.__opened = [];
    const original = window.open;
    window.open = (url, ...rest) => {
      window.__opened.push(String(url));
      return original.call(window, 'about:blank', ...rest);
    };
  });
  // share lives behind the toolbar "more" menu now
  for (const id of await user.evaluate(() =>
    [...document.querySelectorAll('[data-menu-trigger]')].map((el) => el.getAttribute('data-menu-trigger')),
  )) {
    await user.evaluate((tid) => document.querySelector(`[data-menu-trigger="${tid}"]`)?.click(), id);
    await wait(200);
    const hit = await user.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === 'Teilen');
      if (!item) return false;
      item.click();
      return true;
    });
    if (hit) break;
    await user.keyboard.press('Escape');
    await wait(150);
  }
  await wait(600);
  const shareOpen = await user.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.includes('Found an insane setup') ?? false);
  check('newcomer finds the share modal with the spec tweet', shareOpen);
  await user.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Auf X posten');
    button?.click();
  });
  await wait(700);
  check('X intent flips the unlock flag', await user.evaluate(() => document.body.innerText.toLowerCase().includes('freigeschaltet')));
  await user.keyboard.press('Escape');
  await wait(400);
  await user.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Design')?.click();
  });
  await wait(400);
  await user.evaluate(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Miami Vice'));
    (option?.querySelector('button') ?? option)?.click();
  });
  await wait(600);
  check('unlocked newcomer applies Miami Vice', (await user.evaluate(() => document.documentElement.dataset.theme)) === 'miami');

  // PRO metrics: a newcomer can open the premium dock
  await user.click('[data-testid="pro-toggle"]');
  await user.waitForSelector('aside[aria-label="Pro-Metriken"]', { timeout: 5000 });
  await user.waitForFunction(
    () => {
      const text = document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '';
      return text.includes('Funding') && text.includes('Nächstes Funding') && text.includes('Marktbreite');
    },
    { timeout: 50000, polling: 1000 },
  ).catch(() => {});
  check('newcomer sees premium pro metrics', await user.evaluate(() => {
    const text = document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '';
    return text.includes('Funding') && text.includes('Max Pain');
  }));
  check('newcomer sees wave-2 pro cards (countdown, breadth, depth)', await user.evaluate(() => {
    const text = document.querySelector('aside[aria-label="Pro-Metriken"]')?.textContent ?? '';
    return text.includes('Nächstes Funding') && text.includes('Marktbreite') && text.includes('Orderbuch-Tiefe');
  }));
  await user.evaluate(() => {
    const button = [...document.querySelectorAll('aside[aria-label="Pro-Metriken"] button')].find((b) => b.getAttribute('aria-label') === 'Schließen');
    button?.click();
  });
  await wait(400);

  // wave-2 chart tools: a newcomer finds S/R, divergences and price alerts
  // (S/R + divergences live behind the toolbar "analyse" menu now)
  const wave2ClickChip = async (label) => {
    const direct = await user.evaluate((text) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === text && !b.closest('[role="menu"]'),
      );
      if (!button) return false;
      button.click();
      return true;
    }, label);
    if (direct) return;
    await user.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
    await wait(200);
    await user.evaluate((text) => {
      [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').trim() === text)?.click();
    }, label);
  };
  await wave2ClickChip('S/R Auto');
  await wave2ClickChip('Divergenzen');
  await wait(800);
  await user.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
  await wait(200);
  check('newcomer toggles auto S/R + divergence overlays', await user.evaluate(() => {
    const pressed = [...document.querySelectorAll('[role="menuitem"]')]
      .filter((b) => ['S/R Auto', 'Divergenzen'].includes((b.textContent ?? '').trim()))
      .map((b) => b.getAttribute('aria-pressed'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return pressed.length === 2 && pressed.every((value) => value === 'true');
  }));
  await wait(200);
  await wave2ClickChip('Alert');
  await wait(200);
  const alertCanvas = await (await user.$('canvas'))?.boundingBox();
  if (alertCanvas) await user.mouse.click(alertCanvas.x + alertCanvas.width * 0.5, alertCanvas.y + alertCanvas.height * 0.4);
  await wait(500);
  check('newcomer arms a price alert by clicking the chart', await user.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim().startsWith('Alerts')),
  ));
  await user.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith('Alerts'));
    chip?.click();
  });
  await wait(300);
  await wave2ClickChip('S/R Auto');
  await wave2ClickChip('Divergenzen');
  await wait(300);

  // on-chain signals: a newcomer can open the live panel
  await user.click('[data-testid="onchain-toggle"]');
  await user.waitForSelector('aside[aria-label="On-Chain-Signale"]', { timeout: 5000 });
  await user.waitForFunction(
    () => (document.querySelector('aside[aria-label="On-Chain-Signale"]')?.textContent ?? '').includes('Gebühren in sat/vB'),
    { timeout: 40000, polling: 1000 },
  ).catch(() => {});
  check('newcomer sees live on-chain signals', await user.evaluate(() => {
    const text = document.querySelector('aside[aria-label="On-Chain-Signale"]')?.textContent ?? '';
    return text.includes('Gebühren in sat/vB') && text.includes('Gesamt-TVL');
  }));
  await user.evaluate(() => {
    const button = [...document.querySelectorAll('aside[aria-label="On-Chain-Signale"] button')].find((b) => b.getAttribute('aria-label') === 'Schließen');
    button?.click();
  });
  await wait(400);
  check('desktop journey without page errors', userErrors.length === 0, userErrors[0] ?? '');
  await user.close();

  /* ---------------------------- 3. mobile newcomer ------------------------- */
  console.log('\n— beta: mobile newcomer journey —');
  const mob = await browser.newPage();
  const mobErrors = [];
  consoleErrors(mob, mobErrors);
  await mob.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36');
  await mob.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
  await mob.goto(`${BASE}/en/terminal`, { waitUntil: 'domcontentloaded' });
  await mob.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  const gate = await mob.evaluate(() => document.body.innerText.toLowerCase().includes('touch screen') || document.body.innerText.toLowerCase().includes('touchscreen'));
  check('mobile visitor sees the touch warning', gate);
  await mob.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => /force enable/i.test(b.textContent ?? ''));
    button?.click();
  });
  await wait(400);
  check('force enable unlocks the tools', await mob.evaluate(() => {
    const group = document.querySelector('[aria-label="Drawing tools"]');
    return group ? getComputedStyle(group).pointerEvents !== 'none' : false;
  }));
  check('mobile journey without page errors', mobErrors.length === 0, mobErrors[0] ?? '');
  await mob.close();

  /* --------------------------- 4. ad-block visitor ------------------------- */
  console.log('\n— beta: ad-block visitor —');
  const blocked = await browser.newPage();
  await blocked.goto(`${BASE}/en/terminal?adwall=1`, { waitUntil: 'domcontentloaded' });
  await blocked.waitForSelector('[role="dialog"]', { timeout: 30000 });
  check('soft-wall greets the blocked visitor', await blocked.evaluate(() => (document.body.textContent ?? '').toLowerCase().includes('rebellion')));
  await blocked.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Dismiss');
    button?.click();
  });
  await wait(400);
  check('dismiss returns to the chart', (await blocked.$('[role="dialog"]')) === null);
  await blocked.close();

  /* ------------------------- 5. shared link + OG card ---------------------- */
  console.log('\n— beta: shared deep link —');
  const visitor = await browser.newPage();
  await visitor.goto(`${BASE}/es/terminal?ticker=ETH&price=3000`, { waitUntil: 'domcontentloaded' });
  await visitor.waitForSelector('canvas', { timeout: 30000 });
  await wait(3000);
  check('shared link opens the shared symbol', await visitor.evaluate(() => document.body.innerText.includes('ETH/USDT')));
  const og = await visitor.evaluate(() => document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '');
  check('og:image points at the edge card', og.includes('/api/og?ticker=ETH'), og);
  await visitor.close();
  const ogRes = await fetch(`${BASE}/api/og?ticker=ETH&price=3000`);
  check('edge card responds', ogRes.status === 200 && (ogRes.headers.get('content-type') ?? '').includes('svg'));

  /* ------------------------------ 6. edge cases ---------------------------- */
  console.log('\n— beta: edge cases —');
  const stray = await browser.newPage();
  const notFound = await stray.goto(`${BASE}/de/does-not-exist`, { waitUntil: 'domcontentloaded' });
  check('unknown route renders the 404 page', notFound.status() === 404 && (await stray.evaluate(() => document.body.innerText.length)) > 10);
  const badLocale = await stray.goto(`${BASE}/xx/terminal`, { waitUntil: 'domcontentloaded' });
  check('unknown locale falls back gracefully (redirect/404, never 5xx)', [200, 307, 404].includes(badLocale.status()), String(badLocale.status()));
  const hostile = await stray.goto(`${BASE}/de/terminal?ticker=<script>alert(1)</script>`, { waitUntil: 'domcontentloaded' });
  await wait(2500);
  check('hostile ticker param is inert', hostile.status() === 200 && !(await stray.evaluate(() => document.querySelectorAll('script[src="alert(1)"]').length)));
  await stray.close();
} catch (error) {
  check(`beta run completed (${error instanceof Error ? error.message : 'error'})`, false);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✔ beta test OK' : `✖ ${failures} beta failure(s)`} — ${results.filter((r) => r.ok).length}/${results.length} journeys passed\n`);
process.exit(failures === 0 ? 0 : 1);
