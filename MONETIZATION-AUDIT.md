# Monetization- & Viral-Loop-Audit — NodeChart

**Rolle:** Growth Engineer & Monetization Specialist
**Datum:** 2026-09-12 · **Build:** Next.js 16.3.4, Production (`next start`) · **Status: ALLE SUITEN GRÜN**

Auditiert wurden alle umsatz- und share-relevanten Mechanismen: Adsterra-Integration,
AdBlock-Soft-Wall, Donation-Clipboard, Viral Loop (Share → Premium-Theme-Unlock) und
die localStorage-Sicherheit. Verifikation nicht nur per Code-Review, sondern mit zwei
Puppeteer-Suiten gegen echte Production-Builds (einmal **ohne** Ad-Env = Auslieferungszustand,
einmal **mit** Dev-Fixture-Placements = Container-Beweis).

---

## 1. Befunde & Fixes dieses Audits

| # | Befund | Schwere | Fix |
|---|--------|---------|-----|
| 1 | `ShareModal` nutzte im SSR-Zweig (vor Hydration) eine hardkodierte Zweit-Domain `https://nodechart.app/…` statt der kanonischen `SITE_URL` (`nodechart.cc`) — und ohne `ticker`/`price`-Parameter. Crawler/No-JS-Clients hätten die falsche Domain im Share-Panel gesehen. | **Mittel** (SEO/Branding) | SSR-Zweig ruft jetzt dasselbe `buildShareUrl(SITE_URL, …)` wie der Client-Zweig → eine Wahrheit, identische Deep-Link-Parameter. |
| 2 | `ThemeBootScript` setzte `meta[name=theme-color]` vor Hydration nur für light/dark hartkodiert — violet/matrix/miami zeigten bis zum `applyTheme()` die falsche Browser-Chrome-Farbe. | **Kosmetisch** | Boot-Skript inlinet jetzt die komplette `THEME_COLOR`-Map als JSON-Literal (zur Render-Zeit serialisiert, zur Laufzeit dependency-free) und bleibt damit automatisch mit `lib/theme.ts` synchron. Whitelist-Regex wird ebenfalls aus den Map-Keys erzeugt (Single Source of Truth). |
| 3 | Kein Test bewies bisher die **echte** AdBlock-Erkennung (nur der `?adwall=1`-Force-Pfad) und niemand testete Clipboard-**Denied**, Popup-**Blocker** oder feindliche localStorage-Payloads. | Test-Lücke | Neues `scripts/qa-monetization.mjs` (24 Checks, `npm run qa:monetization`) + erweitertes `scripts/ad-slots-check.mjs` (16 Checks: Popunder-Session-Cap, Hydration-Monitoring). |

Keine weiteren Bugs gefunden — die Architektur war bereits härtungsfähig gebaut (Details unten).

---

## 2. Adsterra Async Integration (Task 1) ✅

**Architektur (verifiziert):**

| Placement | Loader | Warum |
|-----------|--------|-------|
| Social Bar | `next/script` `strategy="lazyOnload"` in `AdManager.tsx` | Self-anchoring auf Body-Ebene → kanonischer Next-Loader mit eigenem Dedupe. |
| Native Banner (Rail/Strip) | `injectAdScript()` in `AdSlot.tsx`, via `whenIdle()` (requestIdleCallback, Fallback 1,5 s Timer) | Adsterra-Native-Banner rendern **neben ihrem eigenen `<script>`-Node** — `next/script` injiziert via Loader ans Dokumentenende und würde den Container verfehlen. Deshalb gezielte Container-Injektion mit `async=true`, `data-cfasync="false"`, Dedupe über `container.dataset.adSrc`. Dokumentierter Design-Entscheid. |
| Popunder | `requestPopunder()` im Layout-Click-Handler | Adsterra-Popunder öffnet am **nächsten beobachteten Klick** — die Injection muss exakt in der Geste passieren. 1×/Session via `sessionStorage['nc-popunder-fired']` + Modul-`Set` gegen Doppel-Injektion. |

**Kein Main-Thread-Blocking:** alle Injektionen hinter `requestIdleCallback`/`lazyOnload`; Ad-Fetches `onerror`-abgefangen (`.catch(() => undefined)`) — ein totes Ad-Netzwerk kann das Terminal nie crashen.

**Beweis (Fixture-Build auf :3001, 16/16 PASS):**
- Desktop-Container erhält Desktop-Placement, Mobile-Container bleibt leer solange versteckt; Breakpoint-Flip lädt lazy nach (`native-mobile` erscheint nach Resize).
- Social Bar verankert pro Gerät (`socialbar-desktop`/`-mobile`).
- Popunder armt mit Desktop-Placement, **bleibt 1×/Session** (Re-Click auf 2x2 → weiterhin genau 1 Script + 1 Tag), Flag persistiert als Timestamp.
- **Keine Hydration-Warnungen, keine Page-Errors** mit aktiven Ad-Scripts (Console-Monitor über den kompletten Durchlauf).

