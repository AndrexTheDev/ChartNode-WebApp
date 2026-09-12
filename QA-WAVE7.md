# Wave-7 QA-Protokoll — Edge Suite (modular, Schritt für Schritt)

Jeder Schritt prüft **ein Modul** vollständig: Engine-Mathematik (offline),
Darstellung im Browser (Pixel-Beweise), DOM/UX, Persistenz & Sanitizer,
i18n-Nutzung. Ein Schritt gilt erst als grün, wenn alle seine Checks PASS sind.

| # | Modul | Umfang | Status |
| --- | --- | --- | --- |
| 1 | **Liq Radar** | Engine-Probes, Canvas-Bänder + Leverage-Tags (Pixel), Modal-DOM, Persistenz, Sanitizer, i18n | ✅ **22/22 Browser + 22 Engine + 62/62 Keys** |
| 2 | **Lag Oracle** | Engine (Lag/Beta/HitRate/Puls), Leader-Feed-Lifecycle (nur bei offenem Modal), Modal-DOM, Graceful-Degradation | ✅ **16/16 Browser + 20 Engine-Checks** |
| 3 | **Regime Compass** | Engine-Grenzen (5 Regimes), Driver-Listen, Konfidenz-Clamp, Historien-Streifen, Tool-Empfehlungen → echte Store-Toggles | ✅ **10/10 Browser + 19 Engine-Checks** |
| 4 | **Clock Edge** | Bucket-Mathematik, t-Gate, Jetzt-Ring, Heatmap-Farben/Legende, Graceful bei <100 Kerzen | ✅ **11/11 Browser + 16 Engine-Checks** |
| 5 | **Edge-Menü & Toolbar-Integration** | ToolMenu-Verhalten (Escape/Outside/aria), engaged-State, Bump/Viral-Loop, keine Layout-Brüche | ✅ **17/17 Browser-Checks** (+ Header-Fix) |
| 6 | **Canvas-Primitive-Lifecycle** | attach/detach, setSource(null) beim Ausschalten, Theme-Wechsel (Bull/Bear-Farben), Grid 2x2 (alle Panes), Resize | ✅ **9/9 Browser-Checks** |
| 7 | **i18n ×5 im Browser** | jede Locale: Menü, 4 Modals, Help-Kategorie, Landing-Feature sichtbar & ohne Fehlkeys | ✅ **40/40 Browser-Checks** (5 Locales × 8) |
| 8 | **Mobile & Graceful Failure** | Mobile-Gate, schmale Viewports (Modal-Scroll), Feed-Ausfall (leere Candels → Hinweise statt Crash) | ✅ **13/13 Browser-Checks** (390×844 + Total-Outage) |
| 9 | **Regression gesamt** | browser-check 169/169, beta 30/30, smoke inkl. edge, seo-audit, tsc/eslint | ✅ **alle Suiten grün** (nach Snapshot-Restore + Fresh-Build) |
| 10 | **Doku & Artefakte** | README-Matrix, Help-Topics, Screenshots, Spenden-Doktrin-Konsistenz | ✅ **Audit grün** (Matrix, 4×5 Help-Topics, 38 Artefakte, Doktrin konform) |

Werkzeuge: `scripts/edge-smoke.entry.ts` (Engine, Teil von `npm run smoke`),
`scripts/qa-edge-visual.mjs <step>` (Browser/Pixel/DOM/Persistenz),
`scripts/qa-i18n-usage.mjs` (genutzte Keys ×5 + ICU-Placeholder).

---

## Schritt 1 — Liq Radar ✅

