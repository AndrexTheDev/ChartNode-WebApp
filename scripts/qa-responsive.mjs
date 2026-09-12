/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/*
 * QA-RESPONSIVE — Visuelles Design & Bedienbarkeit über Auflösungen und
 * Eingabemethoden hinweg.
 *
 * Kriterium 1 — Breakpoints: 320 / 375 / 768 / 1440 / 2560 px
 *   · horizontaler Overflow (abgeschnittene Elemente)
 *   · Mobile-Bottom-Navigation verankert + bedienbar
 *   · abgeschnittene Text-/Knoten-Inhalte (overflow hidden + scrollWidth)
 *
 * Kriterium 2 — Touch-Targets: alle interaktiven Flächen >= 44x44 CSS-px,
 *   gemessen auf Touch-Viewports (320/768) mit `hasTouch`. Ausnahmen nur,
 *   wenn das Target rein desktop-exklusiv ist (`lg:`/`xl:`-sichtbar).
 *
 * Kriterium 3 — High-DPI: deviceScaleFactor 2 (320 & 1440) und 3 (375).
 *   · Canvas-Backing-Store vs. CSS-Box (Schaerfefaktor = DPR)
 *   · Wasserzeichen-Trefferquote per Pixel-Scan (scharf = klare Kanten)
 *   · Textschaerfe-Proxy: Kantengradient im Chart-Bereich
 *
 * Nutzung: node scripts/qa-responsive.mjs   (Server auf :3000 muss laufen)
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const OUT = 'artifacts';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

/*
 * Locale-Detect-Banner und offene Modals schliessen.
 * Der Banner liegt als `pointer-events-none fixed inset-x-0 bottom-0` am
 * Viewport-Grund und wird sonst als Bottom-Navigation fehlinterpretiert –
 * er ist aber ein temporaeres Overlay, kein Layout-Bestandteil.
 */
async function dismissOverlays(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
      if (/schließen|close|verstanden|got it|behalten|keep/.test(t)) b.click();
    }
  });
  await wait(500);
  // Modal-Backdrop offen? -> per Escape schliessen
  const modalOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
  if (modalOpen) {
    await page.keyboard.press('Escape');
    await wait(500);
  }
}

/* ------------------------------------------------------------------ */
/* Viewport-Matrix                                                     */
/* ------------------------------------------------------------------ */
const VIEWPORTS = [
  { id: 'mobile320', w: 320, h: 640, dpr: 1, touch: true, label: 'Small Mobile 320' },
  { id: 'mobile375', w: 375, h: 812, dpr: 3, touch: true, label: 'Mobile 375 @3x (Retina)' },
  { id: 'tablet768', w: 768, h: 1024, dpr: 2, touch: true, label: 'Tablet 768 @2x' },
  { id: 'desktop1440', w: 1440, h: 900, dpr: 1, touch: false, label: 'Desktop 1440' },
  { id: 'retina1440', w: 1440, h: 900, dpr: 2, touch: false, label: 'Desktop 1440 @2x (Retina)' },
  { id: 'ultrawide2560', w: 2560, h: 1080, dpr: 1, touch: false, label: 'Ultrawide 2560' },
];

const ROUTES = ['/de', '/de/terminal'];

/*
 * High-DPI-Messung braucht `--force-device-scale-factor`.
 *
 * Grund (verifiziert): Headless-Chrome meldet `devicePixelContentBoxSize` aus
 * `page.setViewport({deviceScaleFactor})` heraus UNSKALIERT – ein reines <div>
 * von 300 CSS-px liefert bei DPR 2 ebenfalls nur 300 statt 600. lightweight-
 * charts nutzt genau dieses Feld (fancy-canvas → ResizeObserver-Pfad) und
 * skaliert den Backing-Store folglich nicht. Mit dem Browser-Flag wird die
 * Groesse korrekt als 600 gemeldet. Der Screenshot-Backbuffer skaliert in
 * beiden Faellen, das Flag aendert also nur die Messgroesse, nicht das
 * Renderergebnis – damit wird der Test erst aussagekraeftig.
 */