---

## 3. AdBlock Soft-Wall & Crypto Donations (Task 2) ✅

**Erkennung (`lib/ads/adblock.ts`):** DOM-Bait + Netzwerk-Bait (`/ads.js` setzt `window.ncAdsServed`), **fail-open** (Erkennungsfehler → nicht blockiert, nie eine Wall zu Unrecht), 1×/Session via `sessionStorage['nc-adcheck']`.

**Clipboard (`WalletsList.tsx` → `copyText`):** `navigator.clipboard.writeText` → kompletter Try/Catch → `document.execCommand('copy')`-Textarea-Fallback → `false`. Fehlschlag erzeugt Warn-Toast (`support.copyFailed`, in allen 5 Locales vorhanden) — niemals stiller Misserfolg.

**Beweis (qa-monetization, Sektion 1–2):**
- Saubere Session: **keine** Wall (Erkennung bleibt unsichtbar), keine Page-Errors.
- Echte Blocker-Simulation via CDP `Network.setBlockedURLs ['*/ads.js*']` (kein Request-Interception — das killt die Hydration): Wall erscheint automatisch mit allen drei Wallet-Adressen **exakt** (SOL `79Ksqt…`, BTC `bc1qeq…`, ETH `0xBC3f…`).
- **Terminal hinter dem Modal crasht nicht:** 7 Canvases, OHLC-Legende rendert und updated weiter (Live-Daten fließen).
- **Clipboard-Denied** (`writeText` rejected + `execCommand → false`): Toast „nicht kopierbar“, kein Crash, kein Page-Error.
- Dismiss → Modal zu, 7-Tage-Cooldown persistiert (`wallDismissedAt` in `nc-viral-v1`) → Reload bleibt ruhig.
- Erfolgs-Pfad (Stub): exakte BTC-Adresse im Clipboard + „Kopiert"-Feedback (browser-check 169/169 deckt das ebenfalls ab).

---

## 4. Viral Loop, Theme-Unlock & XSS (Task 3) ✅

**Flow (verifiziert):** Menü „Teilen" → Share-Modal mit WYSIWYG-Tweet-Vorschau (Spec-Text wörtlich: „Found an insane setup for $BTC on NodeChart. Zero fees, real-time on-chain data. #Crypto #Trading") → X-/Telegram-Intent (`fire()`) → `unlockViaShare()` → Unlock-Panel mit Matrix Green / Miami Vice Pink → Theme sofort anwendbar → Persistenz in `nc-viral-v1`.

**Beweis (qa-monetization, Sektion 3):**
- Premium-Gate: gesperrtes „Matrix Green" im Theme-Picker öffnet die Share-Einladung, Theme bleibt `acid`.
- X-Intent: `twitter.com/intent/tweet?text=…` mit encodiertem Cashtag `$BTC`, Hashtags und Deep-Link `?ticker=BTC&price=…`.
- Telegram-Intent: `t.me/share/url?url=…&text=…` mit denselben Parametern.
- **Popup-Blocker-resistent:** `window.open → null` bricht den Unlock nicht (design: Geste zählt, nicht das Fenster).
- Unlock + Theme überleben den Reload.

**XSS-Härtung (alle persistierten Daten laufen durch Validierungs-Merges):**
- `useViralStore`-Merge: `supporter` nur echte Booleans, `shares`/`wallDismissedAt` nur finite Numbers, `celebrated` nur Strings aus dem Payload; `shareUnlocked` dito.
- `useAppStore`-Merge: `theme` gegen `THEMES`-Whitelist, `activeToken` gegen `TOKEN_INDEX`, `watchlist` filtert Nicht-Strings/Unbekannte raus.
- `ThemeBootScript`: Regex-Whitelist (jetzt aus `THEME_COLOR` erzeugt) + `JSON.parse` im Try/Catch — feindliche Strings erreichen `dataset.theme` nie.
- Keine `dangerouslySetInnerHTML`-Nutzung persistierter Daten anywhere (nur statische Inline-Scripts mit `JSON.stringify`-Literalen + `JsonLd` mit `</`-Escape).
- OG-Route (`/api/og`): `sanitizeTicker/Price` + `escapeXml` ✓.

