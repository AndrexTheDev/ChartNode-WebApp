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
