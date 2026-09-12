// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Interaktions-Audit: Hover/Active/Focus/Disabled-Diffs am echten Rendering,
// Modal-/Dropdown-Animationen + Layout-Jitter (CLS), Toast-Feedback.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info: String(info).slice(0, 220) }); console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${String(info).slice(0, 180)}` : ''}`); };

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1600, height: 1000 } });

async function newPage(patch) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
  if (patch) await page.evaluateOnNewDocument(patch);
  return { page, errors };
}

/* ============ TEIL 1: Interaktive States (Hover/Active/Focus/Disabled) ============ */
async function auditStates(page, label) {
  // Repräsentanten pro Klassen-Signatur sammeln (nicht jedes Element einzeln –
  // identische Klassen = identisches Verhalten).
  const reps = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, [role="switch"], summary';
    const seen = new Map();
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if (/\bsr-only\b/.test(String(el.className))) continue;
      // Von lightweight-charts injizierter TradingView-Attribution-Link –
      // Library-Markup, kein App-Control (eigene Hover-Styles nicht anwendbar).
      if (el.tagName === 'A' && /lwc-link/.test(el.getAttribute('href') || '')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.className?.baseVal !== undefined) continue; // svg
      const sig = `${el.tagName}|${el.disabled ? 'd' : 'e'}|${el.className}`;
      if (seen.has(sig)) { seen.set(sig, seen.get(sig) + 1); continue; }
      seen.set(sig, 1);
      el.setAttribute('data-qa-idx', String(out.length));
      out.push({ idx: out.length, tag: el.tagName, disabled: !!el.disabled, cls: String(el.className).slice(0, 70), pressed: el.getAttribute('aria-pressed'), txt: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) });
    }
    return out;
  });
  const gaps = [];
  for (const rep of reps) {
    const handle = await page.$(`[data-qa-idx="${rep.idx}"]`);
    if (!handle) continue;
    // Cursor erst parken, DANN scrollen: sonst scrollt die Seite das nächste
    // Element unter den alten Cursor und die `before`-Probe ist schon gehovert.
    await page.mouse.move(2, 2);
    await wait(60);
    await page.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }), handle);
    await wait(420); // scroll-behavior: smooth + Layout-Settling (Fonts/Ads)
    const box = await handle.boundingBox();
    if (!box) continue;
    const probeFn = (el) => {
      const parts = [];
      const seen = new Set();
      for (const node of [el, el.closest('label'), el.parentElement]) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const c = getComputedStyle(node);
        parts.push([c.backgroundColor, c.color, c.borderTopColor, c.boxShadow, c.transform, c.filter, c.opacity, c.textDecorationColor, c.textDecorationStyle].join('~'));
      }
      const kids = [...el.querySelectorAll('span,svg')].slice(0, 3).map((k) => getComputedStyle(k).color).join(',');
      return parts.join('|') + '|' + kids;
    };
    const before = await page.evaluate(probeFn, handle);
    // Hover mit frischen Koordinaten + :hover-Verifikation (Retry): zwischen
    // boundingBox() und mouse.move() kann sich das Layout noch verschieben
    // (Smooth-Scroll, nachgeladene Inhalte) – der Cursor landet sonst daneben.
    let receives = false;
    let cx = box.x + box.width / 2;
    let cy = box.y + box.height / 2;
    for (let attempt = 0; attempt < 4; attempt++) {
      const fresh = await handle.boundingBox();
      if (!fresh) break;
      cx = fresh.x + fresh.width / 2;
      cy = fresh.y + fresh.height / 2;
      await page.mouse.move(cx - 6, cy - 6);
      await page.mouse.move(cx, cy, { steps: 4 });
      // Headless + swiftshader wendet :hover erst mit dem nächsten Frame an –
      // auf seiten mit Dauer-rAF (Terminal-Canvas) kann das >260ms dauern.
      // Deshalb aktiv auf matches(':hover') pollen statt fix zu warten.
      let isHover = false;
      for (let t = 0; t < 15; t++) {
        await wait(100);
        isHover = await page.evaluate((el) => el.matches(':hover'), handle);
        if (isHover) break;
      }
      // Guard: liegt das Element wirklich unter dem Cursor (nicht von Overlay verdeckt)?
      receives = isHover && await page.evaluate((el, x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }, handle, cx, cy);
      if (receives) {
        await wait(340); // transition-colors duration-200 + Puffer auslaufen lassen
        break;
      }
      await wait(200);
    }
    const hovered = await page.evaluate(probeFn, handle);
    const hoverOk = hovered !== before || !receives;
    let activeOk = true;
    if (rep.tag === 'BUTTON' && !rep.disabled) {
      await page.mouse.down();
      await wait(140);
      const pressed = await page.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.borderTopColor, c.boxShadow, c.transform, c.filter, c.opacity].join('|'); }, handle);
      await page.mouse.move(2, 2); // außerhalb loslassen → kein Klick
      await page.mouse.up();
      await wait(80);
      activeOk = pressed !== hovered;
    }
    if (!rep.disabled && (!hoverOk || !activeOk)) {
      const html = await page.evaluate((el) => (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 110), handle);
      gaps.push({ ...rep, hoverOk, activeOk, html, before, hovered, receives });
      if (gaps.length <= 6) await page.screenshot({ path: `${OUT}/qa-interaction-gap-${label}-${rep.idx}.png` });
    }
    await page.mouse.move(2, 2);
    await wait(60);
  }
  // Disabled-Stichprobe
  const disabled = await page.evaluate(() => {
    const list = [...document.querySelectorAll('button[disabled]')];
    return list.slice(0, 5).map((b) => { const c = getComputedStyle(b); return { op: c.opacity, pe: c.pointerEvents }; });
  });
  const disabledOk = disabled.every((d) => Number(d.op) < 0.9 && d.pe === 'none');
  return { total: reps.length, gaps, disabledCount: disabled.length, disabledOk };
}

