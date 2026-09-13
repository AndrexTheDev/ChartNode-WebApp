// CWV-Check (SEO-Modul 6): LCP/CLS/TBT-Proxy + Ressourcen-Budget der Landing
// in Desktop- UND Mobile-Emulation. Headless-Swiftshader-Werte sind eine
// Regressionsschranke, keine Feld-CWV – Trends zählen, nicht Absolutwerte.
// Nutzung: node scripts/cwv-check.mjs   (Server auf :3000)
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
let fails = 0;
const check = (name, cond, info = '') => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${String(info).slice(0, 120)}` : ''}`);
};

const PROFILES = [
  ['desktop', { width: 1440, height: 900 }, { lcp: 3500, cls: 0.15, tbt: 900, preloads: 10 }],
  ['mobile', { width: 390, height: 844, isMobile: true, hasTouch: true }, { lcp: 6500, cls: 0.2, tbt: 1600, preloads: 10 }],
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const [name, viewport, limits] of PROFILES) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    window.__m = { lcp: 0, cls: 0, tbt: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__m.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__m.tbt += Math.max(0, e.duration - 50);
    }).observe({ type: 'longtask', buffered: true });
  });

  let requests = 0;
  let thirdPartyBeforeLoad = 0;
  const host = new URL(BASE).host;
  page.on('request', (req) => {
    requests += 1;
    try {
      if (new URL(req.url()).host !== host) thirdPartyBeforeLoad += 1;
    } catch {
      /* ignore */
    }
  });

  await page.goto(`${BASE}/de`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));
  const m = await page.evaluate(() => window.__m);
  const head = await page.evaluate(() => ({
    preloads: document.querySelectorAll('link[rel="preload"]').length,
    extCss: [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) => l.href.startsWith('http') && !l.href.includes(location.host)).length,
    fonts: document.querySelectorAll('link[rel="preload"][as="font"]').length,
  }));
  // Third-Party Zählung nur bis load: danach ist lazyOnload-Werbung erlaubt
  const tp = thirdPartyBeforeLoad;

  check(`${name}: LCP < ${limits.lcp} ms (Headless-Schranke)`, m.lcp < limits.lcp, `lcp=${Math.round(m.lcp)}`);
  check(`${name}: CLS < ${limits.cls}`, m.cls < limits.cls, `cls=${m.cls.toFixed(3)}`);
  check(`${name}: TBT-Proxy < ${limits.tbt} ms`, m.tbt < limits.tbt, `tbt=${Math.round(m.tbt)}`);
  check(`${name}: Font-Preloads ≤ ${limits.preloads}`, head.fonts <= limits.preloads, `fonts=${head.fonts} preloads=${head.preloads}`);
  check(`${name}: keine externe render-blockierende CSS`, head.extCss === 0, `extCss=${head.extCss}`);
  check(`${name}: keine Third-Party-Requests vor load (Ads=lazyOnload)`, tp === 0, `tp=${tp}`);
  console.log(`  info  ${name}: requests=${requests} lcp=${Math.round(m.lcp)}ms cls=${m.cls.toFixed(3)} tbt=${Math.round(m.tbt)}ms`);
  await page.close();
}

await browser.close();
console.log(`\n${fails === 0 ? '✔' : '✖'} cwv-check: ${fails === 0 ? 'Landing-CWV innerhalb der Regressionsschranken' : `${fails} Failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
