/**
 * Systematischer Monetization-Audit: Werbe- & Spenden-Flächen auf Funktion,
 * Darstellung, Überlappung und Verdeckung – über die System-Matrix
 * (Mobile 390, Tablet 768, Desktop 1440, Wide 1920).
 *
 * Lauf:  npm run qa:monetization   (Server auf :3000 erforderlich)
 * Shots: shots-matrix/<state>-<viewport>.png
 *
 * Doktrin (was „verdeckt" heißt):
 *  · PERMANENTE Flächen (Sponsored-Strip, Native-Banner-Box, Smartlink-CTAs,
 *    Social Bar, Whale-Ticker) dürfen kritische UI NIE verdecken:
 *    – In-Flow-Flächen: keine Rect-Überschneidung mit Kritischem.
 *    – Fixed Docks (Ticker/Social Bar): am Scroll-ENDE (max. Scroll) darf
 *      kein kritisches Rect unter ihnen liegen (Reserve-Paddings wirken).
 *  · TRANSIENTE Overlays (Offer-/Nudge-Toasts, <10 s, dismissbar) dürfen
 *    während ihrer Anzeige keine BUTTONS/LINKS/CTAs überdecken; die Chart-
 *    Fläche dürfen sie kurz streifen (Standard-Toast-UX, TradingView gleich).
 *  · Modals sind exklusiv (Backdrop) – dort gilt: eigene Controls klickbar,
 *    Panel im Viewport, fremde Ad-Overlays pausieren (body.nc-modal-open).
 *
 * Geprüfte Flächen: Native Banner (Header-Zone), Smartlink-CTAs, Sponsored-
 * Strip, Offer-Toasts, Social Bar (simuliert – Sandbox-Netz lässt die echte
 * Ad-Domain hängen), Whale-Ticker, SupportModal (?adwall=1), Milestone-Card
 * (Spenden-Pop-up via Visit-Seed), Toast-Stack-Position.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve('shots-matrix');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { id: 'mobile', width: 390, height: 844, mobile: true },
  { id: 'tablet', width: 768, height: 1024, mobile: true },
  { id: 'desktop', width: 1440, height: 900, mobile: false },
  { id: 'wide', width: 1920, height: 1080, mobile: false },
];

let pass = 0;
let fail = 0;
const t = (name, ok, info = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

/** Misst im Page-Kontext: `mode='top'` (Scroll oben) oder `'bottom'`. */
const AUDIT_FN = `((mode) => {
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = rect(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 4 && r.height > 4;
  };
  const inter = (a, b) => {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  };
  const tol = (a, b) => Math.min(a.width, b.width) * Math.min(a.height, b.height) * 0.02 + 4;

  const ticker = [...document.querySelectorAll('div')].find((d) =>
    d.className.includes?.('inset-x-0') && getComputedStyle(d).position === 'fixed' && d.className.includes('z-40'));
  const socialbar = document.querySelector('[data-nc-socialbar="1"], .audit-socialbar');
  const toasts = [...document.querySelectorAll('.nc-sl-toast, [class*="z-toast"] > div')].filter(visible);
  const bannerBox = document.getElementById('container-2cedab945cb896ea179b566a413d953b')?.parentElement;
  const strip = [...document.querySelectorAll('#sponsor-strip .nc-sl-strip-btn')];
  const ctas = [...document.querySelectorAll('a[data-smartlink]')];
  const modalPanel = document.querySelector('[role="dialog"]');

  const controls = [
    ...[...document.querySelectorAll('header a, header button')].slice(0, 8),
    ...[...document.querySelectorAll('.sticky button')].slice(0, 10),
    ...strip, ...ctas,
  ].filter((el) => el && visible(el));
  const canvases = [...document.querySelectorAll('canvas')].filter(visible);

  const docks = [
    ...(ticker && visible(ticker) ? [{ el: ticker, id: 'ticker' }] : []),
    ...(socialbar && visible(socialbar) && getComputedStyle(socialbar).visibility !== 'hidden'
      ? [{ el: socialbar, id: 'socialbar' }]
      : []),
  ];

  const out = {
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    dockOverlaps: [],
    controlOverlaps: [],
    blocked: [],
    offscreen: [],
    tickerBottom: ticker ? Math.round(innerHeight - rect(ticker).bottom) : null,
    toastCount: toasts.length,
    modalOpen: !!modalPanel,
    bannerVisible: bannerBox ? visible(bannerBox) : null,
  };

  if (mode === 'bottom') {
    // Fixed Docks: am Scroll-Ende darf NICHTS Kritisches unter ihnen liegen
    for (const d of docks) {
      for (const c of [...controls, ...canvases]) {
        const a = rect(d.el); const b = rect(c);
        if (inter(a, b) > tol(a, b)) {
          out.dockOverlaps.push(d.id + '×' + ((c.textContent || c.tagName).trim().slice(0, 16) || c.tagName));
        }
      }
    }
  } else {
    // Transiente Toasts: keine Buttons/Links/CTAs überdecken (Canvas ok)
    for (const toast of toasts) {
      for (const c of controls) {
        if (toast.contains(c) || c.contains(toast)) continue;
        const a = rect(toast); const b = rect(c);
        if (inter(a, b) > tol(a, b)) out.controlOverlaps.push('toast×' + ((c.textContent || c.tagName).trim().slice(0, 16)));
      }
    }
    // Click-Durchgriff auf Controls – Punkte unter Toasts/Docks überspringen
    // (transient bzw. Dock-UX), alles andere muss frei sein.
    for (const c of controls.slice(0, 24)) {
      const r = rect(c);
      const px = r.left + r.width / 2; const py = r.top + r.height / 2;
      const underOverlay = [...toasts, ...docks.map((d) => d.el)].some((o) => {
        const or = rect(o);
        return px >= or.left && px <= or.right && py >= or.top && py <= or.bottom;
      });
      if (underOverlay) continue;
      const top = document.elementFromPoint(px, py);
      if (top && !c.contains(top) && !top.contains(c) && !(c.parentElement && c.parentElement.contains(top))) {
        out.blocked.push(
          ((c.textContent || c.tagName).trim().slice(0, 14) + '<=' + top.tagName + '.' + String(top.className).slice(0, 28)),
        );
      }
    }
    for (const el of [...strip, ...ctas, ...toasts, ...(bannerBox && visible(bannerBox) ? [bannerBox] : [])]) {
      const r = rect(el);
      if (r.left < -2 || r.right > innerWidth + 2) out.offscreen.push((el.textContent || el.id || '').trim().slice(0, 20));
    }
  }
  return out;
})`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });

