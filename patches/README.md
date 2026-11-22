# Patches für `ChartNode-WebApp2` (das live deployte Repo)

Dieses Repository ist **nicht** die Quelle von `nodechart.cc`. Live läuft
`AndrexTheDev/ChartNode-WebApp2` — dort existiert die `/cluster`-Route, die
Landing-Fassung mit „Core charts without subscription" und die
Pro-Freischaltung über verifizierte On-Chain-Zahlung. In diesem Repo fehlen
alle drei.

Deshalb liegen Fixes, die den Live-Stand betreffen, hier als Patch statt als
Branch: der Push auf `ChartNode-WebApp2` scheitert mit HTTP 403, weil der in
dieser Umgebung konfigurierte Token nur für dieses Repository berechtigt
(`x-accepted-oauth-scopes: repo`, Repo-Scope statt Org-/Account-Scope).

## Anwenden

```bash
git clone https://github.com/AndrexTheDev/ChartNode-WebApp2.git
cd ChartNode-WebApp2
git checkout -b fix/venue-hysteresis
git am /pfad/zu/chartnode-webapp2-venue-hysteresis.patch
npm ci && npm run typecheck && npm run qa:venue
```

Der Patch bringt `npm run qa:venue` mit (Regressionstest der Prüf-Reihenfolge).

## `chartnode-webapp2-venue-hysteresis.patch`

**Bug:** `pickExchange` nahm einfach den besten Ranglisteneintrag. Die
Reachability-Probes laufen parallel; sobald eine `error` meldet, ist die
laufende Venue (Score 2) schlechter als alle noch ungeprüften (Score 1) und
die Auswahl springt. Jeder Wechsel tauscht Feed-Subscription und `chartId`,
React unmountet den Plot, die Pointer-Capture geht verloren — laufende
Drag-Gesten brechen mitten im Zug ab.

**Fix:** Hysterese. `stickTo()` hält die zuletzt gecharte Venue, solange sie
Symbol und Timeframe bedienen kann und `unsupported` sie nicht widerlegt
(Probe-Fehler ≠ kaputter Feed; verlässlich ist `markUnsupported` aus dem
Feed-Manager). Reihenfolge bleibt: Nutzerwahl > Hysterese > Rangliste.

**Belegt gegen die echte Funktion:**

| Situation | ohne Fix | mit Fix |
|---|---|---|
| `binance=error`, Rest `unknown` | `okx` (Flatter) | `binance` (gehalten) |
| `unsupported` widerlegt binance | `okx` | `okx` (Wechsel bleibt möglich) |
| Timeframe `1s` (binance kann nicht) | — | kein Halten |
| manuell `kraken` gewählt | `kraken` | `kraken` (Nutzerwahl schlägt Hysterese) |

**Im Browser mit Fixtures:** 22 s beobachtet, Venue durchgehend `Binance`,
7/7 Canvases in jedem Frame, 0 pageerrors.

**Verifiziert vor dem Export:** `tsc --noEmit` sauber, ESLint 0 Fehler auf den
drei geänderten Dateien, `next build` grün (mit `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`,
da die Sandbox fonts.googleapis.com nicht erreicht), alle Routen 200
(`/en`, `/de/terminal`, `/en/cluster`, `/robots.txt`, `/sitemap.xml`).
