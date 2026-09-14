// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 5 — MONETARISIERUNG: bettet die bestehenden Suiten ein
// (qa:monetization = Ad-/Spenden-Matrix 4 Viewports × Zustände,
//  qa:smartlinks = Cap/Disclosure/Toast-Batterie). Beide müssen 0 FAIL liefern.
import { execSync } from 'node:child_process';
import { ROOT, makeReporter } from './lib.mjs';

export const META = { id: 'M5', name: 'Monetarisierung (Ad-/Smartlink-Suiten)' };

const parse = (out) => {
  const m = out.match(/(\d+) PASS \/ (\d+) FAIL/);
  return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
};

export async function run() {
  const rep = makeReporter(META.id, META.name);
  for (const [name, cmd] of [
    ['qa:monetization (Ad-/Spenden-Matrix + Overlaps)', 'npm run qa:monetization'],
    ['qa:smartlinks (Cap, Disclosure, Toasts)', 'npm run qa:smartlinks'],
  ]) {
    let out = '';
    let code = 0;
    try {
      out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = e.status || 1;
      out = (e.stdout || '') + (e.stderr || '');
    }
    const r = parse(out);
    rep.check(name + ' ⇒ 0 FAIL', code === 0 && r && r.fail === 0, r ? r.pass + 'P/' + r.fail + 'F' : 'parse-fehler exit=' + code);
  }
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
