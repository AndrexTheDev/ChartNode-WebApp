# NodeChart — UI/UX-Vollaudit: Design-System, Layout-Integrität, i18n

Datum: 2026-09-12 · Rolle: Lead UI/UX & Frontend Architect · Scope: alle Screens, 5 Locales (DE/EN/ES/RU/ZH), 320px → 3440px Ultrawide.

## 1. Farb- & Design-System

**Fundament (verifiziert, unverändert):** Jede semantische Farbe läuft über HSL-Triplet-CSS-Variablen (`--nc-*`) in `src/styles/globals.css`, gemappt in `tailwind.config.js` (`bg`, `surface`, `line`, `fg`, `primary`, …). 5 Themes (acid/violet/light/matrix/miami) skinnen die App ohne Re-Render. Acid-Defaults: BG `#0a0a0a`, Acid Green `#39ff14`, Electric Purple `#b026ff`, Cyan `#00f0ff`, Bull `#00ff9d`, Bear `#ff2e63`. Glow-Effekte (`neon-text`, `neon-box`, `shadow-neon*`) sind überall an `--nc-glow` gekoppelt → light-Theme blendet automatisch ab.

**Behobene Abweichungen (fremde Hexe außerhalb Palette/Token):**

| Fundstelle | Vorher | Nachher |
|---|---|---|
| PriceChart Pattern-Marker | `#00e5a0`/`#ff3860` | `chartTheme.bull`/`chartTheme.bear` (theme-bewusst) |
| PriceChart Compare-Serie | `#b57bff` | `#7c5cff` (SERIES_COLORS-Violett) |
| RatingsModal Gauge-SVG | `#ff3860`, `#00e5a0`, `#e8fff6` | `hsl(var(--nc-bear/--nc-bull/--nc-fg))` |
| MagnifierModal Sparkline | `#00e5a0` | `hsl(var(--nc-bull))` |
| HeatmapModal Kachel-Farben | `rgba(0,229,160/255,56,96,…)` | `hsl(var(--nc-bull/--nc-bear) / α)` |
| 3× Checkbox-Akzent | `accent-[#00e5a0]` | `accent-bull` |
| indicators.ts ADX/CUSTOM | `#ffffff`, `#ff9e00` | `#eefbea`, `#ffb020` (Palette) |
| primitives.ts Fallback-Theme | eigene Hex-Kopien | `CHART_THEME_FALLBACK` (exportierte Token-Werte, Single Source) |

Bewusst behalten (dokumentierte Ausnahmen): `SERIES_COLORS` = kategorische 8-Farb-Skala für Indikator-Serien (Daten-Viz, konsistent in indicators.ts + drawings.ts/Fib); Theme-Swatches in ShareModal (`#00e63c`/`#ff2e97` = exakte Matrix-/Miami-Primärfarben); neutrale Scrims (`bg-black/72` Modal-Backdrop, `border-black/40` Heatmap-Kachelfuge).

**Marker-Signatur-Bug (Nebenfund):** Die Signatur des Marker-Guards enthielt keine Farbe → Theme-Wechsel hätten nicht neu gezeichnet. Signatur jetzt `time:position:text:color`.

**Typography:** Wildwuchs `text-[8px]/[9px]/[10px]` (28 Stellen) in die Config-Skala überführt: `text-micro-8/9/10` (px-Strings ohne lineHeight-Block → erben Zeilenhöhe exakt wie vorher, QA-Selektoren nachgezogen). Verbleibende Display-Einzelwerte (Hero 2.6rem→clamp, 404 6/9rem) sind dekorative One-offs. `audit:css`: 0 fehlende Utilities.

## 2. Layout-Integrität & Z-Index-Matrix

**Z-Index-Hierarchie (Config-Tokens, `tailwind.config.js`):**
`backdrop(-10) < Chart-Interna(10/30) < Sidebars/Toolbar(40) < Header(50) < Modal(70, neu: semantisches z-modal statt z-[70]) < Dropdowns(90) < CommandPalette(100) < Toast/Glitch-Overlay(110)`
→ erfüllt die geforderte Ordnung Dropdowns > Modale > (Seiten-)Overlays > Sidebars > Chart > Background.

