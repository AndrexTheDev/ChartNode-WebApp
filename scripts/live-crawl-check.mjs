#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Prüft eine **live** NodeChart-Instanz (Produktion oder Preview) auf
 * Crawl-Hygiene — nicht den lokalen Build.
 *
 * Warum separat von `seo-check.mjs`: Alle anderen Suiten messen gegen den
 * lokalen `next start`. Genau dort ist eine ganze Klasse von Fehlern
 * unsichtbar, weil sie erst am Edge/Host entsteht: Cloudflares verwaltete
 * `robots.txt`-Injektion, vorgeschaltete Content-Signals-Seiten, Edge-Header.
 *
 * In der Arbeits-Sandbox ist kein ausgehendes Netz zu nodechart.cc vorhanden,
 * deshalb bleibt `QA_LIVE_URL=... node scripts/live-crawl-check.mjs` hier ohne
 * Aussage; der Lauf gehört auf einen Host mit Internetzugang.
 *
 *   QA_LIVE_URL=https://nodechart.cc node scripts/live-crawl-check.mjs
 *
 * Geprüft wird:
 *   1. robots.txt erreichbar, **kein** `Disallow: /` für `User-agent: *` oder
 *      `Googlebot` (KI-Crawler-Blöcke sind erlaubt und werden separat gelistet
 *      — `Google-Extended` ist Gemini-**Training**, nicht die Suche).
 *   2. `Sitemap:`-Direktive vorhanden und die Datei erreichbar.
 *   3. Jede Sitemap-URL antwortet 200 (keine 404/Soft-404 im Sitemap).
 *   4. Keine der indexierbaren Seiten trägt `noindex`.
 */

const BASE = (process.env.QA_LIVE_URL ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('QA_LIVE_URL fehlt, z. B. QA_LIVE_URL=https://nodechart.cc');
  process.exit(2);
}

let failures = 0;
let checks = 0;
const check = (name, cond, info = '') => {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`);
  return cond;
};

/** Zerlegt robots.txt in (agents, rules)-Gruppen wie RFC 9309. */
function parseRobots(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (rules.length) {
        groups.push({ agents, rules });
        agents = [];
        rules = [];
      }
      agents.push(value.toLowerCase());
    } else {
      rules.push({ key, value });
    }
  }
  if (agents.length || rules.length) groups.push({ agents, rules });
  return groups;
}

/** Regeln, die für einen bestimmten Crawler gelten (spezifischste Gruppe gewinnt). */
function rulesFor(groups, crawler) {
  const exact = groups.filter((g) => g.agents.includes(crawler));
  if (exact.length) return exact.flatMap((g) => g.rules);
  return groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
}

const fetchText = async (url) => {
  const res = await fetch(url, { redirect: 'follow' });
  return { status: res.status, body: await res.text(), headers: res.headers };
};

console.log(`\n— Live-Crawl-Hygiene: ${BASE} —\n`);

let robots;
try {
  robots = await fetchText(`${BASE}/robots.txt`);
} catch (error) {
  console.error(`  FATAL  robots.txt nicht erreichbar: ${String(error).slice(0, 160)}`);
  process.exit(1);
}

check('robots.txt erreichbar (200)', robots.status === 200, String(robots.status));

const groups = parseRobots(robots.body);

/*
 * Cloudflare liefert vor der eigenen Datei einen verwalteten Block. Der ist
 * zunächst unverdächtig, muss aber mitgeprüft werden: Er enthält viele
 * `Disallow: /`-Zeilen für KI-Crawler. Entscheidend ist, dass **Googlebot**
 * (die Suche) nicht darunter fällt.
 */
const starRules = rulesFor(groups, '*');
const starDisallow = starRules.filter((r) => r.key === 'disallow' && r.value === '/');
check('robots.txt: kein `Disallow: /` für User-agent *', starDisallow.length === 0, `${starDisallow.length} Treffer`);

const gbotRules = rulesFor(groups, 'googlebot');
const gbotDisallow = gbotRules.filter((r) => r.key === 'disallow' && r.value === '/');
check('robots.txt: kein `Disallow: /` für Googlebot', gbotDisallow.length === 0, `${gbotDisallow.length} Treffer`);

const aiBlocked = groups
  .filter((g) => g.rules.some((r) => r.key === 'disallow' && r.value === '/'))
  .flatMap((g) => g.agents)
  .filter((a) => a !== '*');
if (aiBlocked.length) {
  console.log(`        Hinweis: ${aiBlocked.length} Crawler geblockt (KI/Training, nicht Suche): ${aiBlocked.slice(0, 8).join(', ')}${aiBlocked.length > 8 ? ' …' : ''}`);
}

const sitemapLine = robots.body.match(/^\s*sitemap:\s*(\S+)/im)?.[1];
check('robots.txt: Sitemap-Direktive vorhanden', Boolean(sitemapLine), sitemapLine ?? 'fehlt');

if (sitemapLine) {
  /*
   * Gegen die *geprüfte* Instanz auflösen, nicht gegen den Host aus der Datei.
   * Die Direktive trägt die Produktionsdomain (https://nodechart.cc/…); beim
   * Testen einer Preview oder eines lokalen Servers wäre das der falsche Host
   * und würde falsche FAILs erzeugen. Nur der Pfad zählt hier.
   */
  const sitemapUrl = (() => {
    try {
      const u = new URL(sitemapLine);
      return `${BASE}${u.pathname}${u.search}`;
    } catch {
      return sitemapLine;
    }
  })();
  if (sitemapUrl !== sitemapLine) console.log(`        Sitemap gegen ${BASE} aufgelöst: ${sitemapUrl}`);
  const sm = await fetchText(sitemapUrl).catch(() => null);
  check('Sitemap erreichbar (200)', sm?.status === 200, String(sm?.status));
  const locs = [...(sm?.body ?? '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('Sitemap enthält URLs', locs.length > 0, `${locs.length} Einträge`);

  /*
   * Jede Sitemap-URL muss 200 liefern. Ein 404 im Sitemap ist ein echter
   * Crawl-Fehler: Google meldet ihn in der Search Console, und der Eintrag
   * verbrennt Crawl-Budget.
   */
  const rebase = (loc) => {
    try {
      const u = new URL(loc);
      return `${BASE}${u.pathname}${u.search}`;
    } catch {
      return loc;
    }
  };
  const bad = [];
  for (const loc of locs.slice(0, 40)) {
    const res = await fetch(rebase(loc), { redirect: 'follow' }).catch(() => null);
    if (!res || res.status !== 200) bad.push(`${loc} → ${res?.status ?? 'ERR'}`);
  }
  check('alle Sitemap-URLs antworten 200', bad.length === 0, bad.slice(0, 4).join(' | '));

  /* Und keine davon darf noindex tragen. */
  const noindexed = [];
  for (const loc of locs.slice(0, 12)) {
    const body = await fetch(rebase(loc), { redirect: 'follow' }).then((r) => r.text()).catch(() => '');
    const robotsMeta = body.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
    if (/noindex/i.test(robotsMeta)) noindexed.push(`${loc} → ${robotsMeta}`);
  }
  check('indexierbare Sitemap-Seiten ohne noindex', noindexed.length === 0, noindexed.slice(0, 3).join(' | '));
}

console.log(`\n${failures === 0 ? '✔ live-crawl-check OK' : `✖ ${failures} failure(s)`} (${checks} Checks)\n`);
process.exit(failures === 0 ? 0 : 1);