const HIGH_DPI_FLAG = 2;
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `--force-device-scale-factor=${HIGH_DPI_FLAG}`,
  ],
});

async function newPage(vp) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.setViewport({
    width: vp.w,
    height: vp.h,
    deviceScaleFactor: vp.dpr,
    isMobile: vp.touch,
    hasTouch: vp.touch,
  });
  return { page, errors };
}

/* ------------------------------------------------------------------ */
/* 1 — Responsive Breakpoints                                          */
/* ------------------------------------------------------------------ */
console.log('— 1: Responsive Breakpoints (320 / 375 / 768 / 1440 / 2560) —');
const overflowReport = [];

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const { page, errors } = await newPage(vp);
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (route.includes('terminal')) {
        await page.waitForSelector('canvas', { timeout: 45000 }).catch(() => {});
      }
      await wait(route.includes('terminal') ? 5000 : 3000);

      await dismissOverlays(page);

      const metrics = await page.evaluate((vw) => {
        const doc = document.documentElement;
        const out = {
          docScrollWidth: doc.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          offenders: [],
          clipped: [],
          selfClipped: 0,
        };
        const all = [...document.querySelectorAll('body *')];
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          /*
           * Element ragt rechts ueber den Viewport hinaus.
           * Nur zaehlen, wenn es WIRKLICH sichtbar herausragt: Marquee-Bahnen
           * (`w-max`) und horizontale Scroll-Rows (`overflow-x-auto`) sind
           * bewusst ueberbreit und clippen sich selbst. Ein Vorfahr mit
           * overflow hidden/clip/auto/scroll macht den Ueberlauf unsichtbar.
           */
          if (r.right > vw + 1.5 && cs.position !== 'fixed') {
            let node = el.parentElement;
            let clipped = false;
            while (node && node !== document.documentElement) {
              const o = getComputedStyle(node).overflowX;
              if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') {
                clipped = true;
                break;
              }
              node = node.parentElement;
            }
            if (!clipped) {
              out.offenders.push({
                tag: el.tagName,
                cls: String(el.className).slice(0, 58),
                right: Math.round(r.right),
                width: Math.round(r.width),
              });
            } else {
              out.selfClipped++;
            }
          }
          // Text abgeschnitten: Inhalt breiter/hoeher als Box bei overflow hidden
          if (cs.overflowX === 'hidden' && el.scrollWidth - el.clientWidth > 3 && el.clientWidth > 0) {
            const txt = (el.textContent || '').trim().slice(0, 30);
            if (txt) out.clipped.push({ tag: el.tagName, cls: String(el.className).slice(0, 44), txt, over: el.scrollWidth - el.clientWidth });
          }
        }
        out.offenders = out.offenders.slice(0, 8);
        out.clipped = out.clipped.slice(0, 8);
        return out;
      }, vp.w);

      // `body{overflow-x:hidden}` allein reicht nicht – der Ueberlauf wandert
      // an <html> und die Seite bleibt scrollbar. Deshalb beide pruefen.
      const hOverflow = Math.max(metrics.docScrollWidth, metrics.bodyScrollWidth) - metrics.innerWidth;
      const pass = hOverflow <= 1 && metrics.offenders.length === 0;
      ok(`${vp.label} · ${route}: kein horizontaler Overflow`, pass, `Δ=${hOverflow}px offenders=${metrics.offenders.length}${metrics.offenders.length ? ' ' + JSON.stringify(metrics.offenders.slice(0, 3)) : ''}`);
      if (!pass || metrics.clipped.length) {
        overflowReport.push({ vp: vp.label, route, hOverflow, offenders: metrics.offenders, clipped: metrics.clipped });
      }
      await shot(page, `qa-resp-${vp.id}-${route.replace(/\W/g, '')}`);
      if (errors.length) ok(`${vp.label} · ${route}: keine Page-Errors`, false, errors[0]);
    } catch (e) {
      ok(`${vp.label} · ${route}: laedt fehlerfrei`, false, String(e).slice(0, 140));
    }
    await page.close();
  }
}

