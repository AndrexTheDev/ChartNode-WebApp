# NodeChart — Senior Security & Systems Audit (Build · Typen · SSG · Client-Side Security)

**Datum:** 2026-09-11 · **Stack:** Next.js 16.3.4 (App Router) · Tailwind 3.4.19 · Zustand 5.0.15 · next-intl 4.14.2 · @opennextjs/cloudflare 1.20.6
**Verdikt:** ✅ **Build 0 Warnungen / 0 Fehler · tsc strict clean · 0 `any` · 0 echte Type-Cast-Escapes · 100 % Cloudflare-Pages-kompatibel ($0) · keine Secrets im Code · alle XSS-Sinks entschärft · User-Script-Engine gehärtet.**

---

## 1. Build & Type Checking

### 1.1 Statische Typprüfung
- `tsconfig.json`: `strict: true` **plus** `noUncheckedIndexedAccess` (Index-Zugriffe sind `T | undefined` → erzwingt explizite Narrowing statt stiller Casts).
- `npx tsc --noEmit` → **EXIT 0, null Fehler.**
- `npm run lint` (eslint über **gesamtes Repo** inkl. `scripts/`) → **0 Errors, 0 Warnings** (vorher: 9 Warnings).
- `npm run build` → **Compiled successfully, 0 Warnings, 0 Errors** (vorher: 2 Edge-Runtime-Deprecation-Warnungen, siehe 2.3).

### 1.2 Befund: `any`-Types → 0
Scan (`: any`, `<any>`, `as any`) über `src/`: einzige Treffer sind das englische Wort „any" in Kommentaren. **Kein einziger `any`-Typ im Code.**

### 1.3 Befund & Fix: `as unknown as`-Escapes (3 → 0)
**`src/components/chart/PriceChart.tsx`** — der Bar-Datentyp war strukturell erfunden (`{ time: number } & Record<string, unknown>`) und wurde an zwei Stellen mit `as unknown as` an die lightweight-charts-API gezwungen:

```ts
// VORHER (Escape Hatches)
type BarPoint = { time: number } & Record<string, unknown>;
…
series.update(points[i] as unknown as SeriesDataItemTypeMap<Time>[SeriesType]);
…
series.setData(points as unknown as SeriesDataItemTypeMap<Time>[SeriesType][]);
```

```ts
// NACHHER — echter Library-Typ, castfrei
import type { SeriesDataItemTypeMap, LineData, HistogramData } from 'lightweight-charts';
type BarPoint = SeriesDataItemTypeMap<Time>[SeriesType];
…
const point = points[i];            // noUncheckedIndexedAccess → T | undefined
if (point) series.update(point);    // Narrowing statt Cast
…
series.setData(points);
```
Zusätzlich: 6× `as BarPoint[]` an Call-Sites entfernt; `mapSeries()` bekam echten Return-Typ `(LineData<Time> | HistogramData<Time>)[]` statt `unknown[]`.

**`src/lib/notifications.ts`** — Safari-Fallback mit Window-Cast:

```ts
// VORHER
const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
```
```ts
// NACHHER — sauber deklariert in src/types/global.d.ts
declare global {
  interface Window { webkitAudioContext?: typeof AudioContext }
}
// …
const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? window.webkitAudioContext) : undefined;
```

### 1.4 Befund & Fix: implizite Casts an Trust-Grenzen → Type-Guards
Persistierte/URL-Werte (`unknown` aus localStorage bzw. Query-Params) wurden per `includes()` **+ Cast** validiert. Ersetzt durch echte Guards in `src/store/presets.ts`:

```ts
export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (TIMEFRAMES as readonly string[]).includes(value);
}
export function isChartType(value: unknown): value is ChartType { … }
export function isChartLayoutId(value: unknown): value is ChartLayoutId { … }
```
Anwendung: `useAppStore.ts` (Rehydration-Merge), `useChartStore.ts` (persistierte Pane-Timeframes), `TerminalShell.tsx` (dort war der Cast sogar überflüssig — `TIMEFRAMES` ist `as const`, `value` bereits `Timeframe`; inkl. Entfernen des nun ungenutzten `Timeframe`-Imports).

> Ein `as readonly string[]` bleibt inside der Guards: Das ist **kein** Unsicherheits-Cast, sondern die notwendige Verbreiterung des Readonly-Tuple-Typs für `Array.includes`.

