# NodeChart Beta- und Release-Test

**Stand:** 2026-10-04 · **Status: IN PROGRESS — keine Release-Freigabe**
**Arbeitsbranch:** `arena/01a103d9-chartnode-webapp`
**Getesteter Build:** Next.js 16.3.8 · OpenNext Cloudflare 1.20.6 · Node.js 22.22.3 · npm 10.9.8

> **Produkt-/Funktionsname geklärt:** Das Produkt ist **NodeChart** (`nodechart.cc`). **NodeCluster** existiert ausschließlich als NodeChart-Funktion zur Visualisierung gebündelter Support-/Resistance-Pivots; es ist weder Produktmarke noch eigener Release-Zielname. **Liq Radar** ist ein davon getrenntes Funktionsmodul.

## Prüfregeln

- **PASS**: der benannte Test wurde mit der aktuellen Arbeitskopie tatsächlich ausgeführt und bestand.
- **FAIL**: ein ausführbarer Abnahmepunkt wurde nicht erfüllt oder ein Fehler wurde reproduziert.
- **BLOCKED**: eine Voraussetzung fehlt; das ist kein PASS und darf nicht als Freigabe interpretiert werden.
- **SKIP**: ein Teiltest wurde nicht ausgeführt (zum Beispiel ein nicht erreichbarer Live-Endpunkt); für das Release-Gate bleibt er offen.
- Provider-Smokes sind Momentaufnahmen aus dieser Testumgebung. Sie belegen weder globale Verfügbarkeit noch Reichweite in Browsern, Ländern oder Regionen.
- Ein erfolgreicher lokaler Next-/OpenNext-Build ist keine Bereitstellung und kein Laufzeittest auf Cloudflare.

## Zusammenfassung dieses Laufs

| Bereich | Ergebnis | Befund |
|---|---|---|
| Statische Checks und Offline-Smokes | **PASS / PARTIAL** | M1: 14 PASS / 0 FAIL; `smoke:offline`: 410 PASS / 0 FAIL / 12 SKIP (nur Live-WebSocket-Probes); `qa:offline`: 445 PASS / 0 FAIL / 20 SKIP inkl. explizit ausgelassener Browsermodule. `typecheck`, `lint`, i18n (1.188 Schlüssel × 5 Locales) und CSS-Audit bestehen. |
| Next.js Produktionsbuild | **PASS** | `npm run build`; Next.js 16.3.8 hat 38 statische Seiten erzeugt; Terminal und API-Routen bleiben dynamisch. |
| OpenNext-/Cloudflare-Build | **PASS mit WARNUNG** | `npm run cf:build` erzeugte `.open-next/worker.js`. OpenNext warnt, dass Node.js-Middleware-Unterstützung experimentell und nicht offiziell von OpenNext gepflegt ist. Kein Deploy ausgeführt. |
| SEO auf dem Produktionsbuild | **TEILWEISE** | `seo-audit.mjs`: 95 PASS / 0 FAIL. `seo-check.mjs`: 578 PASS / 0 FAIL; ein Font-Preload-Hinweis wurde für das LCP-Display-Font ergänzt. |
| Live-Markt-/Provider-Smoke | **BLOCKED / bewusst SKIP** | Ein früherer Live-Lauf endete mit Exit 1 und 25 providerabhängigen Assertions, weil externe Endpunkte aus der Sandbox TLS `SSL_ERROR_SYSCALL`/HTTP 000 lieferten. Auf Nutzerwunsch in diesem Lauf nicht wiederholt; keine Live-Verfügbarkeit behauptet. |
| Live-WebSocket-Erreichbarkeit | **SKIP** | `ws:smoke:offline` besteht mit Parser-Fixtures für alle 12 Adapter; 12 Live-Probes wurden diesmal absichtlich nicht gestartet. Eine frühere Ausführung konnte die Endpunkte aus dieser Testumgebung nicht erreichen. Browser-Erreichbarkeit ist unbekannt. |
| Browser-, Screenshot-, Interaktions-, CWV- und CMP-Abnahme | **BLOCKED** | Puppeteer 25.12.0 findet Chrome 154.0.8037.57 nicht; kein systemweites Chromium/Chrome vorhanden. `fit-check` und `cwv-check` konnten nicht starten. Es wurden keine Screenshot-Ergebnisse erzeugt. |
| Dependencies | **TEILWEISE** | `npm audit --omit=dev`: 0 Findings. Vollständiges `npm audit`: 7 High, 0 Critical, im Dev-/Build-/Lint-/CSS-Werkzeugbaum. Keine Major-Upgrades automatisch angewendet. |
| Release-Entscheidung | **KEINE FREIGABE** | Der Offline-Audit (`RELEASE-AUDIT.md`) ist aktuell: 445 PASS / 0 FAIL / 20 SKIP. Browser-/CMP- und Live-Provider-Gates wurden auf Wunsch nicht ausgeführt; weitere Risiko-Gates bleiben dokumentiert. NodeCluster ist eine NodeChart-Funktion, keine Produktmarke. |

