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

## `chartnode-webapp2-live-robots-audit.patch`

**Lücke:** `check:live` prüfte `robots.txt` nur auf `Allow: /` und die
Sitemap-Zeile. Damit wäre eine der wenigen Stellen unbemerkt geblieben, an
denen die Produktion anders aussieht als der Code: Cloudflare stellt der
ausgelieferten Datei einen verwalteten Block voran
(`# BEGIN Cloudflare Managed content`) — der taucht in keinem lokalen Build
auf. Auf `nodechart.cc` stehen dort rund zwei Dutzend `Disallow: /`-Zeilen für
KI-/Trainings-Crawler; Googlebot ist frei. Eine Googlebot-Sperre hätte der
alte Check trotzdem durchgelassen, weil irgendwo in der Datei `Allow: /` steht.

**Fix:** `robots.txt` wird nach RFC 9309 in (agents, rules)-Gruppen zerlegt.
Geprüft wird `Disallow: /` für `*`, `googlebot`, `bingbot` sowie explizit
`googlebot-news` und `googlebot-image`. KI-/Trainings-Crawler werden nur als
Hinweis ausgegeben, nicht als Fehler — `Google-Extended` betrifft
Gemini-Training, nicht die Websuche.

**Gegengetestet mit drei Fixtures:**

| Fixture | Ergebnis |
|---|---|
| live (Cloudflare-Block + KI-Regeln) | alle grün, 4 KI-Crawler als Hinweis |
| bad (`User-agent: *` / `Disallow: /`) | FAIL für `*` und `googlebot` |
| sneaky (nur `Googlebot` gesperrt) | FAIL — genau der Fall, den der alte Check durchgelassen hätte |

Beide Patches zusammen: `git am patches/*.patch` gegen einen frischen Clone
getestet, wendet ohne Konflikt an; danach `tsc --noEmit` sauber, ESLint 0
Fehler, `next build` grün, `qa:venue` grün, `check:live` 45/1 (der eine Fail
ist der vorbestehende Befund oben).

## Bekannter, vorbestehender Befund in `ChartNode-WebApp2`

`npm run check:live` meldet dort **1 FAIL**:

```
FAIL  unbekannte Sprache endet im 404 — 307 → /en → 200
```

`/xx` wird per 307 auf `/en` umgeleitet und liefert dort 200, statt im 404 zu
enden. Das ist **nicht** durch die Patches verursacht — gegen einen frischen
Clone ohne Patches nachgestellt:

| Stand | Ergebnis |
|---|---|
| ungepatcht | 41 PASS / 1 FAIL / 2 SKIP |
| mit beiden Patches | 45 PASS / 1 FAIL / 2 SKIP |

Der Fail ist in beiden Fällen identisch; die vier zusätzlichen PASS sind die
neuen robots-Checks. Die Ursache liegt in `src/proxy.ts`: locale-förmige
Präfixe werden bewusst auf die Default-Locale umgeschrieben, und danach
existiert die Route — die 404-Erwartung des Checks passt nicht zu dieser
bewussten Entscheidung. Entweder ist der Check zu streng oder die Umleitung
sollte für unbekannte Sprachen nicht greifen; das ist eine Produktentscheidung
und wurde hier nicht eigenmächtig geändert.

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
