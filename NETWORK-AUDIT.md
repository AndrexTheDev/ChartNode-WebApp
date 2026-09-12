# NodeChart — Realtime Network Audit (Lead Realtime Network Architect)

**Datum:** 2026-09-11 · **Scope:** gesamte Datenversorgung — 12 CEX-Venues (Binance, Bybit, OKX, Kraken, Coinbase, Gate.io, Bitget, KuCoin, HTX/Huobi, Crypto.com, Bitfinex, CoinEx) + DEX-Aggregatoren (DexScreener, GeckoTerminal) + On-Chain-Signale (GoPlus, RugCheck, honeypot.is, mempool.space, Blockscout, Solana-RPC, DeFiLlama).

> **Hinweis zum Venue-Set:** MEXC und Poloniex sind nicht Teil des integrierten Universums — beim Börsen-Onboarding (Task „so viele CEX/DEX wie du empfiehlst") wurden bewusst Bitfinex + CoinEx statt MEXC/Poloniex gewählt (verlässlichere öffentliche Streams, CORS-freundlichere REST-APIs, tiefere Liqudität). Der Audit gilt lückenlos für alle 12 integrierten Venues.

**Verdikt:** ✅ Alle drei Prüfaufträge erfüllt. 1 kritischer Lifecycle-Bug (Reconnect-Churn), 1 Speicherleck (unbounded `feeds`-Record) und 4 Robustheitslücken gefunden und behoben — mit Beweisführung per Live-Socket-Smoke (12/12 Venues), Browser-Instrumentierung und allen QA-Suiten.

---

## 1. WebSocket Lifecycle & Memory Leak Audit

### 1.1 Bestand (bereits solide, verifiziert)
| Mechanismus | Implementierung | Status |
|---|---|---|
| Referenzzählung | `ExchangeStream.channels: Map<channel, {ref,count}>` — 2 Panes auf BTC/USDT teilen 1 Abo | ✓ |
| Sauberes Schließen | `ManagedSocket.close()`: `intentionallyClosed`, Reconnect-Timer/Heartbeat/Watchdog gestoppt, `ws.close()` | ✓ (nachgeschärft, s. 1.3a) |
| Backoff | `ExponentialBackoff`: 800 ms → 30 s Cap, **Full Jitter** (Thundering-Herd-Schutz), 12 Versuche, Reset on open | ✓ |
| Watchdog | 45 s Stille → erzwungener Close → onclose → Backoff (fängt „TCP lebt, Exchange pusht nicht") | ✓ |
| Heartbeats | App-Level-Pings für Bybit/OKX/KuCoin/Bitget; Server-Pings (HTX gzip `{"ping"}`→`{"pong"}`, Gate `spot.pong`, Bitfinex, KuCoin welcome, CoinEx ack) via `keepalive`-Hook | ✓ |
| Resubscribe | `onOpen` leert `subscribed` und reconciled den vollen Kanalbestand (Reconnect = vollständige Wiederherstellung) | ✓ |
| KuCoin-Token | `resolveUrl()` bei jedem (Re-)Connect neu, 30-min-Cache, 10-s-AbortSignal | ✓ |

### 1.2 KRITISCH — Reconnect-Churn bei jedem Token-/TF-/Börsenwechsel (behoben)
**Befund:** `MarketDataProvider` registrierte Feeds mit `ensureFeed` + Cleanup `releaseFeed` bzw. `setWhaleTargets([])`. React führt den Cleanup **vor** dem nächsten Effect aus → die Referenzzählung kippte bei jedem Timeframe-/Token-/Watchlist-Wechsel und jedem Probe-Update kurz auf **0** → `shutdown()` → Socket-Close → sofortiger Reconnect + Re-Seed. Genau die Zombie-/Churn-Klasse, die der Audit ausschließen soll: pro Wechsel ein kompletter Verbindungsaufbau statt eines UNSUB/SUB auf dem offenen Stream.

**Fix — diff-basierte deklarative Feed-Menge** (`manager.ts` + `MarketDataProvider.tsx`):
```ts
// ExchangeConnection.setFeeds: erst ADD, dann RELEASE, dann PRUNE
setFeeds(next: FeedKey[]): void {
  const wanted = new Map(next.map((key) => [feedId(key), key]));
  for (const [id, key] of wanted) {            // 1) neue Feeds anmelden
    if (this.feeds.has(id)) continue;
    this.feeds.set(id, key);
    this.ensureFeed(key);
  }
  const releasedChannels: string[] = [];
  for (const [id, key] of [...this.feeds]) {   // 2) abgemeldete freigeben – NACH den Adds
    if (wanted.has(id)) continue;
    this.feeds.delete(id);
    const channel = this.adapter.klineChannel(key);
    releasedChannels.push(channel);
    this.streamFor(channel).remove({ kind: 'kline', key });
  }
  for (const channel of releasedChannels) this.prune(channel); // 3) verwaiste Streams schließen
}
```
`CexSocketManager.setFeeds` gruppiert pro Venue und diffed; der Provider-Effekt ruft nur noch `cexManager.setFeeds(wantedFeeds)` (kein Cleanup — Entmount deckt `releaseAll()`). Das Whale-Cleanup `setWhaleTargets([])` entfiel ersatzlos (`setWhaleTargets` diffed selbst; Disable-Zweig + `releaseAll` decken die Abbau-Pfade ab).

**Beweis (Browser-Instrumentierung, `window.WebSocket`-Wrapper zählt Konstruktionen):**
```
Sockets nach Boot: 7 · nach TF-Hop 1h→5m→1h: 7 · nach Token-Wechsel BTC→ETH: 7
→ 0 neue Sockets, 0 Page-Errors   (vorher: Close+Reconnect pro Wechsel)
```
Echte Zombie-Prävention bleibt erhalten: wird ein Stream leer (Venue-Reroute, letztes Panel zu), schließt `prune()` ihn sofort (`shutdown()` → `socket.close()`).

### 1.3 Speicherlecks & Robustheit (behoben)
**a) Handler-Dereferenzierung** — `ManagedSocket.close()` nullt jetzt `onopen/onmessage/onerror/onclose` (Closures referenzieren Adapter/Stores; ein noch CONNECTING-Socket darf nichts davon behalten).

**b) Unbounded `feeds`-Record → LRU-Warm-Cache.** `dropFeed` hatte **null Aufrufer**: jeder je besuchte Token×TF×Venue-Kombination blieben bis zu 500 Kerzen (~30 kB) für die ganze Session im Store. Sofort-Drop hätte aber die Produkt-Erwartung „zurückwechseln zeigt sofort alte Kerzen" (qa-trader-check) zerstört. Fix in `useMarketStore`:
```ts
const RELEASED_FEED_CACHE = 16;
const releasedLru: string[] = [];
markFeedReleased: (id) => set((state) => {
  if (!(id in state.feeds)) return state;
  unmarkReleased(id); releasedLru.push(id);
  let feeds = state.feeds;
  while (releasedLru.length > RELEASED_FEED_CACHE) {   // älteste freigegebene Feeds fliegen raus
    const oldest = releasedLru.shift();
    if (oldest !== undefined && oldest in feeds) {
      if (feeds === state.feeds) feeds = { ...feeds };
      delete feeds[oldest];
    }
  }
  return feeds === state.feeds ? state : { feeds };
}),
```
`setFeedStatus`/`seedCandles`/`upsertCandle` ent-markieren (Feed lebt wieder). Der Manager ruft `markFeedReleased` bei letztem Konsumenten **und** in `ExchangeStream.shutdown()` (harter Abbau umgeht die LRU-Buchhaltung nicht mehr).