## Ausgeführte Prüfungen

### 1. Statische Basis und deterministische Tests

| Prüfung | Ergebnis | Befund |
|---|---|---|
| Branch / Arbeitsbaum | PASS | Auf dem festgelegten Arena-Branch gearbeitet; umfangreiche Änderungen des laufenden Auftrags im Arbeitsbaum erhalten. |
| M1 — statische Konfiguration | **14 PASS / 0 FAIL** | Lizenzheader, Secret-Muster in `src`/`scripts`, `.env.example`, i18n-Key-Parität, Legal-Routen, Konfiguration und Build-Gates geprüft. |
| `npm run typecheck` | PASS | `tsc --noEmit` ohne Fehler. |
| `npm run lint` | PASS | ESLint ohne Fehler. |
| `npm run check:i18n` | PASS | Je 1.188 Schlüssel in `de`, `en`, `es`, `ru`, `zh`; Parität hergestellt. |
| `npm run audit:css` | PASS | 281 verwendete Utilities, 756 CSS-Utilities, 0 fehlende. |
| `npm run chart:smoke` | PASS | Indikatormathematik, Chart-Store, Zeichnungen, Sync, Script-Formeln und Persistenzfixtures bestanden. Kein visueller Browserbeweis. |
| `npm run smoke:modules` | PASS | CEX-Universe, JSON-LD-Builder, Notifications-Degradation, Locale-Gate und Consent-Storage-Logik bestanden. |
| `npm run api:budget-smoke` | PASS | GeckoTerminal-Testfixture, lokales 8-Request-Budget, neunte Request-Ablehnung und Source-Koordination bestanden. Belegt keine Live-Provider-Erreichbarkeit. |
| `npm run api:resilience-smoke` | PASS | Partielle Provider-Antworten, Source-Provenance, Fallbacks, unbekannte Werte, Deribit Call/Put-OI, DVOL und Max Pain bestanden. Fixture-Test, kein aktueller Live-Datenbeleg. |
| `npm run edge:smoke` | PASS | Liq Radar-, Lead/Lag-, Regime-, Seasonality- und Store-Fixtures bestanden. Historische/abgeleitete Signale sind keine Prognosen. |
| `npm run ws:smoke:offline` | **PASS / 12 SKIP** | Alle lokalen Schema-Fixtures für 12 Adapter bestehen; alle 12 Live-Verbindungen wurden absichtlich ausgelassen. |
| `npm run smoke:offline` | **410 PASS / 0 FAIL / 12 SKIP** | Deterministische API-/Chart-/Edge-/Module- und WS-Fixtures; nur Live-WebSocket-Probes ausgelassen. |
| `npm run qa:offline` | **445 PASS / 0 FAIL / 20 SKIP** | Vollständiger auditierbarer lokaler Lauf; Browsermodule und Live-WS sind als SKIP im `RELEASE-AUDIT.md` ausgewiesen. |
| M12 HTTP-/SSR-Baseline | **15 PASS / 0 FAIL** | Header, OG-Input-Escaping, Privacy-SSR, Locale-Fehlerpfad und fünf Font-Preloads samt WOFF2-Response. |
| `git diff --check` | PASS | Keine Whitespace-/Patchfehler festgestellt. |

### 2. Produktions- und Cloudflare-Build

