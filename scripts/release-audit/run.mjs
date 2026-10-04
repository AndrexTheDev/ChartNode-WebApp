// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// RELEASE-AUDIT Orchestrator: führt alle Module sequenziell aus und schreibt
// RELEASE-AUDIT.md. Nutzung: npm run qa:full (vollständig) oder npm run qa:offline
// (nur lokal ausführbare Module; Browsermodule werden explizit als SKIP berichtet).
import { writeReport } from './lib.mjs';
import * as M1 from './m1-static.mjs';
import * as M2 from './m2-routing-seo.mjs';
import * as M3 from './m3-terminal.mjs';
import * as M4 from './m4-a11y.mjs';
import * as M5 from './m5-monetization.mjs';
import * as M6 from './m6-runtime.mjs';
import * as M7 from './m7-deploy.mjs';
import * as M8 from './m8-ads-deep.mjs';
import * as M9 from './m9-security.mjs';
import * as M10 from './m10-resilienz.mjs';
import * as M11 from './m11-offline-smoke.mjs';
import * as M12 from './m12-http-baseline.mjs';

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline') || process.env.QA_OFFLINE === '1';
const ONLY = args.filter((a) => /^M\d{1,2}$/i.test(a)).map((a) => a.toUpperCase());
const MODULES = [M1, M2, M3, M4, M5, M6, M8, M9, M10, M11, M12, M7]; // M7 (cf:build) stets zuletzt
const BROWSER_MODULES = new Map([
  ['M2', 'Browser erforderlich für Routing-/Metadaten-Interaktionen.'],
  ['M3', 'Chrome/Puppeteer erforderlich für Terminal- und Mobile-Interaktionen.'],
  ['M4', 'Chrome/Puppeteer erforderlich für visuelle Accessibility-Prüfungen.'],
  ['M5', 'Chrome/Puppeteer erforderlich für Monetarisierungs-/Smartlink-Viewports.'],
  ['M6', 'Chrome/Puppeteer erforderlich für Runtime- und Interaktionsbatterie.'],
  ['M8', 'Chrome/Puppeteer erforderlich für Ad-/Consent-Interaktionen.'],
  ['M9', 'Browser-/Storage-XSS-Matrix erfordert Chrome/Puppeteer; testbare HTTP-Header, OG-Input, Fonts und Privacy-SSR laufen separat in M12.'],
  ['M10', 'Chrome/Puppeteer erforderlich für Browser-Resilienz-/Download-Prüfungen.'],
]);

const results = [];
for (const mod of MODULES) {
  const id = mod.META.id.toUpperCase();
  if (ONLY.length && !ONLY.includes(id)) continue;
  console.log(`\n=== ${mod.META.id} — ${mod.META.name} ===`);

  if (OFFLINE && BROWSER_MODULES.has(id)) {
    const reason = BROWSER_MODULES.get(id);
    console.log(`  ⊘ [${mod.META.id}] SKIP — ${reason}`);
    results.push({
      ...mod.META,
      pass: 0,
      fail: 0,
      skip: 1,
      rows: [{ name: 'Ausgelassen im Offline-Audit', ok: null, skipped: true, info: reason }],
    });
    continue;
  }

  const started = Date.now();
  try {
    const r = await mod.run();
    console.log(`  → ${r.pass} PASS / ${r.fail} FAIL (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    results.push(r);
  } catch (error) {
    const info = String(error?.stack || error).slice(0, 500);
    console.error(`  ✘ [${mod.META.id}] Modul konnte nicht abgeschlossen werden: ${String(error?.message || error)}`);
    results.push({
      ...mod.META,
      pass: 0,
      fail: 1,
      skip: 0,
      rows: [{ name: 'Modul unerwartet abgebrochen', ok: false, info }],
    });
  }
}

const { totalP, totalF, totalS } = writeReport(results);
console.log(`\nRELEASE-AUDIT: ${totalP} PASS / ${totalF} FAIL / ${totalS} SKIP · Report: RELEASE-AUDIT.md`);
process.exit(totalF ? 1 : 0);
