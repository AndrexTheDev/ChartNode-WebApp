// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Gemeinsame Browser-Helfer für die QA-Skripte.
 *
 * Zweck: Die Suiten sollen in **jeder** Umgebung laufen – mit Provider-Netz
 * (echte Livemarktdaten) und ohne (CI, Sandbox, regionaler Block). Statt das
 * Fixture-Wissen in jedes Skript zu kopieren, entscheiden alle hier zentral.
 *
 * Modi (Env `QA_FIXTURES`):
 *   auto    (Default) – Fixtures werden angefordert; erreichbare Provider
 *                        überschreiben sie binnen Sekunden mit echten Kerzen.
 *   on                 – Fixtures immer anfordern (deterministische Läufe).
 *   off                – niemals Fixtures (verhält sich wie früher).
 *
 * Die Fixtures selbst liegen in `src/lib/qa-fixtures.ts` und sind an
 * `?qa=1&fixtures=1` gebunden – ohne URL-Flag passiert in der App nichts.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE = (process.env.QA_FIXTURES ?? 'auto').toLowerCase();
/** Repo-Wurzel, unabhängig vom aktuellen Arbeitsverzeichnis. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = join(ROOT, 'artifacts');

/**
 * `artifacts/` ist gitignored (Screenshots/JSON der Läufe) und existiert in
 * einem frischen Checkout nicht. Mehrere Suiten schreiben aber direkt dorthin
 * (`page.screenshot({ path: 'artifacts/…' })`) und brachen mit
 * `ENOENT: … artifacts/…png` ab, statt zu messen. Dieser Helfer legt das
 * Verzeichnis an, bevor geschrieben wird – idempotent und ohne Seiteneffekt,
 * wenn es schon existiert.
 */
export function ensureArtifacts(...segments) {
  mkdirSync(join(ARTIFACTS, ...segments), { recursive: true });
  return segments.length > 0 ? join(ARTIFACTS, ...segments) : ARTIFACTS;
}

/** Terminal-URL mit QA-Hook und optionalen Fixtures. */
export function terminalUrl(base, path = '/de/terminal') {
  const params = new URLSearchParams({ qa: '1' });
  if (MODE !== 'off') params.set('fixtures', '1');
  return `${base}${path}?${params.toString()}`;
}

/** Erklärt im Log, in welchem Modus der Lauf war – wichtig für die Bewertung. */
export function fixtureMode() {
  return MODE === 'off' ? 'off (echte Provider benötigt)' : MODE === 'on' ? 'on (deterministisch)' : 'auto';
}

/**
 * Minimaler, deterministischer DEX-Upstream für Offline-Läufe.
 *
 * Liefert genau die Formen, die `src/api/dexscreener.ts` normalisiert
 * (`{ pairs: [...] }`), inklusive Liquidität, damit die Auswahl des besten
 * Pools greift. Adressen werden kleingeschrieben verglichen – die Tests
 * suchen mit unterschiedlicher Groß-/Kleinschreibung.
 */
const DEX_FIXTURE_TOKENS = {
  /* WETH auf Ethereum – der Contract, den qa-trader für Honeypot/Scam nutzt. */
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
    symbol: 'WETH', name: 'Wrapped Ether', chain: 'ethereum',
  },
  /* WBTC – DEX-Preset in qa-trader. */
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': {
    symbol: 'WBTC', name: 'Wrapped BTC', chain: 'ethereum',
  },
};

