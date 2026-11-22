# NodeChart – Signal- & Free-Tier-Overhaul (Audit + Plan)

**Stand:** 2026-11-21 · Branch `arena/ad00efde-chartnode-webapp`
**Ziel:** (1) logische Konsistenz der Anwendung, (2) so viele Signale wie möglich –
insbesondere On-Chain – in der App, (3) Free-Tier-Budgets der Provider so wenig
wie möglich ausschöpfen, (4) trotzdem messbar besser als die Premium-Funktionen
anderer Charting-Tools – weil kostenlos.

---

## 0. Methode

1. Modul für Modul gelesen (`src/api`, `src/websockets`, `src/store`, `src/lib`,
   `src/components`), Smoke-Tests und QA-Skripte als Invarianten erfasst.
2. Provider-Limits recherchiert (siehe §2) und mit dem tatsächlichen
   Request-Verhalten der App abgeglichen.
3. Lücken dokumentiert (§3) und in eine wellenweise Umsetzung überführt (§5).
4. Jede Welle: Implementieren → `typecheck`/`lint`/`check:i18n` → Smoke →
   Quota-Bilanz aktualisieren.

---

## 1. Ist-Zustand (Architektur-Kurzfassung)

| Schicht | Dateien | Aufgabe |
| --- | --- | --- |
| Transport | `src/api/http.ts` | einziger `fetch`-Einstieg: Timeout, 4 MiB Cap, 429/Retry-After, per-Source-Cooldown, In-Flight-Dedupe, L1/L2-Cache, **lokale Request-Budgets** (aktuell nur GeckoTerminal 8/min) |
| UI-Cooldown | `src/api/rateLimit.ts`, `useRateLimitStore` | sichtbares 5 s-Overlay, provider-getrennt |
| DEX | `dexscreener.ts`, `geckoterminal.ts`, `search.ts` | Suche/Token-Lookup/OHLCV, GeckoTerminal nur als Fallback |
| CEX | `websockets/*` (12 Adapter) + `rest.ts` Seeds | Kline-/Trade-Streams, REST-Seeds mit CORS-Bewusstsein, Warm-Cache |
| On-Chain | `api/onchain.ts` + `useOnChainStore` | BTC (mempool.space/Esplora), EVM (Blockscout+PublicNode Gas), Solana (PublicNode/official), DeFiLlama, DEX-Heat, GoPlus-Forensik |
| PRO | `api/prometrics.ts` + `useProStore` | Gate/OKX-Derivate, Orderbuch + CVD, CoinGecko/Alternative.me, Gate/OKX-Heatmap, Deribit-Optionen, Breadth |
| Lokale Analyse | `lib/premium.ts`, `indicators.ts`, `backtest.ts`, `edge suite` | 34 Indikatoren, VP, aVWAP, S/R-Cluster, Divergenzen, Replay, Backtest, Liq-Radar, Lag, Regime, Clock |
| Tools | `components/tools/*` | Screener, Heatmap, Ratings, Watchlist, Alerts, Journal, Risk, Script Lab, Magnifier |

**Wichtige, bereits vorhandene Stärken** (bleiben erhalten und werden zitiert):
L1/L2-LRU-Caches, In-Flight-Dedupe, Stale-While-Error, provider-getrennte
Cooldowns, „unknown bleibt unknown"-Parser, Lifecycle „closed panel = 0 Requests",
Offline-Fixtures (`smoke:offline`), i18n-Paritätscheck.

---

## 2. Provider-Limits (recherchiert, Stand 2026-11)

