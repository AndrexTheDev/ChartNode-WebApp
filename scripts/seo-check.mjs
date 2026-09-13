// SEO-Check M1: Head/Metadaten über ALLE Routen × 5 Locales.
// Prüft Title/Description (Länge + Einzigartigkeit), Canonical exakt,
// Hreflang-Set (5 Locales + x-default), OG-Set, Twitter-Card, Robots-Meta
// je Routen-Policy, html[lang], H1-Zahl, JSON-LD-Parsebarkeit.
// Nutzung: node scripts/seo-check.mjs   (Server auf :3000 erwartet)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const SITE = 'https://nodechart.cc';
const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];
const HTML_LANG = { de: 'de-DE', en: 'en', es: 'es-ES', ru: 'ru-RU', zh: 'zh-Hans' };
const ROUTES = [
  { path: '', name: 'landing', robots: 'index', h1: 1, jsonld: true },
  { path: '/terminal', name: 'terminal', robots: 'noindex', h1: null, jsonld: false },
  { path: '/help', name: 'help', robots: 'index', h1: 1, jsonld: false },
  { path: '/legal/terms', name: 'legal-terms', robots: 'index', h1: 1, jsonld: false },
  { path: '/legal/privacy', name: 'legal-privacy', robots: 'index', h1: 1, jsonld: false },
  { path: '/legal/disclaimer', name: 'legal-disclaimer', robots: 'index', h1: 1, jsonld: false },
];

// CJK-Locales: Hanzi tragen mehr Information pro Zeichen → eigene Grenzen.
const LIMITS = {
  zh: { titleMin: 10, titleMax: 45, descMin: 20, descMax: 165 },
  default: { titleMin: 20, titleMax: 70, descMin: 50, descMax: 165 },
};

