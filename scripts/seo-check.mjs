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
    if (route.jsonld) {
      let ok = ldBlocks.length > 0;
      try {
        for (const block of ldBlocks) JSON.parse(block);
      } catch {
        ok = false;
      }
      check(`${tag}: JSON-LD vorhanden & parse-bar`, ok, `n=${ldBlocks.length}`);
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

console.log(`\n${fails === 0 ? '✔' : '✖'} seo-check M1: ${fails === 0 ? 'alle Head/Metadaten sauber' : `${fails} Failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
