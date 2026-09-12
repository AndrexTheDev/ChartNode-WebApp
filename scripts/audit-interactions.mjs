// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Statische + dynamische Inventur aller interaktiven Elemente und ihrer States.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src';
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})(ROOT);

// JSX-Tag-Extraktion über Klammer-/Winkel-Balance (Attribute können {} enthalten)
function extractTags(src, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}(?=[\\s/>])`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = re.lastIndex;
    let depth = 0;
    let end = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    const attrs = src.slice(re.lastIndex, end);
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, attrs, selfClosing: attrs.endsWith('/') });
  }
  return out;
}

const rows = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const tag of ['button', 'input', 'textarea', 'select']) {
    for (const t of extractTags(src, tag)) {
      // className zusammensuchen: Literale, Template-Literals, cn(...)-Blöcke
      const chunk = t.attrs;
      const clsMatch = chunk.match(/className=([\s\S]*?)(?=\s+[a-zA-Z-]+=|$)/);
      const cls = clsMatch ? clsMatch[1].replace(/[\n\r]+/g, ' ') : '';
      const ariaHidden = /aria-hidden="true"/.test(chunk);
      const srOnly = /sr-only/.test(cls) && !/focus:not-sr-only/.test(cls);
      rows.push({
        file: f.replace(/^src\/components\//, '').replace(/^src\/app\//, 'app/'),
        line: t.line,
        tag,
        ariaHidden,
        srOnly,
        cls,
        raw: chunk.replace(/\s+/g, ' ').slice(0, 200),
      });
    }
  }
}

const has = (r, p) => new RegExp(p).test(r.cls) || new RegExp(p).test(r.raw);
const usesSystem = (r) => /neonButtonVariants|NeonButton|\bnc-input\b|nc-chip|nc-panel-hover/.test(r.raw) || /nc-input/.test(r.cls);

const gaps = [];
for (const r of rows) {
  if (r.ariaHidden || r.srOnly) continue;
  const missing = [];
  const isField = r.tag === 'input' || r.tag === 'textarea' || r.tag === 'select';
  const typeCheckbox = /type="(checkbox|radio|range)"/.test(r.raw);
  if (isField) {
    if (!has(r, 'focus:') && !usesSystem(r) && !typeCheckbox) missing.push('focus');
  } else {
    if (!has(r, 'hover:') && !usesSystem(r)) missing.push('hover');
    if (!has(r, 'active:') && !usesSystem(r)) missing.push('active');
    if (!has(r, 'disabled:') && !usesSystem(r)) missing.push('disabled');
    if (!has(r, 'transition') && !usesSystem(r)) missing.push('transition');
  }
  if (missing.length) gaps.push({ ...r, missing });
}

console.log(`interaktive Elemente gesamt: ${rows.length} (sichtbar/relevant: ${rows.filter((r) => !r.ariaHidden && !r.srOnly).length})`);
console.log(`Elemente mit State-Lücken: ${gaps.length}\n`);
const byFile = new Map();
for (const g of gaps) {
  const k = g.file;
  if (!byFile.has(k)) byFile.set(k, []);
  byFile.get(k).push(g);
}
for (const [f, list] of [...byFile.entries()].sort()) {
  console.log(`## ${f}`);
  for (const g of list) console.log(`  :${g.line} <${g.tag}> fehlt[${g.missing.join(',')}]  ${g.cls.slice(0, 90) || g.raw.slice(0, 90)}`);
}
fs.writeFileSync('artifacts/interaction-gaps.json', JSON.stringify(gaps, null, 1));
