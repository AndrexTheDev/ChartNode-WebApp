// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 7 — DEPLOY-READINESS (Cloudflare Pages via @opennextjs/cloudflare):
// cf:build muss grün durchlaufen; robots.txt + sitemap.xml ausliefern;
// LICENSE (All Rights Reserved) + deutsche Schritt-für-Schritt-Anleitung
// (README/DEPLOY) vorhanden; wrangler-Konfiguration valide.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, BASE, makeReporter } from './lib.mjs';

export const META = { id: 'M7', name: 'Deploy-Readiness (Cloudflare)' };

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;

  /* 1 · robots + sitemap gegen den laufenden Build */
  for (const [path, marker] of [
    ['/robots.txt', 'nodechart.cc'],
    ['/sitemap.xml', '<urlset'],
  ]) {
    let ok = false;
    let body = '';
    try {
      const res = await fetch(BASE + path);
      body = await res.text();
      ok = res.status === 200 && body.includes(marker);
    } catch { /* Server nicht erreichbar */ }
    check(path + ' liefert 200 + Inhalt', ok, body.slice(0, 60).replace(/\n/g, ' '));
  }

  /* 2 · Lizenz + Anleitung + Konfiguration */
  const license = existsSync(join(ROOT, 'LICENSE.md')) ? readFileSync(join(ROOT, 'LICENSE.md'), 'utf8') : '';
  check('LICENSE.md = All Rights Reserved (strengste Lizenz)', /All Rights Reserved/i.test(license));
  const readme = existsSync(join(ROOT, 'README.md')) ? readFileSync(join(ROOT, 'README.md'), 'utf8') : '';
  const guide = [join(ROOT, 'VEROEFFENTLICHEN.md'), join(ROOT, 'DEPLOY.md')]
    .filter(existsSync)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n') + readme;
  check(
    'Deutsche Schritt-für-Schritt-Deploy-Anleitung (GitHub + Cloudflare)',
    /Schritt/i.test(guide) && /Cloudflare/i.test(guide) && /GitHub/i.test(guide),
  );
  const wr = existsSync(join(ROOT, 'wrangler.jsonc')) ? readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8') : '';
  check('wrangler.jsonc mit Name + Kompatibilitätsdatum', /name/.test(wr) && /compatibility_date|compatibility_flags/.test(wr));

  /* 4 · OpenNext/Cloudflare-Build ZULETZT (überschreibt .next ⇒ danach Server-Neustart) (Worker + Static Export) */
  let cfOk = true;
  let cfInfo = '';
  try {
    const out = execSync('npm run cf:build', { cwd: ROOT, encoding: 'utf8', timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'] });
    cfInfo = (out.match(/✓[^\n]*/g) || []).slice(-1)[0] || 'ok';
  } catch (e) {
    cfOk = false;
    cfInfo = String(e.stdout || e.message).slice(-200);
  }
  check('cf:build (opennextjs-cloudflare) grün', cfOk, cfInfo.slice(0, 120));

  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
