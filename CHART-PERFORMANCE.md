# NodeChart — Chart-Engine 60-fps-Audit & Fixes

Datum: 2026-09-11 · Scope: lightweight-charts-Engine, Indikator-Mathe, Multi-Grid-Sync, Mobile-Touch, exklusive Features.

## Befund vor den Fixes

Bereits korrekt (verifiziert, unverändert gelassen):
- WS-Ticks gehen über `applyBars()` → `series.update()` (O(1)-Tail); Chart-Rebuild nur bei `[chartType, chartId]`.
- Wasserzeichen ist ein Series-Primitive (zOrder bottom) → fest im Canvas, screenshot-sicher, ~1 `fillText` pro Frame.
- Sync-Busse doppelt gesichert (Source-Tag + `applyingRemoteRange` + `rangesEqual`-Epsilon) → kein Infinite-Rerender by design.
- Mobile-Gate (`device.ts`): coarse-pointer + UA/Viewport, Warnung als `role=status`, Force-Enable persistiert, `touchAction: drawingActive ? 'none' : 'pan-y'` → Page-Scroll bleibt unter 768 px frei.

## Fixes

### A. rAF-koaleszierter Analyse-Snapshot (`PriceChart.tsx`)
Jeder WS-Tick erzeugte eine neue `candles`-Identität und damit volle Recompute-Kaskaden (Indikatoren, Volume Profile, Liq Radar, S/R, Divergenzen, aVWAP) — mehrfach pro Sekunde. Neu: `analysisCandles` via `requestAnimationFrame`-Throttle; alle abgeleiteten Analysen hängen daran → maximal ein Recompute pro Frame. Main-/Volume-Serie bleiben an rohen `candles` (sofortiger Tail-Update).

### B. Store-Tick-Dedupe (`useMarketStore.ts`)
Identische Kline-Frames (t+OHLCV+`closed` gleich) liefern den State unverändert zurück → keine neue Array-Identität, keine Effects.

### C. Signatur-Guards gegen Chart-Invalidierung (`PriceChart.tsx`)
- S/R-PriceLines: Rebuild nur bei Änderung von `kind:price:touches`.
- Marker: `setMarkers()` nur bei neuer Signatur `time:position:text`.
- Baseline: `applyOptions({baseValue})` nur bei echtem Wertwechsel.
Refs werden im Rebuild-Cleanup zurückgesetzt.

### D. Marker-Bug: Patterns/Backtest vom Divergenz-Toggle entkoppelt
`divOn=false` klemmte bisher auch Pattern- und Backtest-Marker weg. Jetzt gated `divOn` nur noch DIV±-Marker. Zusätzlich filtert ein Timestamp-Set der tatsächlich in der Main-Serie liegenden Bars Marker, die auf keinen Datenpunkt zeigen (lightweight-charts zeichnet sonst ins Leere/wirft). `chartType` in den Deps schließt die Lücke nach Chart-Rebuild.

### E. Crosshair-Bus: Equality-Bail
Im 2x2-Grid feuerte jede Mausbewegung drei identische `setRemote`-Re-Renders. Functional setState mit Vergleich gibt bei gleichen Werten die alte Referenz zurück → kein Render.

### F. Indikator-Mathe (`indicators.ts`)
- `supertrend()`: Guard `a == null || i === 0` — verhinderte `candles[-1]!.c`-Zugriff bei period=1/Custom-Params.
- `squeeze()`: war O(n²) mit Stack-Spreads (`Math.max(...window)`, `closes()` pro Bar) → single-pass Rolling-Window, O(n·period), identische Werte, kein RangeError-Risiko bei langen Perioden.

### G. GoPlus-Soft-Rate-Limit (bei Live-Tests gefunden, `http.ts`/`security.ts`/`onchain.ts`)
GoPlus drosselt mit **HTTP 200 + `{"code":4029}`** im Body. Die Drossel-Antwort wurde für die volle TTL (10 min) gecacht → Token-Forensik blieb dauerhaft OFFLINE. Neu: `inspectBody`-Hook in `fetchJson`; `code 4029` wird exakt wie HTTP 429 behandelt (Glitch-Overlay, Cooldown, Retry, kein Cache-Eintrag), andere Nicht-1-Codes als `invalid` (HTTP 502, kein Cache).

### H. QA-Skripte robuster gegen externe Drosselung
- `qa-trader.mjs`: Polling-Fenster für Forensik (60→150 s) und DEX-Candles (36→48 s) an die App-Retry-Zyklen (ERROR_RETRY_MS 30 s, GeckoTerminal-Backoff 15 s) angepasst.
- `browser-check.mjs`: Wave-7-Sektion öffnet `/de/terminal?ticker=BTC` — der Heatmap-Tile-Klick davor konnte per Live-Volumenordnung einen anderen Token als aktiv persistieren und damit den Lag-Oracle-Select deterministisch verfälschen.

## Verifikation (nach allen Fixes, Production-Build)

| Suite | Ergebnis |
|---|---|
| `tsc --noEmit` | 0 Fehler |
| `eslint .` | 0 Fehler |
| `next build` | ✓ Compiled successfully |
| `npm run smoke` (ws/api/chart/edge) | 4× OK (chart 211 Checks) |
| `browser-check.mjs` | 169/169 (inkl. 2x2-Zoom/TF-Sync, Mobile-Warnung, Force-Enable) |
| `qa-trader.mjs` | 29/29 |
| `qa-responsive.mjs` | 43/43 |
| `qa-interaction.mjs` | 25/25 |
| `beta-test.mjs` | 30/30 |

Bekannte externe Flakes (nicht Code): GeckoTerminal antwortet bei Drosselung mit 429 **ohne** CORS-Header → im Browser `net::ERR_FAILED`; die App heilt via 15-s-Backoff, QA-Fenster entsprechend ausgelegt.
