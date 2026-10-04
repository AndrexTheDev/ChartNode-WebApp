// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 11 — OFFLINE SMOKE: deterministische Adapter-/API-/Chart-/Feature-Fixtures.
// Keine Browserinstanz und keine Live-Provider-Abfragen; WS-Live-Probes werden im
// zugehörigen Harness mit WS_SMOKE_OFFLINE=1 explizit ausgelassen.
import { execSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

export const META = { id: 'M11', name: 'Offline-Smoke-Fixtures (WS/API/Chart/Edge/Module)' };

export async function run() {
  let output = '';
  let code = 0;
  try {
    output = execSync('npm run smoke:offline', {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 900000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (error) {
    code = error.status || 1;
    output = `${error.stdout || ''}\n${error.stderr || ''}`;
  }
  const failures = (output.match(/^\s*FAIL\b.*$/gm) || []).slice(0, 8);
  const passCount = (output.match(/^\s*PASS\b/gm) || []).length;
  const failCount = (output.match(/^\s*FAIL\b/gm) || []).length;
  const skipCount = (output.match(/^\s*SKIP\b/gm) || []).length;
  const ok = code === 0 && failCount === 0;
  const detail = failures.length
    ? failures.join(' | ')
    : `${passCount} PASS / ${failCount} FAIL / ${skipCount} SKIP in deterministic/offline fixtures`;
  console.log(`  ${ok ? '✔' : '✘'} [${META.id}] smoke:offline — ${detail}`);
  return {
    ...META,
    pass: passCount,
    fail: failCount + (code !== 0 && failCount === 0 ? 1 : 0),
    skip: skipCount,
    rows: [{ name: 'npm run smoke:offline', ok, info: detail }],
  };
}
