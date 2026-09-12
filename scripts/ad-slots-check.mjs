#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Device-container proof for the Adsterra slots (dev-only).
 *
 * Run against a build that was compiled with the dev-fixture placements
 * (see the env block in README §9.1), e.g.:
 *
 *   NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP=/ads-dev/desktop.js \
 *   NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE=/ads-dev/mobile.js \
 *   NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP=/ads-dev/socialbar-desktop.js \
 *   NEXT_PUBLIC_ADSTERRA_SOCIALBAR_MOBILE=/ads-dev/socialbar-mobile.js \
 *   NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP=/ads-dev/popunder-desktop.js \
 *   NEXT_PUBLIC_ADSTERRA_POPUNDER_MOBILE=/ads-dev/popunder-mobile.js \
 *   npm run build && npx next start -p 3001
 *
 *   node scripts/ad-slots-check.mjs        # expects BASE_URL=http://localhost:3001
 */
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';

// The fixture scripts live in scripts/fixtures (never shipped). `next start`
// snapshots public/ at boot, so copy them BEFORE starting the server:
//   cp -r scripts/fixtures/ads-dev public/ && npx next start -p 3001
// This guard only covers the dev-server case where they are already present.
const fixtureTarget = join(root, 'public', 'ads-dev');
const copiedFixtures = !existsSync(fixtureTarget);
if (copiedFixtures) {
  mkdirSync(fixtureTarget, { recursive: true });
  cpSync(join(root, 'scripts', 'fixtures', 'ads-dev'), fixtureTarget, { recursive: true });
  console.log('! fixtures copied – restart the server if it was already running');
}
const URL = `${BASE}/de/terminal`;

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});

const slotState = (page) =>
  page.evaluate(() => {
    const info = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { present: false, visible: false, ad: null };
      return {
        present: true,
        visible: el.offsetParent !== null,
        ad: el.querySelector('[data-fake-ad]')?.getAttribute('data-fake-ad') ?? null,
      };
    };
    return {
      desktop: info('[data-ad-slot="desktop"]'),
      mobile: info('[data-ad-slot="mobile"]'),
      socialbar: document.querySelector('[data-fake-ad^="socialbar"]')?.getAttribute('data-fake-ad') ?? null,
    };
  });

try {
  /* ------------------------------- desktop -------------------------------- */
  console.log('\n— desktop viewport (1440px) —');
  const page = await browser.newPage();
  const hydrationNoise = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/hydrat/i.test(text)) hydrationNoise.push(text.slice(0, 160));
  });
  page.on('pageerror', (err) => hydrationNoise.push(`pageerror: ${err.message.slice(0, 140)}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  let s = await slotState(page);
  check('desktop container visible', s.desktop.present && s.desktop.visible);
  check('desktop container holds the desktop placement', s.desktop.ad === 'native-desktop', String(s.desktop.ad));
  check('mobile container present but hidden', s.mobile.present && !s.mobile.visible);
  check('mobile placement NOT injected while hidden', s.mobile.ad === null, String(s.mobile.ad));
  check('desktop social bar anchored', s.socialbar === 'socialbar-desktop', String(s.socialbar));
  await page.screenshot({ path: join(artifacts, 'ads-desktop.png') });

  // popunder arms on the multi-chart gesture (desktop placement)
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '2x2')?.click();
  });
  await wait(1200);
  const pop = await page.evaluate(() => document.querySelector('[data-fake-ad^="popunder"]')?.getAttribute('data-fake-ad') ?? null);
  check('popunder arms with the desktop placement', pop === 'popunder-desktop', String(pop));

  // once per session: back to 1x1, re-arm gesture → still exactly ONE popunder
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '1x1')?.click();
  });
  await wait(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '2x2')?.click();
  });
  await wait(900);
  const popCount = await page.evaluate(() => ({
    scripts: document.querySelectorAll('script[src*="popunder"]').length,
    tags: document.querySelectorAll('[data-fake-ad^="popunder"]').length,
  }));
  const popFlag = await page.evaluate(() => sessionStorage.getItem('nc-popunder-fired'));
  check('popunder stays once-per-session (no duplicate injection)', popCount.scripts === 1 && popCount.tags === 1, JSON.stringify(popCount));
  check('popunder session flag persisted (timestamp)', popFlag !== null && /^\d{10,}$/.test(popFlag), String(popFlag));

  // hydration verdict only AFTER the ad scripts had their chance to misbehave
  await wait(1200);
  check('no hydration warnings / page errors with ad scripts active', hydrationNoise.length === 0, hydrationNoise[0] ?? '');

  // crossing the breakpoint lazy-loads the mobile placement into its slot
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await wait(2000);
  s = await slotState(page);
  check('after resize: mobile container visible', s.mobile.visible);
  check('after resize: mobile placement injected', s.mobile.ad === 'native-mobile', String(s.mobile.ad));
  check('after resize: desktop container hidden', !s.desktop.visible);
  await page.close();

  /* -------------------------------- mobile -------------------------------- */
  console.log('\n— mobile device (iPhone emulation) —');
  const mobile = await browser.newPage();
  await mobile.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(URL, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  const m = await slotState(mobile);
  check('mobile container visible', m.mobile.present && m.mobile.visible);
  check('mobile container holds the mobile placement', m.mobile.ad === 'native-mobile', String(m.mobile.ad));
  check('desktop container hidden', m.desktop.present && !m.desktop.visible);
  check('mobile social bar anchored', m.socialbar === 'socialbar-mobile', String(m.socialbar));
  await mobile.screenshot({ path: join(artifacts, 'ads-mobile.png') });
  await mobile.close();
} catch (error) {
  check(`ad-slot run completed (${error instanceof Error ? error.message : 'error'})`, false);
} finally {
  await browser.close();
  // NOTE: fixtures in public/ads-dev must be removed after the proof
  // (rm -rf public/ads-dev) – they are dev-only and must not ship.
  void copiedFixtures;
}

console.log(failures === 0 ? '\n✔ ad slots OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