| Provider | Limit (öffentlich, keyless) | Konsequenz für uns |
| --- | --- | --- |
| Binance Spot/Futures REST | 1 200 req/min, Weight-basiert; `futures/data/*` = **1 000/5 min/IP** | günstig, aber nicht gratis unendlich → Budget + TTL |
| Binance/Bybit/OKX WS | öffentliche Streams ohne Key; 1 Verbindung, 200 Streams | **0 Quota-Kosten** → bevorzugte Signalquelle |
| Hyperliquid `/info` | **1 200 Weight/min/IP**; jeder Info-Call 20 Weight (außer l2Book/allMids/clearinghouseState = 2) | ~1 Call/3 s sicher |
| HyperEVM RPC | 100 req/min | nur sehr sparsam |
| Gate.io v4 | öffentliche Endpoints, kein harter globaler Cap dokumentiert | Primär für Derivate/Spot-Snapshot |
| OKX v5 | endpoint-spezifisch | Fallback |
| Deribit | credit-basiert | 5 min TTL |
| CoinGecko keyless | ~10–30 calls/min, Burst-begrenzt, **kein SLA** | Budget **6/min** + TTL ≥ 120 s |
| GeckoTerminal keyless | ~10 calls/min, upstream 1 min Cache | Budget **8/min** (bereits vorhanden) |
| DexScreener | 300 req/min core | TTL 20–60 s reicht |
| GoPlus | 30 calls/min, 20 Adressen/Call | Batch (vorhanden), 10 min TTL |
| mempool.space | keine Zahl, Drosselung/Bans dokumentiert | **eigenes Budget** nötig |
| Blockscout | instanzabhängig (~10 req/s dokumentiert, aber geteilt) | 4 Chains parallel, 25–60 s TTL |
| Solana PublicNode / official RPC | shared, stark limitiert | Batch + 45 s TTL (vorhanden) |
| DeFiLlama | fair use, ~300 req/5 min | 120 s TTL |
| Alternative.me FNG | 60 req/min | 120 s TTL |

**Fazit:** Der einzige echte Engpass sind keyless CoinGecko, GeckoTerminal,
GoPlus und die shared RPCs. Alles andere ist im Browser kaum limitierend.
→ Strategie: **On-Chain-Signale bevorzugt aus CEX-WebSockets (Quota 0) und
günstigen öffentlichen Endpoints ziehen; teure Quellen budgetieren und
strikt deduplizieren.**

---

## 3. Gefundene Lücken (Modul für Modul)

### 3.1 Transport/Quota (`api/http.ts`)
- ❌ Nur GeckoTerminal hat ein Budget. **CoinGecko** (keyless ~10–30/min) wird
  ungebremst von der PRO-Panel und potenziell weiteren Modulen aufgerufen.
- ❌ Es gibt keinen globalen **„Quota-Status"**, den die UI zeigen kann –
  Nutzer sehen nicht, wie viel Free-Tier gerade übrig ist.
- ⚠️ `SOURCE_REQUEST_BUDGETS` ist eine Code-Konstante; nicht zentral dokumentiert.
- ⚠️ Retry-Default ist 2; für budgetierte/keyless Quellen ist 1 richtiger.

### 3.2 On-Chain (`api/onchain.ts`, `OnChainPanel`)
Die vorhandenen 6 Gruppen sind gut, aber es fehlen die **stärksten On-Chain-
Signale**, die keyless verfügbar sind:
- ❌ **Hyperliquid-Perp-Kontext** (Funding, Premium, OI, Mark) – keyless, 2–20
  Weight, 1 Call. Aktuell nur Gate/OKX; Hyperliquid fehlt komplett.
- ❌ **On-Chain-Liquidations-Magnet (echt)**: Liq Radar ist lokal geschätzt. Die
  Hyperliquid-`l2Book` (Weight 2) liefert echte Orderbuch-Wände → als
  „On-Chain-Liquidität" nutzbar, ohne neue Quota-Klasse.