### 1.1 Engine (`npm run edge:smoke`, Sektion [1], 22 Checks)
| Check | Ergebnis |
| --- | --- |
| `liquidationPrice` long/short 10x exakt (90.4 / 109.6) | PASS |
| Symmetrie um die Maintenance-Margin (0.4 %) | PASS |
| Long-Liq steigt, Short-Liq fällt mit Hebel (10→100) | PASS |
| Guards: <30 Kerzen, Zero-Volume, Volume außerhalb window=400 → `null` | PASS |
| **Zero-Close-Kerze wird ignoriert** (kein $0-Magnet; Lib-Fix in diesem Schritt) | PASS |
| Recency-Decay: frische Kerze schlägt 2x-Volumen 39 Bars alt; 8x-Volumen dreht es um | PASS |
| Bucket 0 (±0,25 % um Spot) wird verworfen (Lib-Fix aus Wave-7-Finale) | PASS |
| Longs < Spot, Shorts > Spot; top-Listen ≤3 & nach Nähe sortiert | PASS |
| Intensität normalisiert auf max = 1; Filter ≥ 0.12; Hebel nur aus [10,25,50,100] | PASS |
| feineres `bucketPct` → ≥ Buckets; `distancePct` ≡ Preisabstand | PASS |

### 1.2 Darstellung & Funktion im Browser (`scripts/qa-edge-visual.mjs liq`, 22 Checks)
| Check | Messwert |
| --- | --- |
| Host-Attribut `data-liq-radar` off → on → off (Checkbox, Reload, Sanitizer) | PASS |
| **Pixel-Beweis Bänder**: horizontale Tint-Rows 0 → **167** → 0 (Signatur schließt Volumen-Bars & Candle-Kanten aus) | PASS |
| **Pixel-Beweis Leverage-Tags**: graue Mono-Textpx links 0 → **1793** | PASS |
| Modal: Titel + Erklärung + Checkbox-Sync (checked ≙ Store) | PASS |
| ≤3 Magnete je Seite; Distanzen aufsteigend sortiert (0.25/0.5/0.75 %) | PASS |
| Intensitäts-Balkenbreite ≡ gedruckte Intensität; Spot-Zeile mit Preis | PASS |
| Escape schließt; Reload erhält `liqMagnetsOn` (Boolean im Persist-Payload) | PASS |
| **Sanitizer**: korruptes `nc-chart-v1` (`liqMagnetsOn:"ja"`, `panes:"evil"`) → off, Modal öffnet, kein Crash, keine Bänder | PASS |
| Screenshot | `artifacts/qa-step1-liq-on.png` |

### 1.3 i18n (`scripts/qa-i18n-usage.mjs`)
62/62 genutzte `edge`-Keys in allen 5 Locales vorhanden, ICU-Placeholder
(`{leader} {dir} {bps} {exp} {done} {wr} {n}`) identisch; keine Karteileichen.

**Funde & Fixes in Schritt 1:** (a) `buildLiqMap` übersprang Kerzen mit
`c <= 0` nicht → korrupte Feeds hätten einen $0-Magnet malen können (Guard
eingezogen + Probe); (b) QA-Metrik lernte, Volumen-Bars und Anti-Aliasing von
Bändern zu unterscheiden (Row-Run-Metrik).

**Nächster Schritt:** 2 — Lag Oracle (Engine-Probes + Leader-Feed-Lifecycle:
Subscription nur bei offenem Modal, Graceful Degradation bei Feed-Ausfall).

---

## Schritt 2 — Lag Oracle ✅

### 2.1 Engine (`edge-smoke`, Sektion [2], 20 Checks)
| Check | Ergebnis |
| --- | --- |
| 3-Bar-Lag + Korrelation + Beta + Samples (Basis-Szenario) | PASS |
| `lagCurve` spannt 0..maxLag | PASS |
| **Beta-Rekonstruktion**: 2×-Verstärker eine Kerze hinter dem Leader → lag 1, beta ≈ 2; synchroner 2×-Verstärker → lag 0, beta ≈ 2 | PASS |
| **Hit-Rate-Backtest**: 10 gepflanzte 100-bps-Jumps, Follower folgt 8× → exakt 0.8 bei lag 2 | PASS |
| <60 Samples → Null-Stats; schwache Korrelation → bestLag 0 | PASS |
| **Puls-Gates**: <1,5 σ still, >1,5 σ feuert, ≥40 % abgelaufen → still, Falschrichtung hält Puls alive, degenerierte Stats (beta≤0/lag 0/corr≤0.12) → null | PASS |

