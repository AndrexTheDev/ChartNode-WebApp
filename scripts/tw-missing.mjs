// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// CSS-Audit: welche im Quelltext verwendeten Tailwind-Utilities fehlen im Build?
//
// Hintergrund: Tailwind generiert Farb-Modifier wie `bg-primary/12` nur, wenn
// `12` auf der opacity-Skala existiert. Fehlt der Wert, wird die Klasse
// stillschweigend verworfen – der Hover-/Pressed-State ist dann tot, ohne dass
// Build oder TypeScript meckern. Genau das war die Ursache der QA-Hover-Gaps.
//
// Nutzung: `npm run build && node scripts/tw-missing.mjs`  (Exit 1 bei Lücken)
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const cssFiles = execSync('find .next/static -name "*.css"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
if (!cssFiles.length) {
  console.error('Kein gebautes CSS gefunden – erst `npm run build` ausführen.');
  process.exit(2);
}
const css = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// Im CSS definierte Utility-Namen: jeden Selektor zerlegen, Klassen-Token
// entscapen und Pseudo-Teile abschneiden.
// `.hover\:bg-x\/20:hover` → `hover:bg-x/20`   ·   `.open\:bg-y\/30[open]` → `open:bg-y/30`
const PSEUDOS = new Set([
  'hover','focus','focus-within','focus-visible','active','disabled','open','checked',
  'first-child','last-child','only-child','before','after','placeholder','selection',
  'group-hover','group-active','group-open','marker','file','backdrop','odd','even',
]);
const defined = new Set();
for (const sel of css.matchAll(/([^{}@]+)\{/g)) {
  for (const token of sel[1].split(/[\s,>+~]+/)) {
    const dot = token.indexOf('.');
    if (dot < 0) continue;
    // Token besteht aus Klassen-Segmenten und unescapten Pseudo-Teilen:
    // `hover\:bg-x\/20:hover` → Klassen-Segment `hover\:bg-x\/20`, Pseudo `:hover`
    const name = token
      .slice(dot + 1)
      .split(/(?<!\\):/) // nur unescapte Doppelpunkte trennen
      .map((part) => part.replace(/\\(.)/g, '$1'))
      .filter((part) => !PSEUDOS.has(part))
      .join(':');
    defined.add(name.replace(/\[.*/, ''));
  }
}

const VARIANTS = [
  'hover',
  'focus',
  'focus-within',
  'focus-visible',
  'active',
  'disabled',
  'open',
  'checked',
  'group-hover',
  'group-active',
  'group-open',
  'placeholder',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  'dark',
  'motion-safe',
  'motion-reduce',
].join('|');

const grep = `grep -rhoE '\\b((${VARIANTS}):)*(bg|text|border|from|via|to|shadow|ring|divide|outline|decoration|accent|fill|stroke)-[a-z0-9-]+(/[0-9.]+)?\\b' src --include=*.tsx --include=*.ts`;
const used = new Set(execSync(grep, { encoding: 'utf8' }).split('\n').filter(Boolean));

// SVG-Attribute / CSS-Properties im JSX, keine Tailwind-Utilities
const NOISE = new Set([
  'border-color',
  'stroke-width',
  'text-anchor',
  'from-zero',
  'to-zero',
  'to-end',
  'to-right',
  'to-clipboard',
  'to-market',
  'to-unlock',
  'to-front',
]);

const missing = [...used]
  .filter((t) => !NOISE.has(t))
  .filter((t) => {
    const base = t.split(':').pop();
    return !defined.has(t) && !defined.has(base);
  })
  .sort();

console.log(`CSS-Dateien: ${cssFiles.length} · verwendete Utilities: ${used.size} · im CSS definiert: ${defined.size}`);
console.log(missing.length ? `FEHLENDE Utilities: ${missing.length}` : 'FEHLENDE Utilities: 0 ✔');
for (const m of missing) console.log('  ' + m);
process.exit(missing.length ? 1 : 0);