- ❌ **Stablecoin-Flows als Signal**: DeFiLlama liefert Supply, aber es fehlt die
  Ableitung (Δ über Zeit, „risk-on/off").
- ❌ **BTC-Mempool als Signal**: Werte vorhanden, aber kein Score/Regime
  (Congestion → Fee-Pressure → Settlement-Stress).
- ❌ **Exchange-Netflows / Whale-Alerts on-chain** fehlen (teuer ohne Key →
  bewusst nicht integriert, aber als „n/a" begründet).
- ❌ Keine **Cross-Signal-Verknüpfung**: On-Chain-Panel und Regime Compass
  wissen nichts voneinander, obwohl `regime.ts` bereits `funding`, `advPct`,
  `liq5mUsd` als Inputs akzeptiert.

### 3.3 PRO (`api/prometrics.ts`, `ProMetricsPanel`)
- ❌ CoinGecko ohne Budget (siehe 3.1); FNG-Historie wird bei jedem Refresh neu
  geladen, obwohl sie sich nur alle 5 min ändert.
- ❌ `fetchDerivSignals` macht 4 parallele Calls (Gate contract, Gate stats, OKX
  OI, OKX funding) + 2 optionale OKX-Calls; auf Gate-only-Symbolen ist das
  unnötig breit. OKX sollte nur bei Bedarf (fehlende Felder) gefragt werden.
- ❌ **Keine Quota-Anzeige** im Panel trotz ~13 Gate- + 6 OKX-Quellen.
- ❌ Kein **Session-Reset-/Budget**-Verhalten bei Tab-Wiederherstellung.

### 3.4 Signale, die lokal (0 Quota) berechenbar, aber nicht sichtbar sind
- ❌ **CVD pro Pane** existiert nur im PRO-Panel (Session), nicht als Chart-
  Overlay/Indikator → als lokaler Indikator mit Trade-Bus nutzbar.
- ❌ **Delta-Divergenz** (Preis vs. CVD) fehlt.
- ❌ **Funding × Preis-Divergenz** (steigendes Funding bei fallendem Preis = 
  Long-Squeeze-Risiko) fehlt als Signal.
- ❌ **Volatilitäts-Regime pro Pane** (realized vs. implied) fehlt im Chart.
- ❌ **Session-Statistiken** sind im Toolbar-Chip, aber nicht als kompakte
  „Signal-Leiste" mit interpretierbaren Flags (z. B. „Range-bound",
  „Trend-Tag", „High-Vol").

### 3.5 Logik-/Konsistenzfehler
- ❌ **Toolbar-Chip „PRO"** öffnet Panel; **On-Chain** ist ein separater Toggle –
  beide können gleichzeitig offen sein und überlappen (`z-40`, `fixed right-0`).
  → **gegenseitiger Ausschluss** nötig.
- ❌ `useOnChainStore.tick` und `useProStore.tick` laufen unabhängig mit 15 s –
  bei offenen Panels 2 Intervalle; ok, aber: beim Öffnen des einen sollte das
  andere schließen.
- ❌ **Watchlist/Screener/Heatmap** teilen sich `spotTickerRows` (gut), aber
  Watchlist pollt 60 s und der Cache ist 120 s → 50 % der Polls sind Cache-Hits
  (harmlos, aber irreführend). → Poll-Intervall an TTL koppeln.
- ❌ **RatingsModal** ruft `fetchSeed` für 6 Timeframes parallel auf; bei
  CORS-blindem Primary erst nach 6 Fehlversuchen Gate → langsam und
  verschwendet Requests. → **CORS-Check vorab** (existiert) **und** Gate-first
  für Symbole, die auf Gate garantiert sind.
- ❌ **MagnifierModal** nutzt Binance-`aggTrades` hart kodiert; bei
  region-blockiertem Binance kein Fallback auf den bereits offenen
  Socket-Trade-Bus (0 Quota!) → **Trade-Bus-first**.
- ❌ **`liqradar`** heißt „Liq Radar", ist aber eine lokale Heuristik – die UI
  sagt das zwar, aber es fehlt eine echte Orderbuch-Quelle als Ergänzung.
- ❌ **`search.ts`** macht bei Textsuche immer einen DexScreener-Call, auch wenn
  die CEX-Treffer bereits gut sind → optional: erst DEX, wenn CEX < 3 Treffer
  oder Query „exotisch" ist. (Spart DexScreener-Budget, das zwar groß ist, aber
  die Latenz senkt.)
- ❌ **Session-Stats** (`sessionStats`) nutzen lokale Tagesgrenze; auf 1w-Charts
  ist „heute" oft leer → Chip zeigt nichts. → Fallback auf letzte 24 h Kerzen.
- ❌ **`persistCache`** speichert Seeds 24 h, aber es gibt keine Anzeige „Daten
  aus Cache (Alter)" im Chart-Chip für DEX-Kerzen.

### 3.6 UX/Beduienbarkeit
- ❌ Kein **zentraler „Signal-Drawer"**, der On-Chain + PRO + Edge in einer
  Ansicht bündelt (aktuell zwei getrennte Panels + 4 Modals).