### 2.2 Darstellung, Funktion & Feed-Lifecycle (`qa-edge-visual.mjs lag`, 16 Checks)
| Check | Messwert |
| --- | --- |
| Keine Leader-Subscription bei geschlossenem Modal | PASS |
| Öffnen → Kline-Subscribe für ETH erscheint (Binance-Socket), Stats live: lag 0, corr 0.91, beta 0.67, Hits 38 % | PASS |
| Stat-Kacheln via DOM gelesen (Integer-/Bereichs-Gates), Status-Zeile (calm/pulse) mit `role="status"` | PASS |
| Select zeigt nie den aktiven Token und nie leer (Fallback-Logik) | PASS |
| Leader-Wechsel ETH→SOL: alter Kline-Channel wird **unsubscribed**, neuer subscribt | PASS |
| Modal zu: Leader-Kline released; aktiver BTC-Feed lebt weiter | PASS |
| Graceful: Loading-Hint statt Stats, solange der Leader-Feed <60 Kerzen hat | PASS |
| Screenshot | `artifacts/qa-step2-lag.png` |

### 2.3 Funde & Fixes in Schritt 2
1. **Echter Bug**: Der Fallback-Leader (ETH, wenn BTC aktiv) existierte nur lokal
   im Modal — der Provider liest aber `lagLeaderId` aus dem Store (null) und
   hat deshalb **nie subscribt**; das Modal hing ewig im Loading-Hint. Fix:
   Das Modal publiziert den Fallback-Leader beim Öffnen in den Store
   (Single Source of Truth), inkl. Guard gegen Leader = aktiver Token.
2. Select hätte bei `lagLeaderId == aktiver Token` leer gerendert → Fallback
   in der Select-Value-Auflösung.
3. Calm-Box hatte kein `role="status"` (a11y + QA-Handle) → ergänzt.
4. **QA-Methodik**: URL-Fingerprints tragen nicht (Exchange-Fallback-URLs ohne
   Symbol; Whale-Flow subscribt ETH/SOL-Trades auf denselben Hosts; der Manager
   multiplexed Channels pro Exchange-Socket → Release endet als UNSUBSCRIBE,
   nicht als Socket-Close). Neuer Beweis: Kline-Subscribe-Fingerprint pro
   Payload + Unsubscribe-/Close-Nachweis.
5. `check()` in `edge-smoke` bekam ein optionales Detail-Argument (tsc-Stolper).

---

## Schritt 3 — Regime Compass ✅

### 3.1 Engine (`edge-smoke`, Sektion [3], 19 Checks)
| Check | Ergebnis |
| --- | --- |
| **Vorrang-Regeln**: liqRatio ≥3 schlägt vol-expand; extremes Funding + Vol-Spike → liq-storm; extremes Funding allein lässt einen sauberen Trend jedoch Trend bleiben | PASS |
| vol-expand: Range-Spike ohne Trend (ADX <25, rvRatio ≥1.6) | PASS |
| trend-weak: reifer Trend + flacher Tail (ADX 98, Slope 0.53) | PASS |
| Grenzen: 79 Kerzen → null, exakt 80 → Read | PASS |
| Driver-Integrität: ≥3 finite Treiber pro Read; advPct → breadth-Driver 1:1 | PASS |
| Konfidenz: Clamp [0.5, 0.95] auch auf Flat-Feed | PASS |
| Historie: <120 Kerzen → leer; step=120/span=240 → exakt 2 Reads | PASS |

