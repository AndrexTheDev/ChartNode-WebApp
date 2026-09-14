// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// RELEASE-AUDIT Orchestrator: führt alle Module sequenziell aus, schreibt
// RELEASE-AUDIT.md und exitet non-zero bei Fails. Nutzung: npm run qa:full
// Module werden schrittweise ergänzt (M1..M7); jeder Schritt ist eigenständig lauffähig.
import { writeReport } from './lib.mjs';
import * as M1 from './m1-static.mjs';
import * as M2 from './m2-routing-seo.mjs';
import * as M3 from './m3-terminal.mjs';
import * as M4 from './m4-a11y.mjs';

const ONLY = process.argv.slice(2).filter((a) => /^M\d$/.test(a.toUpperCase()));
const MODULES = [M1, M2, M3, M4]; // wächst: M5 Monetization, M6 Runtime/Edge, M7 Deploy

const results = [];
for (const mod of MODULES) {
  if (ONLY.length && !ONLY.includes(mod.META.id.toUpperCase())) continue;
  console.log(`\n=== ${mod.META.id} — ${mod.META.name} ===`);
  const started = Date.now();
  const r = await mod.run();
  console.log(`  → ${r.pass} PASS / ${r.fail} FAIL (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  results.push(r);
}
const { totalP, totalF } = writeReport(results);
console.log(`\nRELEASE-AUDIT GESAMT: ${totalP} PASS / ${totalF} FAIL · Report: RELEASE-AUDIT.md`);
process.exit(totalF ? 1 : 0);