**Behobene Integritätsfehler:**
- **Toasts unter Modalen:** ToastHost `z-50` → `z-toast` — Copy-/Alert-Feedback war bei offenem Modal (z-70 + Backdrop) unsichtbar.
- **Dropdown-Viewport-Clamp (neu, `src/lib/useClampToViewport.ts`):** absolut verankerte Menüs (Dropdown, ToolMenu) ragten bei 320px links/rechts aus dem Viewport (`right-0`-Anker + margin-left war wirkungslos → ankerseitige Margin-Korrektur) und unten heraus (→ maxHeight + Scroll). Doppelter rAF gegen fade-up-Transform/Webfont-Settling.
- **LocaleDetectBanner vs. WhaleTicker:** Banner `bottom-0` → `bottom-12` (Ticker-Leiste bleibt sichtbar/klickbar); Button-Reihe bricht bei 320px jetzt um (`flex-wrap`, ru/de/es-Labels).
- **SupportNudge:** `bottom-4` → `bottom-14` — lag auf der Whale-Ticker-Leiste.
- **WhaleTicker:** Titel-Chip schrumpfbar (`min-w-0` + truncate), Edge-Fades `max-w-full` (fixe 32px-Fades überstanden den Wrapper bei <32px Breite → +5px-Dokument-Overflow).

**Verifiziert ohne Befund:** Ad-Container stehen im Dokumentfluss (Desktop-Rail = Flex-Aside, Mobile-Strip zwischen Toolbar und Grid) → können den Chart strukturell nie überdecken; SlotTag z-10 nur innerhalb der Slot-Box. OnChain-/Pro-Panels sind bewusste Right-Drawer (sm:top-header, eigenes Schließen + Fokus-Handling). Replay-Transport z-30 unter Toolbar-Dropdowns z-40/50. GridBackdrop `-z-10` fixiert.

## 3. i18n-Layout-Stress-Test

**Neues QA-Werkzeug: `scripts/qa-i18n-layout.mjs`** — 5 Locales × 6 Viewports (320/390/768/1440/2560/3440) × Landing+Terminal = **110 Checks**: Dokument-Overflow, unkontrollierter Text-Overflow (scrollWidth ohne Ellipsis-Strategie), fixed/sticky-Elemente außerhalb des Viewports, Dropdown-/Modal-Fit bei 320 & 1440, Page-Errors.

**Gefunden & behoben (vorher 22 FAILs):**
- **RU/ES Hero-H1:** nicht umbrechbare Komposita („Бесплатно, быстро, децентрализованно", „descentralizado") → `[overflow-wrap:anywhere]` am H1 (erbt in beide Gradient-Spans).
- **ES Stats-Labels:** „Rastreadores" +3px in der 4-Spalten-dl → `[overflow-wrap:anywhere]` am dd.
- **RU/ES/DE Pane-Titel @390:** Venue-Label („главная"/„principal"/„Haupt") `shrink-0` → `min-w-0 truncate`.
- **Banner-Buttons 320px** (de/ru/es) und **TF-Dropdown-Clamp** (alle 5 Locales) — siehe oben.

**i18n-Inhalt:** `check:i18n` = Parität 1099/1099 Keys × 5 Locales, 0 fehlende.

## Verifikation (Production-Build, alle Suites)

| Suite | Ergebnis |
|---|---|
| `tsc --noEmit` · `eslint .` · `next build` | 0 · 0 · ✓ |
| **`qa-i18n-layout.mjs` (neu)** | **110/110** (5 Locales × 6 Viewports) |
| `browser-check.mjs` | 169/169 (inkl. Theme-Wechsel, 2x2-Grid, Mobile-Gate) |
| `qa-responsive.mjs` | 43/43 (320px–Ultrawide) |
| `qa-interaction.mjs` | 25/25 |
| `qa-trader.mjs` | 29/29 |
| `beta-test.mjs` | 30/30 |
| `npm run smoke` (ws/api/chart/edge) | 4× OK |
| `audit:css` · `check:i18n` | 0 fehlende Utilities · 5×1099 Keys Parität |
