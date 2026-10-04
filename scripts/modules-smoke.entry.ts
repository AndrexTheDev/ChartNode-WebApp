/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Module smoke: die Logik-Bausteine, die von keiner anderen Suite direkt
 * importiert werden (dev-only harness, not shipped):
 *   1. `cex-universe`  – kuratierte Symbol-Suche + Token-Mapping
 *   2. `jsonld`        – alle sechs Structured-Data-Builder (SEO)
 *   3. `notifications` – Graceful-Degradation ohne window/Notification/Audio
 *   4. `locale-param`  – assertLocale-Gate (Server-Pfad, hier offline simuliert)
 *   5. `ad consent`    – local/session parsing, denial priority and fail-closed storage fallback
 *
 * Run with: npm run smoke:modules
 */

(globalThis as unknown as { window: unknown }).window = globalThis;
let failLocalStorageWrites = false;
let failSessionStorageWrites = false;
let failLocalStorageRemovals = false;
{
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failLocalStorageWrites) throw new Error('simulated localStorage write failure');
      mem.set(k, String(v));
    },
    removeItem: (k: string) => {
      if (failLocalStorageRemovals) throw new Error('simulated localStorage removal failure');
      mem.delete(k);
    },
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
}
{
  const mem = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failSessionStorageWrites) throw new Error('simulated sessionStorage write failure');
      mem.set(k, String(v));
    },
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

/* ----------------------------- 5) ad consent ------------------------------- */

console.log('\n— ad consent: fail-closed local preference —');
const consent = await import('@/lib/ads/consent');
const now = 1_800_000_000_000;
const consentRecord = (choice: 'granted' | 'denied', decidedAt = now, version = 1) =>
  JSON.stringify({ version, choice, decidedAt });
check('missing/malformed consent defaults to unknown', consent.parseAdConsent(null, now) === 'unknown' && consent.parseAdConsent('{broken', now) === 'unknown');
check('only a valid fresh grant/denial is accepted', consent.parseAdConsent(consentRecord('granted'), now) === 'granted' && consent.parseAdConsent(consentRecord('denied'), now) === 'denied');
check('expired, future-dated or unknown-version consent fails closed', consent.parseAdConsent(consentRecord('granted', now - consent.AD_CONSENT_TTL_MS - 1), now) === 'unknown' && consent.parseAdConsent(consentRecord('granted', now + 10 * 60_000), now) === 'unknown' && consent.parseAdConsent(consentRecord('granted', now, 2), now) === 'unknown');
localStorage.removeItem(consent.AD_CONSENT_STORAGE_KEY);
sessionStorage.removeItem('nc-ad-consent-session-v1');
check('no stored choice does not permit ad scripts', consent.getAdConsent() === 'unknown' && !consent.canLoadAdScripts());
check('explicit grant is stored and permits ads', consent.setAdConsent('granted') && consent.canLoadAdScripts());
check('explicit rejection is stored and blocks ads', consent.setAdConsent('denied') && consent.getAdConsent() === 'denied' && !consent.canLoadAdScripts());

// A valid session denial overrides a still-readable local grant; no stale grant fallback.
localStorage.setItem(consent.AD_CONSENT_STORAGE_KEY, consentRecord('granted', Date.now()));
sessionStorage.setItem('nc-ad-consent-session-v1', consentRecord('denied', Date.now()));
check('session denial overrides local grant and blocks ad scripts', consent.getAdConsent() === 'denied' && !consent.canLoadAdScripts());
sessionStorage.removeItem('nc-ad-consent-session-v1');
check('removing session denial reveals only the fresh local grant', consent.getAdConsent() === 'granted' && consent.canLoadAdScripts());
localStorage.removeItem(consent.AD_CONSENT_STORAGE_KEY);
sessionStorage.setItem('nc-ad-consent-session-v1', consentRecord('granted', Date.now()));
check('a session grant alone is ignored', consent.getAdConsent() === 'unknown' && !consent.canLoadAdScripts());
sessionStorage.removeItem('nc-ad-consent-session-v1');

localStorage.setItem(consent.AD_CONSENT_STORAGE_KEY, consentRecord('granted', Date.now()));
failLocalStorageWrites = true;
const denialFallbackWorks = consent.setAdConsent('denied') && consent.getAdConsent() === 'denied' && !consent.canLoadAdScripts();
failLocalStorageWrites = false;
check('a local-storage write failure can still persist a session denial', denialFallbackWorks);
localStorage.removeItem(consent.AD_CONSENT_STORAGE_KEY);
sessionStorage.removeItem('nc-ad-consent-session-v1');

localStorage.setItem(consent.AD_CONSENT_STORAGE_KEY, consentRecord('granted', Date.now()));
failLocalStorageWrites = true;
failSessionStorageWrites = true;
const denialWithRemoval = !consent.setAdConsent('denied') && consent.getAdConsent() === 'denied' && !consent.canLoadAdScripts() && localStorage.getItem(consent.AD_CONSENT_STORAGE_KEY) === null && consent.hasVolatileAdDenial();
failLocalStorageWrites = false;
failSessionStorageWrites = false;
check('if both stores fail but local removal works, ads stay blocked in memory', denialWithRemoval);

localStorage.setItem(consent.AD_CONSENT_STORAGE_KEY, consentRecord('granted', Date.now()));
failLocalStorageWrites = true;
failSessionStorageWrites = true;
failLocalStorageRemovals = true;
const staleGrantBlocked = !consent.setAdConsent('denied') && consent.getAdConsent() === 'denied' && !consent.canLoadAdScripts() && localStorage.getItem(consent.AD_CONSENT_STORAGE_KEY) !== null && consent.hasVolatileAdDenial();
failLocalStorageWrites = false;
failSessionStorageWrites = false;
failLocalStorageRemovals = false;
check('if storage and removal fail, volatile denial overrides a readable stale grant', staleGrantBlocked);
check('a later explicit grant clears the in-memory denial', consent.setAdConsent('granted') && consent.getAdConsent() === 'granted' && !consent.hasVolatileAdDenial());
localStorage.removeItem(consent.AD_CONSENT_STORAGE_KEY);
sessionStorage.removeItem('nc-ad-consent-session-v1');

console.log(failures === 0 ? '\n✔ modules smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

// Top-level-await braucht Modul-Status (die Imports erfolgen dynamisch oben).
export {};