| Prüfung | Ergebnis | Befund |
|---|---|---|
| `npm run build` | PASS | Next.js 16.3.8, TypeScript im Build PASS, 38/38 statische Seiten erzeugt. Dynamisch: `/[locale]/terminal`, `/api/kucoin/public-token`, `/api/og`. |
| `npm run cf:build` | PASS mit WARNUNG | OpenNext 1.20.6 / AWS-Adapter 4.1.4 bundelte Middleware, Serverfunktion und statische Assets; Worker geschrieben nach `.open-next/worker.js`. Node-Middleware-Unterstützung ist laut Buildwarnung experimentell. |
| Cloudflare Deploy / Preview | **OFFEN** | `cf:deploy` wurde nicht ausgeführt; Cloudflare-Runtime, Bindings, Edge-Header, Quotas und echtes Deployment sind nicht durch den Build bestätigt. |

### 3. SEO, Texte und strukturierte Daten

Die Checks wurden gegen einen lokalen **Next-Produktionsserver auf Port 3100** ausgeführt, nicht gegen die öffentliche Domain.

| Prüfung | Ergebnis | Befund |
|---|---|---|
| `scripts/seo-audit.mjs` | **95 PASS / 0 FAIL** | Titel/Descriptions, Canonicals, hreflang, OpenGraph/Twitter, Structured Data, Legal-/Help-Routen, robots.txt, Sitemap und `llms.txt` geprüft. |
| `scripts/seo-check.mjs` | **578 PASS / 0 FAIL** | Für das LCP-Display-Font (Exo 2 Latin) wird über `next/font/local` ein lokaler Preload ausgegeben; in allen fünf Locales ist genau ein Font-Preload-Hinweis vorhanden. Die Preload-Datei antwortet im lokalen Production-Server mit HTTP 200 (`font/woff2`, 40.896 Byte); die Build-Ausgabe enthält 19 WOFF2-Dateien (Grenzwert ≤20). LCP/CWV selbst bleibt mangels Browser BLOCKED. |
| spanische Terminal-Metabeschreibung | PASS nach Korrektur | War zuvor 172 Zeichen; auf 148 Zeichen gekürzt, bei Erhalt des Provider-/Verfügbarkeitsvorbehalts. |
| SoftwareApplication-`featureList` | PASS nach Korrektur | Der Produktions-HTML enthielt zuvor 18 `null`-Einträge: das Landing verwendete für `benefit.paid`/`benefit.unique` falsche Übersetzungstypen. Mapping an die sichtbaren `{ feat, gate }`-Zeilen und String-Arrays angepasst; Produktions-HTML enthält jetzt 18 nicht-leere Feature-Strings. |
| Landing-H1-/OG-Prüfungen | PASS nach Testkorrektur | Veralteter H1-Test verlangte „TradingView + CEX“, obwohl die aktuelle, vorsichtige Copy CEX + DEX nennt. OG-Test verlangte alte deutsche/chinesische Wörter. Assertions wurden an die tatsächliche lokalisierte Copy angepasst, ohne einen Wettbewerbsclaim in die UI einzufügen. |
| `seo-audit.mjs`-Erwartungen / README | PASS nach Test- und Doku-Abgleich | Älterer Audit verlangte FAQ auf Landing, `noindex` für das Basis-Terminal, Terminal-Disallow in `robots.txt` und 25 Sitemap-URLs. Code/aktueller SEO-Check sehen eine Landing-Featureliste, FAQ im Help-Center, indexierbares Basis-Terminal, `noindex` nur für Query-Varianten und 30 URLs. Veraltete Assertions und README-Aussagen wurden abgeglichen; Produktverhalten wurde dafür nicht verändert. |
| Wettbewerber-Metadaten | angepasst | „TradingView alternative“ aus den lokalen Keyword-Feldern entfernt; Paketbeschreibung auf eine Provider-/Regions-bewusste Produktbeschreibung umgestellt. Die Produktmarke NodeChart ist konsistent; NodeCluster bezeichnet ausschließlich das Support-/Resistance-Feature. Kein Rebrand oder Domainwechsel erforderlich. |

**Performance-Messung weiterhin offen:** Die fehlenden Font-Preload-Hints wurden behoben. Ohne Chromium wurde dennoch keine LCP-/CLS-/TBT-Messung behauptet; `cwv-check` bleibt BLOCKED.

### 4. Live-API- und WebSocket-Prüfungen