async function openPage(vp, url, { spoof = true, seed } = {}) {
  const ctx = await browser.createBrowserContext(); // isolierte Caps/Storage
  const page = await ctx.newPage();
  const origClose = page.close.bind(page);
  page.close = async () => {
    await origClose();
    await ctx.close().catch(() => {});
  };
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.mobile, hasTouch: vp.mobile });
  if (spoof) {
    await page.evaluateOnNewDocument((s) => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      if (s) { try { localStorage.setItem('nc-visits', s); } catch {} }
    }, seed ?? null);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return page;
}

const simulateSocialBar = (page, h = 64) =>
  page.evaluate((hh) => {
    const d = document.createElement('div');
    d.className = 'audit-socialbar';
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:' + hh + 'px;z-index:999999;background:#222;';
    d.dataset.ncSocialbar = '1';
    document.body.appendChild(d);
    document.documentElement.style.setProperty('--nc-socialbar-h', hh + 'px');
  }, h);

const audit = (page, mode) => page.evaluate(AUDIT_FN + `(${JSON.stringify(mode)})`);
const toBottom = async (page) => {
  // 'instant' – scroll-behavior:smooth würde sonst mitten in der Animation messen
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await new Promise((r) => setTimeout(r, 350));
};

for (const vp of VIEWPORTS) {
  console.log(`\n━━━ ${vp.id} (${vp.width}×${vp.height}) ━━━`);

  /* 1 — Landing: Banner-Zone + Smartlink-CTAs */
  let p = await openPage(vp, `${BASE}/de`);
  await new Promise((r) => setTimeout(r, 2500));
  let a = await audit(p, 'top');
  let ab = await (async () => { await toBottom(p); return audit(p, 'bottom'); })();
  t(`${vp.id} landing: kein Horizontal-Overflow`, !a.hOverflow);
  t(`${vp.id} landing: keine Control-Überlappung/Verdeckung`, a.controlOverlaps.length === 0 && a.blocked.length === 0, [...a.controlOverlaps, ...a.blocked].join(','));
  t(`${vp.id} landing: Docks verdecken nichts (Scroll-Ende)`, ab.dockOverlaps.length === 0, ab.dockOverlaps.join(','));
  t(`${vp.id} landing: CTAs/Banner im Viewport`, a.offscreen.length === 0, a.offscreen.join(','));
  await p.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: path.join(OUT, `landing-${vp.id}.png`) });
  await p.close();

  /* 2 — Terminal: Strip + Ticker + Offer-Toast */
  p = await openPage(vp, `${BASE}/de/terminal`);
  await p.waitForSelector('button', { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 3500));
  await p.evaluate(() => window.SmartlinksApp?.toast?.(undefined, 'audit'));
  await new Promise((r) => setTimeout(r, 800));
  a = await audit(p, 'top');
  t(`${vp.id} terminal: Offer-Toast erschienen`, a.toastCount >= 1);
  t(`${vp.id} terminal: kein Horizontal-Overflow`, !a.hOverflow);
  t(`${vp.id} terminal: Toast liegt auf keinem Control`, a.controlOverlaps.length === 0, a.controlOverlaps.join(','));
  t(`${vp.id} terminal: alles klickbar (nichts verdeckt)`, a.blocked.length === 0, a.blocked.join(','));
  await p.screenshot({ path: path.join(OUT, `terminal-toast-${vp.id}.png`) });
  await toBottom(p);
  ab = await audit(p, 'bottom');
  t(`${vp.id} terminal: Ticker-Dock verdeckt nichts am Scroll-Ende`, ab.dockOverlaps.length === 0, ab.dockOverlaps.join(','));
  await p.close();

  /* 3 — Terminal + simulierte Social Bar: Ticker-Lift & Dock-Reserve */
  p = await openPage(vp, `${BASE}/de/terminal`);
  await p.waitForSelector('button', { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 2500));
  await simulateSocialBar(p);
  await new Promise((r) => setTimeout(r, 1200));
  await p.evaluate(() => window.SmartlinksApp?.toast?.(undefined, 'audit2'));
  await new Promise((r) => setTimeout(r, 800));
  a = await audit(p, 'top');
  t(`${vp.id} terminal+socialbar: Ticker über der Bar`, a.tickerBottom !== null && a.tickerBottom >= 60, 'tickerBottom=' + a.tickerBottom);
  t(`${vp.id} terminal+socialbar: Toast auf keinem Control`, a.controlOverlaps.length === 0, a.controlOverlaps.join(','));
  t(`${vp.id} terminal+socialbar: kein Horizontal-Overflow`, !a.hOverflow);
  await toBottom(p);
  await new Promise((r) => setTimeout(r, 400));
  ab = await audit(p, 'bottom');
  t(`${vp.id} terminal+socialbar: Docks verdecken nichts am Scroll-Ende`, ab.dockOverlaps.length === 0, ab.dockOverlaps.join(','));
  await p.screenshot({ path: path.join(OUT, `terminal-socialbar-${vp.id}.png`) });
  await p.close();

  /* 4 — SupportModal (?adwall=1): Spenden-Pop-up Darstellung */
  p = await openPage(vp, `${BASE}/de/terminal?adwall=1`);
  await p.waitForSelector('[role="dialog"]', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  a = await audit(p, 'top');
  t(`${vp.id} adwall: Modal offen`, a.modalOpen);
  const modalFit = await p.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const r = panel.getBoundingClientRect();
    return r.left >= -2 && r.right <= innerWidth + 2 && r.height <= innerHeight + 2;
  });
  t(`${vp.id} adwall: Modal passt in Viewport`, modalFit);
  const modalClickable = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] a')].slice(0, 6);
    return btns.every((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && (b.contains(top) || top.contains(b));
    });
  });
  t(`${vp.id} adwall: alle Modal-Controls klickbar`, modalClickable);
  await p.screenshot({ path: path.join(OUT, `adwall-${vp.id}.png`) });
  await p.close();

  /* 5 — Milestone-Spenden-Card (Visit-Seed → 3. Besuch, 6 s Delay) */
  if (vp.id === 'mobile' || vp.id === 'desktop') {
    p = await openPage(vp, `${BASE}/de/terminal`, { seed: '2' });
    await p.waitForSelector('button', { timeout: 40000 });
    await new Promise((r) => setTimeout(r, 8000));
    const ms = await p.evaluate(() => !!document.querySelector('[role="dialog"]'));
    t(`${vp.id} milestone: Spenden-Card erscheint beim 3. Visit`, ms);
    if (ms) {
      const fit = await p.evaluate(() => {
        const panel = document.querySelector('[role="dialog"]');
        const r = panel.getBoundingClientRect();
        return r.right <= innerWidth + 2 && r.left >= -2;
      });
      t(`${vp.id} milestone: Card im Viewport`, fit);
      await p.screenshot({ path: path.join(OUT, `milestone-${vp.id}.png`) });
    }
    await p.close();
  }

  /* 6 — Help: Banner-Zone auf Inhaltsseite */
  if (vp.id === 'mobile' || vp.id === 'desktop') {
    p = await openPage(vp, `${BASE}/de/help`);
    await new Promise((r) => setTimeout(r, 2000));
    a = await audit(p, 'top');
    t(`${vp.id} help: kein Horizontal-Overflow`, !a.hOverflow);
    t(`${vp.id} help: keine Control-Überlappung/Verdeckung`, a.controlOverlaps.length === 0 && a.blocked.length === 0, [...a.controlOverlaps, ...a.blocked].join(','));
    await p.screenshot({ path: path.join(OUT, `help-${vp.id}.png`) });
    await p.close();
  }
}

await browser.close();
console.log(`\n${pass} PASS / ${fail} FAIL · Shots: shots-matrix/`);
process.exit(fail ? 1 : 0);