let fails = 0;
const check = (name, cond, info = '') => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info && !cond ? ` — ${String(info).slice(0, 140)}` : ''}`);
};

const decode = (s) =>
  (s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** content eines <meta name|property=...> egal in welcher Attributreihenfolge. */
function meta(html, prop) {
  const re = new RegExp(
    `<meta\\s+(?:name|property)=["']${prop}["'][^>]*?content=["']([^"']*)["']|<meta\\s+content=["']([^"']*)["'][^>]*?(?:name|property)=["']${prop}["']`,
    'i',
  );
  const m = html.match(re);
  return m ? decode(m[1] ?? m[2] ?? '') : null;
}
function attrLink(html, rel, extraAttr) {
  const re = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*?>`, 'gi');
  const out = [];
  for (const m of html.match(re) ?? []) {
    if (extraAttr) {
      const a = m.match(new RegExp(`${extraAttr}=["']([^"']*)["']`, 'i'));
      const h = m.match(/href=["']([^"']*)["']/);
      out.push([a?.[1] ?? null, h?.[1] ?? null]);
    } else {
      const h = m.match(/href=["']([^"']*)["']/);
      out.push([null, h?.[1] ?? null]);
    }
  }
  return out;
}

const titlesByLocale = new Map();

for (const locale of LOCALES) {
  const titles = [];
  for (const route of ROUTES) {
    const url = `${BASE}/${locale}${route.path}`;
    const res = await fetch(url);
    const html = await res.text();
    const tag = `${locale}${route.path || '/'} [${route.name}]`;

    // Title
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
    titles.push(title);
    const lim = LIMITS[locale] ?? LIMITS.default;
    check(
      `${tag}: Title-Länge ${lim.titleMin}–${lim.titleMax}`,
      title.length >= lim.titleMin && title.length <= lim.titleMax,
      `len=${title.length} "${title}"`,
    );

    // Description
    const desc = meta(html, 'description') ?? '';
    check(
      `${tag}: Description-Länge ${lim.descMin}–${lim.descMax}`,
      desc.length >= lim.descMin && desc.length <= lim.descMax,
      `len=${desc.length}`,
    );

    // Canonical exakt
    const canonical = attrLink(html, 'canonical')[0]?.[1] ?? null;
    check(`${tag}: Canonical exakt`, canonical === `${SITE}/${locale}${route.path}`, canonical);

    // Hreflang-Set vollständig
    const hreflangs = attrLink(html, 'alternate', 'hreflang');
    const wantLangs = [...LOCALES, 'x-default'];
    const missing = wantLangs.filter((l) => !hreflangs.some(([h]) => h === l));
    const wrongHref = hreflangs.find(([h, href]) => {
      const expect = h === 'x-default' ? `${SITE}/en${route.path}` : `${SITE}/${h}${route.path}`;
      return href !== expect;
    });
    check(`${tag}: Hreflang-Set 5+x-default, Hrefs korrekt`, missing.length === 0 && !wrongHref, JSON.stringify({ missing, wrongHref }));

    // OG-Set
    const ogTitle = meta(html, 'og:title');
    const ogDesc = meta(html, 'og:description');
    const ogUrl = meta(html, 'og:url');
    const ogImage = meta(html, 'og:image');
    const ogLocale = meta(html, 'og:locale');
    check(
      `${tag}: OG-Set vollständig`,
      Boolean(ogTitle && ogDesc && ogUrl && ogImage && ogLocale),
      JSON.stringify({ ogTitle, ogUrl, ogLocale }),
    );
    check(`${tag}: OG-Url = Canonical`, ogUrl === canonical, ogUrl);

    // Twitter-Card
    const twCard = meta(html, 'twitter:card');
    const twTitle = meta(html, 'twitter:title');
    check(`${tag}: Twitter-Card summary_large_image + Title`, twCard === 'summary_large_image' && Boolean(twTitle), twCard);

    // Robots-Policy je Route
    const robotsMeta = meta(html, 'robots') ?? '';
    const wantRobots = route.robots === 'noindex' ? /noindex/ : /index,\s*follow/;
    check(`${tag}: Robots-Meta (${route.robots})`, wantRobots.test(robotsMeta), robotsMeta);

    // html[lang]
    const lang = html.match(/<html[^>]*\slang=["']([^"']*)["']/i)?.[1] ?? null;
    check(`${tag}: html[lang] = ${HTML_LANG[locale]}`, lang === HTML_LANG[locale], lang);

    // H1-Zahl
    if (route.h1 != null) {
      const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
      check(`${tag}: genau ${route.h1} H1`, h1 === route.h1, `h1=${h1}`);
    }

    // JSON-LD parse-bar
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    let ldOk = true;
    const ldPayloads = [];
    for (const block of ldBlocks) {
      try {
        ldPayloads.push(JSON.parse(block));
      } catch {
        ldOk = false;
      }
    }
    check(`${tag}: JSON-LD parse-bar`, ldOk && (route.jsonld || ldPayloads.length > 0), `n=${ldPayloads.length}`);
    // M2: ohne @context aufgelöst keine Suchmaschine die Entitäten
    const ctxOk = ldPayloads.every((p) => p['@context'] === 'https://schema.org');
    check(`${tag}: jeder LD-Block trägt @context schema.org`, ctxOk);
    const graph = ldPayloads.flatMap((p) => (Array.isArray(p['@graph']) ? p['@graph'] : [p]));
    const types = graph.map((g) => g['@type']);

    if (route.name !== 'terminal') {
      // M2: Site-Entitäten auf jeder indexierten Route
      const org = graph.find((g) => g['@type'] === 'Organization');
      const site = graph.find((g) => g['@type'] === 'WebSite');
      check(`${tag}: Organization + WebSite im Graph`, Boolean(org && site), JSON.stringify(types));
      const action = site?.potentialAction;
      check(
        `${tag}: WebSite-SearchAction mit query-input`,
        action?.['@type'] === 'SearchAction' &&
          String(action?.target?.urlTemplate ?? '').includes('{search_term_string}') &&
          String(action?.['query-input'] ?? '').includes('required'),
        JSON.stringify(action ?? null),
      );
    }
    if (route.name === 'landing') {
      const app = graph.find((g) => g['@type'] === 'SoftwareApplication');
      check(
        `${tag}: SoftwareApplication featureList ≥12 + Offer 0 + Version`,
        (app?.featureList ?? []).length >= 12 && app?.offers?.price === '0' && typeof app?.softwareVersion === 'string',
        `features=${(app?.featureList ?? []).length}`,
      );
    }
    if (route.name === 'help') {
      const faq = graph.find((g) => g['@type'] === 'FAQPage');
      const qs = faq?.mainEntity ?? [];
      const answersOk = qs.every((q) => (q?.acceptedAnswer?.text ?? '').length > 20);
      check(`${tag}: FAQPage ≥10 Fragen mit substanziellen Antworten`, qs.length >= 10 && answersOk, `n=${qs.length}`);
      const glossary = graph.find((g) => g['@type'] === 'DefinedTermSet');
      check(`${tag}: DefinedTermSet ≥20 Terme`, (glossary?.hasDefinedTerm ?? []).length >= 20, `n=${(glossary?.hasDefinedTerm ?? []).length}`);
      const bc = graph.find((g) => g['@type'] === 'BreadcrumbList');
      check(`${tag}: BreadcrumbList Positionen [1,2]`, JSON.stringify((bc?.itemListElement ?? []).map((i) => i.position)) === '[1,2]');
    }
    if (route.name.startsWith('legal')) {
      const bc = graph.find((g) => g['@type'] === 'BreadcrumbList');
      const items = bc?.itemListElement ?? [];
      check(
        `${tag}: BreadcrumbList [1,2], letztes Item = Canonical`,
        JSON.stringify(items.map((i) => i.position)) === '[1,2]' && items[1]?.item === canonical,
        JSON.stringify(items.map((i) => i.item)),
      );
    }
  }

  // Title-Einzigartigkeit innerhalb der Locale (Landing vs. Rest)
  const landing = titles[0];
  const dupes = titles.slice(1).filter((t) => t === landing || t === '');
  check(`${locale}: Landing-Title eindeutig ggü. Unterrouten`, dupes.length === 0, JSON.stringify(titles));
  titlesByLocale.set(locale, titles);
}

// Description-Einzigartigkeit je Locale über Routen
for (const [locale, titles] of titlesByLocale) {
  const unique = new Set(titles).size === titles.length;
  check(`${locale}: alle 6 Titles unterschiedlich`, unique, JSON.stringify(titles));
}

// robots.txt + sitemap.xml sanity
const robotsTxt = await (await fetch(`${BASE}/robots.txt`)).text();
check('robots.txt: Sitemap-Zeile + kein Terminal-Disallow', robotsTxt.includes('sitemap.xml') && !robotsTxt.includes('disallow: /*/terminal'), robotsTxt.slice(0, 200));
check('robots.txt: Social-Bots erlaubt', robotsTxt.includes('Twitterbot') && robotsTxt.includes('facebookexternalhit') && robotsTxt.includes('TelegramBot'));
const sitemapXml = await (await fetch(`${BASE}/sitemap.xml`)).text();
const sitemapUrls = (sitemapXml.match(/<loc>/g) ?? []).length;
// 5 indexierbare Routen (Terminal = noindex, bewusst draußen) × 5 Locales
check('sitemap.xml: 25 URLs (5 Routen × 5 Locales, Terminal=noindex)', sitemapUrls === 25, `n=${sitemapUrls}`);
check('sitemap.xml: keine Terminal-URLs', !sitemapXml.includes('/terminal'), '');

/* ---------------------------------- M8 ---------------------------------- */
// Tech-Hygiene: 404-Matrix, Redirect-Verhalten, absolute Card-/OG-URLs
const finalStatus = async (path, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: 'follow' });
  return res.status;
};
check('M8: unbekannter Locale-Pfad /xx endet 404', (await finalStatus('/xx')) === 404);
check('M8: unbekannte Seite /de/nope = 404', (await finalStatus('/de/nope')) === 404);
check('M8: unbekanntes Legal-Doc = 404 (keine Soft-404)', (await finalStatus('/de/legal/nope')) === 404);
const rootNoAl = await fetch(`${BASE}/`, { redirect: 'manual' });
const rootDe = await fetch(`${BASE}/`, { redirect: 'manual', headers: { 'accept-language': 'de-DE,de;q=0.9' } });
check('M8: / ohne Accept-Language → defaultLocale en', rootNoAl.status === 307 && (rootNoAl.headers.get('location') ?? '').endsWith('/en'), rootNoAl.headers.get('location'));
check('M8: / mit Accept-Language de → /de', rootDe.status === 307 && (rootDe.headers.get('location') ?? '').endsWith('/de'), rootDe.headers.get('location'));
const vary = (rootNoAl.headers.get('vary') ?? '') + (rootNoAl.headers.get('cache-control') ?? '');
check('M8: Locale-Redirect nicht edge-cachebar ohne Vary', /accept-language/i.test(vary) || /no-store|no-cache|max-age=0/.test(vary), vary);
for (const locale of LOCALES) {
  for (const route of ROUTES) {
    const html = await (await fetch(`${BASE}/${locale}${route.path}`)).text();
    const urls = [
      html.match(/<meta property="og:image" content="([^"]+)"/)?.[1],
      html.match(/<meta property="og:url" content="([^"]+)"/)?.[1],
      html.match(/<meta (?:name|property)="twitter:image" content="([^"]+)"/)?.[1],
    ].filter(Boolean);
    check(`M8 ${locale}${route.path || '/'}: OG/Card-URLs absolut (https)`, urls.every((u) => u.startsWith('https://')), urls.join('|'));
  }
}

/* ---------------------------------- M7 ---------------------------------- */
// Social Cards: lokalisierte OG-SVGs, Injection-Guards, Bot-Fetch, Card-Images
const og = async (qs) => (await fetch(`${BASE}/api/og${qs}`)).text();
const ogDe = await og('?ticker=SOL&locale=de');
check('M7: OG-Card de lokalisiert', ogDe.includes('kein Account') && ogDe.includes('Echtzeit'), '');
const ogZh = await og('?ticker=SOL&locale=zh');
check('M7: OG-Card zh lokalisiert', ogZh.includes('终端'), '');
const ogEn = await og('?ticker=SOL&locale=en');
check('M7: OG-Card en lokalisiert', ogEn.includes('no account'), '');
const ogInj = await og('?ticker=%3Csvg%20onload%3Dalert(1)%3E&locale=de');
check('M7: OG-Injection gesannt (kein onload-Markup)', !ogInj.includes('onload='), '');
const ogProto = await og('?ticker=BTC&locale=constructor');
check('M7: locale=constructor fällt auf EN zurück', ogProto.includes('no account'), '');
for (const locale of ['de', 'en']) {
  const html = await (await fetch(`${BASE}/${locale}/terminal?ticker=SOL&price=150`)).text();
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? '';
  const twImage = html.match(/<meta name="twitter:image" content="([^"]+)"/)?.[1] ?? html.match(/<meta property="twitter:image" content="([^"]+)"/)?.[1] ?? '';
  check(`M7 ${locale}: Card-Image = /api/og mit Ticker`, ogImage.includes('/api/og?ticker=SOL') && twImage.includes('/api/og?ticker=SOL'), `${ogImage} | ${twImage}`);
}
const tDe = (await (await fetch(`${BASE}/de`)).text()).match(/<meta property="og:title" content="([^"]+)"/)?.[1];
const tEn = (await (await fetch(`${BASE}/en`)).text()).match(/<meta property="og:title" content="([^"]+)"/)?.[1];
check('M7: OG-Titel lokalisiert (de ≠ en)', Boolean(tDe && tEn && tDe !== tEn), `${tDe} | ${tEn}`);
for (const bot of ['TelegramBot/1.0', 'Twitterbot/1.0', 'facebookexternalhit/1.1']) {
  const res = await fetch(`${BASE}/de/terminal?ticker=SOL`, { headers: { 'user-agent': bot } });
  const body = await res.text();
  check(`M7: Bot ${bot.split('/')[0]} erhält 200 + OG-Titel`, res.status === 200 && body.includes('og:title'), `${res.status}`);
}

/* ---------------------------------- M6 ---------------------------------- */
// Font-Budget: gebündelte woff2-Dateien im Build (Subsets × Weight-Schnitt)
import { readdirSync } from 'node:fs';
try {
  const woff2 = readdirSync(new URL('../.next/static/media', import.meta.url)).filter((f) => f.endsWith('.woff2'));
  check('M6: woff2-Files im Build ≤ 20 (Subset/Weight-Schnitt)', woff2.length <= 20, `n=${woff2.length}`);
} catch {
  check('M6: woff2-Files im Build ≤ 20 (Subset/Weight-Schnitt)', false, '.next/static/media nicht gefunden – build nötig');
}
for (const locale of ['de', 'ru']) {
  const html = await (await fetch(`${BASE}/${locale}`)).text();
  const fonts = (html.match(/<link[^>]*rel="preload"[^>]*as="font"[^>]*>/g) ?? []).length;
  check(`M6 ${locale}: Font-Preload-Hints ≤ 10`, fonts <= 10, `n=${fonts}`);
}

/* ---------------------------------- M5 ---------------------------------- */
// Help-Center: Sektionen mit Headings, Anker, TOC, SSR-Inhalt, FAQ-LD-Urls
for (const locale of LOCALES) {
  const html = await (await fetch(`${BASE}/${locale}/help`)).text();
  const tag = `${locale}/help [M5]`;
  const h2 = (html.match(/<h2[\s>]/gi) ?? []).length;
  const h3 = (html.match(/<h3[\s>]/gi) ?? []).length;
  check(`${tag}: ≥8 h2 (TOC+Sektionen) & ≥40 h3 (Einträge)`, h2 >= 8 && h3 >= 40, `h2=${h2} h3=${h3}`);
  const levels = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
  let skip = false;
  for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) skip = true;
  check(`${tag}: Hierarchie ohne Skip`, levels[0] === 1 && !skip, JSON.stringify(levels.slice(0, 6)));
  check(`${tag}: Sektions-Anker sec-indicators/sec-metrics`, html.includes('id="sec-indicators"') && html.includes('id="sec-metrics"'));
  const tocLinks = (html.match(/href="#sec-[a-zA-Z]+"/g) ?? []).length;
  check(`${tag}: TOC mit ≥6 Anker-Links`, tocLinks >= 6, `n=${tocLinks}`);
  check(`${tag}: Indikator-Deep-Link-Anker SSR (ind-RSI)`, html.includes('trigger-ind-RSI') || html.includes('panel-ind-RSI'));
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => JSON.parse(m[1]));
  const graph = ld.flatMap((x) => (Array.isArray(x['@graph']) ? x['@graph'] : [x]));
  const faq = graph.find((g) => g['@type'] === 'FAQPage');
  const withUrl = (faq?.mainEntity ?? []).filter((q) => String(q.url ?? '').includes(`/help#`)).length;
  check(`${tag}: FAQ-LD-Fragen tragen Help-Anker-URLs`, withUrl >= 10, `n=${withUrl}`);
}

/* ---------------------------------- M4 ---------------------------------- */
// Landing-Semantik: H1-Keyword, Heading-Hierarchie, interne Links, Anker, imgs
for (const locale of LOCALES) {
  const html = await (await fetch(`${BASE}/${locale}`)).text();
  const tag = `${locale}/ [landing-M4]`;
  const h1 = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  check(`${tag}: H1 trägt Keyword-Cluster (TradingView + CEX)`, /TradingView/i.test(h1) && /CEX/i.test(h1), h1);
  const levels = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
  let skip = false;
  for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) skip = true;
  check(`${tag}: Heading-Hierarchie ohne Level-Skip`, levels[0] === 1 && !skip && levels.length >= 4, JSON.stringify(levels));
  const termLinks = (html.match(/href="[^"]*\/terminal[^"]*"/g) ?? []).length;
  const helpLinks = (html.match(/href="[^"]*\/help[^"]*"/g) ?? []).length;
  const anchorLinks = (html.match(/href="[^"]*#features"/g) ?? []).length;
  const anchorTarget = (html.match(/id="features"/g) ?? []).length;
  check(`${tag}: interne Links (Terminal ≥1, Help ≥1, #features ≥1 + Ziel)`, termLinks >= 1 && helpLinks >= 1 && anchorLinks >= 1 && anchorTarget === 1, JSON.stringify({ termLinks, helpLinks, anchorLinks, anchorTarget }));
  const badImgs = [...html.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/alt="/.test(m[0]) || !/width="/.test(m[0]) || !/height="/.test(m[0]));
  check(`${tag}: alle <img> mit alt+width+height`, badImgs.length === 0, badImgs.map((m) => m[0]).join('|').slice(0, 100));
  const fontPreloads = (html.match(/<link[^>]*rel="preload"[^>]*as="font"[^>]*>/g) ?? []).length;
  check(`${tag}: LCP-Fonts vorgeladen (preload as=font)`, fontPreloads >= 1, `n=${fontPreloads}`);
}

/* ---------------------------------- M3 ---------------------------------- */
// Sitemap: gepflegte lastmod-Werte statt Build-Zeitstempel
const sm = sitemapXml;
const entries = [...sm.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
const locOf = (e) => e.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? '';
const modOf = (e) => e.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? '';
const EXPECTED_LASTMOD = { '': '2026-09-14', '/help': '2026-09-13', '/legal/terms': '2026-08-01', '/legal/privacy': '2026-08-01', '/legal/disclaimer': '2026-08-01' };
for (const [path, mod] of Object.entries(EXPECTED_LASTMOD)) {
  const rows = entries.filter((e) => {
    const loc = locOf(e).replace(`${SITE}/`, '');
    const p = loc.replace(/^(de|en|es|ru|zh)/, '');
    return p === path;
  });
  const ok = rows.length === 5 && rows.every((e) => modOf(e).startsWith(mod));
  check(`sitemap: lastmod ${mod} für ${path || '/'} (5 Locales)`, ok, rows.map(modOf).join(','));
}
const distinctMods = new Set(entries.map(modOf)).size;
check('sitemap: lastmod unterscheidet Routen (kein Build-Timestamp)', distinctMods >= 3, `distinct=${distinctMods}`);

// Cache-Header: SEO-Assets am Edge, HTML s-maxage
const cc = async (path) => (await fetch(`${BASE}${path}`)).headers.get('cache-control') ?? '';
const ccSitemap = await cc('/sitemap.xml');
check('M3: sitemap.xml Edge-Cache 1h', ccSitemap.includes('max-age=3600') && ccSitemap.includes('s-maxage=3600'), ccSitemap);
const ccRobots = await cc('/robots.txt');
check('M3: robots.txt Edge-Cache 1h', ccRobots.includes('s-maxage=3600'), ccRobots);
const ccOg = await cc('/og.png');
check('M3: og.png Edge-Cache 7d', ccOg.includes('s-maxage=604800'), ccOg);
const ccHtml = await cc('/de/help');
check('M3: HTML s-maxage=300 + must-revalidate', ccHtml.includes('s-maxage=300') && ccHtml.includes('must-revalidate'), ccHtml);

// Duplikate: Parameter/Case/Slash müssen kanonisch kollabieren
const paramRes = await fetch(`${BASE}/de/terminal?ticker=SOL&price=150`);
const paramHtml = await paramRes.text();
const paramCanon = paramHtml.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const paramRobots = paramHtml.match(/<meta name="robots" content="([^"]+)"/)?.[1];
check('M3: ?ticker=-Duplikat kanonisiert + noindex', paramCanon === `${SITE}/de/terminal` && /noindex/.test(paramRobots ?? ''), `${paramCanon} / ${paramRobots}`);
const slash = await fetch(`${BASE}/de/help/`, { redirect: 'manual' });
check('M3: Trailing-Slash 308 auf /de/help', slash.status === 308 && (slash.headers.get('location') ?? '').endsWith('/de/help'), `${slash.status} ${slash.headers.get('location')}`);
const caseLoc = await fetch(`${BASE}/DE`, { redirect: 'manual' });
const caseFinal = await fetch(`${BASE}/DE`);
const caseHtml = await caseFinal.text();
const caseCanon = caseHtml.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
check('M3: Case-Variante /DE redirectet & kanonisiert auf /de', caseLoc.status === 307 || caseLoc.status === 308 ? caseCanon === `${SITE}/de` : caseCanon === `${SITE}/de`, `${caseLoc.status} ${caseCanon}`);
const root = await fetch(`${BASE}/`, { redirect: 'manual' });
check('M3: / redirectet auf Locale (307/308)', root.status === 307 || root.status === 308, `${root.status}`);

console.log(`\n${fails === 0 ? '✔' : '✖'} seo-check M1–M3: ${fails === 0 ? 'Metadaten, Structured Data & Crawl-Hygiene sauber' : `${fails} Failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