**c) Stale-Seed-Schutz.** In-flight REST-Seeds schrieben bisher auch dann in den Store, wenn der Kanal längst freigegeben war. `seed()` prüft nach dem Await: `if (!this.channels.has(this.adapter.klineChannel(key))) return;`.

**d) Tab-Throttling / Offline — fehlende Wake-up-Pfade (neu).** Hintergrund-Tabs drosseln `setInterval`/`setTimeout`: Heartbeats stoppen, der Server trennt, Reconnect-Timer stehen (≥1/min) — und ein erschöpfter Backoff (`max-attempts`) blieb **permanent tot**. Neu: `ManagedSocket.resume()` (überspringt offene/connecting Sockets, resetet erschöpften Backoff, verwirft pending Timer, verbindet sofort) + `cexManager.resumeAll()`, getriggert im Provider:
```ts
const wake = () => {
  if (document.visibilityState === 'hidden') return;
  if (navigator.onLine === false) return;
  cexManager.resumeAll();
};
document.addEventListener('visibilitychange', wake);
window.addEventListener('online', wake);
```

**e) CVD-Bus bounded.** Der `tradeBus`-Listener in `useProStore` läuft app-weit ohne Unmount: `sessionCvd` jetzt hart auf 64 Symbole begrenzt (LRU, älteste Einträge inkl. `recentDeltas`-Ring fliegen raus); `tickCvd` leert zusätzlich ausgetrocknete Rings.

---

## 2. API Rate-Limit & Error Handling