- Ein früherer `npm run api:smoke`-Lauf endete mit **Exit 1 / 25 fehlgeschlagenen live-abhängigen Assertions**. Nicht-live Logikgruppen wie Query-Klassifizierung, Rate-Limit-State, Whale-Filter, Chain-Mapping und Region-/Venue-Ranking bestanden. Auf Nutzerwunsch wurde dieser Live-Test im aktuellen Lauf nicht wiederholt.
- Der Live-Teil konnte mehrere Provider nicht auswerten: DEX-Suche/-Pools, Token-Risiko, Honeypot-Simulation, On-Chain-Felder, Derivatives, Orderflow, Global-/Heatmap-Daten und Live-Venue-Probes blieben teilweise leer oder schlugen fehl.
- Separate HTTPS-Probes zu DexScreener, GeckoTerminal, mempool.space, DeFiLlama und GoPlus endeten aus der Sandbox mit `SSL_ERROR_SYSCALL` und HTTP 000. Daher werden die Live-Assertions als **BLOCKED durch die Testumgebung** gewertet, nicht als Nachweis globaler Provider-Ausfälle oder als PASS.
- Der frühere Live-Lauf konnte 12 WebSocket-Endpunkte aus dieser Testregion nicht erreichen; der aktuelle `ws:smoke:offline`-Lauf startete die Live-Probes bewusst nicht. Beides sagt nichts über Erreichbarkeit in einem normalen Browser oder aus anderen Regionen aus.
- Offene Quellen-/Abdeckungsgrenzen bleiben bestehen: CEX-/DEX-Paar- und Chain-Abdeckung, CORS, Anbieterquoten, regionale Einschränkungen, Verzögerungen/Cache-Alter sowie die tatsächliche Erreichbarkeit in den Zielbrowsern.

### 5. Werbung, Consent und Smartlink-Kits

**Quelltextprüfung:** aktive Adsterra-Lader sind jetzt an die First-Party-Consent-Funktion `canLoadAdScripts()` und eine explizite frische Zustimmung gebunden. Das betrifft Social Bar/Adblock-Erkennung/Soft-Wall in `AdManager`, Native Banner, Sidebar, `AdSlot` und Popunder. Ein Ablehnungszustand soll weder Werbeanfragen noch Adblock-Soft-Wall oder Retry-Kette starten. Das wurde auf Quelltextebene geprüft; die Netzwerkwirkung ist noch nicht browserverifiziert.

**Deterministische Consent-Prüfung — PASS:** `smoke:modules` prüft unter anderem:

- Local- und Session-Storage-Einträge werden streng geparst; fehlende, beschädigte, abgelaufene, zukünftige oder unbekannte Versionen sind kein Grant.
- Eine gültige Session-Ablehnung überstimmt einen lokalen Grant.
- Ein Session-Grant allein wird nicht akzeptiert.
- Wenn die Ablehnung nicht in Local Storage gespeichert werden kann, wird Session Storage versucht; schlägt auch das fehl, entfernt die Logik einen lesbaren alten Grant oder hält die Ablehnung zumindest für das aktuelle Dokument fail-closed im Speicher.
- Ein expliziter neuer Grant wird erst nach erfolgreicher Speicherung wirksam.

Das verwendete Record-Schema enthält Version, Wahl und Zeitstempel. Die 180-Tage-TTL ist ein Engineering-Default, **keine rechtliche Feststellung**.

| Pfad | Aktueller Stand | Noch erforderlicher Nachweis |
|---|---|---|
| Consent-Banner / Footer-Einstellungen | Implementiert; Ablehnen und Erlauben sind sichtbar, die Entscheidung soll Chartzugriff nicht sperren; Widerruf/Änderung ist über Einstellungen vorgesehen. | Browserprüfung von Fokus, Gleichwertigkeit, allen Locales, Persistenz, Reload/Tabwechsel und Widerruf. |
| Adsterra-Delivery-Lader | Consent-Guards statisch vorhanden. | Request-Interception in `pending`, `denied`, `granted`, Storage-Fehler und Widerruf: vor Zustimmung/nach Ablehnung null Adsterra-Requests; Retries und laufende Lader nach Widerruf prüfen. |
| CMP-/Partner-Kompatibilität | Nicht bestätigt. Eine lokale Ja/Nein-Präferenz allein belegt keine TCF-/CMP- oder Publisher-Code-Kompatibilität. | Integrationssignal des konkreten Adsterra-Publisher-Codes klären und rechtlich/produktseitig prüfen; keine Rechtsberatung. |
| Smartlink-Kits | First-Party-Skripte mit lokalen `localStorage`-Caps; als eigener Pfad behandeln, nicht als automatisch ladende Ad-Delivery. Partnernavigation ist nutzerinitiiert und als Sponsored/Anzeige zu kennzeichnen. | Browser-Netzwerkprüfung, CTA-Kennzeichnung/`rel`, Speicherverhalten und Ziel-URL prüfen; Drittanbieter-Verarbeitung bleibt offenzulegen. |
| Cookie-/Storage-Wirkung der Werbenetzwerke | Unbekannt in dieser Abnahme. | Reale Browser-Netzwerk-/Cookie-Aufzeichnung erst nach Consent; ablehnungs- und widerrufsseitige Null-Request-Probe. |

