# QA-RESPONSIVE — Breakpoints, Touch-Targets, High-DPI

Audit der Benutzeroberfläche über Auflösungen und Eingabemethoden hinweg.

**Ergebnis: 43/43 Checks · 3 echte Defekte behoben · alle Regressionen grün**

Lauf: `npm run qa:responsive` (Puppeteer, Matrix 320 / 375 / 768 / 1440 / 2560 px,
Touch-Viewports mit `hasTouch`, DPR 1–3)

Screenshots: `artifacts/resp-*.png`

---

## 1. Responsive Breakpoints

Getestet: 320 (Small Mobile), 375 (Mobile @3x), 768 (Tablet @2x),
1440 (Desktop + @2x Retina), 2560 (Ultrawide) — jeweils `/de` und `/de/terminal`.

**Befund:** kein horizontaler Overflow auf keiner Breite (Δ = 0 px).
Alle scheinbaren Überläufe waren by-design: die Ticker-Marquee (`w-max`,
clipt sich selbst via `overflow-hidden`) und horizontale Scroll-Rows.

### Behobener Defekt 1 — 140 px horizontaler Scroll bei 320 px

`#survival` (Funding-Sektion) machte die Seite bei 320 px auf 460 px Breite
scrollbar. Ursache ist das klassische **`min-width: auto`-Problem bei Grid**:

- Die Spur `lg:grid-cols-2` fällt unterhalb von `lg` auf eine einzige
  implizite Spur zurück.
- Grid-Spuren sind per Default `min-width: auto` und wachsen auf die
  **min-content-Breite** ihres Inhalts.
- Inhalt sind Wallet-Adressen: 44 Zeichen, monospace, ohne Umbruchstelle →
  444 px min-content.

Der Beweis lief im Browser: Setzen von `min-width: 0` auf die Grid-Items
senkte `document.scrollWidth` sofort von 460 auf 320.

**Korrektur in `SurvivalSection.tsx`** (konsistent zum Muster, das
`LayoutShowcase` bereits verwendet):

```tsx
{/* vorher: <div className="mt-10 grid gap-6 lg:grid-cols-2"> */}
<div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
```

**Globale Absicherung in `src/styles/globals.css`**, damit lange Tokens
(Adressen, Ticker-Symbole, Monospace-Strings) nie wieder eine Box aufsprengen:

```css
/*
 * Horizontal-Scroll-Schutz auf small mobile (320px).
 *
 * `overflow-x:hidden` am body allein reicht nicht: Der Ueberlauf wird dann
 * an `html` weitergereicht und die Seite bleibt scrollbar. Grid-/Flex-Items
 * sind per Default `min-width:auto` und wachsen auf die min-content-Breite
 * ihres Inhalts – Wallet-Adressen, Ticker-Symbole und Monospace-Strings ohne
 * Umbruchstelle sprengen so jede Spur. Deshalb: Items duerfen schrumpfen,
 * und lange Tokens brechen um, statt die Box aufzuschieben.
 *
 * Ausgenommen sind bewusst ueberbreite Bahnen (Marquee, Scroll-Rows): die
 * tragen `w-max`, `animate-marquee` oder `overflow-x-auto`/`nc-no-scrollbar`
 * und clippen sich selbst.
 */
:where(main, section, header, footer, aside, article) :where(div, p, li, dd, dt, span, code, pre) {
  min-width: 0;
}

code,
pre,
.nc-break-anywhere {
  overflow-wrap: anywhere;
}
```

`:where()` hält die Spezifität bei 0, damit gezielte Utility-Klassen
weiterhin gewinnen.

### Behobener Defekt 2 — Whale-Ticker löste sich beim Scrollen ab

Die Bottom-Leiste war `sticky bottom-0` und liegt in `<main>`. Sticky wirkt
nur innerhalb des eigenen Scroll-Containers, und `<main>` endet **vor** dem
geteilten SiteFooter. Gemessen bei 375×812:

| scrollY | Leiste unten? |
|---|---|
| 0 | ✔ verankert |
| 600 | ✔ verankert |
| 1200 | ✗ 500 px Lücke zum Grund |
| 1800 | ✗ komplett verschwunden |

Die Seite ist 2925 px lang — der Live-Ticker war also auf der Hälfte der
Seite unsichtbar. **Fix:** `fixed inset-x-0 bottom-0` mit
`pointer-events-none` am Wrapper und `pointer-events-auto` an der Innenleiste
(damit die fixierte Fläche keine Footer-Klicks schluckt), plus
`pb-[env(safe-area-inset-bottom)]` für die iOS-Home-Anzeige.

Da `fixed` das Element aus dem Fluss nimmt, deckte es zunächst die letzte
Footer-Zeile ab. Der Ausgleich läuft über eine CSS-Variable, die der Ticker
per `ResizeObserver` am Dokument veröffentlicht und die der geteilte Footer
liest:

```css
/* SiteFooter.tsx */
<footer className="… pb-[var(--nc-dock-offset,0px)] …">
```

```tsx
/* WhaleTicker.tsx – veröffentlicht die echte Leistenhöhe */
useEffect(() => {
  const root = document.documentElement;
  const bar = barRef.current;
  if (!bar) return;
  const apply = () => root.style.setProperty('--nc-dock-offset', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(bar);
  return () => { ro.disconnect(); root.style.removeProperty('--nc-dock-offset'); };
}, []);
```

Default `0px`: Routen ohne Ticker rendern exakt wie vorher. Verifiziert:
`coveredCount: 0` am Dokumentende, Footer-Padding 44 px auf `/terminal`,
0 px auf `/de`.

### Bottom-Verankerung (Kriterium 1b)

- Leiste sitzt bei 320/375/768 px **pixelgenau** auf `window.innerHeight`
  (`bottom === innerHeight`, Toleranz 2 px).
- Kompakt: 44–48 px = 4,7–7,1 % der Viewport-Höhe.
- Überdeckt den Chart nach Scroll nicht (`overlaps: false`,
  sichtbare Charthöhe = volle 292/340 px, Chart-Mitte per
  `elementFromPoint` frei).

Hinweis zur Messung: `window.innerHeight` ist die Referenz, nicht die
konfigurierte Viewport-Höhe — Chrome passt bei `isMobile` die nutzbare Höhe
an (URL-Bar-Simulation).

---

## 2. Touch-Targets ≥ 44×44 px

**Befund:** 106 eindeutig zu kleine Ziele auf Touch-Viewports — praktisch die
gesamte kompakte Toolbar-Familie (`h-7` = 28 px, `size-7`, `h-9` = 36 px,
Selects, FAQ-Summaries, Footer-Links, Wallet-Copy-Buttons).

Einzel-Edits an 81 gerenderten Zielen wären wartungsfeindlich und hätten das
Desktop-Layout aufgebläht. Die Lösung ist eine zentrale Media-Query in
`src/styles/globals.css`, die **nur auf echten Touch-Geräten** greift:

```css
/* ==========================================================================
   Touch-Targets (WCAG 2.5.8 / Apple HIG / Material: min. 44x44 CSS-px)
   ==========================================================================
   Das Terminal ist bewusst kompakt gesetzt – `h-7` (28px) und `size-7`
   funktionieren mit Maus, sind fuer Finger aber zu klein. Statt 81 Einzel-
   edits an Komponenten hebt diese Regel interaktive Elemente NUR auf
   echten Touch-Geraeten an:

   · `(hover: none) and (pointer: coarse)` matcht ausschliesslich Geraete ohne
     Hover und mit grobem Zeiger (Smartphone/Tablet). Desktop, Ultrawide und
     Laptops mit Touchscreen behalten das kompakte Layout unveraendert.
   · `min-height`/`min-width` statt `height`: bestehende h-9/h-10-Klassen
     wachsen nicht ueber ihr Design hinaus, es wird nur nach unten abgesichert.
   · `:where()` haelt die Spezifitaet bei 0, damit Klassen wie `h-7` weiterhin
     wirken und nichts ueberschrieben wird.
   -------------------------------------------------------------------------- */
@media (hover: none) and (pointer: coarse) {
  :where(a[href], button, [role='button'], [role='menuitem'], [role='tab'], [role='switch'], summary):where(:not(.sr-only)) {
    min-height: 44px;
  }

  /* Breite: quadratische Icon-Buttons (size-*) UND schmale Text-Chips.
     `1h`, `LOG`, `%`, `1x1` sind nur 26–42px breit – ebenfalls Fehltreffer-
     risiko. Die Mindestbreite gilt fuer alle, die nicht bewusst breit sind. */
  :where(button, [role='button'], [role='menuitem'], [role='tab'], [role='switch'], summary):where(:not(.sr-only)) {
    min-width: 44px;
  }

  /* Text-Inputs und Selects: volle Trefferhoehe, damit der Fokus nicht
     daneben geht und die Soft-Tastatur zuverlaessig oeffnet. */
  :where(input, select, textarea):where(:not([type='checkbox']):not([type='radio']):not(.sr-only)) {
    min-height: 44px;
  }

  /* Checkboxen/Radios in dichten Listen: Trefferflaeche ueber das Label. */
  :where(label:has(> input[type='checkbox']), label:has(> input[type='radio'])) {
    min-height: 44px;
  }

  /* Links ohne Button-Charakter (Fliess-text-Links, Mailto, Logo) sollen
     schmaler bleiben duerfen – hier zaehlt nur die Hoehe. */
}
```