### 1.5 Verbleibende Casts (inventarisiert, alle legitim)
| Cast | Stelle | Begründung |
|---|---|---|
| `as UTCTimestamp` | Feed-Adapter | Branding-Cast: lightweight-charts erwartet gebrandete `number`-Subtypen; Werte stammen aus eigenen Normalizern |
| `as const` | Konstanten | Literal-Typing, kein Downcast |
| `as AnySeries` | PriceChart-Series-Registry | Union→Registry-Map; Series werden ausschließlich aus derselben Union befüllt |

**0 ungenutzte Imports/Variablen** (eslint `no-unused-vars` über ganzes Repo clean; 9 Warnungen in `scripts/*.mjs` beseitigt: tote `STYLE_PROBE`-Konstante, No-op-Loop, tote `openedMenu`/`openedModal`/`clipper`/`liveCount`/`offCount`-Zuweisungen, `_label`-Rename).

---

## 2. SSG-Kompatibilität (Cloudflare Pages, $0)

### 2.1 Scan auf Node.js-Server-Laufzeitfunktionen
| Muster | Treffer in `src/` |
|---|---|
| `getServerSideProps` / `getStaticProps` (Pages-API) | **0** (reiner App Router) |
| `'use server'` / Server Actions | **0** |
| `fs` / `node:fs` / `node:*`-Importe | **0** |
| Dynamic Opt-ins (`cookies()`, `headers()`, `revalidate`, `force-dynamic`) | **0** |
| Kind-Prozesse, Worker-Threads, native Addons | **0** |

### 2.2 Build-Beweis: Routen-Tabelle (`next build`)
```
┌ ○ /_not-found
├ ● /[locale]            (en, de, es, +2 — generateStaticParams)
├ ● /[locale]/help       (5 Locales)
├ ● /[locale]/legal/[doc] (15 Dokumente)
├ ƒ /[locale]/terminal
├ ƒ /api/og
├ ○ /icon.svg
├ ○ /llms.txt
├ ○ /manifest.webmanifest
├ ○ /robots.txt
├ ○ /sitemap.xml
ƒ Proxy (Middleware)
```
**37 statische Seiten werden zur Build-Zeit prerendered** (○/●). Die drei `ƒ`-Einträge sind **keine SSG-Verletzungen**, sondern Worker-Routen:
1. **`/[locale]/terminal`** — liest `searchParams` (`?ticker=&price=`) für die OG-Share-Card (gewünschtes Feature: geteilte Setups rendern ihr eigenes Social-Image). Query-Raum ist unendlich → nicht prerenderbar; rendert auf dem CF-Worker.
2. **`/api/og`** — query-getriebener SVG-Generator (pure String-Funktion, keine Node-APIs).
3. **Proxy/Middleware** (`src/proxy.ts`, Next 16) — Locale-Erkennung via `Accept-Language`/Cookie + `cf-ipcountry`-Mirror; läuft nativ auf der CF-Edge.

Alle drei laufen unter **@opennextjs/cloudflare auf Workers (Free Tier)** — kein Node-Server-Prozess, kein Backend, **$0-konform**. Es gibt keine Route, die Node.js-Runtime-Features benötigt.

### 2.3 Fix: Edge-Runtime-Deprecation (2 Build-Warnungen → 0)
```ts
// VORHER — src/app/api/og/route.ts
export const runtime = 'edge';
// ⚠ The Edge Runtime is deprecated …
// ⚠ Using edge runtime on a page currently disables static generation …
```
**NACHHER:** Export entfernt. Der Handler ist eine pure String-Funktion (Web-`Response`), läuft im Default-Runtime und wird von OpenNext ohnehin nach workerd kompiliert. Build seitdem warnungsfrei.

### 2.4 Fix: `/llms.txt` dynamisch → statisch
Next 16 rendert Route-Handler per Default pro Request. Der Inhalt besteht ausschließlich aus Build-Konstanten:
```ts
// src/app/llms.txt/route.ts
export const dynamic = 'force-static';
```
→ `ƒ /llms.txt` wurde zu `○ /llms.txt` (prerendered, eine weitere Route weniger auf dem Worker).

---

## 3. Client-Side Security