### 6. Security- und Dependency-Snapshot

| Prüfung | Ergebnis | Befund |
|---|---|---|
| M1 Secret-/Env-/Lizenzscan | PASS | Keine erkannten Secret-Muster in `src`/`scripts`; alle 14 `NEXT_PUBLIC_*`-Verwendungen im `.env.example` abgedeckt. Das ist kein externer Penetrationstest. |
| M12 lokale HTTP-/SSR-Baseline | **15 PASS / 0 FAIL** | Status-/Security-Header, 5 locale Font-Preloads + Asset, OG-Query-Escaping, Privacy-SSR und ungültige Locale direkt gegen den lokalen Produktionsserver geprüft. Kein Browser-/Edge-/Penetrationstest. |
| Produktionsabhängigkeiten | PASS | `npm audit --omit=dev`: 0 Findings. |
| Vollständiger Dependency-Baum | **FAIL / offen** | `npm audit`: 7 High, 0 Critical — `@next/eslint-plugin-next`, `braces`, `chokidar`, `eslint-config-next`, `fast-glob`, `micromatch`, `tailwindcss`; Findings liegen im Dev-/Build-/Lint-/CSS-Werkzeugpfad. `npm audit fix --dry-run` bietet nur den Breaking-Wechsel auf Tailwind 4 bzw. ein inkompatibles Downgrade von `eslint-config-next` an. Der auslösende `braces`-Advisory `GHSA-vfj7-8cjw-p6xm` hat laut aktueller npm-Registry keinen gepatchten veröffentlichten 3.x-Release (3.0.3 ist aktuell). Keine Major-Migration ohne visuelle Regressionstests durchgeführt. |
| Lokale Next-Header auf `/de/terminal` | TEILWEISE PASS | `X-Content-Type-Options: nosniff`, `Referrer-Policy` und `Permissions-Policy` vorhanden; `X-Powered-By` fehlt. In der lokalen HTTP-Antwort fehlen CSP und HSTS; `X-Frame-Options`/`frame-ancestors` sind bewusst nicht gesetzt, damit die Arena-Vorschau eingebettet werden kann. Das ist kein Snapshot der echten Cloudflare-Edge-Konfiguration. |
| Script Lab | **Offen, Disclosure vorhanden** | Formeln/importierter Code laufen im Seitenkontext und sind keine sichere Sandbox. Die UI warnt davor; nur vertrauenswürdigen Code ausführen. Browser-/CSP-/Hostile-import-Abnahme offen. |
| Public API/Proxy/Rate-Limits | **Offen** | Lokal begrenzte Budgets und Source-Cooldowns sind getestet; sie koordinieren nicht alle Nutzer hinter geteilten Provider-/IP-Limits und ersetzen kein öffentliches Abuse-/Rate-Limit-Hardening. |
| Cloudflare/Node-Warnung | **Offen** | OpenNext-Build erfolgreich, aber Node-Middleware-Unterstützung experimentell. Ziel-Worker, Kompatibilitätsdatum, Kosten-/Quotas und echte Edge-Header sind nicht deployed/getestet. |

## Screenshot- und Browser-Matrix