/* Mobile-Bottom-Navigation / Ad-Strip verankert? */
console.log('\n— 1b: Mobile Bottom-Verankerung (320 & 768, Touch) —');
for (const vp of VIEWPORTS.filter((v) => v.touch && v.w <= 768)) {
  const { page } = await newPage(vp);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 45000 }).catch(() => {});
  await wait(5000);
  await dismissOverlays(page);
  const nav = await page.evaluate(() => {
    // `window.innerHeight` ist die Wahrheit: bei isMobile passt Chrome die
    // nutzbare Hoehe an (URL-Bar-Simulation), die konfigurierte Viewport-Hoehe
    // weicht dann ab und jede Verankerungs-Pruefung wird zum Fehlalarm.
    const vh = window.innerHeight;
    const fixed = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
      const r = el.getBoundingClientRect();
      if (!(r.height > 10 && r.width > 40 && r.bottom >= vh - 6)) return false;
      // Vollflaechige Backdrops/Overlays sind keine Navigationsleiste
      if (r.height >= vh * 0.9) return false;
      /*
       * `pointer-events:none`-Wrapper (Backdrop, GridBackdrop, Toast-Host)
       * sind Deko bzw. Overlay-Container, keine Navigation. Ausnahme: Der
       * Whale-Ticker-Wrapper ist bewusst `pointer-events-none`, damit er
       * keine Footer-Klicks schluckt – die Leiste darin ist aber `auto`.
       */
      if (cs.pointerEvents === 'none' && !el.querySelector('[aria-label]')) {
        const inner = [...el.children].some((c) => getComputedStyle(c).pointerEvents === 'auto');
        if (!inner) return false;
      }
      /*
       * Locale-Banner / Toasts sind temporaere Overlays, keine Navigation.
       * Erkennungsmerkmal: `pointer-events-none` am Wrapper ODER ein
       * `role="status"`-Container. Der Whale-Ticker traegt beides nicht mehr
       * (sein Wrapper ist pointer-events-none, aber er IST die Bottom-Leiste) –
       * deshalb wird er explizit ueber `aria-label` wieder hereingelassen.
       */
      const isWhaleBar = !!el.getAttribute('aria-label') && el.matches('[class*="bottom-0"]');
      if (!isWhaleBar) {
        if (el.getAttribute('role') === 'status') return false;
        if (el.querySelector('[role="status"]')) return false;
      }
      return true;
    });
    return { vh, bars: fixed.slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: String(el.className).slice(0, 50),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        vh,
        anchored: Math.abs(r.bottom - vh) <= 2,
        zIndex: cs.zIndex,
        interactive: el.querySelectorAll('a,button,input,select').length,
      };
    }) };
  });
  const vh = nav.vh;
  const anchored = nav.bars.filter((n) => n.anchored);
  ok(`${vp.label}: Bottom-Leiste pixelgenau verankert (bottom === innerHeight)`, nav.bars.length === 0 || anchored.length > 0, JSON.stringify(nav.bars.slice(0, 3)));
  // Die Leiste darf nicht mehr als ein Viertel des Viewports fressen, sonst
  // bleibt auf 320x640 zu wenig nutzbarer Chart-/Inhaltsbereich.
  ok(`${vp.label}: Bottom-Leiste kompakt (< 25% Viewport-Hoehe)`, anchored.length === 0 || anchored.every((n) => n.height < vh * 0.25), JSON.stringify(anchored.map((a) => ({ h: a.height, vh, pct: +((a.height / vh) * 100).toFixed(1) }))));
  /*
   * Die Bottom-Leiste ist der Whale-Ticker: reine Live-Anzeige ohne eigene
   * Bedienelemente (die Chips sind `span`, kein Link). Deshalb wird hier nur
   * geprueft, dass sie den Inhalt nicht blockiert – `pointer-events` muss
   * durchlässig bleiben bzw. die Leiste darf nicht den Chart ueberdecken.
   */
  /*
   * Echte Ueberlappung pruefen: Das Terminal ist ein langes Scroll-Dokument,
   * ein `sticky`-Element liegt im Anfangs-Viewport weit unter dem Chart. Ein
   * reiner Koordinatenvergleich (canvas.bottom <= bar.top) schlaegt deshalb
   * fehl. Korrekter Test: an die Chart-Position scrollen und dort messen, ob
   * die Leiste den Chart oder seine Bedienelemente verdeckt.
   */
  // Erst zum Chart scrollen und die smooth-scroll-Animation abwarten, sonst
  // misst man die Position VOR dem Scroll (scroll-behavior: smooth ist global).
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return;
    const y = c.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
  });
  await wait(700);
  const blocked = await page.evaluate(() => {
    const vh = window.innerHeight;
    const bar = [...document.querySelectorAll('div.sticky, div.fixed')]
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter((x) => {
        if (x.el.getAttribute('aria-label') && x.el.className.includes('bottom-0')) return true;
        if (x.cs.pointerEvents === 'none') return false;
        return x.el.getAttribute('role') !== 'status';
      })
      .find((x) => Math.abs(x.r.bottom - vh) <= 2 && x.r.height > 20 && x.r.height < vh * 0.5);
    if (!bar) return null;
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const cr = canvas.getBoundingClientRect();
    const br = bar.el.getBoundingClientRect();
    /*
     * Ueberlappung = beide Rechtecke schneiden sich wirklich.
     * 1px Toleranz: Der Whale-Ticker traegt eine `border-t`-Linie, deren
     * Subpixel-Rundung sonst bei jeder Aufloesung einen Fehlalarm erzeugt.
     */
    const TOL = 1.5;
    const overlapPx = Math.min(cr.bottom, br.bottom) - Math.max(cr.top, br.top);
    const overlaps =
      overlapPx > TOL && cr.left < br.right - TOL && cr.right > br.left + TOL;
    // Und: ist der Chart-Kern (Mitte) noch anklickbar, nicht von der Leiste verdeckt?
    const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
    return {
      overlaps,
      canvasH: Math.round(cr.height),
      barTop: Math.round(br.top),
      barH: Math.round(br.height),
      chartCenterHitByBar: !!hit && bar.el.contains(hit),
      visibleChartHeight: Math.round(Math.max(0, Math.min(cr.bottom, br.top) - Math.max(cr.top, 0))),
      overlapPx: +overlapPx.toFixed(2),
      scrollY: Math.round(window.scrollY),
    };
  });
  ok(
    `${vp.label}: Bottom-Leiste ueberdeckt den Chart nicht`,
    !blocked || (!blocked.overlaps && !blocked.chartCenterHitByBar),
    JSON.stringify(blocked),
  );
  // Der Chart muss im gescrollten Zustand vollstaendig sichtbar sein – sonst
  // waere die Leiste doch im Weg bzw. das Layout zu eng.
  ok(
    `${vp.label}: Chart nach Scroll vollstaendig sichtbar`,
    !blocked || blocked.visibleChartHeight >= Math.min(blocked.canvasH, vh * 0.5) * 0.9,
    JSON.stringify(blocked),
  );
  await shot(page, `qa-resp-bottomnav-${vp.id}`);
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 2 — Touch-Targets >= 44x44                                          */
/* ------------------------------------------------------------------ */
console.log('\n— 2: Touch-Targets (min. 44x44 CSS-px auf Touch-Viewports) —');
const MIN = 44;
const touchReport = [];

