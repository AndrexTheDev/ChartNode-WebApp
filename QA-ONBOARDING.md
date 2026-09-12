# QA-ONBOARDING — Neubesucher-Simulation (Landing, i18n, Navigation, Rechtliches)

Suite: `node scripts/qa-onboarding.mjs` — **88/88 PASS** (Puppeteer, frische
Browser-Kontexte, Accept-Language- bzw. `navigator.languages`-Simulation).
Screenshots: `artifacts/qa-onboarding-{landing,terminal,locale-zh,banner,legal,help}.png`.

## 1 — Landingpage & Terminal-Transition

| Check | Ergebnis |
| --- | --- |
| `/` leitet frische de-DE-Besucher per 307 → `/de` (Proxy, Accept-Language) | PASS |
| Hero: Badge, beide Headline-Zeilen, Subtitle, CTAs, Slogan | PASS |
| Cyberpunk-Design-System: `data-theme=acid`, Body `rgb(10,10,10)`, Neon-Var `110 100% 54%`, self-hosted Manrope | PASS |
| Landing-CLS | **0.000** |
| Landing → Terminal = Client-Side-Navigation (SPA-Marker überlebt, kein Reload) | PASS |
| Layout-Shift der Transition | **Δ 0.004** (nach Fix, vorher 0.667 — siehe Befund 1) |
| Terminal malt Charts nach SPA-Transition | PASS |
| Memory/Leaks: Sockets beim Verlassen des Terminals komplett released (0 live), Heap-Roundtrip 10.6 → 11.6 MB | PASS |

## 2 — i18n & dynamisches SEO (de, en, es, zh, ru)

Pro Locale 10 Checks, alle PASS:

| Check | Ergebnis ×5 |
| --- | --- |
| `html lang` exakt (`de-DE`, `en`, `es-ES`, `zh-Hans`, `ru-RU`) | PASS |
| `<title>` + `meta description` Zeichen-exakt aus `messages/{loc}.json` | PASS |
| `og:locale` (`de_DE`, `en_US`, `es_ES`, `zh_CN`, `ru_RU`) | PASS |
| hreflang-Set vollständig (5 Locales + `x-default`), Canonical auf eigene Locale | PASS |
| Hero + Navigation sichtbar lokalisiert | PASS |
| Command-Palette-Modal (Placeholder) lokalisiert, schließt clean inkl. Scroll-Lock-Release | PASS |
| Header-Tooltips/`aria-label`s lokalisiert (z. B. „Befehlspalette öffnen" / „打开命令面板" / «Открыть командную панель») | PASS |
| Null Intl-/Console-Errors | PASS |

Zusätzliche Navigations-Logik:

| Check | Ergebnis |
| --- | --- |
| Sprachmenü (Dropdown, `role=listbox/option`) wechselt de → es **client-side**, ohne Reload, `lang` + gesamter Copy-Satz folgen | PASS |
| Systemsprachen-Banner: frischer Besucher mit `navigator.languages=[ru-RU]` auf `/en` sieht das Banner („Switch to RU"), Klick navigiert nach `/ru` (`lang=ru-RU`) | PASS |
| Unbekannte Locale `/fr/terminal` → saubere 404, kein 5xx, kein Crash | PASS |

## 3 — Rechtliches, Hilfe, Kontakt

| Check | Ergebnis |
| --- | --- |
| `/de/legal/{terms,disclaimer,privacy}`: lokalisierte H1s („Allgemeine Geschäftsbedingungen", „Disclaimer / Risikohinweis", „Datenschutzerklärung"), keine rohen ICU-Placeholder, keine Console-Errors | PASS ×3 |
| Footer-Legal-Link routed client-side (SPA-Marker überlebt) | PASS |
| Footer-Mailto exakt `mailto:hippie.highho@gmail.com?subject=NodeChart%20%E2%80%93%20Feedback` (2 Stellen) | PASS |
| Help-Center: Suche filtert auf „Wie funktioniert der Liq Radar?", Kategorie-Chip „Edge Suite", Accordion (`aria-expanded`) öffnet, 14 `kbd`-Shortcuts | PASS |
| Tip-Jar-Modal (Trigger `aria-label="Trinkgeld-Glas"` im Terminal-Toolbar) öffnet, Escape schließt, Scroll-Lock released | PASS |

## Befunde & Fixes

1. **Echter UI-Mangel (behoben): CLS 0.667 beim Landing→Terminal-Übergang.**
   Die Toolbar-Zeilen (`flex-wrap`) brachen nach der Hydration anders um als
   im SSR-Shell, weil hydrations-gatinge Chips (Session-Strip, Status) erst
   client-seitig Breite beitragen → alles darunter shiftete. Fix in
   `TerminalShell.tsx`: Wrap-stabile Zeilen — ab `lg` eine Zeile mit
   horizontalem Inner-Scroll (`lg:flex-nowrap lg:overflow-x-auto
   [&>*]:lg:shrink-0`), darunter weiterhin Wrapping (Tablet/Mobile bleiben
   voll sichtbar ohne Scroll). Ergebnis: ΔCLS **0.004**, alle Layout-Checks
   bei 1280/1024/768 grün, Edge-Trigger überall ohne Scroll erreichbar.
2. **QA-Metrik-Artefakt (kein Produktbug):** `scrollWidth` zählt den
   bewussten Toolbar-Inner-Scroller mit, obwohl die Seite selbst nicht
   horizontal scrollbar ist (`body{overflow-x:hidden}`, Scroll-Probe = 0).
   Der Layout-Check misst jetzt nutzerrelevante Wahrheit: Scroll-Probe +
   Scan auf ungeclippten visuellen Overflow + Trigger-Sichtbarkeit.
3. **Keine Übersetzungslücken, keine Routing-Fehler, keine Zombie-Sockets,
   keine Hydration-Mismatches** in allen getesteten Pfaden.

Regression nach dem Toolbar-Fix: Menu-Flow 17/17, Mobile-Flow 13/13,
Onboarding 88/88, browser-check 169/169, Beta 30/30 — alles grün.