- ❌ Keine **Quota-/Free-Tier-Transparenz** („Du hast in dieser Minute 3/8
  GeckoTerminal-Calls genutzt").
- ❌ Kein **Export der On-Chain-/PRO-Snapshots** (CSV/JSON) – TradingView
  Premium kann das auch nicht; Alleinstellungsmerkmal.

---

## 4. Design-Entscheidungen

1. **Zentrale Quota-Registry** (`src/api/quota.ts`): eine deklarative Tabelle
   aller Provider (Limit, Fenster, TTL-Minimum, Retry-Default, Kostenklasse
   `free-ws | cheap-rest | budgeted | expensive`). `http.ts` liest daraus;
   das UI kann live „Budget-Verbrauch" anzeigen. Keine neuen Netzwerk-Calls.
2. **WebSocket-first für Signale**: Funding/OI/LSR/Liquidations-Pulse kommen –
   wo möglich – aus Binance-Futures-Streams (`!markPrice@arr`,
   `forceOrder`, `kline`) statt REST-Polling; REST nur als Seed/Backfill.
   Damit sinkt das REST-Volumen, während die Signal-Frequenz steigt.
3. **On-Chain = 0-Quota-Erweiterung**: Hyperliquid-`metaAndAssetCtxs`
   (ein Call, alle Perps inkl. funding/OI/mark/premium) + `l2Book` (Weight 2)
   als echte On-Chain-Liquiditätsquelle; beides budgetiert und gecacht.
4. **Cross-Signal-Fusion**: Regime Compass konsumiert On-Chain- und PRO-Werte
   automatisch (wenn Panels offen oder Daten im Store), ohne zusätzliche
   Requests. Neue abgeleitete Signale (Funding-Divergenz, Stablecoin-Flow,
   Mempool-Stress) entstehen rein lokal.
5. **Ein Signal-Hub**: `SignalPanel` mit Tabs (On-Chain · Markt · Edge · Quota)
   ersetzt das Nebeneinander von OnChainPanel/ProMetricsPanel; beide bisherigen
   Panels bleiben als Tabs erhalten (kein Feature-Verlust) und schließen sich
   nicht mehr gegenseitig aus.
6. **Free-Tier-Budget als Feature**: sichtbare „Free-Tier-Leiste" pro Provider
   inkl. „läuft aus in X s" und Hinweis, wenn die App auf Cache/Fallback
   umschaltet. Das ist Transparenz, die kein Premium-Tool bietet.
7. **Kein Feature-Gate**: alles bleibt kostenlos; „Premium" ist nur ein
   Markenname für „erweiterte Analyse". Keine künstlichen Limits.

---

## 5. Umsetzungsplan (Wellen)

### Welle 1 – Fundament (Quota & Transport) ✅
- [x] `src/api/quota.ts`: Provider-Registry + `quotaSnapshot()` für die UI.
- [x] `http.ts`: Budgets für `coingecko`, `mempool.space`, `goplus` ergänzen;
      Retry-Default aus Registry; `Probe`-Calls von Budgets ausnehmen.
- [x] Tests: `api-budget-smoke` auf mehrere Provider erweitern
      (Registry-Assertions, Prefix-Fallback `blockscout:base`, Unknown-Policy,
      `quotaSnapshot`-Form, Hyperliquid-Parser, Derived-Signals).

### Welle 2 – On-Chain-Ausbau (0–2 Quota-Klasse) ✅
- [x] `api/hyperliquid.ts`: `metaAndAssetCtxs`, `l2Book`, `fundingHistory` mit
      Weight-Bewusstsein, 20 s/60 s TTL, In-Flight-Dedupe.
- [x] OnChain-Store: neue Gruppen `hl` (Hyperliquid-Perp-Kontext) und
      `liq` (echtes Orderbuch → Liquiditätswände), instrument-scoped über
      `base:<BASE>`, Scope-Wechsel verwirft veraltete Antworten.
- [x] Abgeleitete Signale lokal (`lib/derived-signals.ts`): Mempool-Stress,
      Stablecoin-Flow-Δ, Funding-Divergenz, OI/Preis-Regime, Vol-Regime,
      Whale-Netflow-Proxy, Composite-Bundle.
- [x] `OnChainPanel`: `DerivedStrip`, `HyperliquidCard`, `LiquidityCard`; i18n ×5.
- [x] Tests: Parser-Fixtures + Signal-Mathematik im `api:budget-smoke`.

### Welle 3 – PRO-Verdichtung ✅
- [x] Gate-first, OKX nur bei fehlenden Feldern (Latenz + Quota).
- [x] FNG-Historie + globale Marktdaten auf 5-min-TTL, synchron zum Store-Takt
      (vorher: 120 s TTL bei 300 s Refresh = verschwendete Requests).
- [x] `QuotaBar` im Footer beider Panels (On-Chain + PRO): 0 Requests,
      reine In-Memory-Zähler, 2 s-Poll.
- [x] Panel-Exklusivität: beide Drawer liegen übereinander (`fixed right-0`);
      Öffnen des einen schließt den anderen ⇒ nie zwei Request-Kreisläufe
      über einem unsichtbaren Panel.

### Welle 4 – Chart-nahe Signale (0 Quota) ✅
- [x] `lib/tape.ts`: begrenzter Minuten-Bucket-Puffer am `tradeBus`
      (4 Symbole × 24 h, kein Timer, keine Requests).
- [x] CVD-Indikator + Delta-Divergenz (36 Indikatoren); Buckets werden
      **genau einer** Kerze zugeordnet (Bugfix gegen Doppelzählung an
      Kerzengrenzen, per Smoke-Test abgesichert).
- [x] `LiqMagnetPrimitive` an die `liq`-Gruppe angebunden: gemessene
      Orderbuch-Wände gewinnen, Kerzen-Schätzung nur als Fallback; Symbol-
      Drift-Schutz ±15 %, gemessene Wände ohne Leverage-Tag (BID/ASK).
- [x] Session-Chip: `24h`-Fallback bei dünnem Tages-Puffer, sichtbar markiert.
- [x] Magnifier: Trade-Bus-first, Binance/OKX nur als Lückenfüller; Quelle
      wird in der UI ausgewiesen (Bucket-Aggregat ≠ Einzel-Print).
- [ ] Funding-/OI-Overlay als Chart-Linie (Daten liegen im Store; eigenes
      Overlay-Primitive folgt in Welle 5).

### Welle 5 – Signal-Hub & Transparenz ✅ (Hub-Tabs offen)
- [x] Free-Tier-Bar (`components/signals/QuotaBar.tsx`) in beiden Panels,
      zeigt das jeweils **engere** Limit (Requests vs. Weight).
- [x] Export (`lib/signal-snapshot.ts`): JSON **und** CSV aus den geladenen
      Reads, mit Herkunft (`measured`/`derived`), Quota-Stand und
      `missing`-Liste. Kein Netzwerkaufruf beim Export.
- [x] Funding-/OI-Ribbon in `PriceChart` (`FundingRibbonPrimitive`):
      Store-Read, 0 Requests, per Edge-Menü zuschaltbar.
- [x] `LiqMagnetPrimitive` zeigt gemessene Buch-Wände (siehe Welle 4) und
      markiert sie im Liq-Radar-Modal mit `liqMeasured`.
- [ ] `SignalHub`-Tabs (On-Chain / PRO / Quota) statt zweier paralleler Drawer –
      Panels bleiben unverändert und werden Tab-Inhalte (größerer UI-Umbau,
      bewusst separat, damit die bestehenden Panel-Tests stabil bleiben).
- [ ] Help-Center-Einträge + README/API_AUDIT-Aktualisierung (teilweise: siehe
      §7 dieser Datei).

### Welle 6 – Verifikation (laufend)
- [x] `npm run typecheck && npm run lint && npm run check:i18n` → 0 Fehler.
- [x] `npm run smoke:offline` → 6/6 Suiten grün (ws, budget, resilience,
      chart, edge, modules).
- [x] `npm run build` (Next 16, Turbopack) → erfolgreich.
- [x] Server-Smoke: `/en|de|es/terminal` → 200, neue UI-Strings im HTML.
- [ ] `npm run qa:features` / `qa:interactive` — **in dieser Sandbox nicht
      möglich**: kein Chrome-Binary (Puppeteer-Cache leer, Download-Hosts
      nicht erreichbar). Muss auf dem Ziel-Rechner laufen.
- [x] Quota-Bilanz: siehe §6 (Zielbilanz erfüllt, Details unten).

---

## 6. Quota-Bilanz (Ziel)

| Quelle | heute | nachher | wie |
| --- | --- | --- | --- |
| CoinGecko keyless | ungebremst, 2 Calls/5 min je offenem PRO-Panel | ≤ 6/min hart, 120 s TTL | Registry + Budget |
| GeckoTerminal | 8/min | 8/min (unverändert) | – |
| GoPlus | 30/min ungebremst | ≤ 12/min Budget | Registry |
| mempool.space | 3 Calls/60 s | 3 Calls/90 s + Budget 30/min | Registry |
| Hyperliquid | 0 | ≤ 20 Weight/min (≈1 Call/3 s) | Weight-Budget |
| Gate/OKX/Deribit | TTL-basiert | TTL-basiert, OKX seltener | Gate-first |
| Neue Signale | – | **+ Hyperliquid-Kontext, echte Liquiditätswände, CVD-Indikator, Mempool-Stress, Stablecoin-Flow, Funding-Divergenz** | 0 neue Dauer-Requests |

**Netto:** mehr Signale bei *weniger* oder gleichem Free-Tier-Verbrauch.

---

## 7. Änderungsprotokoll (diese Session)

| Bereich | Datei | Änderung |
| --- | --- | --- |
| Transport | `api/http.ts`, `api/quota.ts` | Registry, Budgets, Weight-Stamps, `quotaSnapshot()` |
| API | `api/hyperliquid.ts` **neu** | Perp-Kontext, L2-Buch, Funding-Historie, Liq-Wände |
| API | `api/prometrics.ts` | Gate-first (OKX nur bei Lücken), 5-min-TTL für Global/FNG |
| Signale | `lib/derived-signals.ts` **neu** | 7 lokal berechnete Signale + Composite |
| Signale | `lib/tape.ts` **neu** | Minuten-Bucket-Puffer am Trade-Bus (0 Quota) |
| Signale | `lib/signal-snapshot.ts` **neu** | Export-Snapshot (JSON/CSV, Herkunft, Quota) |
| Chart | `lib/indicators.ts` | +`CVD`, +`DELTADIV` (36 Indikatoren), `IndicatorContext` |
| Chart | `components/chart/primitives.ts` | +`FundingRibbonPrimitive`, Liq-Wände gemessen |
| Chart | `components/chart/PriceChart.tsx` | Tape-Kontext, Buch-Wände-first, Ribbon |
| Chart | `lib/premium.ts` | `sessionStats` mit 24 h-Fallback + `window`-Flag |
| Panel | `components/onchain/OnChainPanel.tsx` | Derived-Strip, HL-/Liq-Karten, Export, QuotaBar |
| Panel | `components/pro/ProMetricsPanel.tsx` | QuotaBar |
| Panel | `components/signals/QuotaBar.tsx` **neu** | Free-Tier-Leiste (engstes Limit) |
| Tools | `components/tools/MagnifierModal.tsx` | Tape-first, Quellenangabe |
| Tools | `components/tools/EdgeModals.tsx` | Ribbon-Toggle, gemessene Wände |
| Store | `store/useOnChainStore.ts` | Gruppen `hl`/`liq`, instrument-scoped |
| Store | `store/useChartStore.ts` | `fundingRibbonOn` (persistiert) |
| Shell | `components/terminal/TerminalShell.tsx` | Panels exklusiv, Session-Chip-Fallback |
| i18n | `messages/*.json` (×5) | 1229 Keys, Parität grün |
| Tests | `scripts/api-budget-smoke.entry.ts` | Registry, HL-Parser, Signale, Snapshot |
| Tests | `scripts/chart-smoke.entry.ts` | 36 Indikatoren, Tape-Fixture, CVD-Mathe |

### Gefundene und behobene Fehler
1. **CVD-Doppelzählung** an Kerzengrenzen (Tape-Buckets wurden zwei Kerzen
   zugeordnet) – behoben, per Chart-Smoke abgesichert.
2. **Verschwendete CoinGecko-Requests**: Store-Takt 300 s, Cache-TTL 120 s
   ⇒ jeder zweite Takt zwang einen Refetch. Jetzt 300 s/300 s.
3. **Zwei Panels gleichzeitig offen**: beide `fixed right-0` ⇒ das untere war
   unsichtbar, pollte aber weiter. Jetzt schließen sie sich aus.
4. **Session-Chip verschwand** auf 4h/1d/1w stillschweigend – jetzt 24 h-Fallback
   mit sichtbarer Kennzeichnung statt leerer Stelle.

### Offene Punkte (bewusst nicht in dieser Runde)
- `SignalHub`-Tabs als gemeinsamer Drawer (UI-Umbau, eigener Review-Zyklus).
- OI-Zeitverlauf für `oiRegime`: bräuchte `futures/data/openInterestHist`
  (1 000/5 min) – erst sinnvoll, wenn ein TTL von 5 min in den Store passt.
- `qa:features`/`qa:interaction` lokal ausführen (kein Browser in der Sandbox).