**Beweis (qa-monetization, Sektion 4):** Feindliche Payloads direkt in beide Storage-Keys gesät
(`theme: '"><img src=x onerror=…>'`, `activeToken: '"><script>…'`, `celebrated: [{xss:…}]`,
`supporter: 'yes-please'`, `shareUnlocked: 1`, `wallDismissedAt: 'soon'`, `shares: NaN`) →
Reload: Theme fällt auf `acid` zurück, **kein injizierter Handler feuert**, Terminal rendert
fehlerfrei, Typ-Müll erzeugt keinen Supporter-/Unlock-Status (Wall-Logik intakt).

---

## 5. Verifikations-Matrix (Endstand)

| Suite | Ergebnis |
|-------|----------|
| `qa:monetization` (NEU, 24 Checks: Wall/Clipboard/Share/Unlock/XSS) | **24/24** |
| `ad-slots-check` (erweitert, 16 Checks: Container/Popunder-Cap/Hydration) | **16/16** |
| browser-check (169 Checks, inkl. Wall + Clipboard + Share + Theme) | **169/169** |
| qa-responsive / qa-interaction / qa-trader / beta-test | 43/43 · 25/25 · 29/29 · 30/30 |
| qa-i18n-layout | 110/110 |
| check:i18n (5 × 1099 Keys) · audit:css · tsc · lint · build | 0 Fehler |
| Smoke: 5 Locales `/terminal` + `/api/og` | 6× HTTP 200 |

**Deliverable-Code (finaler Stand):**
`src/components/ads/AdManager.tsx` · `AdRig/AdRail/AdSlot/SupportModal.tsx` ·
`src/lib/ads/{adsterra,config,adblock}.ts` · `public/ads.js` ·
`src/components/support/WalletsList.tsx` (copyText-Fallback-Kette) ·
`src/components/share/ShareModal.tsx` + `src/lib/viral.ts` ·
`src/store/useViralStore.ts` + `storage.ts` · `src/lib/theme.ts` ·
`src/components/layout/ThemeBootScript.tsx`

Fixtures (`scripts/fixtures/ads-dev/`) sind dev-only und wurden nach dem Beweis aus
`public/` entfernt; der Auslieferungs-Build läuft ohne Ad-Env (Slots rendern leer,
Erkennung fail-open).

---

## Addendum 2026-09-12 — Donation-Grace-System (48 h / 5 Tage)

**Anforderung:** Wer spendet, sieht 48 h keinen Spendenaufruf; wer **mehr als
5 $** in Crypto spendet, 5 Tage. Umgesetzt als **ein zentrales Gate** statt
verstreuter Regeln:

* `src/store/useViralStore.ts`: `lastDonationAt` + `lastDonationUsd`
  (persistiert, merge-validiert: finite, `0 ≤ usd ≤ 1e6`, `at > 0` – korrumpierte
  Werte können keine Grace faken), `registerDonation(usd)`, sowie
  `donationGraceMs()/donationGraceActive()` (`> BIG_DONATION_USD` → 5-Tage-Tier,
  sonst 48 h; `$5` exakt bleibt strikt im 48-h-Tier).
* `src/components/support/DonatedFlow.tsx` (neu): zweistufiger Button
  („Ich habe gespendet" → Chips „Bis $5" / „Über $5"), genutzt von Wall **und**
  Tip-Jar; setzt Badge + Grace, sendet Danke-Toast mit der jeweiligen Frist und
  schließt die Wall. Wiederholungsspender (Badge-Label „Supporter") können die
  Grace jederzeit verlängern.
* **Alle Aufrufe hängen am selben Gate:** Nudge-Toast (7-min-Rotation),
  Session-Milestone, Tool-Nudge, Premium-Ribbon (`SupportNudge.tsx`) und die
  AdBlock-Soft-Wall inkl. `?adwall=1`-Force (`AdManager.tsx`).
* Legacy-Migration: alte `supporter: true`-Profile ohne Donation-Felder
  erhalten einmalig ein 48-h-Fenster ab erstem Rehydrate.

**Verifikation (alles live/Unit gegen den Release-Build):**
`qa:monetization` **32/32** (neue Sektion 5: 47 h vs. 49 h im 48-h-Tier,
4 d vs. 6 d im 5-Tage-Tier, Zweistufen-Flow mit Toast + Persistenz + geschlossener
Wall, Korruptions-Gegenbeweis) · `npm run smoke` inkl. Grace-Unit-Checks
(Tier-Wechsel, $5-Grenze, Ablauf, feindliche Felder, Migration) grün ·
Full-Regression: browser-check 169 · release 38 · beta 30 · interaction 25 ·
responsive 43 · i18n-layout 110 · i18n-Parität 5 × 1104 · audit:css 0 · tsc 0 · lint 0.