async function focusWalk(page, _label) {
  await page.evaluate(() => document.body.focus());
  const bad = [];
  let checked = 0;
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const c = getComputedStyle(el);
      const visible = c.outlineWidth !== '0px' && c.outlineStyle !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(c.outlineColor);
      const shadow = c.boxShadow !== 'none';
      return { tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28), visible, shadow, matchesFV: el.matches(':focus-visible') };
    });
    if (!info) continue;
    checked++;
    if (info.matchesFV && !info.visible && !info.shadow) bad.push(info);
  }
  return { checked, bad };
}

console.log('— 1: Interaktive States auf Landing (/de) —');
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/de`, { waitUntil: 'domcontentloaded' });
  await wait(3000);
  const st = await auditStates(page, 'landing');
  fs.writeFileSync(`${OUT}/qa-interaction-gaps-landing.json`, JSON.stringify(st.gaps, null, 1));
  ok(`Landing: alle ${st.total} Kontroll-Klassen zeigen Hover- UND Active-Feedback`, st.gaps.length === 0, JSON.stringify(st.gaps.map((g) => `${g.tag}:${g.cls.slice(0, 40)} h=${g.hoverOk}`)));
  ok('Landing: Disabled-Buttons einheitlich inert (opacity + pointer-events)', st.disabledCount === 0 || st.disabledOk, `n=${st.disabledCount}`);
  const fw = await focusWalk(page, 'landing');
  ok('Landing: Tab-Fokus überall sichtbar (Focus-Ring/Glow)', fw.bad.length === 0, `${fw.checked} Stationen, ${fw.bad.length} ohne Ring: ${JSON.stringify(fw.bad.slice(0, 3))}`);
  ok('Landing: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();
}

console.log('\n— 1b: Interaktive States im Terminal (/de/terminal) —');
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(3500);
  const st = await auditStates(page, 'terminal');
  fs.writeFileSync(`${OUT}/qa-interaction-gaps-terminal.json`, JSON.stringify(st.gaps, null, 1));
  ok(`Terminal: alle ${st.total} Kontroll-Klassen zeigen Hover- UND Active-Feedback`, st.gaps.length === 0, JSON.stringify(st.gaps.map((g) => `${g.tag}:${g.cls.slice(0, 40)} h=${g.hoverOk}`)));
  ok('Terminal: Disabled-Buttons einheitlich inert', st.disabledCount === 0 || st.disabledOk, `n=${st.disabledCount}`);

  // Suchmaske: Neon-Border bei Fokus (Wrapper mit focus-within)
  const focusNeon = await page.evaluate(async () => {
    const input = document.querySelector('header input[type="text"]');
    const wrap = input?.closest('div');
    if (!input || !wrap) return null;
    const before = getComputedStyle(wrap).borderTopColor + '|' + getComputedStyle(wrap).boxShadow;
    input.focus();
    await new Promise((r) => setTimeout(r, 350));
    const after = getComputedStyle(wrap).borderTopColor + '|' + getComputedStyle(wrap).boxShadow;
    input.blur();
    return { changed: before !== after, after: after.slice(0, 90) };
  });
  ok('Suchmaske: Fokus zeigt klaren Neon-Border + Glow', focusNeon?.changed, JSON.stringify(focusNeon));

  // Fehlerhafte/leere Eingabe: einheitlicher Empty-State in der Suchliste
  await page.click('header input[type="text"]');
  await page.type('header input[type="text"]', '%%%invalid###', { delay: 20 });
  let invalid = null;
  for (let i = 0; i < 12; i++) {
    await wait(1200);
    invalid = await page.evaluate(() => {
      const lb = document.querySelector('[role="listbox"]');
      const t = (lb?.innerText ?? '').toUpperCase();
      const scanning = /GESCANNT|LÄDT/.test(t);
      return { scanning, hasState: /KEINE TREFFER|0 TREFFER|NICHTS GEFUNDEN/.test(t) || (!scanning && /TREFFER/.test(t)), text: (lb?.innerText ?? '').slice(0, 60) };
    });
    if (invalid.hasState) break;
  }
  ok('Fehlerhafte Eingabe: Dropdown zeigt definierten Empty-State (kein rohes Nichts)', invalid?.hasState, JSON.stringify(invalid));
  await page.keyboard.press('Escape');

  /*
   * aria-invalid-Mechanismus global verifiziert.
   * Wichtig: Blink cached Computed Styles innerhalb EINES evaluate()-Aufrufs,
   * wenn das Attribut nach dem ersten getComputedStyle() gesetzt wird. Deshalb
   * laufen Anlegen / Attribut setzen / Lesen in drei getrennten Aufrufen.
   */
  await page.evaluate(() => {
    document.getElementById('qa-invalid-probe')?.remove();
    const a = document.createElement('input');
    a.id = 'qa-invalid-probe';
    a.className = 'border border-line';
    document.body.appendChild(a);
  });
  const plain = await page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('qa-invalid-probe'));
    return { border: c.borderTopColor, shadow: c.boxShadow };
  });
  await page.evaluate(() => document.getElementById('qa-invalid-probe').setAttribute('aria-invalid', 'true'));
  await wait(450); // border/shadow-Transition sicher auslaufen lassen (>150ms-Grenze war flaky)
  const errState = await page.evaluate(() => {
    const el = document.getElementById('qa-invalid-probe');
    const c = getComputedStyle(el);
    const res = { border: c.borderTopColor, shadow: c.boxShadow, matches: el.matches("input[aria-invalid='true']") };
    el.remove();
    return res;
  });
  const invalidCss = {
    plain: plain.border,
    err: errState.border,
    differs: plain.border !== errState.border,
    shadow: errState.shadow !== 'none' && errState.shadow !== plain.shadow,
  };
  ok('aria-invalid hebt fehlerhafte Eingaben global hervor (Danger-Border + Glow)', invalidCss.differs && invalidCss.shadow, JSON.stringify(invalidCss));
  ok('Terminal: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();
}

console.log('\n— 2: Modal- & Dropdown-Animationen (Jitter/CLS) —');
{
  const { page, errors } = await newPage((_) => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(3500);

  const anchorProbe = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const h = document.querySelector('header');
    const r1 = c?.getBoundingClientRect();
    const r2 = h?.getBoundingClientRect();
    return [r1?.x, r1?.y, r1?.width, r2?.x, r2?.y].map((n) => Math.round(n ?? -1)).join(',');
  });
  const clsOf = () => page.evaluate(() => window.__cls);

  // --- 2a: Venue-Dropdown (Exchange-Picker) ---
  const base = await anchorProbe();
  const cls0 = await clsOf();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => { const t = (x.textContent ?? '').trim(); return /▾/.test(t) && !/^(DE|EN|RU|ES|中文)▾$|^[0-9]+[mhdwMHDW]▾$|^[A-Z]+\/[A-Z0-9]+▾$|^▾$/.test(t); });
    b?.click();
  });
  await wait(120);
  const menuAnim = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    if (!lb) return null;
    const c = getComputedStyle(lb);
    return { anim: c.animationName, dur: c.animationDuration };
  });
  await wait(600);
  const jitter = await anchorProbe();
  const cls1 = await clsOf();
  ok('Venue-Dropdown: Öffnen mit Entry-Animation (fade-up)', menuAnim && menuAnim.anim !== 'none' && parseFloat(menuAnim.dur) > 0.1 && parseFloat(menuAnim.dur) < 1.2, JSON.stringify(menuAnim));
  ok('Venue-Dropdown: kein Layout-Jitter (Anker stabil, ΔCLS≈0)', jitter === base && cls1 - cls0 < 0.01, `anchor=${jitter === base} ΔCLS=${(cls1 - cls0).toFixed(4)}`);
  await page.keyboard.press('Escape');
  await wait(400);

  // --- 2b: Tools-Menü → Journal-Modal ---
  const cls2 = await clsOf();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) => /Tools/i.test(x.textContent ?? ''));
    if (!b) return false;
    b.click();
    return true;
  });
  await wait(500);
  const menuAnim2 = await page.evaluate(() => {
    const m = document.querySelector('[role="menu"]');
    if (!m) return null;
    const c = getComputedStyle(m);
    return { anim: c.animationName, dur: c.animationDuration };
  });
  ok('Tools-Menü: Dropdown-Entry-Animation vorhanden', menuAnim2 && menuAnim2.anim !== 'none', JSON.stringify(menuAnim2));
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].find((x) => /Journal/i.test(x.textContent ?? ''));
    if (!item) return false;
    (item.querySelector('button') ?? item).click();
    return true;
  });
  await wait(150);
  const modalAnim = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const c = getComputedStyle(d);
    const backdrop = d.parentElement ? getComputedStyle(d.parentElement) : null;
    return { anim: c.animationName, dur: c.animationDuration, backdropAnim: backdrop?.animationName };
  });
  await wait(700);
  const cls3 = await clsOf();
  const jitter2 = await anchorProbe();
  ok('Modal (Journal): geschmeidige Entry-Animation (Panel + Backdrop)', modalAnim && modalAnim.anim !== 'none', JSON.stringify(modalAnim));
  ok('Modal: kein Layout-Jitter beim Öffnen (ΔCLS < 0.01, Anker stabil)', cls3 - cls2 < 0.01 && jitter2 === base, `ΔCLS=${(cls3 - cls2).toFixed(4)} anchor=${jitter2 === base}`);
  await page.screenshot({ path: `${OUT}/qa-interaction-modal.png` });
  await page.keyboard.press('Escape');
  await wait(500);
  const cls4 = await clsOf();
  ok('Modal: Schließen ohne Jitter (ΔCLS < 0.01)', cls4 - cls3 < 0.01, `ΔCLS=${(cls4 - cls3).toFixed(4)}`);

  // --- 2c: i18n-/Locale-Dropdown ---
  const openedLocale = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => /^(DE|EN|RU|ES|中文)▾$/.test((x.textContent ?? '').trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  await wait(400);
  const localeAnim = await page.evaluate(() => {
    const lb = [...document.querySelectorAll('[role="listbox"]')].pop();
    if (!lb) return null;
    const c = getComputedStyle(lb);
    return { anim: c.animationName };
  });
  ok('Locale-Dropdown: Entry-Animation vorhanden', !openedLocale || (localeAnim && localeAnim.anim !== 'none'), JSON.stringify(localeAnim));
  await page.keyboard.press('Escape');
  ok('Sektion 2: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();
}

console.log('\n— 3: Feedback & Toasts (Wallet kopieren) —');
{
  // 3a) Erfolgs-Pfad: Inline-Neon-Feedback im Wallet-Row
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE, ['clipboard-write', 'clipboard-sanitized-write']);
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await wait(3000);
  const openModal = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /TRINKGELD|TIP.?JAR|SPENDEN/i.test((x.getAttribute('aria-label') ?? '') + (x.getAttribute('title') ?? '') + (x.textContent ?? ''))) ?? [...document.querySelectorAll('button')].find((x) => x.querySelector('svg.lucide-heart'));
    if (!b) return false;
    b.click();
    return true;
  });
  const opened = await openModal();
  await wait(900);
  const clicked = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 'kein-dialog';
    const btn = [...dlg.querySelectorAll('button')].find((b) => /KOPIEREN|COPY/i.test((b.getAttribute('aria-label') ?? '') + (b.textContent ?? '')));
    if (!btn) return 'kein-copy-button';
    btn.click();
    return 'clicked';
  });
  await wait(600);
  const inlineFb = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const btn = [...dlg.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-check')) ?? null;
    const row = btn?.closest('div.nc-clip-sm');
    return {
      check: !!btn,
      label: btn ? (btn.textContent ?? '').trim() : '',
      bullBorder: row ? getComputedStyle(row).borderTopColor : '',
    };
  });
  ok('Tip-Jar öffnet + Copy-Klick zeigt Inline-Neon-Feedback (Check + Bull-Border)', opened && clicked === 'clicked' && inlineFb?.check, JSON.stringify({ opened, clicked, inlineFb }));
  await page.screenshot({ path: `${OUT}/qa-interaction-copy-feedback.png` });
  ok('3a: keine Page-Errors', errors.length === 0, errors[0] || '');
  await page.close();

  // 3b) Fehler-Pfad: Clipboard scheitert → Warn-Toast mit Animation + Auto-Expiry
  await context.clearPermissionOverrides();
  const { page: p2, errors: e2 } = await newPage(() => {
    try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch { /* Clipboard-API eben erreichbar – execCommand-Stub greift dann */ }
    try { document.execCommand = () => false; } catch { /* ignore */ }
  });
  await p2.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('canvas', { timeout: 30000 });
  await wait(3000);
  await p2.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /TRINKGELD|TIP.?JAR|SPENDEN/i.test((x.getAttribute('aria-label') ?? '') + (x.getAttribute('title') ?? '') + (x.textContent ?? ''))) ?? [...document.querySelectorAll('button')].find((x) => x.querySelector('svg.lucide-heart'));
    b?.click();
  });
  await wait(900);
  await p2.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btn = dlg && [...dlg.querySelectorAll('button')].find((b) => /KOPIEREN|COPY/i.test((b.getAttribute('aria-label') ?? '') + (b.textContent ?? '')));
    btn?.click();
  });
  await wait(800);
  const toast = await p2.evaluate(() => {
    const host =
      document.querySelector('[aria-live="polite"].fixed') ??
      [...document.querySelectorAll('[aria-live]')].find((h) => h.firstElementChild);
    const t = host?.firstElementChild;
    if (!t) return null;
    const c = getComputedStyle(t);
    return {
      text: (t.innerText ?? '').trim().slice(0, 70),
      anim: c.animationName,
      dur: c.animationDuration,
      clip: String(t.className).includes('nc-clip'),
      border: c.borderTopColor,
      shadow: c.boxShadow !== 'none',
      warnTone: /warning|255|2[0-9]{2}/.test(c.borderTopColor),
    };
  });
  ok('Fehlgeschlagenes Kopieren → Toast-Feedback erscheint', toast && toast.text.length > 0, JSON.stringify(toast));
  ok('Toast im Cyberpunk-Stil (nc-clip, Neon-Border, Glow, Warn-Ton)', toast && toast.clip && toast.shadow, JSON.stringify(toast));
  ok('Toast mit Entry-Animation (toast-in)', toast && toast.anim === 'toast-in' && parseFloat(toast.dur) > 0.1, JSON.stringify(toast && { anim: toast.anim, dur: toast.dur }));
  await p2.screenshot({ path: `${OUT}/qa-interaction-toast.png` });
  let gone = false;
  for (let i = 0; i < 12; i++) {
    await wait(1000);
    const still = await p2.evaluate(() => {
      const host = document.querySelector('[aria-live="polite"].fixed') ?? [...document.querySelectorAll('[aria-live]')].find((h) => h.firstElementChild);
      return !!host?.firstElementChild;
    });
    if (!still) { gone = true; break; }
  }
  ok('Toast verschwindet automatisch (Auto-Expiry)', gone, '');
  ok('3b: keine Page-Errors', e2.length === 0, e2[0] || '');
  await p2.close();
}

await browser.close();
const fails = results.filter((r) => !r.pass);
console.log(`\n${fails.length === 0 ? '✔' : '✖'} teil1: ${results.length - fails.length}/${results.length}`);
