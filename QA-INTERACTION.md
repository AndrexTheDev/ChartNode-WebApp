# QA-INTERACTION — Interaktive Elemente, Feedback & Zustände

Audit aller interaktiven UI-Elemente auf konsistentes Feedback, Ladezustände und
geschmeidige Interaktionen.

**Ergebnis: 25/25 Checks · CSS-Audit 0 fehlende Utilities · alle Regressionen grün**

Lauf: `npm run qa:interaction` (Puppeteer, Chrome Headless, `/de` + `/de/terminal`)
CSS-Audit: `npm run audit:css`

---

## 1. Gefundener Hauptdefekt — Tailwind-Opacity-Skala

**Symptom:** Ergänzte Hover-/Pressed-Zustände (`hover:bg-primary/22`,
`hover:bg-warning/22`, `hover:bg-bull/25`, `bg-primary/12` …) zeigten keinerlei
Wirkung. Computed Styles blieben vor und nach Hover identisch.

**Ursache:** Tailwind 3.4 generiert Farb-Modifier wie `bg-primary/12` **nur**, wenn
`12` auf der `opacity`-Skala steht. Die Default-Skala lautet
`0 5 10 15 20 25 30 35 40 45 50 55 60 65 70 75 80 85 90 95 100`.
Alle Werte außerhalb (`/8 /12 /14 /16 /18 /22 /72 /92 /96 /97` …) werden
**stillschweigend verworfen** — kein Build-Fehler, keine TypeScript-Meldung,
keine Lint-Warnung. Die Klasse steht im DOM, aber nicht im CSS.

Betroffen waren app-weit **106 Utilities**, darunter nahezu alle neu ergänzten
Engaged-Hovers sowie Hintergrund-Deckkraftstufen.

**Fix:** `theme.extend.opacity` in `tailwind.config.js` um die tatsächlich
verwendeten Stufen erweitert (2, 3, 4, 6, 8, 11, 12, 14, 16, 18, 22, 28, 30, 32,
45, 55, 65, 72, 85, 88, 92, 94, 96, 97, 98).

## 2. Zweiter Defekt — `bull`/`bear` nicht als Farbe definiert

**Symptom:** `text-bull` (46×), `text-bear` (47×), `border-bull/50`, `bg-bull/10`
waren tot — Kursgewinne/-verluste und Whale-Markierungen rendern ohne Farbe.

**Ursache:** Die Werte existierten in `tailwind.config.js` nur unter
`neon.bull` / `neon.bear` (also als `text-neon-bull`), die UI schreibt sie aber flach.

**Fix:** Top-Level-Aliase `bull: '#00ff9d'` / `bear: '#ff2e63'` ergänzt —
weiterhin brand-identisch zu den Chart-Candles.

**Verifiziert:** `text-bull` → `rgb(0, 255, 157)`, `text-bear` → `rgb(255, 46, 99)`.

## 3. Fehlende Hover-/Active-Zustände (Produkt-Edits)

| Komponente | Zustand | Ergänzung |
|---|---|---|
| `LayoutShowcase` | Layout-Button aktiv | `hover:bg-primary/16` + `active:bg-primary/22` |
| `LayoutShowcase` | Layout-Button inaktiv | `hover:bg-elevated/60` + `active:bg-elevated/70` |
| `ToolMenu` | Trigger offen/engaged | `hover:border-primary/80` + `hover:bg-primary/18` + `active:bg-primary/25` |
| `ToolMenu` | Trigger geschlossen | `hover:border-primary/40` + `hover:bg-elevated/60` + `active:bg-elevated/70` |
| `SiteHeader` | Logo, aktiver Nav-Punkt | Engaged-Hover |
| `SmartSearch` | Suchmaske | Neon-Border + Glow bei `focus-within` |
| `TerminalShell` | Stern, OnChain, Pro, Supporter, Chip, Select | Engaged- und Inaktiv-Hovers |
| `ChartGrid` | Zellen-Button aktiv | `hover:bg-primary/22` |
| `DrawingToolbar` | Force-Modus, inaktive Tools | `hover:bg-primary/22` / `hover:border-primary/40` |
| `WalletsList` | Wallet-Zeile | Engaged-Hover |
| `Modal`, `ToastHost` | Entry-Animationen | `fade-up` 220 ms Panel + `fade-in` Backdrop, `toast-in` 260 ms |

**Verifiziert am Beispiel ToolMenu:** `rgba(60,255,20,0.12)` →
Hover `0.18` + Border `0.8` → Active `0.25`.

## 4. Fehlerhafte Eingaben — einheitliche Hervorhebung

`input/textarea/select[aria-invalid='true']` erhält Danger-Border
(`hsl(var(--nc-danger) / 0.75)`) plus Glow. Die Regel liegt **außerhalb aller
Cascade-Layer** mit `!important`, damit sie gegen `border-<color>`-Utilities auf
dem Element gewinnt (`@layer utilities` allein reichte nicht).

