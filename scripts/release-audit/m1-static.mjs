// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 1 — STATIK: Lizenz-Header, Secrets, Env-Abdeckung, i18n-Parität
// (5 Locales), Routing-/Legal-Vollständigkeit, Doktrin-Konstanten.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, LOCALES, makeReporter } from './lib.mjs';

export const META = { id: 'M1', name: 'Statik & Konfiguration' };

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export async function run() {
  const rep = makeReporter(META.id, META.name);
  const { check } = rep;

  /* 1 · Lizenz-Header-Doktrin: jede Quelldatei trägt den Copyright-Vermerk */
  const srcFiles = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))].filter((f) =>
    /\.(ts|tsx|css|mjs|json)$/.test(f),
  );
  const noHeader = srcFiles.filter((f) => {
    if (f.endsWith('.json')) return false; // Nachrichten/Config: kein Header nötig
    const head = readFileSync(f, 'utf8').slice(0, 200);
    return !/All Rights Reserved/i.test(head);
  });
  check(`Lizenz-Header in allen ${srcFiles.length} Quell-Dateien`, noHeader.length === 0, noHeader.slice(0, 3).map((f) => relative(ROOT, f)).join(', '));

  /* 2 · Secrets-Scan: keine privaten Keys/Tokens im Repo */
  const secretRe = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{24,}\b|\bsk_live_[A-Za-z0-9]+\b|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|ghp_[A-Za-z0-9]{36}/;
  const withSecret = srcFiles.filter((f) => secretRe.test(readFileSync(f, 'utf8')));
  check('Keine Secrets/Private-Keys in src+scripts', withSecret.length === 0, withSecret.slice(0, 3).map((f) => relative(ROOT, f)).join(', '));

  /* 3 · Env-Abdeckung: jedes NEXT_PUBLIC_* im Code steht in .env.example */
  const envUsed = new Set();
  for (const f of srcFiles) {
    const code = readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    for (const m of code.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) envUsed.add(m[1]);
  }
  const envExample = existsSync(join(ROOT, '.env.example')) ? readFileSync(join(ROOT, '.env.example'), 'utf8') : '';
  const missing = [...envUsed].filter((k) => !envExample.includes(k));
  check(`.env.example deckt alle ${envUsed.size} NEXT_PUBLIC_-Variablen ab`, missing.length === 0, missing.join(', '));

  /* 4 · i18n-Parität: identische Key-Bäume über alle 5 Locales */
  const trees = LOCALES.map((l) => JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8')));
  const keysOf = (o, pre = '') =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, pre + k + '.') : [pre + k]));
  const base = keysOf(trees[0]).sort();
  const parity = LOCALES.map((l, i) => {
    const ks = keysOf(trees[i]).sort();
    const miss = base.filter((k) => !ks.includes(k));
    const extra = ks.filter((k) => !base.includes(k));
    return { l, miss, extra };
  });
  const bad = parity.filter((p) => p.miss.length || p.extra.length);
  check(`i18n-Key-Parität über ${LOCALES.length} Locales (${base.length} Keys)`, bad.length === 0, bad.map((b) => `${b.l}:${b.miss.length}miss/${b.extra.length}extra`).join(', '));

  /* 5 · Legal-Dokumente in jeder Locale vollständig */
  const legalBad = [];
  for (let i = 0; i < LOCALES.length; i++) {
    const t = trees[i];
    for (const doc of ['terms', 'disclaimer', 'privacy']) {
      const sec = t?.legal?.[doc];
      if (!sec || !sec.title || Object.keys(sec).length < 3) legalBad.push(`${LOCALES[i]}/${doc}`);
    }
  }
  check('Legal-Dokumente (terms/disclaimer/privacy) in 5 Locales', legalBad.length === 0, legalBad.join(', '));

  /* 6 · Routing-Struktur + Doktrinen */
  const must = [
    'src/app/[locale]/page.tsx',
    'src/app/[locale]/help/page.tsx',
    'src/app/[locale]/terminal/page.tsx',
    'src/app/[locale]/legal/[doc]/page.tsx',
    'src/app/[locale]/layout.tsx',
  ];
  const missRoute = must.filter((m) => !existsSync(join(ROOT, m)));
  check('Routen-Struktur vollständig (locale-basiert)', missRoute.length === 0, missRoute.join(', '));
  check('KEIN Root-layout.tsx (Next-Doktrin)', !existsSync(join(ROOT, 'src/app/layout.tsx')));

  /* 7 · Doktrin-Konstanten: Wasserzeichen, Wallets, Persist-Keys */
  const all = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  check('Wasserzeichen exakt www.NodeChart.cc', all.includes('www.NodeChart.cc'));
  check(
    'Spenden-Wallets exakt (SOL/BTC/ETH)',
    all.includes('79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8') &&
      all.includes('bc1qeqzrlfg3edrydkakey0hecakc82gp26n5p7hkc7f') &&
      all.includes('0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7'),
  );
  check('Persist-Keys nodechart:store:v1 + nc-viral-v1', all.includes('nodechart:store:v1') && all.includes('nc-viral-v1'));

  /* 8 · Deploy-Konfiguration vorhanden */
  check('wrangler.jsonc vorhanden', existsSync(join(ROOT, 'wrangler.jsonc')));
  check('cf:build-Skript vorhanden (OpenNext/Cloudflare)', readFileSync(join(ROOT, 'package.json'), 'utf8').includes('opennextjs-cloudflare build'));

  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
