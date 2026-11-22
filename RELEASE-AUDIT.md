# RELEASE-AUDIT (modular)

Stand: 2026-10-04T21:19:53.818Z · **PARTIAL — SKIPs dokumentiert · 445 PASS / 0 FAIL / 20 SKIP**

| Modul | Bereich | PASS | FAIL | SKIP | Status |
|---|---|---:|---:|---:|---|
| M1 | Statik & Konfiguration | 14 | 0 | 0 | PASS |
| M2 | Routing & SEO (30 Seiten) | 0 | 0 | 1 | SKIP |
| M3 | Terminal-Funktionalbatterie | 0 | 0 | 1 | SKIP |
| M4 | A11y & UX-Semantik | 0 | 0 | 1 | SKIP |
| M5 | Monetarisierung (Ad-/Smartlink-Suiten) | 0 | 0 | 1 | SKIP |
| M6 | Runtime & Edge (CTO-Suite) | 0 | 0 | 1 | SKIP |
| M8 | Native Banner + Smartlinks (Tiefe) | 0 | 0 | 1 | SKIP |
| M9 | Security & Input-Hardening | 0 | 0 | 1 | SKIP |
| M10 | Daten-Resilienz & Session | 0 | 0 | 1 | SKIP |
| M11 | Offline-Smoke-Fixtures (WS/API/Chart/Edge/Module) | 410 | 0 | 12 | PARTIAL |
| M12 | HTTP/SSR-Baseline (Header, OG, Fonts, Privacy) | 15 | 0 | 0 | PASS |
| M7 | Deploy-Readiness (Cloudflare) | 6 | 0 | 0 | PASS |

## M1 — Statik & Konfiguration

- ✔ **PASS** Lizenz-Header in allen 230 Quell-Dateien
- ✔ **PASS** Keine Secrets/Private-Keys in src+scripts
- ✔ **PASS** .env.example deckt alle 14 NEXT_PUBLIC_-Variablen ab
- ✔ **PASS** i18n-Key-Parität über 5 Locales (1188 Keys)
- ✔ **PASS** Legal-Dokumente (terms/disclaimer/privacy) in 5 Locales
- ✔ **PASS** Routen-Struktur vollständig (locale-basiert)
- ✔ **PASS** KEIN Root-layout.tsx (Next-Doktrin)
- ✔ **PASS** Wasserzeichen exakt www.NodeChart.cc
- ✔ **PASS** Spenden-Wallets exakt (SOL/BTC/ETH)
- ✔ **PASS** Persist-Keys nodechart:store:v1 + nc-viral-v1
- ✔ **PASS** typecheck (tsc --noEmit)
- ✔ **PASS** lint (eslint 0/0)
- ✔ **PASS** wrangler.jsonc vorhanden
- ✔ **PASS** cf:build-Skript vorhanden (OpenNext/Cloudflare)

## M2 — Routing & SEO (30 Seiten)

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Browser erforderlich für Routing-/Metadaten-Interaktionen.

## M3 — Terminal-Funktionalbatterie

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Chrome/Puppeteer erforderlich für Terminal- und Mobile-Interaktionen.

## M4 — A11y & UX-Semantik

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Chrome/Puppeteer erforderlich für visuelle Accessibility-Prüfungen.

## M5 — Monetarisierung (Ad-/Smartlink-Suiten)

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Chrome/Puppeteer erforderlich für Monetarisierungs-/Smartlink-Viewports.

## M6 — Runtime & Edge (CTO-Suite)

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Chrome/Puppeteer erforderlich für Runtime- und Interaktionsbatterie.

## M8 — Native Banner + Smartlinks (Tiefe)

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Chrome/Puppeteer erforderlich für Ad-/Consent-Interaktionen.

## M9 — Security & Input-Hardening

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Browser-/Storage-XSS-Matrix erfordert Chrome/Puppeteer; testbare HTTP-Header, OG-Input, Fonts und Privacy-SSR laufen separat in M12.

## M10 — Daten-Resilienz & Session

- ⊘ **SKIP** Ausgelassen im Offline-Audit — Chrome/Puppeteer erforderlich für Browser-Resilienz-/Download-Prüfungen.

## Browser-Module (M2–M10) — nachgeholt mit echtem Chromium

Der Offline-Audit (`npm run qa:offline`) überspringt alle browserabhängigen
Module. In dieser Umgebung wurde Chromium 153.0.8010.0 bereitgestellt
(`@sparticuz/chromium` plus selbstgebaute NSS-/NSPR-Bibliotheken aus den
Quellen) und die Suiten wurden tatsächlich ausgeführt — jeweils gegen den
lokalen Production-Server mit `?qa=1&fixtures=1` und Netzsperre für fremde
Hosts (in dieser Sandbox gibt es kein Provider-Netz).

| Modul | Suite | Ergebnis |
|---|---|---|
| M2 | `qa:onboarding` | ✔ grün (Routing, Metadaten je Locale, Legal, Help, Support) |
| M3 | `qa:modules`, `qa:trader` | ✔ 0 Failures · 29/29 (12 Venues, DEX, CA-Suche, Forensik, 429-Resilienz) |
| M4 | `qa:interaction`, `qa:responsive`, `qa:i18n` | ✔ 25/25 · 43/43 · 110/110 (Tastatur, Fokus, Touch-Targets ≥44 px, Overflow 320–3440 px) |
| M5 | `qa:monetization` | ✔ 78 PASS / 0 FAIL |
| M6 | `qa:release` | ✔ 44/44 (inkl. Altbrowser-Fallbacks, Clipboard, 5 Locales) |
| M8 | `qa:gui`, `qa:gui-verify` | ✔ 109 Screenshots / 0 automatische Befunde · alle Fixes bestätigt |
| M9/M10 | `browser-check` | ✔ **152 PASS / 0 FAIL / 19 SKIP** (Live-Provider-Checks als SKIP ausgewiesen, `QA_LIVE=1` schaltet sie scharf) |