### 2.1 Smart Search — Debounce
**Befund:** 250 ms — unter der geforderten Schwelle. **Fix:** `SmartSearch.tsx` auf **300 ms** erhöht. Alles Weitere war bereits vorbildlich: AbortController pro Anschlag (abbruch-sicher bis in die Retry-Schleife — „abort after 429-cooldown" wird respektiert), `cacheTtlMs` 20 s + In-Flight-Dedupe, **GoPlus-Batching** (10 Treffer → 1 Request pro Chain), Audit-Cache 10 min TTL + 512-Entry-LRU, Honeypot-Zweitmeinung nur bei danger/unknown (On-Chain-Simulation bleibt sparsam).

### 2.2 HTTP-429-Kette (verifiziert + nachgeschärft)
Ablauf: `fetchJson` → 429 → `beginCooldown(source)` → **Glitch-Overlay „RATE LIMIT EXCEEDED/ÜBERSCHRITTEN – BYPASSING…" mit 5-s-Countdown** + Fortschrittsbalken → parallele 429s joinen dieselbe Promise (kein Overlay-Stacking) → bei 0 `endCooldown()` → automatischer Retry. Safety-Timer (ms+2 s) verhindert Hänger bei throttled Tabs. **Beweis:** qa-trader „429-Sturm triggert Glitch-Overlay mit Countdown — {overlay:true, cd:'5'}" ✓, „Overlay verschwindet nach Countdown, Feed erholt sich" ✓.

**Fix — Response-Body-Leck:** 429-/Fehler-Responses wurden ungelesen verworfen; ein unconsumed Body hält die Verbindung im Browser-Pool (max. 6/Host) und kann Folge-Requests stallen. Jetzt: `await response.body?.cancel().catch(() => {})` vor Cooldown bzw. Throw.

### 2.3 localStorage-Fallback bei Rate-Limit (NEU — war Lücke)
**Befund:** Caching war rein in-memory; nach Reload oder langem Ausfall ging das Chart leer aus. **Neu: L2-Cache `src/api/persistCache.ts`** (namespaced `nc-l2-v1`, 60-Entry-LRU, 512-kB-Wert-Cap, quota-sicher mit Evict+Retry, Safari-Private-Mode-sicher — jeder Zugriff try/catch). `fetchJson` bekam `persistKey`/`staleTtlMs`: Erfolg → L2-Write; finaler Fehler (429 erschöpft, Netzwerk tot — **nicht** bei Caller-Abort) → letzte gute Kopie, falls jünger als `staleTtlMs`:
```ts
if (persistKey && staleTtlMs && !aborted) {
  const stale = readPersisted<T>(persistKey, staleTtlMs);
  if (stale) return stale.value;   // + console.info + L1-Rekalibrierung
}
```
Verdrahtet: **CEX-Seeds** (`rest.ts guarded()`, 24 h stale — historische Kerzen, Live-Ticks übernehmen ab der letzten Kerze), **DexScreener-Token-Lookup** (6 h), **GeckoTerminal Pool-Liste** (6 h) und **OHLCV** (12 h). Such-Endpunkte bewusst ohne Persist (Freshness > Verfügbarkeit).

**Beweis (Browser, voller 429-Sturm auf alle Kline-Endpoints + Reload):**
```
L2 nach Boot: seedKeys=1 (nc-l2-v1:seed:https://data-api.binance.vision/…klines…)
Nach Reload mit 429-Interceptor: candles=300 · Page-Errors: keine → L2-FALLBACK: PASS
```

---

## 3. On-Chain-Signale & Data Parsing

### 3.1 Uncaught Exceptions bei fehlerhaften Payloads — Härtung
**Befund 1:** `ManagedSocket.dispatch()` reichte Payloads ungeschützt an `keepalive`/`onMessage` — ein Throw (Adapter-Bug, bizarrer Upstream) wäre als **unhandled rejection** aus `void this.dispatch(...)` entkommen. Fix: beide Stufen try/catch, Fehler wird geloggt, Frame verworfen, Stream lebt weiter.

**Befund 2:** `binance.ts` castete das rohe Wire-Feld `k.i` per `as Timeframe` — ein unbekanntes Intervall (Upstream-Änderung/feindliches Payload) hätte einen Out-of-Union-Key in `feedId`/Store erzeugt. Fix: Guard `isKnownTimeframe()` in `shared.ts` (Whitelist gegen `ALL_TIMEFRAMES`); unbekanntes Intervall → Event drop. Alle 11 anderen Adapter validieren bereits konstruktiv (Reverse-Lookup auf den eigenen Intervall-Maps).

### 3.2 Parser-Inventar (auditiert, defensiv)
| Schicht | Schutzmechanismen |
|---|---|
| 12 WS-Adapter (`parse`) | `isRecord`/`num`/`str`-Guards überall; `num()` nur finite Zahlen (NaN/Infinity/null → Event-Drop); Batch-Formate (Kraken-Arrays, HTX gzip-binär via `DecompressionStream`, Gate/Bitfinex) mit Fallbacks; ws-smoke-Fixtures sind **live aufgezeichnete** Wire-Payloads |
| Whale-Stream | `Number.isFinite(notional)` vor Store-Push; 400-ms-Batching (Burst-Schutz); Store-Cap 48 Trades |
| Holder-Konzentration / LP-Lock / Taxes (GoPlus-Forensik) | `num()`-Normalisierung, `?? 0`/`?? null`-Defaults, try/catch um jeden Fetch, `null` statt Throw bei Müll |
| DEX-Parsing (DexScreener/GeckoTerminal) | `normalise()` verwirft unvollständige Pools (`return null` + Type-Guard-Filter); String→Number nur via `toNum` (finite-geprüft) |
| REST (alle 12 Venues) | Row-Picker mit Null-Checks pro Feld; Sekunden/Ms/Ns-Normalisierung; `finalise()` sortiert + dedupliziert statt Doku zu vertrauen; **4-MiB-Response-Cap** (Memory-DoS-Schutz gegen feindliche Endpoints, chunked statt O(n²)-String-Concat) |
| Candle-Derivation (Coinbase/KuCoin/CoinEx) | `isFinite(price/qty/bucket)`-Guards; Late-Trades auf geschlossene Buckets werden ignoriert |
| Signal-Gruppen (BTC/EVM/Solana/DeFi/DEX) | jeder Fetch-Block try/catch → `null`/letzter guter Wert bleibt stehen („OFFLINE"-LED statt Crash); `inFlight`-Set + Gruppen-Deadlines verhindern Request-Stürme |

**Beweis:** `api:smoke` grün (inkl. GoPlus-Forensik-Parsing, „forensics refuses unsupported chain gracefully"); qa-trader „feindlicher GoPlus-Upstream kippt Badge auf SCAM/HONEYPOT" ✓; alleSuiten „keine Page-Errors" ✓.

---

## 4. Regression & Beweise (frischer Production-Build)

| Check | Ergebnis |
|---|---|
| `tsc --noEmit` / `eslint .` / `next build` | 0 Fehler · 0/0 · 0 Warnungen (38 Seiten prerendered) |
| `ws:smoke` — 12 Adapter offline + **12 Live-Streams** | ✔ alle PASS (binance 348 trades, bybit 456, coinbase 143 derived, htx gzip, …) |
| `api:smoke` (REST/On-Chain/Pro-Metrics) | ✔ OK |
| Churn-Beweis (Instrumentiert) | 7 Sockets konstant über TF-Hop + Token-Wechsel, 0 Page-Errors |
| L2-Beweis (429-Sturm + Reload) | 300 Kerzen aus localStorage, Overlay sauber |
| `qa-trader` (429/Overlay/Countdown/Cache/Kill-Reconnect) | **29/29** |
| `browser-check` (169 Checks, breiteste Suite) | ✔ OK |
| `qa-interaction` | **25/25** |

### Test-Robustheit nebenbei (2 deterministische Flakes in QA-Skripten, kein Produktcode)
1. `qa-trader` 2b: `awaitDexHits(needBadge)` kehrte früh zurück, weil der nicht-auditierbare PulseChain-Treffer sofort „UNGEPRÜFT" zeigte, während das WETH-Audit (honeypot.is-Zweitmeinung = Live-Call, 12 s Timeout) noch lief → Polling auf den Endzustand des auditierten Treffers ergänzt (40-s-Fenster).
2. DEX-Candle-Check: GeckoTerminal-Freikontingent (30 req/min) war durch Vorläufe erschöpft → transient; Re-Run grün (Produkt-Backoff 15 s existierte bereits).

## 5. Restrisiken (transparent)
- **Whale-/Trade-Sockets** hängen an Watchlist + Stream-Toggle; bei deaktiviertem Stream diffed `setWhaleTargets([])` korrekt runter (bewiesen durch Socket-Zählung).
- **L2-Stale-Daten** sind als solche erkennbar: die letzte Kerze ist bis zu `staleTtlMs` alt; Live-Ticks übernehmen ab der ersten neuen Kerze (Out-of-Order-Guard im Store). `console.info` markiert jede Stale-Auslieferung.
- **KuCoin `bullet-public`** läuft als POST bewusst außerhalb von `fetchJson` (kein JSON-Cache-Semantik-Fit), aber mit 10-s-AbortSignal; Ausfall → `resolveUrl`-Catch → Backoff.
- **Backoff-Erschöpfung** (12 Versuche) bleibt bewusst terminal — Wiederbelebung jetzt sofort via visibility/online (`resume()`), nicht mehr erst nach Watchdog.