function dexFixturePayload(rawUrl) {
  if (MODE === 'off') return null;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname;
  if (!/(dexscreener|geckoterminal|gopluslabs|honeypot)/.test(host)) return null;

  /* GoPlus/Honeypot: leeres, aber gültiges „kein Risiko"-Ergebnis. Die
     Scam-Tests überschreiben das per window.fetch-Stub im Browser. */
  /*
   * GoPlus-Forensik vollständig: `sanitizeForensics` (OnChainPanel) verlangt
   * holderCount, buyTaxPct, sellTaxPct, top10Pct, lpLockedPct, isMintable und
   * isHoneypot – fehlt EIN Feld, bleibt die Karte im Platzhalter statt Werte
   * zu zeigen. Struktur exakt wie in `src/api/onchain.ts` geparst:
   *   buy_tax/sell_tax  = Dezimalbruch (× 100 → Prozent)
   *   holders[].percent = Dezimalbruch (× 100 → Prozent, Top-10-Summe)
   *   lp_holders[].is_locked = 1|0, percent = Dezimalbruch
   */
  if (/gopluslabs/.test(host)) {
    const addr = (u.searchParams.get('contract_addresses') ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    const makeEntry = (scale) => ({
      holder_count: String(scale),
      buy_tax: '0.005',
      sell_tax: '0.01',
      holders: [
        { address: '0xholder1', percent: '0.12', is_locked: 0 },
        { address: '0xholder2', percent: '0.08', is_locked: 0 },
        { address: '0xholder3', percent: '0.05', is_locked: 0 },
        { address: '0xholder4', percent: '0.03', is_locked: 0 },
      ],
      lp_holders: [
        { address: '0xlp1', percent: '0.86', is_locked: 1 },
        { address: '0xlp2', percent: '0.09', is_locked: 0 },
      ],
      is_mintable: '0',
      is_honeypot: '0',
    });
    const result = {};
    for (const [i, a] of (addr.length > 0 ? addr : ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']).entries()) {
      result[a] = makeEntry(18_400 - i * 100);
    }
    return { code: 1, message: 'OK', result };
  }
  /* honeypot.is: Simulation – nur die Risiko-Flags, keine Konzentrationsdaten. */
  if (/honeypot/.test(host)) {
    return {
      simulationSuccess: true,
      simulation: { buyTax: 0.5, sellTax: 1, transferTax: 0 },
      honeypotResult: { isHoneypot: false },
    };
  }

  /* GeckoTerminal: Pools + OHLCV. Die App holt zuerst Pools für den Token,
     dann `/pools/{addr}/ohlcv/…`. Beides muss offline geantwortet werden,
     sonst bleibt der DEX-Chart leer (`canvases: 0`). */
  if (/geckoterminal/.test(host)) {
    const path = u.pathname.toLowerCase();
    if (path.includes('/ohlcv/')) {
      // 300 simulierte Stundenkerzen, aufsteigend – die App kehrt die Liste um.
      const unit = /\/ohlcv\/(minute)/.test(path) ? 60_000 : /\/ohlcv\/(day)/.test(path) ? 86_400_000 : 3_600_000;
      const agg = Number(u.searchParams.get('aggregate') ?? 1) || 1;
      const step = unit * agg;
      const now = Math.floor(Date.now() / step) * step;
      let price = 61_250;
      const ohlcv = [];
      for (let i = 299; i >= 0; i -= 1) {
        const drift = Math.sin(i / 11) * 240 + (i % 7 - 3) * 45;
        const o = price;
        const c = 61_250 + drift;
        const h = Math.max(o, c) + 40;
        const l = Math.min(o, c) - 40;
        ohlcv.push([Math.floor((now - i * step) / 1000), o, h, l, c, 120 + (i % 40)]);
        price = c;
      }
      return { data: { id: 'fixture', type: 'ohlcv', attributes: { ohlcv_list: ohlcv.reverse() } } };
    }
    // Pool-/Such-Antwort für den ersten Fixture-Token (DexPair-Form).
    const addr = Object.keys(DEX_FIXTURE_TOKENS)[0];
    return {
      data: [
        {
          id: `eth_0xpool${addr.slice(2, 10)}`,
          type: 'pool',
          attributes: {
            address: `0xpool${addr.slice(2, 34)}`,
            name: 'WETH / USDC',
            base_token_price_usd: '3125.18',
            reserve_in_usd: '24500000',
            volume_usd: { h24: '18400000' },
            price_change_percentage: { h24: '1.84' },
            pool_created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
          },
          relationships: {
            network: { data: { id: 'eth' } },
            dex: { data: { id: 'uniswap_v3' } },
            base_token: { data: { id: `eth_${addr}`, type: 'token' } },
            quote_token: { data: { id: 'eth_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', type: 'token' } },
          },
        },
      ],
    };
  }

  const needle = `${u.pathname}${u.search}`.toLowerCase();
  const hits = Object.entries(DEX_FIXTURE_TOKENS).filter(([addr]) => needle.includes(addr));
  const tokens = hits.length > 0 ? hits : [Object.entries(DEX_FIXTURE_TOKENS)[0]];
  const now = Date.now();
  const pairs = tokens.flatMap(([addr, meta], i) => [
    {
      chainId: meta.chain,
      dexId: 'uniswap',
      url: `https://dexscreener.com/${meta.chain}/${addr}`,
      pairAddress: `0xpair${i}${addr.slice(2, 12)}`,
      baseToken: { address: addr, name: meta.name, symbol: meta.symbol },
      quoteToken: { address: '0x0000000000000000000000000000000000000000', name: 'USD Coin', symbol: 'USDC' },
      priceUsd: meta.symbol === 'WBTC' ? '61250.42' : '3125.18',
      priceChange: { h24: 1.84 },
      volume: { h24: 18_400_000 },
      liquidity: { usd: 24_500_000, base: 7800, quote: 24_500_000 },
      fdv: 380_000_000,
      pairCreatedAt: now - 400 * 86_400_000,
      info: { imageUrl: null },
    },
  ]);
  return { schemaVersion: '1.0.0', pairs };
}

/**
 * Externe Provider-Requests blocken, **bevor** navigiert wird.
 *
 * Warum: Ohne Provider-Netz hängt jeder Request bis zum Timeout (10–20 s
 * Stück), die Seite ist beim Messen noch nicht fertig und Layout-/Fokus-
 * Prüfungen laufen gegen ein halb aufgebautes DOM. In der Sandbox sind die
 * Provider ohnehin nicht erreichbar – die Blockade macht den Lauf schnell und
 * deterministisch, statt ihn nur „langsam genug zufällig" zu machen.
 *
 * Nur same-origin (die App selbst), `data:` und `blob:` gehen durch.
 */
export async function stubExternalNetwork(page, base) {
  /*
   * Idempotent: mehrere Suiten rufen den Helper mehrfach auf derselben Page
   * auf (z. B. qa-release nach einem Reload). Ein zweiter `request`-Listener
   * würde dieselbe Anfrage ein zweites Mal fortsetzen/abbrechen und Puppeteer
   * mit „Request is already handled!\" abbrechen. Deshalb pro Page markieren.
   */
  if (page.__ncStubbed) return;
  page.__ncStubbed = true;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const ok = url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:');
    if (ok) return req.continue();
    /*
     * DEX-Suche (DexScreener/GeckoTerminal) beantworten wir offline selbst:
     * mehrere Suiten (qa-trader, qa-onboarding) prüfen Treffer-Listen,
     * Scam-Badges und Forensik-Panels, die ohne Live-DEX nicht entstehen.
     * Der Fake kommt aus derselben Fixture-Quelle wie die Kerzen.
     */
    let dex = null;
    try {
      dex = dexFixturePayload(url);
    } catch (error) {
      console.log('[net] fixture-error', String(error).slice(0, 200), url.slice(0, 80));
      return req.abort();
    }
    if (process.env.QA_DEBUG_NET) console.log('[net]', dex ? 'FIXTURE' : 'abort  ', url.slice(0, 96));
    if (dex) {
      /*
       * CORS ist hier Pflicht: `respond` erzeugt eine synthetische Antwort ohne
       * die Header, die der echte Provider setzen würde. Der Browser verwirft
       * sie dann als Cross-Origin-Fehler (`TypeError: Failed to fetch`) – und
       * zwar auch bei `mode: 'cors'` mit einfacher GET-Anfrage. Mit
       * `access-control-allow-origin: *` verhält sich die Fixture wie das
       * Original (fetchJson sendet keine Credentials).
       */
      return req
        .respond({
          status: 200,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-expose-headers': '*',
            'cache-control': 'no-store',
          },
          body: JSON.stringify(dex),
        })
        .catch((error) => console.log('[net] respond-error', String(error).slice(0, 160)));
    }
    return req.abort();
  });
  /*
   * WebSockets laufen NICHT über die Request-Interception. Ohne diesen Block
   * versucht der Chart weiter `wss://data-stream.binance.vision/ws` und Chrome
   * loggt `WebSocket connection … net::ERR_CONNECTION_CLOSED` als
   * Konsolen-Fehler – in der Sandbox unvermeidbar, aber für die Suiten
   * („0 Konsolen-Fehler") ein falsches Signal. Deshalb Zugriffe auf fremde
   * Hosts auf Transport-Ebene verbieten; same-origin bleibt erlaubt.
   */
  try {
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    await client.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] });
  } catch {
    // CDP nicht verfügbar: Request-Interception deckt den HTTP-Teil weiter ab.
  }
  /*
   * `setBlockedURLs` deckt WebSockets nicht ab. Ein stiller Stub VOR dem
   * App-Bundle verhindert den Verbindungsversuch komplett – dann gibt es auch
   * keine `net::ERR_CONNECTION_CLOSED`-Konsolenfehler mehr. Der Stub sammelt
   * URLs, damit Tests bei Bedarf prüfen können, was die App versucht hätte.
   */
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket;
    class StubWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 3;
        this.bufferedAmount = 0;
        this.extensions = '';
        this.protocol = '';
        this.binaryType = 'blob';
        (window.__ncBlockedSockets ??= []).push(String(url));
        // Asynchron schließen, damit `onopen`-Erwartungen sauber auflaufen.
        setTimeout(() => {
          this.dispatchEvent(new Event('close'));
        }, 0);
      }
      send() {}
      close() {
        this.readyState = 3;
      }
      addEventListener(...args) {
        super.addEventListener(...args);
      }
      removeEventListener(...args) {
        super.removeEventListener(...args);
      }
    }
    // Nur fremde Hosts stubben; same-origin bleibt echt (Tests, die es brauchen).
    const isLocal = (u) => /^(wss?|http)s?:\/\/[^/]*(127\.0\.0\.1|localhost)([:/]|$)/.test(String(u));
    window.WebSocket = new Proxy(Real, {
      construct(target, args) {
        return isLocal(args[0]) ? new target(...args) : new StubWebSocket(args[0]);
      },
    });
  });
}

/**
 * Wartet auf das erste gezeichnete Canvas. Gibt `true` zurück, wenn innerhalb
 * des Budgets eins erschien – die Suiten entscheiden selbst, ob ein fehlendes
 * Canvas ein Skip oder ein Fehler ist.
 */
export async function waitForCanvas(page, timeoutMs = 30_000) {
  try {
    await page.waitForSelector('canvas', { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