### 3.2 Darstellung & Aktionen im Browser (`qa-edge-visual.mjs regime`, 10 Checks)
| Check | Messwert |
| --- | --- |
| Live-Read im Terminal: „Schwacher Trend", Konfidenz 78 % | PASS |
| Driver-Kacheln: ADX 32 · Vol-Ratio 0.70 · Steigung −0.67 | PASS |
| Historien-Streifen: 4 Regime-Fenster | PASS |
| Empfehlungen regimespezifisch (1–2 Buttons), alle bekannt | PASS |
| **Aktions-Beweis**: Klick auf „Support/Resistance" schließt Modal UND flippt den echten Toggle (Analyse-Menü `aria-pressed=true`), danach sauber zurückgesetzt | PASS |
| Screenshot | `artifacts/qa-step3-regime.png` |

### 3.3 Funde & Fixes in Schritt 3
1. QA-Szenario-Learning: trend-weak braucht einen *micro-wiggling* Tail —
   ein komplett flacher Tail lässt ADX unter 25 decayen („range"); der
   rnd-Wobble der `candles()`-Helper (±0,2 %) frisst das 0,05%-Signal →
   Tail deterministisch gebaut.
2. Keine Produkt-Bugs in diesem Schritt.

---

## Schritt 4 — Clock Edge ✅

### 4.1 Engine (`edge-smoke`, Sektion [4], 16 Checks)
| Check | Ergebnis |
| --- | --- |
| Bucket-Buchhaltung: Summe(n) über 24h und 7d ≡ candles − forward-Fenster | PASS |
| Gepflanzter Edge: Stunde 5 → winRate 1, meanBps **150.8** (≡ 4× +0.375 %), t weit über Gate | PASS |
| `forward=1` formt den Edge auf exakt **+37.5 bps** um | PASS |
| **t-Gate negativ**: noisy Half-Edge (n ≥ 30, t = 0.00) bleibt insignificant | PASS |
| nowHour/nowWeekday ≡ echte UTC-Uhr; exakt 100 Kerzen → Read, <100 → null | PASS |
| Zero-Close-Kerzen werden übersprungen (1191 statt 1196 Buckets) | PASS |
| Wochentags-n ≡ Kalenderzählung (168 = 168) | PASS |

### 4.2 Darstellung im Browser (`qa-edge-visual.mjs clock`, 11 Checks)
| Check | Messwert |
| --- | --- |
| 24 Stunden- + 7 Wochentags-Zellen (Direct-Children-Zählung) | PASS |
| Zellenwerte: Win-Rates 0–100 oder „·" für leere Buckets | PASS |
| **Genau ein** Jetzt-Ring pro Heatmap (Stunde + Wochentag) | PASS |
| Tooltips tragen n, Win-Rate und t-Wert | PASS |
| 13 signifikante Zellen computed-getintet (rgba-Alpha > 0.05) | PASS |
| „Edge jetzt?"-Statuszeile (`role=status`) + Legende vorhanden | PASS |
| Screenshot | `artifacts/qa-step4-clock.png` |

### 4.3 Funde & Fixes in Schritt 4
1. QA-Messfehler (kein Produkt-Bug): Wochentags-Zellen enthalten ein inneres
   Win-Rate-`span` → Direct-Children statt `querySelectorAll('span')`; Chrome
   normalisiert `hsla()` im Style-Attribut zu `rgba()` → Tint-Nachweis über
   `getComputedStyle`.
2. Keine Produkt-Bugs in diesem Schritt.

---

## Schritt 5 — Edge-Menü & Toolbar-Integration ✅

### 5.1 Browser (`qa-edge-visual.mjs menu`, 17 Checks)
| Check | Ergebnis |
| --- | --- |
| Trigger: Label „Edge", `aria-haspopup=menu`, startet calm + collapsed | PASS |
| Panel `role=menu[aria-label=Edge]`, 4 Items in Reihenfolge Liq→Lag→Regime→Clock | PASS |
| ARIA: Liq-Item `aria-pressed=false` (Magnete aus), andere Items ohne pressed; Trigger `aria-expanded` korrekt | PASS |
| Escape **und** Outside-Click schließen das Menü | PASS |
| **Engaged-Neon-State**: offenes Modal → engaged; zu + Magnete aus → calm; Magnete an (persistiert) → engaged bleibt; Item `aria-pressed=true`; nach Disable wieder calm | PASS |
| **Viral-Loop/Doktrin**: 6 Edge-Gesten feuern den Usage-Nudge („meint es ernst") | PASS |
| Layout bei 1280/1024/768 px: kein Horizontal-Overflow, Trigger sichtbar | PASS (nach Header-Fix) |
| Screenshot | `artifacts/qa-step5-menu.png` |

### 5.2 Funde & Fixes in Schritt 5
1. **Pre-existing Header-Overflow** (nicht wave-7): Die Header-Zeile
   (`container flex h-header …`) hatte Fixhöhe ohne Wrap → bei 1024 px
   142 px Horizontal-Overflow (Suchfeld + Aktions-Cluster), bei 768 px 8 px.
   Delta-Test bewies: Edge-Menü trägt 0 px bei. Fix: `min-h-[var(--nc-header-h)]
   flex-wrap py-1.5` — wrappt statt zu überlaufen, bei 1440 px identisches Bild.
2. Whale-Ticker-LIs melden zwar rect.right > Viewport, sind aber falsch-positiv:
   die Liste ist `overflow-x-auto` (clippt/scrollt intern).
3. Regression nach Header-Fix (betrifft alle Seiten): browser-check erneut
   **169/169** (ein EVM-Gas-FAIL im ersten Lauf war ein externes
   GeckoTerminal-Rate-Limit-Flake, Re-Run grün), beta **30/30**.

---

## Schritt 6 — Canvas-Primitive-Lifecycle ✅

### 6.1 Browser (`qa-edge-visual.mjs primitive`, 9 Checks)
| Check | Messwert |
| --- | --- |
| Magnete malen auf der Einzelpane | 169 Band-Rows |
| **setSource(null)**: Ausschalten löscht ausnahmslos alles | 0 Rows / 0 Tag-Pixel |
| Themed Reboot (matrix via Persist-Payload): Bänder überleben | 159 Rows |
| **Band-Tint folgt der Theme-Palette**: Blau-Grün-Gap der Bear-Rows 11.9 (acid, #ff2e63 trägt Blau) → **−1.9** (matrix, Bär = reinrot) → 12.0 (zurück auf acid) | PASS |
| Grid 2x2: alle vier Preis-Panes tragen Bänder (Overlay-Canvases korrekt leer) | 74,0,74,0,74,0,74,0 |
| Zurück auf 1x1: exakt eine gebandete Pane, kein Leak | 135,0 |
| Chart-Typ-Swap (Heikin-Ashi → Candles) re-attached die Primitive | 135 Rows |
| Resize 1440→1000 px malt weiter | 100 Rows |
| Screenshot | `artifacts/qa-step6-primitive.png` |

### 6.2 Funde & Fixes in Schritt 6
1. Keine Produkt-Bugs: `setSource`-Effect hängt korrekt an `[liqOn, candles,
   chartTheme]`, die Primitive wird bei Series-Neuerstellung (Chart-Typ-Swap)
   neu attached und beim Pane-Abbau genullt.
2. QA-Werkzeug: Theme-Fingerprint über den mittleren Blau-Grün-Abstand der
   Bear-Band-Pixel (default #ff2e63 vs matrix #ff0000) — robust gegen
   Live-Candle-Rauschen, weil nur Band-Rows (Row-Run-Signatur) einfließen.

---

## Schritt 7 — i18n ×5 im Browser ✅

Pro Locale (de/en/es/ru/zh) acht Checks, insgesamt **40/40**:
| Check | Ergebnis |
| --- | --- |
| Edge-Menü listet alle vier Engines (Produktnamen lokal identisch) | 5/5 PASS |
| Liq-Radar-Modal: Locale-String (z. B. „Mostrar imanes en el gráfico"), keine Roh-Placeholder, keine Fehlkeys | 5/5 PASS |
| Lag-Oracle-Modal: Locale-Hint/Stats-Labels, clean | 5/5 PASS |
| Regime-Compass-Modal: einer der fünf Locale-Regime-Namen oder Need-Hint, clean | 5/5 PASS |
| Clock-Edge-Modal: Stunden-/Wochentags-Label der Locale, clean | 5/5 PASS |
| Help: Kategorie-Chip „Edge Suite" mit Badge 4 + erste Topic-Frage der Locale | 5/5 PASS |
| Landing: Feature-Titel + Body-Snippet der Locale | 5/5 PASS |
| Keine intl-/Console-Errors während des Sweeps | 5/5 PASS |

### 7.1 Funde & Fixes in Schritt 7
1. QA-Messfehler (kein Produkt-Bug): CSS-`uppercase` macht `includes()`
   case-sensitiv kaputt (zh fiel nicht auf, weil Hanzi keine Kasus haben);
   der Fehlkey-Marker `edge.` matchte den englischen Satzausklang
   „no seasonality edge." → Marker auf `edge\.[a-zA-Z]` geschärft,
   String-Vergleiche case-insensitiv.
2. Keine Produkt-Bugs: alle ICU-Strings rendern in allen Locales sauber.

## Schritt 8 — Mobile & Graceful Failure ✅

`node scripts/qa-edge-visual.mjs mobile` → **13/13 PASS**.

**Teil A — Mobile (390×844, iPhone-Maß):**
| Check | Ergebnis |
| --- | --- |
| Mobile-Gate warnt vor dem Terminal | PASS |
| „Trotzdem aktivieren" entsperrt das Terminal | PASS |
| Liq-Radar-Modal öffnet + scrollt innerhalb 390 px | PASS |
| Kein horizontaler Seiten-Overflow bei offenem Modal | PASS |
| Clock-Edge-Heatmaps passen in 390 px | PASS |
| Regime Compass passt in 390 px | PASS |
| Lag-Oracle-Select bei 390 px bedienbar | PASS |

**Teil B — Total-Ausfall aller Feeds (Outage-Simulation):**
| Check | Ergebnis |
| --- | --- |
| Externe Fetches + Sockets wirklich tot | PASS — 9 blockiert |
| Terminal bootet auf seed-losem, dünnem Feed | PASS |
| Liq Radar degradiert zu „Noch zu wenig Kerzen im Feed." | PASS |
| Scharfgeschaltete Magnete malen nichts, crashen nichts | PASS — checked, 0 Canvases, kein Host |
| Lag Oracle → „Leader-Feed lädt" | PASS |
| Regime Compass → „noch zu wenig Kerzen für eine Einordnung" | PASS |
| Clock Edge → „noch zu wenig Kerzen geladen" | PASS |
| Keine Roh-Placeholder/Crashes in degradierten Modals | PASS |

**Methode (Outage):** `evaluateOnNewDocument` patcht `window.fetch`
(Reject für alles außer eigener Origin) und `window.WebSocket`
(externe URLs → `wss://invalid.invalid/dead`). Bewusst KEIN
`setRequestInterception` — das abortet die `?_rsc`-Hydration-Requests
von Next.js und der Client-Baum mountet nie (QA-Sackgasse, dokumentiert).

**Befund (kein Bug, Design):** Bei <2 Candles rendert `ChartGrid` den
`PanePlaceholder` (Feed-Status „Verbinde neu · Versuch N") statt
`PriceChart` — es gibt im Total-Ausfall also **kein Canvas**, und der
`[data-liq-radar]`-Host fehlt. Genau so soll Graceful Failure aussehen:
Status sichtbar, kein leerer Chart, alle vier Modals zeigen ihre
Need-Hints, der Magnet-Toggle bleibt harmlos (Store-Flag an, nichts
gemalt). Die Checks warten deshalb auf `[data-menu-trigger="edge"]`
statt `canvas` und verifizieren `checked && !host && canvases === 0`.

Screenshots: `artifacts/qa-step8-mobile-clock.png`,
`artifacts/qa-step8-dead-feeds.png`. Regression: browser-check 169/169 grün.

## Schritt 9 — Regression gesamt ✅

Nach einem Workspace-Snapshot-Restore (`node_modules`/`.next`/Chrome-Libs
weg) komplette Frisch-Installation: `npm ci` (789 Pakete), apt-Chrome-Libs,
`next build` — dann alle Suiten auf dem Production-Server:

| Suite | Ergebnis |
| --- | --- |
| `npm run typecheck` (tsc --noEmit) | ✔ 0 Fehler |
| `npm run lint` (eslint .) | ✔ 0 Warnungen |
| `npm run check:i18n` | ✔ Parität 1098 Keys × 5 Locales |
| `npm run build` | ✔ (statisch + SSG + Proxy/Middleware) |
| `npm run smoke` (ws + api + chart + edge) | ✔ 4/4 |
| `node scripts/beta-test.mjs` | ✔ 30/30 Journeys (Run 1: 29/30, bekannter External-API-Flake Gate/DEX-429; Runs 2+3 fehlerfrei) |
| `node scripts/browser-check.mjs` | ✔ 169 Checks |
| `node scripts/seo-audit.mjs` | ✔ inkl. hreflang-Sitemap + llms.txt |
| `node scripts/qa-i18n-usage.mjs` | ✔ 62/62 Edge-Keys × 5 |

Kein Produktcode geändert seit Schritt 8 — die Edge-Visual-Flows
(Schritte 1–8) bleiben gültig.

## Schritt 10 — Doku & Artefakte ✅ (Serienabschluss)

| Check | Ergebnis |
| --- | --- |
| README-Feature-Matrix listet alle vier Engines mit Formel-/Engine-Verweis (`src/lib/*.ts`) | ✔ Zeilen 754–757 |
| README-Test-Matrix + Wave-7-QA-Zeile konsistent („steps 1–9 green", Suiten benannt) | ✔ |
| Help-Topics: 4 Edge-Topics (`edgeTopics`) × 5 Locales, Kategorie `edge`, keine leeren Antworten | ✔ 20/20 |
| Help-Kategorien-Chips inkl. „Edge Suite" mit Badge 4 in allen Locales | ✔ (Schritt 7 + Screenshot) |
| Screenshot-Inventar `artifacts/`: 38 Dateien, je Schritt 1–8 mind. ein QA-Shot; fehlender Step-7-Shot nachgezogen (`qa-step7-i18n-help-es.png`: es-Help, Edge-Suite-Chip engaged, Liq-Topic offen) | ✔ |
| Spenden-Doktrin: keine Paywalls, keine erfundenen Fakten; Milestone-Nudge nutzt echte Visit-Zähler (`nc-visit-stamped`/`nc-milestone-*` aus localStorage), „ein Dev, Miete/Strom/Ramen"-Narrativ + Ads-und-Spenden-Begründung in allen 5 Locales | ✔ |
| Wallets/Copy-Feedback/Supporter-Badge-Texte paritätisch ×5 (1098 Keys, `check:i18n` grün) | ✔ |

Damit sind **alle 10 QA-Schritte der Wave-7-Serie abgeschlossen**:
1 Liq Radar · 2 Lag Oracle · 3 Regime Compass · 4 Clock Edge ·
5 Menü/Toolbar · 6 Canvas-Primitive · 7 i18n ×5 · 8 Mobile & Graceful
Failure · 9 Regression gesamt · 10 Doku & Artefakte.

Gesamtbilanz: 22+16+10+11+17+9+40+13 = **138 modulare Browser-Checks** +
77 Engine-Checks (edge-smoke 41 + step-1..4 Engine-Suiten) + Regression
(169 browser, 30 beta, smoke ×4, tsc, eslint, seo, i18n 1098×5).
