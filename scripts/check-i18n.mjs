#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * i18n parity check.
 * Verifies that every locale bundle has exactly the same key structure as the
 * reference (en) and that no ICU placeholder went missing in translation.
 *
 * Usage:  node scripts/check-i18n.mjs
 * Exit code 1 => something is out of sync (wire this into CI).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = join(root, 'messages');
const REFERENCE = 'en';

const files = readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
const bundles = Object.fromEntries(
  files.map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(messagesDir, f), 'utf8'))]),
);

/** Flatten { a: { b: 1 } } -> ['a.b'] ; arrays are flattened with indices. */
function flatten(value, prefix = '', out = []) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child, path, out);
    else out.push(path);
  }
  return out;
}

function placeholders(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/\{([a-zA-Z_][\w]*)\}/g)].map((m) => m[1]).sort();
}

function get(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

const refKeys = flatten(bundles[REFERENCE]).sort();
let errors = 0;

for (const [locale, bundle] of Object.entries(bundles)) {
  if (locale === REFERENCE) continue;
  const keys = flatten(bundle).sort();

  const missing = refKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !refKeys.includes(k));

  for (const key of missing) {
    console.error(`✖ [${locale}] missing key: ${key}`);
    errors++;
  }
  for (const key of extra) {
    console.error(`✖ [${locale}] unexpected key: ${key}`);
    errors++;
  }
  for (const key of refKeys.filter((k) => keys.includes(k))) {
    const a = placeholders(get(bundles[REFERENCE], key));
    const b = placeholders(get(bundle, key));
    if (a.join() !== b.join()) {
      console.error(`✖ [${locale}] placeholder mismatch at "${key}": {${a}} != {${b}}`);
      errors++;
    }
  }
}

const count = (locale) => flatten(bundles[locale]).length;
console.log('');
for (const locale of Object.keys(bundles)) {
  console.log(`  ${locale.padEnd(4)} ${String(count(locale)).padStart(4)} keys`);
}
console.log('');

if (errors > 0) {
  console.error(`${errors} problem(s) found.`);
  process.exit(1);
}
console.log(`✔ i18n parity OK across ${files.length} locales.`);