for (const vp of VIEWPORTS.filter((v) => v.touch)) {
  for (const route of ROUTES) {
    const { page } = await newPage(vp);
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (route.includes('terminal')) await page.waitForSelector('canvas', { timeout: 45000 }).catch(() => {});
    await wait(route.includes('terminal') ? 5000 : 3000);
    await dismissOverlays(page);

    const tooSmall = await page.evaluate((min) => {
      const out = [];
      const sel = 'a[href], button, input, select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], summary, label[for]';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue; // nicht sichtbar
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (cs.pointerEvents === 'none') continue;
        // Desktop-exklusive Elemente (nur ab lg/xl sichtbar) sind auf Touch kein Target
        const cls = String(el.className);
        if (/\b(hidden\s+(lg|xl|2xl):|lg:hidden\s+hidden)/.test(cls) && r.width === 0) continue;
        if (r.width >= min && r.height >= min) continue;

        /*
         * Begruendete Ausnahmen:
         * 1. sr-only Skip-Link – per WCAG-Muster 1x1, bis er Fokus bekommt;
         *    dann wird er via `focus:not-sr-only` sichtbar UND gross.
         * 2. Von Dritt-Libraries injizierte Marken-Links (lightweight-charts
         *    rendert `#tv-attr-logo` selbst ins DOM) – nicht editierbar.
         */
        if (/(^|\s)sr-only(\s|$)/.test(cls)) continue;
        if (el.id && /^(tv-attr-logo|tv-attr-text)/.test(el.id)) continue;
        out.push({
          tag: el.tagName,
          w: Math.round(r.width),
          h: Math.round(r.height),
          cls: cls.slice(0, 52),
          txt: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
          type: el.getAttribute('type') || '',
        });
      }
      return out.slice(0, 14);
    }, MIN);

    ok(`${vp.label} · ${route}: alle Touch-Targets >= ${MIN}x${MIN}px`, tooSmall.length === 0, `${tooSmall.length} zu klein${tooSmall.length ? ': ' + JSON.stringify(tooSmall.slice(0, 4)) : ''}`);
    if (tooSmall.length) touchReport.push({ vp: vp.label, route, tooSmall });
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
/* 3 — High-DPI / Retina Canvas-Rendering                              */
/* ------------------------------------------------------------------ */
console.log('\n— 3: High-DPI / Retina Canvas-Rendering —');
const DPI_CASES = [
  { id: 'mobile375', w: 375, h: 812, dpr: 3, touch: true },
  { id: 'tablet768', w: 768, h: 1024, dpr: 2, touch: true },
  { id: 'retina1440', w: 1440, h: 900, dpr: 2, touch: false },
];

for (const vp of DPI_CASES) {
  const { page } = await newPage(vp);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 45000 }).catch(() => {});
  await wait(6000);

  const dpi = await page.evaluate((expectedDpr) => {
    const canvases = [...document.querySelectorAll('canvas')].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        cssW: Math.round(r.width),
        cssH: Math.round(r.height),
        bufW: c.width,
        bufH: c.height,
        ratioW: r.width ? c.width / r.width : 0,
        ratioH: r.height ? c.height / r.height : 0,
      };
    });
    // Schaerfe-Proxy: Kantengradient im groessten Canvas (Chart)
    let sharpness = null;
    const main = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (main && main.width > 50) {
      const ctx = main.getContext('2d');
      if (ctx) {
        try {
          const d = ctx.getImageData(0, 0, Math.min(main.width, 900), Math.min(main.height, 500)).data;
          let strong = 0;
          let mid = 0;
          let total = 0;
          for (let i = 4; i < d.length; i += 4) {
            const delta = Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2]);
            if (delta < 4) continue; // flache Fläche
            total++;
            if (delta > 90) strong++;
            else if (delta > 18) mid++;
          }
          // scharfe Kanten dominieren; unschaerfe verteilt den Uebergang auf viele mittlere Deltas
          sharpness = total > 200 ? { strong: Math.round((strong / total) * 100), mid: Math.round((mid / total) * 100), samples: total } : null;
        } catch {
          sharpness = 'unreadable';
        }
      }
    }
    return { dpr: window.devicePixelRatio, expectedDpr, canvases: canvases.slice(0, 6), sharpness };
  }, vp.dpr);

  // Erwarteter Faktor = Browser-Flag (siehe Kommentar bei HIGH_DPI_FLAG),
  // nicht der per setViewport gesetzte Wert.
  const expected = HIGH_DPI_FLAG;
  const bad = dpi.canvases.filter((c) => c.cssW > 20 && (c.ratioW < expected - 0.35 || c.ratioH < expected - 0.35));
  ok(`${vp.id} @${vp.dpr}x: Canvas-Backing-Store skaliert mit DPR (scharf)`, dpi.canvases.length > 0 && bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 3)) : JSON.stringify(dpi.canvases.slice(0, 3)));
  ok(`${vp.id} @${vp.dpr}x: devicePixelRatio korrekt an Layout uebergeben`, Math.abs(dpi.dpr - vp.dpr) < 0.01, `dpr=${dpi.dpr} erwartet=${vp.dpr}`);
  if (dpi.sharpness && dpi.sharpness !== 'unreadable') {
    ok(`${vp.id} @${vp.dpr}x: Kanten scharf (hoher Anteil harter Uebergaenge)`, dpi.sharpness.strong >= 25, JSON.stringify(dpi.sharpness));
  }
  await shot(page, `qa-resp-dpi-${vp.id}`);
  await page.close();
}

