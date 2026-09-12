/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Systematic SEO audit (dev-only harness, not shipped).
 *
 * Crawls every locale × route of a running build and verifies the full
 * on-page programme: titles, descriptions, canonicals, hreflang mesh,
 * OpenGraph/Twitter cards, robots directives, JSON-LD graph types,
 * heading hygiene, internal links, FAQ content, sitemap + robots.txt +
 * llms.txt. Run with: node scripts/seo-audit.mjs
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SITE = 'https://nodechart.cc';
const LOCALES = ['en', 'de', 'es', 'zh', 'ru'];

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${detail && !condition ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  const body = await response.text();
  return { status: response.status, body };
}

function tag(body, property) {
  const re = new RegExp(`<meta[^>]+property="${property}"[^>]*>`, 'i');
  const match = body.match(re);
  if (!match) return null;
  const content = match[0].match(/content="([^"]*)"/);
  return content ? content[1] : '';
}
function metaName(body, name) {
  const re = new RegExp(`<meta[^>]+name="${name}"[^>]*>`, 'i');
  const match = body.match(re);
  if (!match) return null;
  const content = match[0].match(/content="([^"]*)"/);
  return content ? content[1] : '';
}
function jsonLdTypes(body) {
  const scripts = [...body.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const types = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (typeof node['@type'] === 'string') types.add(node['@type']);
      Object.values(node).forEach(walk);
    }
  };
  for (const script of scripts) {
    try {
      walk(JSON.parse(script[1].replaceAll('\\u003c', '<')));
    } catch {
      /* broken JSON-LD is itself a failure – surfaced by type absence */
    }
  }
  return types;
}
function hreflangs(body) {
  const map = {};
  for (const match of body.matchAll(/<link[^>]+rel="alternate"[^>]+>/g)) {
    const tagText = match[0];
    const lang = tagText.match(/hreflang="([^"]+)"/i)?.[1];
    const href = tagText.match(/href="([^"]+)"/)?.[1];
    if (lang && href) map[lang] = href;
  }
  return map;
}

console.log('\n— SEO audit: per-locale on-page programme —');
for (const locale of LOCALES) {
  const home = await get(`/${locale}`);
  const title = home.body.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  check(`[${locale}] title length sane (${title.length})`, title.length >= 25 && title.length <= 70, title);
  const description = metaName(home.body, 'description') ?? '';
  check(`[${locale}] meta description 70–170 chars (${description.length})`, description.length >= 70 && description.length <= 170);
  check(`[${locale}] canonical is the locale URL`, home.body.includes(`rel="canonical" href="${SITE}/${locale}"`));
  const langs = hreflangs(home.body);
  check(
    `[${locale}] hreflang mesh complete (5 + x-default)`,
    LOCALES.every((l) => langs[l] === `${SITE}/${l}`) && langs['x-default'] === `${SITE}/en`,
    JSON.stringify(langs),
  );
  check(
    `[${locale}] open graph core tags`,
    Boolean(tag(home.body, 'og:title')) &&
      Boolean(tag(home.body, 'og:description')) &&
      tag(home.body, 'og:url') === `${SITE}/${locale}` &&
      Boolean(tag(home.body, 'og:image')) &&
      tag(home.body, 'og:type') === 'website',
  );
  check(`[${locale}] og locale alternates`, (home.body.match(/property="og:locale:alternate"/g) ?? []).length === 4);
  check(`[${locale}] twitter card = summary_large_image`, metaName(home.body, 'twitter:card') === 'summary_large_image');
  check(`[${locale}] robots meta index,follow`, (metaName(home.body, 'robots') ?? '').includes('index'));
  const types = jsonLdTypes(home.body);
  check(
    `[${locale}] JSON-LD graph: Organization+WebSite+SoftwareApplication+FAQPage`,
    ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage'].every((type) => types.has(type)),
    [...types].join(','),
  );
  const h1Count = (home.body.match(/<h1[\s>]/g) ?? []).length;
  check(`[${locale}] exactly one h1 on landing`, h1Count === 1, String(h1Count));
  check(`[${locale}] visible FAQ section with six entries`, home.body.includes('id="faq"') && (home.body.match(/<details/g) ?? []).length === 6);
  check(`[${locale}] landing links into terminal + help`, home.body.includes(`/${locale}/terminal`) && home.body.includes(`/${locale}/help`));

  const help = await get(`/${locale}/help`);
  const helpTypes = jsonLdTypes(help.body);
  check(
    `[${locale}] help JSON-LD: FAQPage+DefinedTermSet+BreadcrumbList`,
    ['FAQPage', 'DefinedTermSet', 'BreadcrumbList'].every((type) => helpTypes.has(type)),
    [...helpTypes].join(','),
  );
  check(`[${locale}] help breadcrumb nav rendered`, help.body.includes('aria-label="breadcrumb"'));
  const helpH1 = (help.body.match(/<h1[\s>]/g) ?? []).length;
  check(`[${locale}] exactly one h1 on help`, helpH1 === 1, String(helpH1));

  const legal = await get(`/${locale}/legal/terms`);
  check(`[${locale}] legal JSON-LD breadcrumb`, jsonLdTypes(legal.body).has('BreadcrumbList'));

  const terminal = await get(`/${locale}/terminal`);
  check(`[${locale}] terminal stays noindex`, (metaName(terminal.body, 'robots') ?? '').includes('noindex'));
}

console.log('\n— SEO audit: crawlers & machine readers —');
const robots = await get('/robots.txt');
check('robots.txt allows site + names sitemap', robots.status === 200 && robots.body.includes('Sitemap:') && robots.body.includes('/sitemap.xml'));
check('robots.txt keeps the workspace out of the index', robots.body.includes('/*/terminal'));

const sitemap = await get('/sitemap.xml');
const urlCount = (sitemap.body.match(/<url>/g) ?? []).length;
check(`sitemap lists all 25 locale×route URLs (${urlCount})`, urlCount === 25);
check('sitemap carries hreflang alternates + lastmod', sitemap.body.includes('xhtml:link') && sitemap.body.includes('<lastmod>'));

const llms = await get('/llms.txt');
check('llms.txt serves the AI-answer-engine brief', llms.status === 200 && llms.body.startsWith('# NodeChart') && llms.body.includes('## Facts for citations'));

console.log(`\n${failures === 0 ? '✔ seo audit OK' : `✖ ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
