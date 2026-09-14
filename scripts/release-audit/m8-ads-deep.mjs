// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 8 — AD-UNITS TIEFENPRÜFUNG: Native Banner 4:1 (Header-Zone, alle
// Seiten außer Terminal) + Smartlinks (Kit, Badges, echte Anker, Toasts,
// Cap 3/h, kein Click-Hijacking). Fill-Pfade per Request-Interception,
// No-Fill/Kollaps im Sandbox-Netz, CLS-Messung, Overlap-Rects, Console-Scan.
import { BASE, LOCALES, makeReporter, launchBrowser, newPage, attachConsole, gotoSafe, wait } from './lib.mjs';

export const META = { id: 'M8', name: 'Native Banner + Smartlinks (Tiefe)' };

const NB_CONTAINER = '#container-2cedab945cb896ea179b566a413d953b';
const SL_KEY_FRAG = 'ufhc3mt24s'; // fester Smartlink-Pfad aus config/Kit-Default

const nbState = (page) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel);
    const box = c?.closest('div[style], section, aside') || c;
    const r = c ? c.getBoundingClientRect() : null;
    const header = document.querySelector('header')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    return {
      present: !!c,
      filled: (c?.childElementCount || 0) > 0,
      h: r ? Math.round(r.height) : 0,
      betweenHeaderAndMain: !!(r && header && main && r.top >= header.bottom - 4 && r.bottom <= main.top + 4),
      mainTop: main ? Math.round(main.top) : null,
    };
  }, NB_CONTAINER);

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;
  const browser = await launchBrowser();

  /* ---------------- NB: Präsenz, Routing-Doktrin, Locales ---------------- */
  for (const route of ['/', '/help', '/legal/terms']) {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await gotoSafe(p, BASE + '/de' + (route === '/' ? '' : route));
    await wait(2000);
    const s = await nbState(p);
    check(`NB de${route}: Container in Header-Zone (zwischen Header & Main)`, s.present && s.betweenHeaderAndMain, JSON.stringify(s));
    const injected = await p.evaluate((frag) => performance.getEntriesByType('resource').filter((e) => e.name.includes(frag)).length, '2cedab945cb896ea179b566a413d953b/invoke.js');
    check(`NB de${route}: invoke.js-Loader angefordert`, injected >= 1, 'n=' + injected);
    check(`NB de${route}: Console sauber`, errs.length === 0, errs.slice(0, 1).join('|'));
    await p.close();
  }
  const pt = await newPage(browser);
  await gotoSafe(pt, BASE + '/de/terminal');
  await pt.waitForSelector('canvas', { timeout: 40000 });
  await wait(1500);
  check('NB Terminal: KEIN Native Banner (Strip-Doktrin)', !(await pt.evaluate((sel) => !!document.querySelector(sel), NB_CONTAINER)));
  await pt.close();
  for (const loc of LOCALES) {
    const p = await newPage(browser);
    await gotoSafe(p, BASE + '/' + loc);
    await wait(1200);
    check(`NB ${loc}/: Container präsent`, (await nbState(p)).present);
    await p.close();
  }

  /* ---------------- NB: No-Fill-Kollaps (Sandbox) ---------------- */
  {
    const p = await newPage(browser);
    await gotoSafe(p, BASE + '/de');
    await wait(1500);
    const early = await nbState(p);
    await wait(8000);
    const late = await nbState(p);
    check('NB No-Fill: reservierte Box kollabiert (~6 s)', early.present && (late.h === 0 || !late.present), `early h=${early.h} late h=${late.h}`);
    await p.close();
  }

  /* ---------------- NB: Fill-Pfad (Interception) + CLS + Overlaps -------- */
  {
    const p = await newPage(browser);
    await p.setRequestInterception(true);
    p.on('request', (req) => {
      const u = req.url();
      if (u.includes('2cedab945cb896ea179b566a413d953b/invoke.js') && req.resourceType() === 'script') {
        return req.respond({
          status: 200,
          contentType: 'application/javascript',
          body: "(function(){var c=document.getElementById('container-2cedab945cb896ea179b566a413d953b');if(!c)return;var d=document.createElement('div');d.style.cssText='width:100%;height:120px;background:#123;display:flex;align-items:center;justify-content:center';d.textContent='NATIVE 4:1 KREATIV';c.appendChild(d);})();",
        });
      }
      return req.continue();
    });
    await gotoSafe(p, BASE + '/de');
    await wait(1200);
    const before = await nbState(p);
    await wait(4000);
    const after = await nbState(p);
    check('NB Fill: Kreativ im Container, Box bleibt (kein Kollaps)', after.filled && after.h > 40, JSON.stringify(after));
    check('NB Fill: kein CLS (main-Top identisch)', before.mainTop === after.mainTop, `${before.mainTop} → ${after.mainTop}`);
    const overlap = await p.evaluate((sel) => {
      const c = document.querySelector(sel);
      const main = document.querySelector('main');
      if (!c || !main) return -1;
      const a = c.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      const x = Math.max(0, Math.min(a.right, m.right) - Math.max(a.left, m.left));
      const y = Math.max(0, Math.min(a.bottom, m.bottom) - Math.max(a.top, m.top));
      return Math.round(x * y);
    }, NB_CONTAINER);
    check('NB Fill: kein Overlap mit Main-Inhalt', overlap >= 0 && overlap <= 4, 'px²=' + overlap);
    await p.screenshot({ path: 'shots-matrix/nativebanner-fill-beweis.png' });
    await p.close();
  }

  /* ---------------- NB: Mobile ohne Overflow ---------------- */
  {
    const p = await newPage(browser, { width: 390, height: 844, mobile: true });
    await gotoSafe(p, BASE + '/de');
    await wait(1500);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('NB Mobile 390: kein Horizontal-Overflow', overflow <= 0, 'overflow=' + overflow);
    await wait(7000);
    const late = await nbState(p);
    check('NB Mobile: No-Fill-Kollaps greift auch mobil', late.h === 0 || !late.present, 'h=' + late.h);
    await p.close();
  }

  /* ---------------- SL: Kit-Globals, Badges, Anker ---------------- */
  for (const [url, glob] of [['/de', 'SmartlinksLanding'], ['/de/terminal', 'SmartlinksApp']]) {
    const p = await newPage(browser);
    const errs = [];
    attachConsole(p, errs);
    await gotoSafe(p, BASE + url);
    if (glob === 'SmartlinksApp') await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(3000);
    const kit = await p.evaluate((g) => ({
      api: typeof window[g] === 'object' && typeof window[g].open === 'function' && typeof window[g].remaining === 'function',
      remaining: window[g]?.remaining?.() ?? -1,
      css: !!document.querySelector('link[data-smartlink-css]'),
      hooks: document.querySelectorAll('[data-smartlink], [data-smartlink-card], #sponsor-strip a.nc-sl-strip-btn').length,
      badges: document.querySelectorAll('.nc-sl-badge').length,
      anchor: [...document.querySelectorAll('a[data-smartlink]')].map((a) => a.href).find((h) => h.includes('globalimmaturelunatic.com')) || null,
    }), glob);
    check(`SL ${url}: Kit-API ${glob} (open/remaining)`, kit.api === true, 'remaining=' + kit.remaining);
    check(`SL ${url}: CSS + Hooks + Badges gesetzt`, kit.css && kit.hooks > 0 && kit.badges > 0, JSON.stringify({ css: kit.css, hooks: kit.hooks, badges: kit.badges }));
    const stripAnchors = await p.evaluate((frag) => [...document.querySelectorAll('#sponsor-strip a.nc-sl-strip-btn')].map((a) => ({ href: a.href.includes(frag), rel: a.rel, target: a.target, badge: !!a.querySelector('.nc-sl-badge') })), SL_KEY_FRAG);
    if (url === '/de/terminal') {
      check('SL Terminal: Strip = echte Anker (href=Smartlink-URL, rel sponsored, target _blank, Badge)', stripAnchors.length >= 2 && stripAnchors.every((a) => a.href && /sponsored/.test(a.rel) && a.target === '_blank' && a.badge), JSON.stringify(stripAnchors.slice(0, 2)));
    } else {
      check(`SL ${url}: echte Anker auf feste Smartlink-URL`, kit.anchor === null || kit.anchor.includes(SL_KEY_FRAG), String(kit.anchor).slice(0, 60));
    }
    check(`SL ${url}: Console sauber`, errs.length === 0, errs.slice(0, 1).join('|'));

    /* Cap 3/h: open() ×4 ⇒ 4. blockiert, remaining 0 */
    const cap = await p.evaluate(() => {
      const g = window.SmartlinksLanding || window.SmartlinksApp;
      const orig = window.open;
      const opened = [];
      window.open = (...a) => { opened.push(a[0]); return { opener: null, closed: false }; };
      for (let i = 0; i < 4; i++) g.open(undefined, 'audit');
      window.open = orig;
      return { opened: opened.length, remaining: g.remaining() };
    });
    check(`SL ${url}: Cap 3/h (4. open blockiert, remaining 0)`, cap.opened <= 3 && cap.remaining === 0, JSON.stringify(cap));

    /* Kein Click-Hijacking: normaler Button-Klick öffnet nichts */
    const hijack = await p.evaluate(() => {
      const orig = window.open;
      const opened = [];
      window.open = (...a) => { opened.push(a[0]); return null; };
      const btn = [...document.querySelectorAll('button')].find((b) => /1H|DE|EN/i.test(b.textContent || ''));
      btn?.click();
      window.open = orig;
      return opened.length;
    });
    check(`SL ${url}: kein Click-Hijacking auf Normal-Buttons`, hijack === 0, 'opened=' + hijack);
    await p.close();
  }

  /* ---------------- SL: Post-Action-Toast nach ECHTER Aktion -------------- */
  {
    const p = await newPage(browser);
    await gotoSafe(p, BASE + '/de/terminal');
    await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(3000);
    // PNG-Export = echte Feature-Aktion; offerToast() kommt NACH ihr (Doktrin)
    const exported = await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /PNG export/i.test(b.getAttribute('aria-label') || ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await wait(1800);
    const toast = await p.evaluate(() => {
      const t = document.querySelector('.nc-sl-toast');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const ticker = [...document.querySelectorAll('div,aside')].find((e) => /WHALE-FLOW/.test(e.textContent || '') && getComputedStyle(e).position === 'fixed');
      const tr = ticker?.getBoundingClientRect();
      return {
        visible: r.height > 10,
        badge: !!t.querySelector('.nc-sl-badge'),
        anchor: !!t.querySelector('a[href*="globalimmaturelunatic.com"]'),
        intersectsTicker: tr ? !(r.bottom < tr.top || r.top > tr.bottom) : false,
      };
    });
    check('SL Terminal: Post-Action-Toast nach PNG-Export (Badge + Direkt-Anker)', exported && toast !== null && toast.visible && toast.badge && toast.anchor, JSON.stringify(toast));
    check('SL Terminal: Toast kollidiert nicht mit Whale-Ticker', toast === null || toast.intersectsTicker === false);
    // Cooldown: zweite Aktion binnen Intervall ⇒ kein zweiter Toast (Singleton)
    const second = await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /PNG export/i.test(b.getAttribute('aria-label') || ''));
      btn?.click();
      return new Promise((res) => setTimeout(() => res(document.querySelectorAll('.nc-sl-toast').length), 1500));
    });
    check('SL Terminal: Toast-Singleton/Cooldown (kein Spam)', second <= 1, 'n=' + second);
    await p.screenshot({ path: 'shots-matrix/smartlink-toast-beweis.png' });
    await p.close();
  }

  /* ---------------- SL: Strip-Klick zählt Fire + navigiert echt ----------- */
  {
    const p = await newPage(browser);
    const targets = [];
    p.browser().on('targetcreated', (t) => targets.push(t.url()));
    await gotoSafe(p, BASE + '/de/terminal');
    await p.waitForSelector('canvas', { timeout: 40000 });
    await wait(3000);
    const before = await p.evaluate(() => (window.SmartlinksApp?.remaining?.() ?? -1));
    await p.evaluate(() => document.querySelector('#sponsor-strip a.nc-sl-strip-btn')?.click());
    await wait(1500);
    const after = await p.evaluate(() => (window.SmartlinksApp?.remaining?.() ?? -1));
    check('SL Terminal: Strip-Klick öffnet echten Tab + zählt Fire (remaining -1)', before === 3 && after === 2 && targets.some((u) => u.includes(SL_KEY_FRAG)), 'before=' + before + ' after=' + after + ' targets=' + targets.length);
    await p.close();
  }

  await browser.close();
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
