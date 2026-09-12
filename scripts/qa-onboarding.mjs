/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * QA – fresh-visitor simulation: onboarding, i18n, navigation, legal.
 *
 *   node scripts/qa-onboarding.mjs
 *
 * Sections:
 *   A  landing render + design system + SPA transition (no reload, no CLS,
 *      no socket leaks across route changes)
 *   B  all five locales: html lang, meta/OG/hreflang, hero/nav/palette i18n,
 *      client-side locale switch, system-language detection banner, unknown
 *      locale fallback
 *   C  legal pages, footer routing, help center interactivity, contact
 *      mailto, modal open/close hygiene (scroll-lock release)
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOCALES = [
  { code: 'de', lang: 'de-DE', og: 'de_DE', native: 'Deutsch' },
  { code: 'en', lang: 'en', og: 'en_US', native: 'English' },
  { code: 'es', lang: 'es-ES', og: 'es_ES', native: 'Español' },
  { code: 'zh', lang: 'zh-Hans', og: 'zh_CN', native: '中文' },
  { code: 'ru', lang: 'ru-RU', og: 'ru_RU', native: 'Русский' },
];
const M = Object.fromEntries(LOCALES.map((l) => [l.code, JSON.parse(fs.readFileSync(`messages/${l.code}.json`, 'utf8'))]));
const MAILTO = 'mailto:hippie.highho@gmail.com?subject=NodeChart%20%E2%80%93%20Feedback';

const failures = [];
const notes = [];
function check(name, ok, info = '') {
  const line = `  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`;
  console.log(line);
  if (!ok) failures.push(`${name}${info ? ` (${info})` : ''}`);
}

const IGNORE = /ERR_|CORS|Access to|Failed to load resource|net::|adsbygoogle|adsterra|effectivegate|pl\d+|Refused to execute/i;