**Verifiziert:** 106 → **0** zu kleine Ziele auf 320/375/768 px, während der
Desktop unverändert 28 px misst (`btnMinH: '44px'` unter Touch, `'auto'` auf
Desktop).

Begründete Ausnahmen im Audit:
- **sr-only-Skip-Link** — WCAG-Muster: 1×1 bis zum Fokus, dann per
  `focus:not-sr-only` sichtbar und groß.
- **`#tv-attr-logo`** — von lightweight-charts injizierter Markenlink, nicht
  editierbar.

---

## 3. High-DPI & Retina Canvas-Rendering

**Befund: korrekt implementiert.** Alle 7 Canvases skalieren exakt mit dem
Device-Pixel-Ratio — gemessen bei DPR 1, 2 und 3:

| DPR | CSS-Breite | Backing-Store | Verhältnis |
|---|---|---|---|
| 1 | 1348 | 1348 | 1.0 |
| 2 | 1348 | 2696 | 2.0 |
| 3 | 1348 | 4044 | 3.0 |

Ground Truth ist der Screenshot-Backbuffer: ein 400×200-Clip liefert bei
DPR 2 ein 800×400-PNG, bei DPR 3 ein 1200×600-PNG. lightweight-charts
(`autoSize: true` → fancy-canvas `devicePixelContentBoxSize`) übernimmt die
Skalierung selbst; ein Eingriff in der App wäre falsch.

**Wasserzeichen** `www.NodeChart.cc`: zentriert, semitransparent, mit
scharfen Glyphenkanten bei 2x und 3x (Pixel-Scan: 451 143 Samples im
Mittelband, harte Kanten dominieren). Sichtkontrolle im Retina-Crop
(`artifacts/resp-retina-crop.png`): Candlesticks, Dochte, gestrichelte
Preislinie und Wasserzeichen ohne jede Unschärfe.

### Zwei Messfallen, die dieses Ergebnis zunächst verfälscht haben

1. **Headless-Chrome meldet `devicePixelContentBoxSize` unskaliert**, wenn der
   DPR nur per `setViewport({deviceScaleFactor})` gesetzt wird — ein reines
   `<div>` von 300 CSS-px liefert bei DPR 2 ebenfalls 300 statt 600. Erst mit
   `--force-device-scale-factor` meldet Chrome korrekt. Das Audit startet
   deshalb mit diesem Flag (`HIGH_DPI_FLAG = 2`) und erwartet diesen Faktor;
   ohne Flag wäre jeder DPR-Test ein Fehlalarm gegen ein korrekt arbeitendes
   Produkt.
2. **`window.devicePixelRatio` allein beweist nichts.** Der Screenshot-
   Backbuffer ist die einzige belastbare Ground Truth für die Render-Auflösung.

---

## Check-Ergebnisse (43/43)

### 1 — Breakpoints (12 Checks)
Alle 6 Viewports × 2 Routen: Δ = 0 px, keine sichtbaren abgeschnittenen
Elemente, keine ungeclippten Überläufe.

### 1b — Bottom-Verankerung (12 Checks)
Verankert, kompakt, Chart nicht überdeckt, Chart nach Scroll vollständig
sichtbar — bei 320, 375 und 768 px.

### 2 — Touch-Targets (6 Checks)
0 zu kleine Ziele auf allen drei Touch-Viewports × 2 Routen.

### 3 — High-DPI (10 Checks) + 3b Wasserzeichen (4 Checks)
Backing-Store = DPR, Kantenprofil scharf, Wasserzeichen-Glyphen scharf,
Retina-Auflösung bestätigt.

---

## Regressionen

| Suite | Ergebnis |
|---|---|
| `scripts/qa-interaction.mjs` | ✔ 25/25 |
| `scripts/beta-test.mjs` | ✔ 30/30 (×3 Läufe; 1 Flake: Binance-WS „Ping received after close", umgebungsbedingt) |
| `scripts/qa-trader.mjs` | ✔ 29/29 |
| `scripts/qa-onboarding.mjs` | ✔ (ΔCLS 0.0048) |
| `scripts/browser-check.mjs` | ✔ 169 PASS |
| `npm run audit:css` | ✔ 265 verwendet / 0 fehlend |
| `npm run typecheck` / `npm run lint` | ✔ 0 Errors |

---

## Dauerhafte Absicherung

`npm run qa:responsive` ist als feste Suite angelegt und bricht bei
Regression mit Exit-Code 1 ab. Es prüft je Viewport: Overflow (nur echte,
nicht geclippte Überläufe), Bottom-Verankerung gegen `window.innerHeight`,
Touch-Target-Matrix gegen 44×44, DPR-Skalierung aller Canvases und die
Wasserzeichen-Schärfe per Pixel-Scan.