### 3.1 Secrets / vertrauliche Strings
- Env-Scan: ausschließlich `NEXT_PUBLIC_*`-Variablen (Adsterra-Platzierungs-IDs, `NEXT_PUBLIC_SITE_URL`) — **per Next.js-Design im Client-Bundle öffentlich** und keine Credentials (Werbenetzwerk-Slot-IDs sind Public-Identifier).
- Pattern-Scan über Repo (`sk-`, `ghp_`, `xox`, `AIza`, `BEGIN … PRIVATE KEY`, `Bearer `): **0 Treffer.**
- `.env.example` enthält nur Platzhalter; keine echte `.env` committet.
- **Keine API-Keys für Börsen nötig/by design** (öffentliche REST/WS-Endpunkte) → es gibt nichts zu leaken.
- Ad-URLs sind env-driven, keine Hardcoded-Domains im Code (`src/lib/ads/config.ts`).

### 3.2 XSS-Sinks (vollständiges Inventar)
| Sink | Bewertung |
|---|---|
| `dangerouslySetInnerHTML` × 2 | **ThemeBootScript:** statischer, dependency-freier Inline-Code; einziger dynamischer Anteil ist `JSON.stringify(STORAGE_KEY)` (Build-Konstante); liest localStorage **nur** durch strikte Whitelist `/^(acid\|violet\|light\|matrix\|miami)$/` in try/catch → kein Injektionspfad. **JsonLd:** `JSON.stringify(data).replace(/</g, '\\u003c')` → `</script>`-Breakout unmöglich. |
| `innerHTML` / `outerHTML`-Writes | **0** in `src/` (Ad-Loader nutzt `document.createElement` + `src`-Property) |
| `new Function` (Script Lab) | siehe 3.3 — gehärtet |
| `eval` | **0** |
| OG-Route (`searchParams` → SVG) | `sanitizeTicker` (`[^A-Z0-9]` strip, max 10 Zeichen), `sanitizePrice`, `changePct`-Clamp (±99.99, `Number.isFinite`) + `escapeXml` auf allen Textfeldern. Live-Probe mit `<script>`/`"onload`-Payload → 200, **0 Injektions-Artefakte** im SVG. |
| `target="_blank"` ohne `rel` | **0** (alle mit `noopener noreferrer`) |
| `postMessage`-Listener | **0** |
| Externe Skript-URLs hartcodiert | **0** `.js`-URLs in `src/` |

### 3.3 Härtung: User-Script-Engine (`src/lib/scripts.ts`)
Script-Lab-Formeln liefen via `new Function('i','api', 'with (api) { return (…); }')` mit freiem Zugriff auf alle Browser-Globals. **Fix: 24 Plattform-Globals werden als Funktionsparameter gereicht und damit im Scope geshadowed** (`window`, `document`, `globalThis`, `self`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `Worker`, `Function`, …):

```ts
const fn = new Function(
  'i', 'api', ...SHADOWED_GLOBALS,
  // NOTE: deliberately sloppy mode – `with` ist in strict mode verboten.
  `with (api) { return (${source}); }`,
);
```
Verifiziert (Node-Harness): `close + sma(14)` → korrekt; `typeof window/fetch/document/localStorage` → **`undefined`** statt Plattform-Objekt.

**Ehrliches Trust-Modell (dokumentiert im Code):** Scripts laufen ausschließlich im Browser des Traders selbst — gleiches Vertrauensniveau wie die Devtools-Konsole (Wave-5-Doktrin: eigene Scripts schreiben & importieren). Das Shadowing verhindert *versehentlichen* Zugriff auf DOM/Netz/Storage und tipobedingte Auflösungen wie `window.close`; es ist **Defense-in-Depth, keine harte Sandbox** (determinierte Escapes, z. B. indirektes `eval`, bleiben möglich — echte Isolation ginge nur via Realm/Worker, unverhältnismäßig invasiv). Der Import-Dialog behält seine explizite Warnung vor Community-Scripts.

### 3.4 Externe Skripte (Werbung / i18n / Analytics)
- **Adsterra:** Einbindung via `next/script` (`strategy="lazyOnload"`, hydration-safe) + `src/lib/ads/adsterra.ts`-Loader mit `document.createElement('script')` und `src`-Property — **kein `innerHTML`, kein `document.write`**. URLs kommen aus Env; bei leeren Env-Variablen wird nichts geladen.
- **i18n:** next-intl mit **lokal gebundelten** Katalogen — kein externes Skript/CDN.
- **Analytics:** keines vorhanden.
- **Börsen-Daten:** öffentliche REST/WS-Endpunkte direkt vom Client; keine Keys, keine Proxies.
- **Fundstelle (Drittanbieter-DOM):** lightweight-charts injiziert selbst einen „Charting-by-TradingView"-Attribution-Anchor (`utm_source` enthält den Hostnamen — wird **nur bei Klick** übertragen, kein Skript, kein Pixel). Lizenzkonforme Bibliotheks-Markierung; bewusst nicht entfernt, aus QA-Scans als Nicht-App-Control ausgeschlossen.

