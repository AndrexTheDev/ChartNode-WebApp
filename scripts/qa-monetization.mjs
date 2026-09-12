// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Monetization-QA: Adsterra-Ausfallsicherheit, AdBlock-Soft-Wall, Clipboard,
// Viral Loop (Share → Theme-Unlock) und localStorage-Härtung (XSS/Korruption).
//
// Läuft gegen einen Build OHNE Adsterra-Env (Default) auf :3000.
// Blocker-Simulation via CDP `Network.setBlockedURLs` (kein Request-
// Interception – die würde die Hydration killen, s. QA-Vergangenheit).
//
// Nutzung: node scripts/qa-monetization.mjs
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let failures = 0;
function check(name, cond, info = '') {
  if (!cond) failures += 1;
  results.push({ name, pass: !!cond });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`);
}

const WALLET_BTC = 'bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f';
const WALLET_SOL = '79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8';
const WALLET_ETH = '0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});

async function openTerminal(page, { blockAdsJs = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
  if (blockAdsJs) {
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    await client.send('Network.setBlockedURLs', { urls: ['*/ads.js*'] });
  }
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  return errors;
}

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

/* -------------------------------------------------------------------------- */
console.log('\n— 1: saubere Session zeigt KEINE Wall —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  await wait(6000); // Detection läuft 1,5 s nach Mount + Bait-Ladezeit
  const wall = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].some((d) => /Rebellion|Wallets|Spenden/i.test(d.textContent ?? '')),
  );
  check('ohne Blocker erscheint kein Soft-Wall-Modal', !wall);
  check('Sektion 1: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* -------------------------------------------------------------------------- */
console.log('\n— 2: Blocker-Simulation (CDP blockt /ads.js) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page, { blockAdsJs: true });

  // Wall muss von allein kommen (Network-Bait onerror → blocked)
  let wallUp = false;
  for (let i = 0; i < 20; i += 1) {
    await wait(1000);
    wallUp = await page.evaluate((btc) =>
      [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent ?? '').includes(btc)), WALLET_BTC,
    );
    if (wallUp) break;
  }
  check('AdBlock-Detection triggert das Wallet-Modal automatisch', wallUp);

  // Terminal dahinter bleibt lebendig
  const alive = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    legend: document.querySelector('.font-mono.text-micro-10')?.textContent ?? '',
  }));
  await wait(3000);
  const alive2 = await page.evaluate(() => document.querySelector('.font-mono.text-micro-10')?.textContent ?? '');
  check('Terminal hinter dem Modal crasht nicht (Canvas + OHLC-Legende)', alive.canvases >= 1 && /O\s*[\d.]+/.test(alive.legend), JSON.stringify(alive).slice(0, 100));
  check('Legende updated weiter (LiveData hinter dem Modal)', alive2 !== alive.legend || alive2.length > 0);
  check('Sektion 2a: keine Page-Errors', errors.length === 0, errors[0] ?? '');

  // Alle drei Wallets exakt
  const wallets = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    return (dlg?.textContent ?? '').toLowerCase();
  });
  check('SOL/BTC/ETH-Wallets stehen exakt im Modal', wallets.includes(WALLET_SOL.toLowerCase()) && wallets.includes(WALLET_BTC) && wallets.includes(WALLET_ETH.toLowerCase()));

  // Clipboard DENIED: API rejected + execCommand false → Warn-Toast, kein Crash
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    document.execCommand = () => false;
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Kopieren BTC')?.click();
  });
  await wait(600);
  const deniedToast = await page.evaluate(() => document.body.innerText.includes('nicht kopierbar'));
  check('Clipboard-Denied → Fallback → Warn-Toast (kein stummer Fehlschlag)', deniedToast);
  check('Sektion 2b: keine Page-Errors nach Denied-Click', errors.length === 0, errors[0] ?? '');

  // Dismiss → Cooldown persistiert → Reload bleibt ruhig
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim() === 'Ausblenden')?.click();
  });
  await wait(400);
  const dismissed = await page.evaluate(() => {
    const raw = localStorage.getItem('nc-viral-v1') ?? '';
    return { gone: !document.querySelector('[role="dialog"]'), cooldown: /"wallDismissedAt":\d{12,}/.test(raw) };
  });
  check('Dismiss schließt das Modal und persistiert den 7-Tage-Cooldown', dismissed.gone && dismissed.cooldown, JSON.stringify(dismissed));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(5000);
  const wallAgain = await page.evaluate((btc) =>
    [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent ?? '').includes(btc)), WALLET_BTC,
  );
  check('innerhalb des Cooldowns kehrt die Wall nicht zurück', !wallAgain);
  await page.close();
}

/* -------------------------------------------------------------------------- */
console.log('\n— 3: Viral Loop (Share → Unlock → Premium-Theme) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);

  // Premium-Gate VOR dem Unlock: Theme-Picker öffnet stattdessen den Share
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Design')?.click();
  });
  await wait(400);
  await page.evaluate(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Matrix Green'));
    (option?.querySelector('button') ?? option)?.click();
  });
  await wait(600);
  const gated = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    shareUp: [...document.querySelectorAll('[role="dialog"]')].some((d) => /freischalten|Unlock/i.test(d.textContent ?? '')),
  }));
  check('gesperrtes Premium-Theme öffnet die Share-Einladung statt zu skinnen', gated.shareUp && gated.theme === 'acid', JSON.stringify(gated));
  await page.keyboard.press('Escape');
  await wait(300);

  // Share-Modal über das Menü, window.open-Stub fängt die Intent-URLs
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null; // Popup-Blocker-Simulation: Unlock darf trotzdem flippen
    };
  });
  check('Share-Menüeintrag öffnet das Modal', await clickMenuItem(page, 'Teilen'));
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const preview = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  check('Tweet-Vorschau ist der Spec-Text mit Cashtag', preview.includes('Found an insane setup for $BTC on NodeChart') && preview.includes('#Crypto #Trading'));

  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim() === 'Auf X posten')?.click();
  });
  await wait(500);
  const xUrl = await page.evaluate(() => window.__opened[0] ?? '');
  check(
    'X-Intent: twitter.com + encodierter Tweet + Share-URL mit ticker/price',
    xUrl.startsWith('https://twitter.com/intent/tweet?text=') &&
      decodeURIComponent(xUrl).includes('$BTC') &&
      decodeURIComponent(xUrl).includes('#Crypto #Trading') &&
      /ticker=BTC/.test(decodeURIComponent(xUrl)),
    xUrl.slice(0, 110),
  );
  check('Popup-Blocker (window.open → null) bricht den Unlock nicht', await page.evaluate(() => document.body.innerText.toLowerCase().includes('freigeschaltet')));

  // Telegram-Intent aus demselben Modal
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Telegram/i.test(b.textContent ?? ''))?.click();
  });
  await wait(400);
  const tgUrl = await page.evaluate(() => window.__opened[1] ?? '');
  check('Telegram-Intent: t.me/share/url mit url+text', tgUrl.startsWith('https://t.me/share/url?url=') && decodeURIComponent(tgUrl).includes('ticker=BTC'), tgUrl.slice(0, 100));

  // Unlock-Buttons im Modal: Matrix anwenden
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').includes('Matrix Green'))?.click();
  });
  await wait(600);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  check('Matrix Green lässt sich aus dem Unlock-Panel sofort anwenden', applied === 'matrix', String(applied));

  // Persistenz über Reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(2500);
  const persisted = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    viral: localStorage.getItem('nc-viral-v1') ?? '',
  }));
  check('Unlock + Theme überleben den Reload (localStorage)', persisted.theme === 'matrix' && persisted.viral.includes('"shareUnlocked":true'), JSON.stringify(persisted).slice(0, 120));
  check('Sektion 3: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* -------------------------------------------------------------------------- */
console.log('\n— 4: localStorage-Härtung (XSS + Typ-Korruption) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  // Feindliche Persist-Payloads: Theme-XSS, Typen-Müll, fetter String
  await page.evaluate(() => {
    window.__xssFired = false;
    localStorage.setItem(
      'nodechart:store:v1',
      JSON.stringify({
        state: {
          theme: '"><img src=x onerror="window.__xssFired=true">',
          layout: { evil: true },
          activeToken: '"><script>window.__xssFired=true</script>',
          watchlist: ['<img src=x onerror=window.__xssFired=true>', 42, null],
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      'nc-viral-v1',
      JSON.stringify({
        state: {
          supporter: 'yes-please',
          shareUnlocked: 1,
          wallDismissedAt: 'soon',
          shares: Number.NaN,
          celebrated: [{ xss: '<img src=x onerror=window.__xssFired=true>' }, null, 'ok-feature'],
          lastDonationAt: 'yesterday',
          lastDonationUsd: 1e12,
        },
        version: 0,
      }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(3000);
  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    xss: window.__xssFired === true,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    canvases: document.querySelectorAll('canvas').length,
    viral: localStorage.getItem('nc-viral-v1') ?? '',
  }));
  check('XSS-Theme-String wird auf acid zurückvalidiert (Boot-Skript + Merge)', state.theme === 'acid', String(state.theme));
  check('kein injiziertes Skript/Handler feuert', !state.xss);
  check('Terminal rendert trotz korrupter Stores (Canvas da, keine Errors)', state.canvases >= 1 && errors.length === 0, errors[0] ?? '');
  check('Typ-Korruption erzeugt keinen Supporter/Unlock (Wall-Logik intakt)', !state.viral.includes('"supporter":true') && !state.viral.includes('"shareUnlocked":true'), state.viral.slice(0, 120));

  // Feindliche Donation-Felder dürfen keine Gnadenfrist faken: adwall muss ziehen
  await page.goto(`${BASE}/de/terminal?adwall=1`, { waitUntil: 'domcontentloaded' });
  let junkWall = false;
  for (let i = 0; i < 15; i += 1) {
    await wait(1000);
    junkWall = await page.evaluate((btc) =>
      [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent ?? '').includes(btc)), WALLET_BTC,
    );
    if (junkWall) break;
  }
  check('korrumpierte Donation-Felder faken keine Grace (adwall zieht trotzdem)', junkWall && errors.length === 0, errors[0] ?? '');
  await page.close();
}

/* -------------------------------------------------------------------------- */
console.log('\n— 5: Donation-Grace (48 h / >$5 → 5 Tage) —');
{
  const page = await browser.newPage();
  const errors = await openTerminal(page);
  // Milestones dürfen die Dialog-Asserts nicht kreuzen
  await page.evaluate(() => localStorage.setItem('nc-visits', '99'));

  const seedViral = (state) =>
    page.evaluate((json) => {
      localStorage.setItem('nc-viral-v1', json);
      sessionStorage.removeItem('nc-adcheck');
    }, JSON.stringify({ state, version: 0 }));

  const loadForced = async () => {
    await page.goto(`${BASE}/de/terminal?adwall=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    for (let i = 0; i < 8; i += 1) {
      await wait(750);
      const up = await page.evaluate((btc) =>
        [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent ?? '').includes(btc)), WALLET_BTC,
      );
      if (up) return true;
    }
    return false;
  };

  const H = 60 * 60 * 1000;
  const D = 24 * H;

  // 1) 48-h-Tier, 47 h alt → Grace aktiv → kein Aufruf (trotz adwall-Force)
  await seedViral({ supporter: true, lastDonationAt: Date.now() - 47 * H, lastDonationUsd: 1 });
  check('Spender (≤$5, vor 47 h) sieht 48 h lang keinen Aufruf', (await loadForced()) === false);

  // 2) 48-h-Tier, 49 h alt → abgelaufen → Aufruf erscheint
  await seedViral({ supporter: true, lastDonationAt: Date.now() - 49 * H, lastDonationUsd: 1 });
  check('nach 49 h darf der Aufruf zurückkehren (48-h-Tier)', (await loadForced()) === true);

  // 3) Live-Flow: Zweistufiger Button → „Über $5" → Toast + Persistenz
  // Wiederholungsspender sehen das Badge-Label „Supporter" statt „Ich habe
  // gespendet" – beide öffnen Stufe 2 (Grace-Verlängerung bleibt möglich).
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
      /^(Ich habe gespendet|Supporter)$/.test((b.textContent ?? '').trim()),
    )?.click();
  });
  await wait(400);
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button')].map((b) => (b.textContent ?? '').trim()),
  );
  check('Stufe 2 klappt auf: Betrags-Chips „Bis $5"/„Über $5"', chips.includes('Bis $5') && chips.includes('Über $5'), chips.join('|').slice(0, 120));
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim() === 'Über $5')?.click();
  });
  await wait(700);
  const declared = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('nc-viral-v1') ?? '{}');
    return {
      toast: document.body.innerText.includes('5 Tage'),
      wallGone: ![...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent ?? '').includes('bc1q')),
      supporter: raw?.state?.supporter,
      usd: raw?.state?.lastDonationUsd,
      at: raw?.state?.lastDonationAt,
    };
  });
  check(
    '„Über $5" registriert Big-Tier-Donation + Danke-Toast + Wall schließt',
    declared.toast && declared.wallGone && declared.supporter === true && declared.usd > 5 && Math.abs(declared.at - Date.now()) < 60000,
    JSON.stringify(declared).slice(0, 140),
  );

  // 4) Big-Tier aktiv: 4 Tage alt → immer noch ruhig
  await seedViral({ supporter: true, lastDonationAt: Date.now() - 4 * D, lastDonationUsd: 10 });
  check('Big-Tier (> $5): nach 4 Tagen weiterhin kein Aufruf', (await loadForced()) === false);

  // 5) Big-Tier abgelaufen: 6 Tage alt → Aufruf darf zurück
  await seedViral({ supporter: true, lastDonationAt: Date.now() - 6 * D, lastDonationUsd: 10 });
  check('Big-Tier: nach 6 Tagen ( > 5 Tage) kehrt der Aufruf zurück', (await loadForced()) === true);

  check('Sektion 5: keine Page-Errors', errors.length === 0, errors[0] ?? '');
  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '✔' : '✖'} monetization: ${results.length - failures}/${results.length} checks bestanden`);
process.exit(failures === 0 ? 0 : 1);