**Verifiziert:** `rgb(52,75,48)` → `rgba(253,46,101,0.753)` + Danger-Shadow.

## 5. Test-Harness-Korrekturen (Audit-Skript, nicht Produkt)

Drei Defekte lagen im Prüfskript und erzeugten False Negatives:

1. **Toast-Selektor:** `[aria-live="polite"]` matchte zuerst die leere
   sr-only-Anouncer-Region, nicht den Toast-Host. Fix:
   `[aria-live="polite"].fixed` mit Fallback auf die erste Region mit Inhalt.
2. **Blink-Style-Cache:** Chrome cached Computed Styles *innerhalb eines*
   `evaluate()`-Aufrufs. Wurde `aria-invalid` nach dem ersten `getComputedStyle()`
   gesetzt, las der zweite Aufruf denselben veralteten Wert. Fix: Anlegen /
   Attribut setzen / Lesen in drei getrennten `evaluate()`-Aufrufen.
3. **Hover-Probe-Blindstellen:** `textDecorationColor`/`-Style` fehlten in der
   Vergleichssignatur; ein von Overlays verdecktes Element galt als „kein Hover"
   statt als „nicht prüfbar". Fix: Signatur erweitert,
   `document.elementFromPoint()`-Guard ergänzt, `outerHTML`-Snippet in den
   Gap-Report aufgenommen.

---

## Check-Ergebnisse (25/25)

### 1 — Interaktive States
- ✔ Landing: alle 20 Kontroll-Klassen zeigen Hover- **und** Active-Feedback
- ✔ Terminal: alle 26 Kontroll-Klassen zeigen Hover- **und** Active-Feedback
- ✔ Disabled-Buttons einheitlich inert (`opacity` < 0.9 + `pointer-events: none`)
- ✔ Tab-Fokus überall sichtbar — 43 Stationen, 0 ohne Ring/Glow
- ✔ Suchmaske: Fokus zeigt klaren Neon-Border + Glow
- ✔ `aria-invalid`: Danger-Border + Glow
- ✔ Fehlerhafte Eingabe: Dropdown zeigt definierten Empty-State, kein rohes Nichts
- ✔ keine Page-Errors (Landing + Terminal)

### 2 — Modal- & Dropdown-Animationen
- ✔ Venue-Dropdown `fade-up` 0.55 s
- ✔ Tools-Menü `fade-up` 0.2 s
- ✔ Journal-Modal: Panel `fade-up` 0.22 s + Backdrop `fade-in`
- ✔ Locale-Dropdown `fade-up`
- ✔ **ΔCLS = 0.0000** beim Öffnen und Schließen, Anker bleibt stabil → kein Layout-Jitter

### 3 — Feedback & Toasts
- ✔ Tip-Jar öffnet, Copy-Klick zeigt Inline-Neon-Feedback (Check-Icon,
      Bull-Border `rgba(0,255,157,0.7)`, Label „Kopiert!")
- ✔ Fehlgeschlagenes Kopieren → Warn-Toast „Adresse nicht kopierbar – bitte
      manuell markieren."
- ✔ Toast im Cyberpunk-Stil: `nc-clip`, Warn-Border `rgba(255,183,0,0.6)`, Glow
- ✔ Entry-Animation `toast-in` 0.26 s
- ✔ Auto-Expiry (verschwindet selbstständig)
- ✔ keine Page-Errors

### CSS-Audit (`npm run audit:css`)
```
CSS-Dateien: 1 · verwendete Utilities: 265 · im CSS definiert: 719
FEHLENDE Utilities: 0 ✔
```

---

## Regressionen

| Suite | Ergebnis |
|---|---|
| `scripts/browser-check.mjs` | ✔ 170/170 |
| `scripts/beta-test.mjs` | ✔ 30/30 Journeys |
| `scripts/qa-onboarding.mjs` | ✔ (ΔCLS 0.0043, Heap 10.7 → 11.4 MB) |
| `scripts/qa-trader.mjs` | ✔ 29/29 |
| `scripts/qa-edge-visual.mjs` | ✔ |
| `npm run check:i18n` | ✔ 1099 Keys × 5 Locales |
| `npm run typecheck` | ✔ 0 Fehler |
| `npm run lint` | ✔ 0 Errors (8 Warnings, alle in QA-Skripten) |

Bekannte Umgebungsgrenzen (nicht produktseitig): `api.geckoterminal.com` liefert
intermittierend 429, `api.kucoin.com` im Sandbox-Netz `ERR_FAILED`,
CORS-blockiert: bybit, kucoin, bitfinex, coinex.

---

## Dauerhafte Absicherung

`npm run audit:css` vergleicht alle im Quelltext verwendeten Tailwind-Utilities
gegen das gebaute CSS und bricht mit Exit-Code 1 ab, sobald eine Klasse
stillschweigend verworfen wird — genau die Fehlerklasse, die dieses Audit
verursacht hat und die weder Build noch TypeScript melden.