### 3.5 Header & Konfiguration
- `next.config.mjs`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` auf `/:path*`; `poweredByHeader: false`; `images.unoptimized` (kein Image-Server nötig → $0).
- **CSP bewusst nicht gesetzt:** Ad-Netzwerke injizieren dynamische Inline-Skripte; eine strikte CSP würde das Werbefinanzierungs-Modell (Wave-final-Doktrin) brechen. Kompensation: nosniff + Referrer-Policy + Permissions-Policy + keine `innerHTML`-Sinks + Env-gated Ad-Loader. Als Produktions-Option ist eine `Content-Security-Policy-Report-Only`-Phase im Bericht als Empfehlung vermerkt.

---

## 4. Regression & QA-Beweise (nach allen Fixes, frischer Production-Build)

| Suite | Ergebnis |
|---|---|
| `npx tsc --noEmit` | **0 Fehler** |
| `npm run lint` (gesamtes Repo) | **0 Errors, 0 Warnings** |
| `npm run build` | **0 Warnungen, 0 Errors**, 37 Seiten prerendered |
| `npm run audit:css` | 265 verwendete Utilities, **0 fehlende** |
| `qa-trader` (inkl. Script-Lab/Forensik/Rate-Limit) | **29/29** |
| `qa-interaction` | **25/25** (3 konsekutive Läufe stabil) |
| `qa-responsive` | **43/43** |
| `browser-check` (breiteste Suite) | **169 Checks OK** |
| `/api/og` Live-Probe | 200 `image/svg+xml`, XSS-Payload sauber neutralisiert |
| `/llms.txt` | 200 `text/plain` (jetzt statisch prerendered) |

### QA-Hardening nebenbei (Test-Side-Fixes, Produkt war nicht betroffen)
Zwei Flakes in `qa-interaction.mjs` root-caused und behoben (failing Checks wechselten zufällig zwischen Läufen):
1. **Hover-Walk:** Headless+swiftshader wendet `:hover` erst mit Frame-Verzögerung an (Terminal rendert Dauer-rAF), und zwischen `boundingBox()` und `mouse.move()` verschob Smooth-Scroll das Layout (~52 px gemessen) → Cursor daneben. Fix: Cursor vor dem Scrollen parken, Koordinaten unmittelbar vor jedem Move neu messen, aktiv auf `el.matches(':hover')` pollen (≤1,5 s) + 340 ms Transition-Puffer, Retry-Loop.
2. **aria-invalid-Probe:** Wartezeit exakt an der 150-ms-Transition-Grenze → auf 450 ms erhöht.
3. Library-injizierter TradingView-Attribution-Link aus dem Kontroll-Klassen-Scan ausgeschlossen (kein App-Control).
CSS-seitig per CDP `CSS.forcePseudoState` gegengeprüft: `hover:bg-primary/16` **ist** generiert und wirksam — Off-Scale-Opacities (16/22) sind in `tailwind.config.js` hinterlegt.

---

## 5. Restrisiken & Empfehlungen (transparent)

| # | Thema | Einordnung | Empfehlung |
|---|---|---|---|
| 1 | Script-Lab `new Function` | By-design-Feature, Shadow-Härtung aktiv, Selbstausführungs-Modell | Import-Warnung beibehalten; optional künftig Isolation in einem Web-Worker mit Message-Bridge |
| 2 | Keine CSP | Ad-Modell-Konflikt | `Report-Only`-Phase vor Live-Schaltung evaluieren |
| 3 | `ƒ /terminal` + `ƒ /api/og` | Worker-Routen, Free-Tier-Limits (100k Req/Tag) großzügig | Bei Bedarf `cache-control` auf Terminal-HTML erhöhen |
| 4 | TV-Attribution-Link | Lizenzkonform, klick-bedingter Hostname-Leak an tradingview.com | Akzeptiert |

**Fazit: Alle drei Audit-Aufträge erfüllt — (1) Typprüfung ohne `any`/Escapes mit warnungsfreiem Build, (2) null SSG-Verletzungen für Cloudflare Pages ($0), (3) keine exponierten Secrets, alle XSS-Sinks entschärft bzw. verifiziert sicher, externe Skripte hydration-safe und ohne `innerHTML` eingebunden.**