**Status der automatisierten Screenshot-Matrix: BLOCKED — keine reproduzierbaren Screenshots durch den QA-Lauf.** Der Nutzer hat einen mobilen Brave-Screenshot als visuelle Referenz beigefügt; er ist kein Screenshot-Artefakt dieses Builds und ersetzt keine Viewport-/Geräteprüfung. Der bekannte Grund bleibt: Chrome 154.0.8037.57 fehlt; `/home/user/.cache/puppeteer` enthält keinen Browser und kein systemweites Chromium/Chrome ist vorhanden. Ein früherer Installationsversuch scheiterte vor TLS-Aufbau (`Client network socket disconnected`). In diesem Durchlauf wurden die nicht ausführbaren Browsermodule ausgelassen. Kein Pixel-, Geräte-, Tastatur-, Cookie- oder Cross-Browser-PASS wird aus Server-/Fixture-Tests abgeleitet.

| Viewport-Profil | Größe | Zielansichten | Screenshot-/Interaktionsstatus |
|---|---:|---|---|
| Mini | 320 × 568 | Landing, Consent, Terminal-Controls/Settings | BLOCKED |
| Telefon | 390 × 844 | Landing, Terminal, Controls-Sheet, Chart-Settings, Dialoge, Consent | BLOCKED |
| Tablet | 768 × 1024 | Landing, Terminal, Menüs/Controls, Panels | BLOCKED |
| Tablet portrait | 834 × 1112 | Terminal, Dropdown-Fit, Modals | BLOCKED |
| Low-height laptop | 1024 × 500 | Terminal, Menüs, Picker/Dropdowns | BLOCKED |
| Laptop | 1280 × 620 und 1280 × 800 | Terminal, Sidebar/Ads, Controls | BLOCKED |
| Desktop | 1440 × 900 | Landing, Terminal, jedes Hauptmenü/Tool-Modal, Help/Legal | BLOCKED |
| Wide desktop | 1920 × 1080 | Terminal, Sidebar, Sponsored-Flächen/Overlaps | BLOCKED |

Für die Freigabe zusätzlich pro Viewport: `en`, `de`, `es`, `ru`, `zh`; Consent `unknown`/`denied`/`granted`/Widerruf; Landing, Terminal mit Controls und Settings, Help, Legal, Modals, Toasts und Sponsored-Platzierungen. Chromium-Automation allein ersetzt keine Firefox-/WebKit- oder physischen Android-/iOS-Tests.

## Marketing-/Produktcopy: aktueller Stand und offene Punkte

- Paketbeschreibung wurde von „100% free / fast / decentralized / TradingView alternative“ auf eine neutralere Beschreibung mit Provider-, Netzwerk- und Regionsvorbehalt umgestellt. „TradingView alternative“ wurde auch aus den lokalen SEO-Keyword-Feldern entfernt.
- Spanische Terminal-Metabeschreibung wurde gekürzt. H1- und OG-Prüfungen messen die tatsächliche aktuelle Lokalisierung statt überholter Wettbewerber-/Wortlaut-Erwartungen.
- Script Lab weist darauf hin, dass Nutzerformeln und importierter JavaScript-Code nicht isoliert sind. Backtest-, NodeCluster-, Liq-Radar-, Saison-, Security- und Provider-Signale bleiben als heuristisch/historisch/best-effort gekennzeichnet; sie sind keine Prognosen, Sicherheitsgarantien oder Handelsberatung.
- Donation-/Supporter-Badge ist kosmetisch, browserlokal und nicht verifiziert. Donation-Unlock ist best-effort und darf nicht als nachgewiesene Zahlung oder dauerhaftes Abonnement dargestellt werden.
- Verbleibende Release-Review-Punkte: GSC-Verifizierungsplatzhalter; CEX-/DEX-Quellenlücken und regionale Limits; approximative Marktsignale; kein echter Token-Unlock-Kalender; partielle Chain-Security-Abdeckung; öffentliche Proxy-/Rate-Limit-Absicherung; optionale Ads/CMP-/Browser-Coverage; regionale Partner-/Cookie-Offenlegung. Claim-Abdeckung ist nicht vollständig durch externe Quellen oder Live-Daten verifiziert.
- `npm run qa:offline` erzeugte einen aktuellen auditierbaren Snapshot in `RELEASE-AUDIT.md`: 445 PASS / 0 FAIL / 20 SKIP. Browserabhängige M2–M6/M8–M10 sind mit konkretem Grund als SKIP ausgewiesen; M7-Build-/Deploy-Readiness ist PASS. Der Snapshot ist ausdrücklich kein vollständiger Browser- oder Cloudflare-Laufzeitnachweis und keine Release-Freigabe.

