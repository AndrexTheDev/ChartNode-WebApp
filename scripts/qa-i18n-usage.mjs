#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Verifies that every translation key the Edge Suite actually reads exists in
 * every locale bundle (check-i18n.mjs only proves parity between locales, not
 * that used keys exist). Also proves the ICU placeholders of used keys match.
 *
 * Usage: node scripts/qa-i18n-usage.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundles = Object.fromEntries(
  readdirSync(join(root, 'messages'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(root, 'messages', f), 'utf8'))]),
);

const componentFiles = [
  'src/components/tools/EdgeModals.tsx',
  'src/components/terminal/TerminalShell.tsx',
];

/** literal t('x') / te('x') calls inside the edge-namespace components */
const used = new Set();
for (const file of componentFiles) {
  const src = readFileSync(join(root, file), 'utf8');
  for (const match of src.matchAll(/\bt(?:e)?\('([a-zA-Z][\w]*)'(?:\)|,)/g)) used.add(match[1]);
}
// keys reached through lookup tables instead of literal calls
for (const key of [
  'rTrendStrong', 'rTrendWeak', 'rRange', 'rVolExpand', 'rLiqStorm',
  'rdTrendStrong', 'rdTrendWeak', 'rdRange', 'rdVolExpand', 'rdLiqStorm',
]) {
  used.add(key);
}
// TerminalShell reads menu labels via te(), but other namespaces' t() calls
// also match the regex – keep only keys that live in the edge namespace or
// are known menu labels.
const edgeKeys = new Set(Object.keys(bundles.en.edge));
const menuLabels = new Set(['menuLabel', 'menuLiq', 'menuLag', 'menuRegime', 'menuClock']);
const wanted = [...used].filter((key) => edgeKeys.has(key) || menuLabels.has(key));

let failures = 0;
for (const [locale, bundle] of Object.entries(bundles)) {
  const missing = wanted.filter((key) => bundle.edge?.[key] == null);
  if (missing.length > 0) {
    console.error(`✖ [${locale}] missing edge keys: ${missing.join(', ')}`);
    failures += missing.length;
  }
}

// ICU placeholder parity for the used keys
const placeholders = (value) =>
  typeof value === 'string' ? [...value.matchAll(/\{([a-zA-Z_][\w]*)\}/g)].map((m) => m[1]).sort().join(',') : '';
for (const key of wanted) {
  const ref = placeholders(bundles.en.edge[key]);
  for (const [locale, bundle] of Object.entries(bundles)) {
    if (locale === 'en') continue;
    if (placeholders(bundle.edge?.[key]) !== ref) {
      console.error(`✖ [${locale}] placeholder mismatch at edge.${key}`);
      failures += 1;
    }
  }
}

const unused = [...edgeKeys].filter((key) => !wanted.includes(key));
console.log(`  edge keys used by components: ${wanted.length}`);
console.log(`  edge keys in bundle:          ${edgeKeys.size}`);
if (unused.length > 0) console.log(`  bundle-only (docs/help only): ${unused.join(', ')}`);
console.log('');
if (failures > 0) {
  console.error(`✖ ${failures} i18n usage problem(s).`);
  process.exit(1);
}
console.log(`✔ edge i18n usage OK across ${Object.keys(bundles).length} locales.`);
