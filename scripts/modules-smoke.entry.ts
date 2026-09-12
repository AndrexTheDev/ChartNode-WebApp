/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Module smoke: die Logik-Bausteine, die von keiner anderen Suite direkt
 * importiert werden (dev-only harness, not shipped):
 *   1. `cex-universe`  – kuratierte Symbol-Suche + Token-Mapping
 *   2. `jsonld`        – alle sechs Structured-Data-Builder (SEO)
 *   3. `notifications` – Graceful-Degradation ohne window/Notification/Audio
 *   4. `locale-param`  – assertLocale-Gate (Server-Pfad, hier offline simuliert)
 *
 * Run with: npm run smoke:modules
 */

(globalThis as unknown as { window: unknown }).window = globalThis;
{
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
}

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}`);
  if (!condition) failures += 1;
}

/* ------------------------------ 1) cex-universe ---------------------------- */

console.log('\n— cex-universe: kuratierte Suche & Mapping —');
const cu = await import('@/lib/cex-universe');

check('Universe ist kuratiert und gefüllt', cu.CEX_UNIVERSE.length >= 40);
check(
  'jedes Instrument hat Base/Quote/Name + mindestens eine Venue',
  cu.CEX_UNIVERSE.every((i) => !!i.base && !!i.quote && !!i.name && i.exchanges.length > 0),
);
check(
  'keine doppelten Base/Quote-Paare im Universe',
  new Set(cu.CEX_UNIVERSE.map((i) => `${i.base}/${i.quote}`)).size === cu.CEX_UNIVERSE.length,
);
const majors = cu.matchCexUniverse('btc');
check('„btc" matcht und rankt BTC-Paare vorne', majors.length > 0 && majors[0]?.base === 'BTC');
check('Limit wird respektiert', cu.matchCexUniverse('usdt', 3).length <= 3);
check('leerer/zu kurzer Query bleibt bewusst leer (kein Flood in der Suche)', cu.matchCexUniverse('').length === 0 && cu.matchCexUniverse('b').length === 0);
check('hostile Queries kehren sicher zurück', Array.isArray(cu.matchCexUniverse('<img src=x onerror=1>')) && Array.isArray(cu.matchCexUniverse('%%%')));
const first = cu.CEX_UNIVERSE[0];
const token = first ? cu.cexToToken(first, first.exchanges[0] ?? 'binance') : null;
check('cexToToken baut ein Store-kompatibles Token', token !== null && typeof token.symbol === 'string' && token.symbol.includes('/') && !!token.exchange);

/* --------------------------------- 2) jsonld ------------------------------- */

console.log('\n— jsonld: alle sechs Builder —');
const jl = await import('@/lib/jsonld');

const org = jl.organizationLd() as Record<string, unknown>;
check('organizationLd: @type Organization', org['@type'] === 'Organization');
const website = JSON.stringify(jl.websiteLd('de'));
check('websiteLd: trägt Locale-URL, Sprache + Organization-Ref', website.includes('/de') && website.includes('"inLanguage":"de"') && website.includes('#organization'));
const software = JSON.stringify(jl.softwareApplicationLd('en', ['Liq Radar', 'Lag Oracle']));
check('softwareApplicationLd: listet übergebene Features', software.includes('Liq Radar') && software.includes('Lag Oracle'));
const faq = jl.faqPageLd([{ question: 'Q1', answer: 'A1' }]) as Record<string, unknown>;
check('faqPageLd: @type FAQPage + Entity', faq['@type'] === 'FAQPage' && JSON.stringify(faq).includes('Q1'));
const terms = jl.definedTermSetLd('Glossar', [{ term: 'Funding', description: 'd' }]) as Record<string, unknown>;
check('definedTermSet: @type + Term enthalten', terms['@type'] === 'DefinedTermSet' && JSON.stringify(terms).includes('Funding'));
const crumbs = JSON.stringify(jl.breadcrumbLd('de', [{ name: 'Terminal', path: '/de/terminal' }]));
check('breadcrumbLd: BreadcrumbList mit Positions-Items', crumbs.includes('BreadcrumbList') && crumbs.includes('/de/terminal'));
const hostile = JSON.stringify(jl.faqPageLd([{ question: '</script><img src=x>', answer: '"' }]) );
check('jsonld-Builder überleben hostile Strings (strukturell intakt)', hostile.length > 0 && JSON.parse(hostile) !== null);

/* ------------------------------ 3) notifications --------------------------- */

console.log('\n— notifications: Degradation ohne Browser-APIs —');
const nf = await import('@/lib/notifications');

check('notificationGranted() = false ohne window.Notification', nf.notificationGranted() === false);
check('requestNotificationPermission() = false ohne API', (await nf.requestNotificationPermission()) === false);
check('notifyAlert() no-oppt ohne Grant (wirft nicht)', (nf.notifyAlert('T', 'B'), true));
check('beepAlert() no-oppt ohne AudioContext (wirft nicht)', (nf.beepAlert(), true));

/* ------------------------------ 4) locale-param ---------------------------- */

console.log('\n— locale-param: assertLocale-Gate —');
// Server-Component-Pfad: notFound() wirft NEXT_NOT_FOUND – hier simulieren wir
// das Routing-Gate über dieselbe isLocale-Prüfung, die assertLocale nutzt.
const { isLocale } = await import('@/i18n/routing');
check('unterstützte Locales passieren das Gate', (['de', 'en', 'es', 'ru', 'zh'] as string[]).every((l) => isLocale(l)));
check('fremde Locales werden abgewiesen (→ 404 live in qa-modules)', !isLocale('fr') && !isLocale('xx') && !isLocale('de-DE'));

console.log(failures === 0 ? '\n✔ modules smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

// Top-level-await braucht Modul-Status (die Imports erfolgen dynamisch oben).
export {};