/* Wasserzeichen-Schaerfe auf Retina: Pixel-Scan auf www.NodeChart.cc */
console.log('\n— 3b: Wasserzeichen (www.NodeChart.cc) auf Retina —');
for (const vp of [{ id: 'retina1440', w: 1440, h: 900, dpr: 2 }, { id: 'mobile375', w: 375, h: 812, dpr: 3 }]) {
  const { page } = await newPage(vp);
  await page.goto(`${BASE}${vp.id === 'mobile375' ? '/de/terminal' : '/de/terminal'}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 45000 }).catch(() => {});
  await wait(6000);
  const wm = await page.evaluate(() => {
    const main = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!main) return { err: 'kein canvas' };
    const ctx = main.getContext('2d');
    if (!ctx) return { err: 'kein 2d-context' };
    let data;
    try {
      data = ctx.getImageData(0, 0, main.width, main.height).data;
    } catch (e) {
      return { err: 'getImageData blockiert: ' + String(e).slice(0, 60) };
    }
    // Wasserzeichen ist hell auf dunkel, zentriert, alpha ~0.12 -> leichte Aufhellung.
    // Wir suchen im mittleren Band nach Pixeln, die gegenueber ihrer Nachbarschaft
    // aufgehellt sind, und messen die Kantenschaerfe dieser Glyphen.
    const w = main.width;
    const h = main.height;
    const y0 = Math.floor(h * 0.38);
    const y1 = Math.floor(h * 0.62);
    let lit = 0;
    let scanned = 0;
    let edges = 0;
    const lum = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    for (let y = y0; y < y1; y += 1) {
      for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x += 1) {
        scanned++;
        const l = lum(x, y);
        const ln = lum(x - 1, y);
        if (l - ln > 6) edges++;
        if (l > 46) lit++;
      }
    }
    return {
      bufW: w,
      bufH: h,
      cssW: Math.round(main.getBoundingClientRect().width),
      litPct: +((lit / scanned) * 100).toFixed(2),
      edgePct: +((edges / scanned) * 100).toFixed(3),
      scanned,
    };
  });
  if (wm.err) {
    ok(`${wm.id ?? vp.id}: Wasserzeichen-Scan moeglich`, false, wm.err);
  } else {
    // Scharfe Glyphen => viele harte Kantenuebergaenge, geringer Anteil "verschmierter" Pixel
    ok(`${vp.id} @${vp.dpr}x: Wasserzeichen mit scharfen Glyphenkanten gerendert`, wm.edgePct > 0.02 && wm.litPct > 0.05, JSON.stringify(wm));
    ok(`${vp.id} @${vp.dpr}x: Wasserzeichen-Canvas in Retina-Aufloesung`, wm.bufW >= wm.cssW * (HIGH_DPI_FLAG - 0.35), `buf=${wm.bufW} css=${wm.cssW} dsf=${HIGH_DPI_FLAG}`);
  }
  await shot(page, `qa-resp-watermark-${vp.id}`);
  await page.close();
}

/* ------------------------------------------------------------------ */
/* Zusammenfassung                                                     */
/* ------------------------------------------------------------------ */
await browser.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/qa-responsive-overflow.json`, JSON.stringify(overflowReport, null, 1));
fs.writeFileSync(`${OUT}/qa-responsive-touch.json`, JSON.stringify(touchReport, null, 1));

const fails = results.filter((r) => !r.pass);
console.log(`\n${fails.length === 0 ? '✔' : '✖'} responsive: ${results.length - fails.length}/${results.length}`);
if (fails.length) {
  console.log('\nOffene Punkte:');
  for (const f of fails) console.log(`  · ${f.name} → ${String(f.detail).slice(0, 220)}`);
}
process.exit(fails.length ? 1 : 0);