Was das **nicht** belegt: echte Livemarktdaten (Provider-Netz fehlt), echte
Mobilgeräte sowie Firefox/WebKit. Die Fixtures sind deterministisch und
ersetzen keinen Provider-Vergleich.

### Nebenbefunde dieses Durchlaufs (behoben)

- **Venue-Flattern**: Die Reachability-Probes laufen parallel; jede `error`-Meldung
  machte die laufende Venue schlechter als alle noch ungeprüften, sodass die
  Auswahl im Sekundentakt sprang (binance → okx → coinbase → kraken …). Jeder
  Wechsel tauscht die Feed-Subscription und damit den Chart-Container: React
  unmountete den Plot, Pointer-Capture ging verloren, **laufende Drags brachen
  ab**. Fix: Hysterese (`stickTo` in `exchange-select.ts`) hält die zuletzt
  gecharte Venue, solange sie Pair und Timeframe bedienen kann; ein
  fehlgeschlagener Probe ist kein Beweis für einen kaputten Feed.
- **Custom-Intervall-Fixture-Lücke**: `resolveFixtureFeeds()` las `customAgg`
  nicht. Nach „∿ 7“ abonnierte `ChartGrid` korrekt den `1m`-Basis-Feed, der
  bekam aber nie Kerzen – der Chart blieb auf 1h und die Legende zeigte nie
  „7m“. Fix: Fixture-Resolver löst das Basis-Intervall genauso auf wie der
  Chart (7 ⇒ 1m + clientseitige Aggregation).
- **KuCoin-Token im Fixture-Modus**: `/api/kucoin/public-token` antwortete in
  der Sandbox korrekt mit 503 und `retry-after`; da der Socket im QA-Lauf
  ohnehin gestubbt ist, wird der Token dort gar nicht mehr angefragt.
- **Consent-Banner blockierte Dialoge**: Banner lagen auf `z-toast` (110) über
  dem Modal-Backdrop (70). Auf 390 × 844 waren im Spenden-Modal „Ausblenden“
  und „Ich habe gespendet“ nicht klickbar, obwohl das Modal vollständig im
  Viewport lag (`elementFromPoint` traf den Banner). Fix: ambos Banner tragen
  `data-nc-ambient-banner`, und unter `body.nc-modal-open` rücken sie unter den
  Backdrop (z-index 65) – dasselbe Muster wie für die Adsterra-Socialbar.

## M11 — Offline-Smoke-Fixtures (WS/API/Chart/Edge/Module)

- ✔ **PASS** npm run smoke:offline — 410 PASS / 0 FAIL / 12 SKIP in deterministic/offline fixtures

## M12 — HTTP/SSR-Baseline (Header, OG, Fonts, Privacy)

- ✔ **PASS** GET /de liefert 200 + HTML
- ✔ **PASS** X-Content-Type-Options: nosniff
- ✔ **PASS** Referrer-Policy vorhanden — strict-origin-when-cross-origin
- ✔ **PASS** Permissions-Policy schränkt Kamera ein
- ✔ **PASS** X-Powered-By nicht offengelegt
- ✔ **PASS** de hat exakt einen Font-Preload — status=200; count=1
- ✔ **PASS** en hat exakt einen Font-Preload — status=200; count=1
- ✔ **PASS** es hat exakt einen Font-Preload — status=200; count=1
- ✔ **PASS** ru hat exakt einen Font-Preload — status=200; count=1
- ✔ **PASS** zh hat exakt einen Font-Preload — status=200; count=1
- ✔ **PASS** Preload-WOFF2-Assets liefern HTTP 200 — 200 font/woff2
- ✔ **PASS** OG-Endpunkt liefert 200-Bild ohne Script-Markup
- ✔ **PASS** OG-Endpunkt escaped aktives Markup aus Query-Input
- ✔ **PASS** Privacy-SSR nennt Locale-Cookie und Ad-Partner
- ✔ **PASS** Ungültige Locale endet mit 404 oder Redirect, nicht 5xx — HTTP 307

## M7 — Deploy-Readiness (Cloudflare)

- ✔ **PASS** /robots.txt liefert 200 + Inhalt — User-Agent: * Allow: /  User-Agent: Twitterbot User-Agent: f
- ✔ **PASS** /sitemap.xml liefert 200 + Inhalt — <?xml version="1.0" encoding="UTF-8"?> <urlset xmlns="http:/
- ✔ **PASS** LICENSE.md = All Rights Reserved (strengste Lizenz)
- ✔ **PASS** Deutsche Schritt-für-Schritt-Deploy-Anleitung (GitHub + Cloudflare)
- ✔ **PASS** wrangler.jsonc mit Name + Kompatibilitätsdatum
- ✔ **PASS** cf:build (opennextjs-cloudflare) grün — ✓ Generating static pages using 1 worker (38/38) in 2.1s