## Geplante Freigabemodule und Status

| Modul | Gegenstand | Status |
|---|---|---|
| M1 | Statische Konfiguration, Lizenz-/Secret-Muster, Env, i18n, Typecheck/Lint | **PASS 14/14** |
| M2 | Routing, SEO, Metadata, Übersetzungen und Copy über alle Locales | **TEILWEISE** — 95 SEO-Audit-PASS; 578 SEO-Check-PASS / 0 FAIL; NodeChart/NodeCluster-Namensrolle geklärt; externe Marketing-Claims bleiben zu reviewen |
| M3 | Terminal-/Chart-Funktionen, Menüs, Datenquellen, Indikatoren, Persistenz | **TEILWEISE** — Chart-/Module-Smokes PASS; Browser-Interaktionen BLOCKED |
| M4 | Tastatur, Fokus, ARIA, Kontrast, Viewport-/Layout-Fit | **BLOCKED** — Browser fehlt; statische Checks ersetzen keine Laufzeitabnahme |
| M5/M8 | Ads, Consent, Smartlinks, Spenden-Flow, Disclosure/Overlaps | **TEILWEISE** — Storage-Logik PASS, Guards statisch geprüft; CMP-, Request-, Cookie- und Screenshot-Abnahme BLOCKED |
| M6/M10 | Runtime, Offline-/Reconnect-, Fehlformat-, Budget- und Resilienztests | **TEILWEISE** — API-/Chart-/Edge-Fixtures PASS; Live-API BLOCKED, 12 WS SKIP, Browser-Offlinetests BLOCKED |
| M7 | Next-/Cloudflare-Produktionsbuild und Deployment-Konfiguration | **BUILD PASS** mit experimenteller Node-Middleware-Warnung; Deployment/Edge-Prüfung offen |
| M9 | Security-Header, XSS/Inputs, lokale Daten, API-Routen, Dependencies | **TEILWEISE** — M1/Inputs/Headers/Dependency-Snapshot; CSP/HSTS/Edge, öffentlicher Abuse-Schutz und Browser-Historie offen |
| Geräte-/Browsermatrix | Screenshots, Chromium/Firefox/WebKit sowie echte Android-/iOS-Geräte | **BLOCKED / nicht abgedeckt** |

## Nächste Schritte bis zur Freigabe

1. Mit verfügbarer Browserumgebung CWV messen; der LCP-Font-Preload ist implementiert und alle statischen SEO-Checks bestehen.
2. Browserumgebung bereitstellen und Screenshot-/Fit-/Feature-/Smartlink-/Ad-Slot-/Consent-Matrix einschließlich Request-Interception, Widerruf und Storage-Fehlern ausführen.
3. Live-API- und WebSocket-Smokes in einer Umgebung mit funktionierendem Provider-Egress wiederholen; Ergebnisse pro Provider und Region ausweisen, keine globale Verfügbarkeit ableiten.
4. CMP-/Publisher-Signal und Datenschutz-/Cookie-Texte vor optionaler Ad-Delivery klären; das lokale Consent-Modell nicht als Rechts- oder Compliance-Bestätigung bezeichnen.
5. Dependency-Findings bewerten, öffentliches Proxy-/Rate-Limit-Hardening prüfen und Cloudflare-Worker tatsächlich previewen/deployen; Edge-Header und Runtime-Kompatibilität messen.
6. GSC-Verifizierungsplatzhalter, Token-Unlock-Kalender-Abdeckung, Chain-Security-Grenzen und Donation-Wording entscheiden. NodeCluster ist eine lokale NodeChart-Funktion; keine separate Marke oder Domain.
7. Nach Behebung/akzeptierter Bewertung aller offenen Punkte vollständigen Release-Audit und finalen Produktions- plus Cloudflare-Build erneut ausführen.

**Freigabekriterium:** Ein grüner Build ist notwendig, aber nicht hinreichend. Bis die blockierten Browser-/CMP-/Live-Provider-Checks und die dokumentierten Findings abgeschlossen oder ausdrücklich akzeptiert sind, bleibt die Empfehlung **keine Release-Freigabe**.