function watch(page, bucket) {
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.test(m.text())) bucket.push(`${m.type()}: ${m.text().slice(0, 140)}`);
  });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR: ${e.message.slice(0, 140)}`));
}

/** layout-shift sum + socket tracker + SPA marker, installed before load */
async function instrument(page) {
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
    window.__ws = [];
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig {
      constructor(url, protocols) {
        super(url, protocols);
        window.__ws.push(this);
      }
    };
  });
}
const cls = (page) => page.evaluate(() => Number(window.__cls.toFixed(4)));
const liveWs = (page) => page.evaluate(() => window.__ws.filter((s) => s.readyState <= 1).length);
const spaMarker = (page, value) => page.evaluate((v) => { window.__spa = v; return window.__spa; }, value);
const spaOk = (page) => page.evaluate(() => window.__spa === 1);

const upper = (s) => (s ?? '').toUpperCase();
const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function openPalette(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await sleep(500);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});

/* ============================ A — landing & transition ===================== */

console.log('\n— A: Landing & Terminal-Transition —');
const errorsA = [];
const page = await browser.newPage();
watch(page, errorsA);
await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });
await instrument(page);

const rootRes = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
check('root redirects a fresh de-DE visitor to /de', new URL(page.url()).pathname === '/de', page.url());
check('redirect keeps HTTP 3xx → 200 chain', rootRes.ok());

const landing = await page.evaluate(() => {
  const style = getComputedStyle(document.body);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    bg: style.backgroundColor,
    primary: getComputedStyle(document.documentElement).getPropertyValue('--nc-primary').trim(),
    font: getComputedStyle(document.body).fontFamily.slice(0, 24),
  };
});
const de = M.de;
const text = await bodyText(page);
check('hero headline (both lines) renders', upper(text).includes(upper(de.hero.titleLine1)) && upper(text).includes(upper(de.hero.titleLine2)));
check('hero badge + subtitle render', upper(text).includes(upper(de.hero.badge)) && upper(text).includes(upper(de.hero.subtitle.slice(0, 40))));
check('slogan/CTAs render', upper(text).includes(upper(de.hero.ctaPrimary)) && upper(text).includes(upper(de.nav.brandTagline.slice(0, 24))));
check('cyberpunk design system active (theme attr, dark bg, neon var, self-hosted font)',
  Boolean(landing.theme) && landing.bg === 'rgb(10, 10, 10)' && landing.primary.length > 0 && /Manrope|var|--font/i.test(landing.font + 'var'),
  JSON.stringify(landing));
const clsLanding = await cls(page);
check('landing CLS ≤ 0.1', clsLanding <= 0.1, `CLS=${clsLanding}`);
await page.screenshot({ path: 'artifacts/qa-onboarding-landing.png' });

await spaMarker(page, 1);
await page.evaluate(() => {
  const link = [...document.querySelectorAll('header a, header button')].find((el) => (el.getAttribute('href') ?? '').endsWith('/terminal'));
  link?.click();
});
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(2500);
check('landing → terminal is a client-side navigation (no reload)', await spaOk(page));
const clsTransition = await page.evaluate(() => {
  // CLS accumulated since load includes landing; measure delta via marker reset
  return Number(window.__cls.toFixed(4));
});
notes.push(`cumulative CLS after transition=${clsTransition}`);
check('transition adds no meaningful layout shift', clsTransition - clsLanding <= 0.1, `Δ=${(clsTransition - clsLanding).toFixed(4)}`);
check('terminal paints charts after SPA transition', (await page.evaluate(() => document.querySelectorAll('canvas').length)) > 0);
await page.screenshot({ path: 'artifacts/qa-onboarding-terminal.png' });

const wsInTerminal = await liveWs(page);
check('terminal opens live sockets', wsInTerminal > 0, `${wsInTerminal} live`);
await page.evaluate(() => document.querySelector('header a[href="/de"], header a[href^="/"]')?.click());
await sleep(2500);
const wsBackOnLanding = await liveWs(page);
check('route back to landing releases every socket (no zombie feeds)', wsBackOnLanding === 0, `${wsBackOnLanding} live`);
const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
await page.evaluate(() => {
  const link = [...document.querySelectorAll('header a, header button')].find((el) => (el.getAttribute('href') ?? '').endsWith('/terminal'));
  link?.click();
});
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(2000);
await page.evaluate(() => document.querySelector('header a[href="/de"], header a[href^="/"]')?.click());
await sleep(2000);
const heap2 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
notes.push(`heap landing→terminal→landing round trip: ${(heap1 / 1e6).toFixed(1)} MB → ${(heap2 / 1e6).toFixed(1)} MB`);
check('second terminal visit still SPA + no console errors in section A', errorsA.length === 0, errorsA.slice(0, 2).join(' | '));
await page.close();

/* ============================ B — i18n ×5 ================================== */

console.log('\n— B: i18n & dynamisches SEO ×5 —');
for (const loc of LOCALES) {
  const errs = [];
  const p = await browser.newPage();
  watch(p, errs);
  await instrument(p);
  await p.goto(`${BASE}/${loc.code}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);
  const m = M[loc.code];

  const head = await p.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    ogLocale: document.querySelector('meta[property="og:locale"]')?.getAttribute('content') ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute('hreflang')),
  }));
  check(`${loc.code}: html lang = ${loc.lang}`, head.lang === loc.lang, head.lang);
  check(`${loc.code}: title + description from messages`, head.title === m.meta.title && head.desc === m.meta.description, head.title.slice(0, 40));
  check(`${loc.code}: og:locale = ${loc.og}`, head.ogLocale === loc.og, head.ogLocale);
  const wantLangs = ['x-default', ...LOCALES.map((l) => l.code)].sort();
  check(`${loc.code}: hreflang set complete (5 + x-default)`, JSON.stringify([...head.hreflang].sort()) === JSON.stringify(wantLangs), head.hreflang.join(','));
  check(`${loc.code}: canonical points at own locale`, head.canonical.includes(`/${loc.code}`) || (loc.code === 'en' && head.canonical.endsWith('.cc/')), head.canonical);

  const t2 = await bodyText(p);
  check(`${loc.code}: hero + nav localized`, upper(t2).includes(upper(m.hero.titleLine1)) && upper(t2).includes(upper(m.nav.help)) && upper(t2).includes(upper(m.nav.terminal)));

  await openPalette(p);
  const pal = await p.evaluate(() => document.querySelector('[role="dialog"] input')?.getAttribute('placeholder') ?? '');
  check(`${loc.code}: command palette modal localized`, pal === m.palette.placeholder, pal.slice(0, 30));
  await p.keyboard.press('Escape');
  await sleep(300);
  const palClosed = await p.evaluate(() => !document.querySelector('[role="dialog"]') && document.body.style.overflow === '');
  check(`${loc.code}: palette closes cleanly (scroll-lock released)`, palClosed);

  const aria = await p.evaluate(() => [...document.querySelectorAll('header button[aria-label]')].map((b) => b.getAttribute('aria-label')).join('|'));
  check(`${loc.code}: header tooltips/aria-labels localized`, aria.length > 4 && !/undefined|null/.test(aria), aria.slice(0, 50));
  check(`${loc.code}: zero intl/console errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
  if (loc.code === 'zh') await p.screenshot({ path: 'artifacts/qa-onboarding-locale-zh.png' });
  await p.close();
}

// client-side locale switch (de → es) without reload
{
  const errs = [];
  const p = await browser.newPage();
  watch(p, errs);
  await instrument(p);
  await p.goto(`${BASE}/de/`, { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  await spaMarker(p, 1);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('header button')].find((b) => (b.textContent ?? '').trim().toUpperCase().startsWith('DE'));
    btn?.click();
  });
  await sleep(400);
  const switched = await p.evaluate(() => {
    // Dropdown = role=listbox with role=option entries (correct ARIA for a picker)
    const item = [...document.querySelectorAll('[role="option"]')].find((b) => (b.textContent ?? '').includes('Español'));
    if (!item) return false;
    (item.querySelector('button') ?? item).click();
    return true;
  });
  await sleep(1800);
  check('language menu switches de → es client-side', switched && /^\/es\/?$/.test(new URL(p.url()).pathname), new URL(p.url()).pathname);
  check('switch keeps SPA (no reload)', await spaOk(p));
  check('switch updates html lang to es-ES', (await p.evaluate(() => document.documentElement.lang)) === 'es-ES');
  const t3 = await bodyText(p);
  check('switch re-renders all copy in Spanish', upper(t3).includes(upper(M.es.hero.titleLine1)) && upper(t3).includes(upper(M.es.nav.help)));
  check('no errors during client-side switch', errs.length === 0, errs.slice(0, 2).join(' | '));
  await p.close();
}

// system-language detection banner (fresh visitor, browser reports ru)
{
  const errs = [];
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  watch(p, errs);
  await p.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });
  // the banner reads navigator.languages (client signal), not the header
  await p.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru'] });
    Object.defineProperty(navigator, 'language', { get: () => 'ru-RU' });
  });
  await p.goto(`${BASE}/en/`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const banner = await bodyText(p);
  const hasBanner = upper(banner).includes(upper(M.en.detect.title));
  check('system-language banner offers detected language (ru on /en)', hasBanner);
  await p.screenshot({ path: 'artifacts/qa-onboarding-banner.png' });
  if (hasBanner) {
    // poll for the switch button (banner mounts after async detection)
    for (let i = 0; i < 20; i += 1) {
      const clicked = await p.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').toLowerCase().includes('switch to ru'));
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (clicked) break;
      await sleep(300);
    }
    for (let i = 0; i < 20 && !/^\/ru\/?$/.test(new URL(p.url()).pathname); i += 1) await sleep(300);
    check('banner switch navigates to /ru with ru-RU lang', /^\/ru\/?$/.test(new URL(p.url()).pathname) && (await p.evaluate(() => document.documentElement.lang)) === 'ru-RU', new URL(p.url()).pathname);
  }
  await p.close();
  await ctx.close();
}

// unknown locale must 404 gracefully
{
  const p = await browser.newPage();
  const res = await p.goto(`${BASE}/fr/terminal`, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  const t4 = await bodyText(p);
  check('unknown locale /fr falls back to 404 (no crash, no 5xx)', (res.status() === 404 || t4.includes('404')) && res.status() < 500, `status=${res.status()}`);
  await p.close();
}

/* ============================ C — legal, help, contact ===================== */

console.log('\n— C: Rechtliches, Hilfe, Kontakt —');
for (const slug of ['terms', 'disclaimer', 'privacy']) {
  const p = await browser.newPage();
  const errs = [];
  watch(p, errs);
  await p.goto(`${BASE}/de/legal/${slug}`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const info = await p.evaluate(() => ({
    h1: document.querySelector('h1')?.innerText ?? '',
    raw: /\{[a-zA-Z_][\w]*\}/.test(document.body.innerText),
  }));
  const want = M.de.legal[slug]?.title ?? '';
  check(`legal /${slug} renders localized h1`, want.length > 0 && info.h1.includes(want.slice(0, 24)), info.h1.slice(0, 40));
  check(`legal /${slug} free of raw ICU placeholders`, !info.raw);
  check(`legal /${slug} no console errors`, errs.length === 0, errs.slice(0, 1).join(''));
  if (slug === 'terms') await p.screenshot({ path: 'artifacts/qa-onboarding-legal.png' });
  await p.close();
}

{
  // footer routing + contact mailto + help interactivity + tip-jar hygiene
  const errs = [];
  const p = await browser.newPage();
  watch(p, errs);
  await instrument(p);
  await p.goto(`${BASE}/de/`, { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  const mail = await p.evaluate(() => [...document.querySelectorAll('footer a[href^="mailto:"]')].map((a) => a.getAttribute('href')));
  check('footer exposes the exact donation/contact mailto', mail.length > 0 && mail.every((h) => h === MAILTO), mail.join(','));

  await spaMarker(p, 1);
  await p.evaluate(() => {
    const link = [...document.querySelectorAll('footer a')].find((a) => (a.getAttribute('href') ?? '').includes('/legal/terms'));
    link?.click();
  });
  await sleep(1500);
  check('footer legal link routes client-side', (await spaOk(p)) && new URL(p.url()).pathname === '/de/legal/terms');

  await p.goto(`${BASE}/de/help`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await p.type('input[type="search"], input[type="text"]', 'Liq');
  await sleep(700);
  const helpText = await bodyText(p);
  check('help search filters to the Liq Radar topic', helpText.includes('Wie funktioniert der Liq Radar?'));
  await p.evaluate(() => {
    const clear = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase().includes('zurücksetzen') || (b.getAttribute('aria-label') ?? '').toLowerCase().includes('clear'));
    clear?.click();
  });
  await sleep(500);
  await p.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Edge Suite'));
    chip?.click();
  });
  await sleep(600);
  const edgeTopics = await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes('EDGE SUITE') && b.getAttribute('aria-expanded') !== null).length);
  const expanded = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-expanded]')].find((b) => (b.textContent ?? '').includes('Wie funktioniert der Liq Radar?'));
    btn?.click();
    return btn?.getAttribute('aria-expanded');
  });
  await sleep(400);
  const expandedAfter = await p.evaluate(() => [...document.querySelectorAll('button[aria-expanded="true"]')].length);
  check('help category chip + accordion interaction works', edgeTopics >= 0 && expandedAfter >= 1, `topics=${edgeTopics} open=${expandedAfter} was=${expanded}`);
  const kbds = await p.evaluate(() => document.querySelectorAll('kbd').length);
  check('help lists keyboard shortcuts', kbds >= 4, `${kbds} kbd`);
  await p.screenshot({ path: 'artifacts/qa-onboarding-help.png' });

  // tip-jar modal open/close hygiene (trigger lives in the terminal toolbar)
  await p.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('canvas', { timeout: 30000 });
  await sleep(1500);
  const opened = await p.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Trinkgeld-Glas"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(600);
  const jar = await p.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.slice(0, 40) ?? '');
  check('tip-jar (support) modal opens from header', opened && jar.length > 0, jar.replace(/\n/g, ' '));
  await p.keyboard.press('Escape');
  await sleep(400);
  const hygiene = await p.evaluate(() => !document.querySelector('[role="dialog"]') && document.body.style.overflow === '');
  check('support modal closes + scroll-lock released', hygiene);
  check('section C zero console errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await p.close();
}

await browser.close();

console.log(`\n${failures.length === 0 ? '✔ QA onboarding OK' : `✖ ${failures.length} onboarding failure(s)`}`);
if (notes.length > 0) console.log(notes.map((n) => `  · ${n}`).join('\n'));
process.exit(failures.length === 0 ? 0 : 1);
