#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Dev-only test runner: bundles one of the `scripts/*.entry.ts` harnesses with
 * esbuild (so the real TS sources run unmodified, `@/` aliases included) and
 * executes it in Node with browser globals shimmed by the entry itself.
 *
 *   node scripts/run-harness.mjs ws-smoke.entry.ts
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-harness.mjs <entry.ts>');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.tmp-smoke');
mkdirSync(outDir, { recursive: true });

const outfile = join(outDir, `${entry.replace(/\.ts$/, '')}.mjs`);

await build({
  entryPoints: [join(root, 'scripts', entry)],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  alias: { '@': join(root, 'src') },
  external: ['ws'],
  logLevel: 'warning',
});

execFileSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root });
