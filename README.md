# NodeChart

> **NodeChart – Decode the Market. Free to Use, Browser-First.**

A free-to-use, browser-based charting workspace for **CEX & DEX** markets. It includes
**12 configured exchange adapters**, a **33-entry canonical chain/alias registry** for DEX discovery,
region-aware venue ranking and best-effort token-risk data. Registry entries are not proof of live provider coverage;
actual markets, browser reachability and audit depth vary by provider, region and token. Missing or
partial checks remain unknown rather than being presented as a clean bill of health.
Next.js App Router (static marketing/help pages + Worker-backed terminal/API routes) · Tailwind
cyberpunk design system · Zustand · next-intl (5 locales) · deployed to Cloudflare via
`@opennextjs/cloudflare` — no paid data backend is required by the app; platform usage remains
subject to Cloudflare's current limits and pricing.

---

## 1. Tech stack & architectural decisions

| Concern | Decision | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router) | Turbopack build, `proxy.ts`, static marketing/help/legal pages plus runtime terminal/API routes |
| Deployment adapter | **`@opennextjs/cloudflare`** | Builds the Next.js Worker and static assets for Cloudflare. The current config uses no KV/D1 binding; request quotas, billing and runtime limits still depend on the Cloudflare plan and may change. |
| i18n | **next-intl** | `localePrefix: 'always'` ⇒ `/en /de /es /zh /ru`, perfect canonical + hreflang + `og:locale` per language |
| Language auto-detection | **`proxy.ts` in the Cloudflare Worker** (Accept-Language / NEXT_LOCALE cookie) + client `navigator.languages` banner as fallback | No client JS needed for the common case; OpenNext currently warns Cloudflare's Node.js middleware support is experimental, so verify the target deployment |
| State | **Zustand** (`useAppStore`) with `persist` + `skipHydration` | Selector-scoped subscriptions ⇒ no re-render storms; persisted to localStorage |
| Styling | **Tailwind CSS 3** with a CSS-variable theme layer | Swapping `<html data-theme>` re-skins the whole app without re-rendering React |
| Charts (landing/terminal preview) | deterministic inline-SVG `MockChart` → `LiveCandles` once a feed is live | Seeded PRNG ⇒ SSR markup === client markup, zero hydration mismatch, zero image bytes |
| CEX market data | **12 configured exchange WebSocket adapters** plus REST candle seeds | Browser, pair, region and exchange policy determine actual reachability; seed history may come from another venue when the selected venue cannot supply it |
| DEX market data | **DexScreener primary; GeckoTerminal on-demand fallback + OHLCV** | Reduces duplicate provider fan-out; live chain/pool coverage depends on the providers, not on the alias registry |
| Token risk | **GoPlus** on configured EVM chains; **RugCheck** on Solana; limited Honeypot simulation fallback | These are best-effort risk signals, not guarantees or comprehensive audits; partial and unavailable fields stay unknown |
| Rate limiting | Per-source cooldown/backoff, bounded retries, local GeckoTerminal safety budget and a visible cooldown overlay | A provider's 429 does not pause unrelated sources; local budgets cannot coordinate all users sharing an upstream IP |
| Whale stream | trade channels on the same sockets, ≥ $10 000 notional | Zero extra connections: candles and trades are multiplexed per endpoint |

### Why `proxy.ts` and not `middleware.ts`?
Next.js 16 renamed the file convention (`middleware.ts` → `proxy.ts`, `middleware()` → `proxy()`).
next-intl's `createMiddleware` is used unchanged; only the file name/export contract changed.

### Why a `/terminal` route?
The landing-page CTA targets a working terminal, not a placeholder. The locale route provides the
workspace shell, live-feed integration, multi-pane chart engine, indicators and drawing tools (see
§7). It is a dynamic Worker route in the current production build. The base terminal page is
indexable; shared `?ticker`/`?price` variants are `noindex` and canonicalize to the base route.

---

## 2. Repository layout

```
nodechart/
├── messages/                     # 5 locale bundles (en = reference, checked by scripts/check-i18n.mjs)
│   ├── en.json  de.json  es.json  zh.json  ru.json
├── scripts/
│   ├── check-i18n.mjs            # key + ICU-placeholder parity check across locales
│   ├── run-harness.mjs           # esbuild runner for the smoke-test entries
│   ├── ws-smoke.entry.ts         # 12-adapter fixtures + CandleDeriver + live WS proof
│   ├── api-smoke.entry.ts        # live DexScreener/GeckoTerminal/GoPlus/RugCheck/honeypot.is,
│   │                             #   region detection, venue ranking + live probe proof
│   ├── chart-smoke.entry.ts      # Part 4: indicator math vs technicalindicators, sync bus,
│   │                             #   drawings store, device gate, precision, persistence
│   └── browser-check.mjs         # Part 4 (dev-only): real headless-Chrome proof of the
│                                 #   terminal (needs `npm i --no-save puppeteer`), screenshots
│                                 #   land in artifacts/
├── public/
│   └── og.png                    # 1200×630 social card
├── src/
│   ├── proxy.ts                  # edge locale detection + routing (Next 16 proxy convention)
│   ├── i18n/
│   │   ├── routing.ts            # locales, defaultLocale, prefix strategy  (source of truth)
│   │   ├── navigation.ts         # locale-aware Link / useRouter / usePathname
│   │   └── request.ts            # per-request message + locale resolution (must return `locale`)
│   ├── app/
│   │   ├── sitemap.ts  robots.ts  manifest.ts  icon.svg
│   │   └── [locale]/
│   │       ├── layout.tsx        # <html lang>, fonts, metadata, providers, boot script
│   │       ├── page.tsx          # landing
│   │       ├── not-found.tsx
│   │       ├── help/page.tsx     # interactive help center (search + filter + accordion)
│   │       ├── terminal/page.tsx # workspace shell + dynamic OG metadata
│   ├── api/og/route.ts           # edge social card (SVG 1200×630, sanitised)
│   │       └── legal/[doc]/page.tsx   # terms | disclaimer | privacy × 5 locales
│   ├── api/                      # ── Part 2: REST data layer ─────────────────
│   │   ├── http.ts               # the ONLY fetch entry point (timeout, 429, cache, dedupe)
│   │   ├── rateLimit.ts          # global cooldown controller (5 s) driving the overlay
│   │   ├── dexscreener.ts        # /latest/dex/search + /tokens/{addr}
│   │   ├── geckoterminal.ts      # /search/pools + /networks/{n}/tokens/{addr}/pools
│   │   ├── security.ts           # GoPlus + honeypot.is (EVM) / RugCheck (Solana) → verdict
│   │   ├── exchangeProbe.ts      # best-effort latency/reachability from this browser session
│   │   ├── search.ts             # smartSearch(): CEX universe ∥ DEX aggregators
│   │   └── types.ts              # DexPair · SecurityAudit · SearchHit · AuditProvider
│   ├── websockets/               # ── Part 2: CEX streaming layer ─────────────
│   │   ├── manager.ts            # one socket per (exchange, endpoint), ref-counted channels
│   │   ├── socket.ts             # ManagedSocket: reconnect, backoff+jitter, heartbeat, watchdog
│   │   ├── backoff.ts            # exponential backoff with jitter
│   │   ├── rest.ts               # initial candle history (seed) per exchange
│   │   ├── derive.ts             # CandleDeriver: trades → OHLCV (Coinbase/KuCoin/CoinEx)
│   │   ├── registry.ts           # ADAPTERS + EXCHANGE_PREFERENCE (liquidity order)
│   │   ├── whale.ts              # ≥ $10 000 trade filter, batched flush (400 ms)
│   │   ├── types.ts              # Candle · FeedKey · FeedEvent · ExchangeAdapter · ExchangeId
│   │   └── adapters/             # binance · bybit · okx · kraken · coinbase · gate · bitfinex ·
│   │                             #   cryptocom · htx · bitget · kucoin · coinex (+ shared)
│   ├── components/
│   │   ├── ads/       AdManager (social bar + soft-wall host) · AdRail (native
│   │   │              banner) · SupportModal (donations + clipboard)
│   │   ├── share/     ShareModal (X/Telegram intents + theme unlock)
│   │   ├── ui/        NeonButton · NeonPanel · Dropdown · GlitchText · GridBackdrop ·
│   │   │              Kbd · StatusLed · SectionHeading · MockChart · FeatureIcon · Modal
│   │   ├── layout/    SiteHeader · SiteFooter · LocaleSwitcher · ThemeSwitcher ·
│   │   │              CommandPalette · GlobalShortcuts · StoreBridge · ThemeBootScript ·
│   │   │              LocaleDetectBanner · Logo
│   │   ├── landing/   Hero · Ticker · FeatureGrid · LayoutShowcase · CtaSection
│   │   ├── help/      HelpExplorer
│   │   ├── legal/     LegalDocument
│   │   ├── search/    SmartSearch (top-nav bar + dropdown) · SecurityBadge
│   │   ├── whales/    WhaleTicker (sticky bottom stream)
│   │   ├── overlays/  RateLimitOverlay (CSS glitch + 5 s countdown)
│   │   ├── chart/     PriceChart (lightweight-charts wrapper) · ChartGrid (1x1/2x1/2x2) ·
│   │   │              IndicatorModal (multiple instances, editable params) ·
│   │   │              DrawingToolbar (tools + mobile gate) · primitives (watermark, drawings)
│   │   ├── market/    MarketDataProvider (mounts feeds, reroutes, renders nothing)
│   │   └── terminal/  TerminalShell · LiveCandles · ExchangePicker (venue dropdown)
│   ├── store/
│   │   ├── types.ts              # Token / Pane / layout / theme domain types
│   │   ├── presets.ts            # 1x1 · 2x1 · 2x2 grid presets, timeframes, chart types
│   │   ├── storage.ts            # SSR-safe persist storage (critical, see file comment)
│   │   ├── useAppStore.ts        # THE global store + selectors + actions
│   │   ├── useMarketStore.ts     # candles · feed status · DEX quotes (Part 2)
│   │   ├── useWhaleStore.ts      # whale ring buffer (48) · threshold · enabled
│   │   ├── useRateLimitStore.ts  # overlay state (active · source · deadline · hits)
│   │   ├── useExchangeStore.ts   # reach/latency · country · unsupported pairs · preferences
│   │   ├── useExchangeSelection.ts  # hook: ranked venues + active feed + reroute notices
│   │   ├── useChartStore.ts      # Part 4: indicators · drawings · sync flags · mobile gate
│   │   ├── useViralStore.ts      # supporter · wall cooldown · share unlock (persisted)
│   │   └── useHydrated.ts        # hydration gate for persisted state
│   ├── lib/           ads/ (adsterra loader · adblock bait · config) · viral
│   │                  (share texts/intents/urls) · og (edge card builder) ·
│   │                  cn · constants · locales · locale-param · seo · theme · format ·
│   │                  address (EVM/Move/TON/Solana CA detection) · chains (33 canonical IDs
│   │                  + provider aliases; not live coverage proof) · cex-universe · exchanges ·
│   │                  region (geo-blocks + detection) · exchange-select (ranking) ·
│   │                  indicators (technicalindicators wrappers) · drawings (data-space
│   │                  geometry) · chart-sync (range/crosshair bus) · device (touch gate) ·
│   │                  chart-theme (3 themes → lightweight-charts options)
│   └── styles/globals.css        # design tokens (3 themes), components, utilities
├── tailwind.config.js            # cyberpunk design system (asked-for deliverable)
├── next.config.mjs               # next-intl plugin + optional CF bindings for dev
├── open-next.config.ts
├── wrangler.jsonc
└── eslint.config.mjs
```

---

## 3. Local development

```bash
npm install            # use Node 22.12+ for Puppeteer/browser QA
npm run dev            # http://localhost:3000  (Turbopack)
```

> **Node version:** Next's local `dev`/`build` floor is Node ≥ 20.9. Cloudflare builds use Node 22;
> browser/release QA uses Puppeteer 25 and requires Node ≥ 22.12. The committed `.nvmrc` selects
> the Node 22 line; use a current patch release for QA.

| Script | Purpose |
| --- | --- |
| `npm run dev` | local dev server on `0.0.0.0:3000` |
| `npm run build` | `next build`; prerenders static locale pages and prepares dynamic routes for the deployment adapter |
| `npm start` | serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint flat config (`next lint` was removed in Next 16) |
| `npm run check:i18n` | locale bundle parity (keys + `{placeholders}`) |
| `npm run smoke:offline` | deterministic WS/API/chart/edge/module fixtures; no public-provider requests |
| `npm run smoke` | offline fixtures plus best-effort live provider checks (see §6); live availability varies |
| `npm run ws:smoke:offline` | adapter fixtures only; skips all 12 live WebSocket probes |
| `npm run ws:smoke` | adapter fixtures + best-effort live WebSocket probes; region/browser reachability varies |
| `npm run api:smoke` | best-effort public-provider smoke calls + local rate-limit/whale-filter assertions; availability and quotas vary |
| `npm run qa:offline` | local release-audit inventory; browser-dependent modules are explicit SKIPs; needs a running production server at `BASE_URL` (default `127.0.0.1:3000`) |
| `npm run qa:full` | full release audit including browser modules; requires installed Chrome and a compatible local server |
| `npm run cf:build` | `opennextjs-cloudflare build` → `.open-next/` |
| `npm run cf:preview` | build + `wrangler dev` (local Cloudflare runtime) |
| `npm run cf:deploy` | build + `wrangler deploy` |
| `CF_LOCAL_BINDINGS=1 npm run dev` | boot miniflare so KV/D1 bindings exist in dev |

---

## 4. Deploy: GitHub → Cloudflare Workers

> **Idiotensichere Komplett-Anleitung (Deutsch, Klick für Klick):** [`VEROEFFENTLICHEN.md`](VEROEFFENTLICHEN.md)

1. Push this repository to GitHub (or use the zero-config auto-deploy: `.github/workflows/deploy.yml` + `VEROEFFENTLICHEN.md` §3b).
2. Cloudflare dashboard → **Workers & Pages** → **Create** → connect the repo.
3. Build settings:

   | Field | Value |
   | --- | --- |
   | Build command | `npm run cf:build` |
   | Deploy command | `npx wrangler deploy` |
   | Node version | `22` (or rely on the committed `.nvmrc`) |
   | Env var | `NEXT_PUBLIC_SITE_URL=https://nodechart.cc` |

   Cloudflare runs the build in its own CI, executes `opennextjs-cloudflare build`
   (which runs `next build` + converts `.next/` → `.open-next/worker.js` + static assets) and
   publishes a Worker with static assets on `workers.dev`.

4. Point `nodechart.cc` at the Worker (dashboard → custom domain). SSL is automatic.
5. The landing, help and legal locale pages are prerendered and served as static assets. The
   terminal, KuCoin token handler and OG route execute in the Worker. Check Cloudflare's current
   quotas, compatibility requirements and pricing for the account and traffic level you deploy.

> `wrangler.jsonc` contains the `main`, `assets` and compatibility flags (`nodejs_compat`).
> OpenNext currently warns that Cloudflare's Node.js middleware support is experimental; verify
> `npm run cf:preview` and the deployed Worker in your target account before relying on it. KV/D1
> bindings are not enabled by default; check current limits and pricing before adding them.

---

## 5. i18n & SEO setup

* **5 locales** — `en de es zh ru`, each with a complete message bundle (1,188 keys per locale on 2026-10-04, parity-checked by `npm run check:i18n`).
* **Static where appropriate** — landing, help and legal pages are prerendered for the five locales; the terminal and API handlers are Worker routes. The production build output is the source of truth for the current route split.
* **`<html lang>`** — exact BCP-47 tags: `en`, `de-DE`, `es-ES`, `zh-Hans`, `ru-RU`.
* **hreflang** — `x-default` + all 5 languages on every page and in `sitemap.xml`.
* **canonical / og:url / og:locale** — per-locale, absolute, derived from `NEXT_PUBLIC_SITE_URL`.
* **Fonts** — self-hosted Fontsource variable files (Orbitron, Exo 2, Manrope and JetBrains Mono);
  the Exo 2 Latin LCP subset is preloaded through `next/font/local`, while Fontsource provides
  remaining Latin/Cyrillic subsets and CJK falls back to system fonts. Builds do not fetch Google
  Fonts at build time.
* **robots/sitemap/manifest/icon.svg** — generated at build time; base `/terminal` is indexable, while shared `?ticker`/`?price` variants are `noindex` and canonicalize to the base route.

---

## 6. Live data layer (Parts 2–3)

Most provider reads run client-side without user-supplied API keys. A narrow same-origin route supplies KuCoin's public WebSocket token; it is not a general-purpose proxy. Public access, browser/CORS reachability, regional access and free quotas vary by provider and can change.

### 6.1 Configured provider endpoints (not a live-availability guarantee)

| Feed | Endpoint | Notes |
| --- | --- | --- |
| DEX search | `api.dexscreener.com/latest/dex/search`, `/tokens/{addr}` | Official core search/token routes document 300 req/min; response availability and indexed chains/pools are not guaranteed |
| DEX search / OHLCV | `api.geckoterminal.com/api/v2` | Public limit is approximate/dynamic (about 10 req/min); 8/min best-effort local budget, 60 s cache, fallback-only search, one-call global trending |
| EVM token risk | `api.gopluslabs.io/api/v1/token_security/{chainId}` | Configured chain IDs are mapped from `/supported_chains`; fields are provider-dependent and string flags commonly use `"1"`/`"0"` |
| EVM simulation fallback | `api.honeypot.is/v2/IsHoneypot?address=…&chainID=…` | Keyless buy/sell simulation on the configured five chains; this does not replace holder, LP or ownership analysis |
| Solana token risk | `api.rugcheck.xyz/v1/tokens/{mint}/report/summary` | RugCheck score/risks when returned; RPC fallback checks only SPL mint/freeze authority and remains a partial, non-safe verdict |
| CEX candle seed | see §6.3 per venue | Normalised to ascending open time and capped at 300 candles; limits and pair support vary by venue |
| KuCoin socket URL | `api.kucoin.com/api/v1/bullet-public` | token + `instanceServers[0].endpoint`, POST, no auth |

Provider limits/terms/audit: [API_AUDIT.md](API_AUDIT.md).

The manager opens **one socket per (exchange, endpoint)** and reference-counts channels, so
`MarketDataProvider` can add/remove watchlist symbols at runtime without reconnecting, and two
panes on the same pair share one subscription. `urlFor(channel)` in the adapter interface is what
lets OKX use two endpoints transparently.

### 6.2 Resilience

* **Reconnect** — exponential backoff 800 ms → 30 s with jitter, max 12 attempts, full resubscribe on open.
* **Watchdog** — no message for 45 s ⇒ socket is considered dead and recycled (the classic
  "TCP alive but exchange silent" failure).
* **Region blocks** — HTTP 401/403/451 are *not* retried; the venue is marked `blocked` and the
  selection layer reroutes to the next-ranked exchange (§6.4). The feed chip shows `feed.region`.
* **Pair not listed** — an empty/404 seed marks that symbol as unsupported on that venue
  (`unsupported[exchange]`), and the picker skips it for this pair only.
* **Rate limits** — an upstream HTTP 429 opens the provider-labeled `<RateLimitOverlay/>` with a
  live countdown. The backoff is tracked per source and honours `Retry-After` within a short
  automatic-wait cap; unrelated providers continue. A request waits/retries only when retries remain
  (two retries by default); long waits fail fast so stale data or another source can be used. The
  overlay is a shared UI signal, not a shared-IP quota, and its safety timer only prevents a stuck
  overlay.

### 6.3 Configured CEX adapters — 12 venue IDs

The adapters use public, keyless market-data endpoints where configured; provider terms, rate
limits, regional access and availability vary, and no uptime or free-use guarantee is implied. The
offline harness exercises recorded parsing fixtures for the 12 adapter IDs currently configured in
`src/websockets/registry.ts`; fixture success checks local decoding only. Live connection attempts
are separate, best-effort observations and do not establish browser or provider coverage.

| Venue | WebSocket | Candles | Trades | Quirk (verified) |
| --- | --- | --- | --- | --- |
| Binance | `wss://data-stream.binance.vision/ws` | `<pair>@kline_1m` | `@aggTrade` | market-data mirror — `stream.binance.com` answers **HTTP 451** for many regions |
| OKX | `wss://ws.okx.com:8443/ws/v5/{business\|public}` | `candle1m` | `trades` | `candle*` on the *public* endpoint answers `error 60018` |
| Bybit | `wss://stream.bybit.com/v5/public/spot` | `kline.1.BTCUSDT` | `publicTrade.*` | ping ≤ 20 s (18 s used); REST is 403 from some IPs |
| Coinbase | `wss://ws-feed.exchange.coinbase.com` | **derived** from `matches` | `matches` | no candle channel; maker side must be inverted; granularities stop at 1d; REST needs a `User-Agent` |
| Kraken | `wss://ws.kraken.com` | `ohlc` (interval in **minutes**) | `trade` | `XBT`→BTC, `XDG`→DOGE; v2 endpoints behave differently, v1 used |
| Gate.io | `wss://api.gateio.ws/ws/v4/` | `spot.candlesticks` | `spot.trades` | candle payload is a **flat** `["1m","BTC_USDT"]` (nested arrays silently stream nothing); server `spot.ping` → `spot.pong`; `create_time_ms` has microseconds |
| Bitfinex | `wss://api-pub.bitfinex.com/ws/2` | `trade:1m:tBTCUST` | `trades` | USDT is spelled **`UST`** (`tBTCUSDT` returns `[]`); `AMOUNT < 0` = sell; chanId map; **no 4h** bucket |
| Crypto.com | `wss://stream.crypto.com/exchange/v1/market` | `candlestick.1m.*` | `trade.*` | no REST seed reachable ⇒ `seedsViaSocket` (the subscribe answer carries history) |
| HTX | `wss://api.huobi.pro/ws` | `market.<sym>.kline.1min` | `…trade.detail` | frames are **gzip-compressed binary**; server `ping` must be answered with `pong` |
| Bitget | `wss://ws.bitget.com/v2/ws/public` | `candle1m` (`instType: SPOT`) | `trade` | v1 `SPBL` answers `30016`; heartbeat is the literal string `ping` |
| KuCoin | token URL from `bullet-public` | **derived** from `/market/match` | `/market/match` | both kline topics answer `404 topic does not exist`; ns timestamps; ping every 18 s |
| CoinEx | `wss://socket.coinex.com/` | **derived** from `deals.update` | `deals.subscribe` | v2 `candlesticks.subscribe` = "method not found"; REST klines are **v1** (`/v1/market/kline`) |

**Derived candles** — Coinbase, KuCoin and CoinEx expose no public candle channel. `derive.ts`
buckets their trade stream into OHLCV (`CandleDeriver`) and can continue a REST-seeded candle rather
than starting a fresh bucket. This avoids one common seam in the displayed chart, but trade gaps,
provider timing and cross-venue seed differences mean it is not guaranteed to match a native candle
feed exactly. The smoke test checks rollover and seed-continuation on deterministic fixtures.

**Deliberately skipped** (measured, not guessed): MEXC (IP-blocked 403), Bitstamp (invalid
subscription answer), AscendEX (403 on the public socket), Upbit (binary protobuf protocol).

### 6.4 Region-aware routing

```
proxy.ts  →  cf-ipcountry header mirrored into the nc_country cookie (7 d, lax)
           ↘ fallback in the browser: Intl.DateTimeFormat().resolvedOptions().timeZone
```

`detectRegion()` returns `{ country, source }` (`edge` or `timezone`), while the region list in
`isRestrictedIn(exchange, country)` is only a heuristic and can become stale. `exchangeProbe.ts`
performs best-effort browser-side attempts for the current pair/timeframe: a direct REST-seed fetch
where configured, or a WebSocket **opening handshake** for CORS-blind/no-seed venues. It cancels
HTTP response bodies and closes a socket after the handshake; it does not validate API payloads,
subscribe to market data, or prove continued availability. Browser extensions, CORS, provider policy,
region, pair support and transient network state can change the result. The displayed time is a
client-observed response/handshake duration, not a guaranteed network RTT or provider latency. These
snapshots guide ranking only.

Ranking (`exchange-select.ts`) — lower score wins:

| Contribution | Value |
| --- | --- |
| probe returned a usable HTTP response / opened socket (`ok`) | `0` |
| successful probe, but slow | `0.5` |
| unknown / stale | `1` |
| denied or no usable probe response (`blocked`, `error`) | `2` |
| region rule heuristic | `+1` |
| client-observed response/handshake time | `+0 … +0.4` (capped at 1500 ms) |
| liquidity preference rank | `+0.05` per step (binance → okx → bybit → …) |

The latency term is only a tie-breaker: with other terms equal, one preference step is about 190 ms
of observed response time. It is not a performance promise. A manual choice in `<ExchangePicker/>`
usually wins, but a fresh denied/no-response probe or unsupported timeframe/pair may reroute the
chart. All configured adapters remain listed; probe and region results do not guarantee that any
endpoint is available from a particular device or network.

### 6.5 DEX chain aliases and actual coverage

`src/lib/chains.ts` contains a 33-entry canonical chain registry and alias tables for provider
naming differences (for example `avax`/`avalanche`, `xdai`/`gnosis`, and `seiv2`/`sei`). These
mappings let the app normalize provider responses; they do **not** prove that a provider currently
indexes each network, token, DEX or pool. Live search uses DexScreener first and calls
GeckoTerminal only when the primary search misses or fails; OHLCV uses GeckoTerminal. The number
of DEX brands listed by either service is not independently verified here, so this README makes no
"700+ DEXes" coverage claim. Results can be empty or partial even for a mapped chain.

Search classification (`src/lib/address.ts`) routes pasted contracts into the address lookup path:
EVM (`0x` + 40 hex), **Sui/Aptos/raw TON** (`0x` + 64 hex, optional `::module::Type` suffix), TON
friendly (`EQ…`/`UQ…`) and Solana (base58). Anything else is a symbol/name search across the CEX
universe (~50 instruments), with GeckoTerminal used only as the DEX fallback when DexScreener
returns no result.

### 6.6 Security verdicts (`src/api/security.ts`)

| Verdict | Rule |
| --- | --- |
| `danger` (red) | A configured provider reports a high-risk flag, high tax, honeypot or RugCheck danger score; not a legal/scam determination |
| `warn` (amber) | A configured warning is present, such as tax, mintability, proxy, closed source, few holders or a non-low simulation summary |
| `safe` (green glow) | Internal state meaning the provider row contains the required core fields and no configured flags; **not** a guarantee that a token is safe |
| `unknown` (muted) | Provider failed, returned incomplete data, or the chain is unsupported; partial simulation does not promote this state to a clean result |

Pipeline per chain: **GoPlus** (static flags, 19 EVM chains) → if it answers `danger`, `unknown` or
returns no data, **honeypot.is** simulates a real buy+sell on-chain (5 major chains) → **worst-of
merge** (honeypot beats static flags; a simulation that passed adds `simulation-passed`, taxes above
threshold escalate). Solana uses **RugCheck**. `provider` records who decided, and the UI shows
"unaudited" rather than a wrong green badge on chains nobody covers (Sui, Aptos, TON, …).

Audits are cached 10 min, in-flight duplicates are deduped, and failures resolve to `null` — a dead
auditor can never break the dropdown.

### 6.7 Whale tracker

Trade channels are multiplexed onto the same sockets (no extra connections). `whale.ts` keeps only
trades with `price × qty ≥ 10 000 USD`, buffers them and flushes at most every 400 ms (newest first)
into a 48-entry ring buffer. Neon green = buy, neon red = sell; the ticker also shows count and total
notional, and the `Waves` button in the terminal toolbar unsubscribes the streams entirely.

### 6.8 Smoke tests

```bash
npm run smoke:offline # deterministic fixtures only; no live provider requests
npm run smoke         # offline fixtures + best-effort live probes
```

`smoke:offline` runs `ws:smoke:offline`, the API budget/resilience fixtures, chart math/store,
Edge Suite and module tests. The WebSocket harness replays recorded parser fixtures for all 12
configured adapter IDs and exercises `CandleDeriver` plus HTX gzip handling; the live venue probes
are explicitly skipped. These fixtures do not establish current exchange behavior or coverage.

`smoke` additionally attempts live connections. A live `PASS` only records that this test machine
opened a connection at that moment; `SKIP` is expected when the sandbox/network cannot reach an
endpoint. Neither result establishes browser, regional, subscription, ongoing-data or full-provider
coverage. `api:smoke` exercises live search/audit/provider paths plus deterministic region/ranking
fixtures: CA lookups (Base `AERO`, Sui `CETUS`), GoPlus/RugCheck examples, timezone→country detection
and selector scoring. Its Node-side venue probe reports only this run's observations; it has no
minimum reachable-count assertion because outcomes vary by network, region, provider CORS and service
state. All harnesses bundle the production TS sources with esbuild; they are dev-only and never shipped.

---

## 7. Chart engine (Part 4)

The terminal at `/terminal` renders real exchange data on
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5 (the open-source
TradingView canvas engine) — no iframe, no paid widget or proprietary market-data backend. Indicator mathematics comes
from [`technicalindicators`](https://www.npmjs.com/package/technicalindicators); every series the
UI draws is recomputed client-side from the raw candle stream.

### 7.1 Uncroppable watermark

A single TradingView-style text line — **`www.NodeChart.cc`** — is painted by a custom
`IPrimitivePaneView` *into the chart canvas itself* (vector paths, ~12 % alpha). It sits centred
in every pane, auto-fits to ~72 % of the pane width, and panes smaller than 120×48 px skip it, so
it never collides with the price scale, series or legend chips. Because it lives inside the canvas
bitmap, every screenshot, screen recording and the built-in PNG export (`chart.takeScreenshot()`)
carries it — cropping the DOM around the chart cannot remove it. Each pane host also exposes
`data-watermark="www.NodeChart.cc"` for automated verification.

### 7.2 Indicators — multiple instances, editable, multi-pane

* The store does not enforce a fixed instance count; practical limits depend on browser memory
  and device performance. Each instance has its own parameters and renders as an overlay line
  (EMA/SMA/Bollinger/VWAP…) or in its own oscillator pane (RSI/MACD/Stochastic/ATR/Williams
  %R/AO/ROC) — `chart.addSeries(def, opts,
  paneIndex)` keeps time scale and crosshair shared with the price pane.
* `src/lib/indicators.ts` wraps the `technicalindicators` classes, validates parameters and
  aligns outputs to candle timestamps. `scripts/chart-smoke.entry.ts` proves the math against
  independently computed references (including two library quirks: RSI rounds its output to
  2 dp, ATR seeds its first value at input index `period`).
* Parameters are edited in `IndicatorModal` (slider + numeric input, live preview, per-instance
  colour) and persisted with the workspace.

### 7.3 Grid views & sync (1x1 · 2x1 · 2x2)

* Layouts come from `CHART_LAYOUTS`; every pane has its own token and (optional) timeframe
  override, otherwise the global timeframe applies.
* `src/lib/chart-sync.ts` is a module-singleton bus: visible-range and crosshair events are
  re-broadcast to all mounted charts with a source tag so echoes terminate (no feedback loops).
  Toggles: `syncZoom`, `syncCrosshair`, `syncTimeframe`.
* Crosshair sync uses synthetic `subscribeCrosshairMove` primitives because v5 removed
  `setCrosshairPosition`; zoom sync uses `setVisibleLogicalRange`.

### 7.4 Drawing tools

Trend line · ray · segment · horizontal line · Fibonacci retracement · rectangle/support zone.
Drawings are stored in **data space** (timestamp + price, never pixels) in
`localStorage['nc-chart-v1']`, survive zoom/pan/reload and are rendered by an
`ISeriesPrimitive` pane view attached to the price series. PNG export includes them.

### 7.5 Mobile gate

`src/lib/device.ts` detects touch hosts (pointer/coarse media queries + UA + viewport). On touch
devices the toolbar shows the warning *"Complex drawing is not recommended on touch screens"*,
the tools stay hidden/locked until **Force enable** is pressed (both the warning dismissal and
the force flag persist per device).

### 7.6 Browser seeding & the CORS reality

Browsers enforce CORS on `fetch`; Node does not. The current browser-seed policy classifies four
configured REST histories (`bybit`, `kucoin`, `coinex`, `bitfinex`) as CORS-blind based on observed
responses. Provider headers can change. WebSockets are not governed by fetch CORS, but can still be
blocked by endpoint policy, region or network conditions. NodeChart handles this in two places:

1. `exchangeProbe` treats a CORS rejection (`TypeError`) as inconclusive and may attempt a
   WebSocket **opening handshake**. It does not subscribe or verify continued data, so the result is
   not a real-stream reachability guarantee.
2. `CexSocketManager.seedWithFallback()` tries the selected venue's history first when the browser
   policy permits it, then races up to three configured CORS-readable seed candidates at a time
   (`CORS_FRIENDLY_SEEDS`: binance → okx → kraken → gate → bitget → htx). This fallback supplies
   candle history only; live updates still depend on the selected venue's socket. Fresh substitute
   history is labeled `History via <venue>` in the feed, while persisted stale history also shows
   its source and cache age. Neither label guarantees that the live stream is currently healthy.

A second subtlety fixed here: channels added while a socket is **already open** (e.g. a timeframe
switch) never see the on-open hook, so they are seeded explicitly — otherwise the chart would sit
empty until two live candles accumulate.

### 7.7 Verification

* `npm run smoke` → `chart-smoke` (85 assertions): indicator math vs references, alignment,
  Heikin-Ashi, precision bands, sync bus echo-guard, drawing geometry + persistence, device gate.
* `node scripts/ad-slots-check.mjs` (dev-only): builds with the `public/ads-dev/*`
fixture scripts and proves both containers per device – desktop rail filled +
mobile hidden, mobile strip filled + desktop hidden, per-device social bar and
popunder, and the lazy injection after crossing the breakpoint.
* `node scripts/browser-check.mjs` (dev-only, headless Chrome): canvases mount, live candles
  arrive, watermark pixels present in-canvas, indicator modal adds EMA/RSI/MACD with editable
  parameters, oscillator panes spawn, trend line drag persists, 2x2 grid + zoom/timeframe sync,
  mobile warning + force-enable, reload persistence, CORS inventory. Screenshots in `artifacts/`.

---

## 8. Best-effort on-chain signals

Toolbar toggle **ON-CHAIN** (Radar icon) docks a right-hand panel with keyless public data where
available. This is not a guaranteed live feed: CORS, regional access, rate limits and provider
uptime vary. The panel fetches only while open (15 s heartbeat; individual groups have longer
refresh deadlines); closed = zero requests. Failed groups retain the last good in-memory reading
where possible and otherwise display missing values rather than fabricated zeros.

| Group | Source | Signals | Refresh |
| --- | --- | --- | --- |
| Bitcoin | `mempool.space`; Blockstream Esplora fallback | Partial mempool/fee readings; difficulty and average block timing are only available from the primary source | 60 s |
| EVM networks | Public Blockscout instances for Ethereum/Base/Arbitrum/Polygon | Instance-dependent gas, utilisation, tx and price fields; not every instance exposes every field | 60 s |
| Solana | PublicNode RPC; official shared Mainnet RPC fallback | Slot/TPS readings when supported; shared RPCs are rate-limited and not production SLAs | 45 s |
| DeFi capital | DeFiLlama API + stablecoins API | TVL history, top-chain TVL and stablecoin supply are independently parsed; missing endpoints remain blank | 5 min |
| DEX heat | GeckoTerminal global trending + DexScreener boosts | Provider-ranked trending pools and paid-boost attention data, not a complete market-wide DEX ranking | 2 min |
| Token forensics | GoPlus; Honeypot.is simulation fallback on supported EVM chains | Holder/tax/top-holder/LP fields only when GoPlus supplies them; simulation-only fallback leaves holder, LP and mintability unknown | 10 min |

Implementation notes: `src/api/onchain.ts` parses each provider independently and represents
missing fields as `null`; `src/store/useOnChainStore.ts` keeps ephemeral readings in memory and
uses in-flight guards plus per-group deadlines. RPC calls share `fetchJson` timeouts, response-size
limits and provider-aware retry handling. Local caching reduces duplicate requests but is not a
shared quota for all visitors; fallback traffic can still be rate-limited.

---

## 9. Provider-dependent PRO metrics & local chart analytics

Toolbar toggle **PRO** (Gauge icon) shows best-effort market snapshots and local chart calculations.
The metrics are not guaranteed feeds or investment advice; values can be stale, partial, venue-specific
or unavailable. Source labels are shown where the UI can identify the venue.

| Group | Source | Signals | Refresh |
| --- | --- | --- | --- |
| Derivatives | `api.gateio.ws` + `www.okx.com` | funding rate (+ annualised), **next-funding countdown**, mark/index + premium %, open interest (USD), long/short (accounts / taker / top traders), liquidations per 5 m (long vs short), **OI / L-S-taker / funding-history sparklines** (30 × 5 m stats + 24 × 8 h settled funding) | 60 s |
| Order flow | `api.gateio.ws` book + **live tape** | best bid/ask, spread (bps), book imbalance (top 50 levels), **cumulative depth chart** (±0.5 % around mid, SVG), session **CVD** + Δ60 s from the whale trade stream (throttled 600 ms) | 15 s |
| Market breadth | Gate spot tickers, OKX fallback | Advancers/decliners and median change across the provider-returned USDT set; not total-market breadth | 5 min |
| Global market | CoinGecko + Alternative.me | Independent global-market and sentiment snapshots; CoinGecko attribution is shown; either source may be missing | 5 min |
| Heatmap | Gate spot tickers, OKX fallback | Top returned USDT tickers as intensity tiles (change × volume); universe and freshness follow the exchange snapshot | 5 min |
| Options & IV | Deribit public API | DVOL where available, call/put OI, calculated max pain over returned contracts, and derived smile/term summaries; all are venue-specific and max pain is descriptive, not predictive | 10 min |

Implementation: `src/api/prometrics.ts`, `src/store/useProStore.ts` (same
open-only-fetch lifecycle as the on-chain panel), `src/components/pro/ProMetricsPanel.tsx`.
CVD accumulates from `tradeBus` in `src/websockets/manager.ts` – zero extra requests.

### Premium chart tools (computed locally, in-canvas)

* **Volume Profile Visible Range** – chip `VP`: price-binned volume histogram
  anchored to the pane edge, POC line + dashed VAH/VAL (70 % value area),
  painted by `VolumeProfilePrimitive` so screenshots keep it.
* **Anchored VWAP** – chip `aVWAP`: arm, click a candle, get the session VWAP
  from that anchor (click chip cycles arm → anchored → cleared).
* **34 indicator kinds** (multiple instances; practical limits depend on the device): the 7 classics plus
  Supertrend, Keltner, Donchian, Parabolic SAR, StochRSI, OBV, MFI, CCI,
  ADX/DMI, TRIX, PPO, DPO, Bollinger %B, Aroon – wave 2: **Ichimoku Cloud,
  VWAP, Williams %R, Hull MA, TEMA, DEMA, Guppy MMA (6-EMA ribbon), TTM
  Squeeze, TD Sequential, Chaikin Money Flow, Ease of Movement, Ultimate
  Oscillator** – and wave 5: **CUSTOM (Script Lab formulas)** – all with
  parameter modals, all computed locally.
* **Script Lab** – toolbar chip `Skripte` (or the CUSTOM tile in the indicator
  modal): write per-candle formulas (`o h l c v` plus `ema sma rsi atr stoch
  vwap highest lowest change` + math helpers), test them against the live
  buffer (last/min/max), save up to 50 locally, **import from any https raw
  URL** – `github.com/…/blob/…` and gist links are rewritten to their raw
  hosts automatically (≤20 KB) – and plot the result as its own pane or as a
  price overlay. Engine: `src/lib/scripts.ts` (`new Function` expression
  evaluator, 4000-char cap, memoised helper series). The global-shadowing is not
  a hard sandbox: formulas run in the page context and may reach browser APIs.
  The UI now warns users to run only trusted code; imported content is not
  executed until the user tests or applies it. This is a small formula language,
  not Pine Script or a Pine-compatible sandbox, and is available without a paid
  subscription in the current version. UI: `src/components/tools/ScriptLabModal.tsx`.
* **NodeCluster (support/resistance)** – chip `NodeCluster`: nearby swing pivots
  are grouped into layered price bands with in-canvas node markers, touch counts
  and a local strength estimate (`supportResistance()` in `src/lib/premium.ts`).
  It is calculated from the chart candles, not exchange order-book depth or a
  guarantee of liquidity.
* **RSI divergence markers** – chip `Divergenzen`: classic bullish/bearish
  price-vs-RSI(14) pivot divergences rendered as `DIV+`/`DIV−` arrows via
  `createSeriesMarkers` (`divergences()` in `src/lib/premium.ts`).
* **Price alerts** – chip `Alert`: arm, click any price level, the chart draws
  a dotted ALERT line and fires a neon toast (10 s) the moment the last price
  crosses it. Session-only by design (never persisted); chip cycles
  arm → `Alerts (n)` → clear-all.
* **Compare overlay** – `Vergleich` select: any CEX seed symbol as a
  normalized %-line on its own overlay scale; its kline feed is
  reference-counted through the same `cexManager.ensureFeed` pipeline.
* **Session strip** – today's UTC change %, range-position marker and
  annualized **realized volatility** straight from the candle buffer
  (`sessionStats()` / `realizedVolPct()`).
* **Bar replay on every timeframe** – chip `Replay`: play/pause/step/10×
  transport that hides candles from the right edge while indicators, the volume
  profile and support/resistance recompute on the sliced, locally loaded buffer;
  source data is not altered.
* **Strategy lab (backtester)** – chip `Backtest`: six zero-config strategies
  (EMA cross, RSI reversion, Bollinger reversion, Supertrend flip, MACD cross,
  Donchian breakout) with fees per side, mark-to-market equity curve, win
  rate, profit factor, max drawdown, exposure, and one click to paint every
  round trip onto the chart (`src/lib/backtest.ts`). Results are a local
  historical simulation, not a prediction or a guarantee of future performance.
* **Market screener** – chip `Screener`: current provider-listed USDT spot-ticker
  snapshot (Gate primary, OKX fallback), sortable and filterable by fields that
  the provider returned. Listings and missing values vary; unknown changes stay
  blank. Search, CSV export and ad-hoc chart opening are included.
* **Watchlist** – chip `Watchlist`: saved symbols have no in-app count cap. CEX
  quotes appear only when the base is present in the shared Gate/OKX spot-ticker
  snapshot (normally cached up to two minutes); DEX entries have no quote here.
  If refresh fails, the last non-empty rows may remain visible. This is not a
  per-symbol live stream. The list is stored locally and reuses the shared cache path.
* **Risk & position calculator** – chip `Risk`: account, risk %, entry, stop,
  target, leverage → size, notional, margin, R:R and account impact
  (`src/lib/risk.ts`).
* **QoL pack** – log & percent price scales, countdown to bar close in the
  legend, baseline chart type and OHLCV **CSV export** per pane.
* **Real DEX candles** – DEX tokens chart genuine OHLCV history from
  GeckoTerminal (`fetchDexCandles`). The client keeps the last chart/quote in
  memory on failures, respects an 8-request/minute local safety budget, waits
  out that budget's retry window, and refreshes from the source's documented
  one-minute cache window while mounted.

---

## 10. Keyboard map

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | command palette (navigation, layout, theme, language, actions) |
| `1` `2` `3` | chart layout 1x1 / 2x1 / 2x2 |
| `?` | help center |
| `/` | focus help search |
| `Esc` | close any overlay |

---

## 11. Monetization, advertising consent & donations

The current release is available without a paid subscription. Optional advertising
and voluntary donations help cover operating costs; provider availability, hosting
plans and any fees remain subject to current third-party terms.

### 11.1 Optional advertising choice

Adsterra delivery is **off until an explicit opt-in**. A fresh browser starts in
`unknown`; the in-flow notice offers equally prominent allow/reject actions. A
rejection does not disable charts or market-data requests and does not trigger the
ad-block detector, soft-wall or ad retries. The footer's **Ad preferences** action
reopens the choice. Withdrawing a previous grant stores `denied` and reloads the
page to end the current JavaScript context; this cannot delete cookies already
set by a third party.

The app stores only a versioned choice and timestamp in first-party
`localStorage` (`nc-ad-consent-v1`). If saving a denial there fails, it tries a
session-only denial fallback; if both stores fail and no readable prior grant
remains, denial is enforced in memory for the current page. A grant never uses a
storage fallback. The engineering expiry is 180 days; clearing browser storage
resets persisted choices, and storage failures never create a new grant.
This is an app-side gate, **not a claim that the publisher integration is CMP/TCF
compatible**. Adsterra's documented consent-signal requirements have not yet been
verified for these exact placements; release approval remains blocked until that
integration and actual browser cookie/network behavior are checked. This note is
technical documentation, not legal advice.

Active insertion points are deliberately listed separately because a guard in
one loader would not cover the others:

* `HeaderNativeBanner` — default native banner on non-terminal routes.
* `SidebarBanner` — separate default loader on terminal viewports at 1280 px and up.
* `AdManager` — Social Bar on `/terminal` and consent-gated ad-block detection.
* `AdSlot` — responsive native placements only when the matching build variables
  are configured.
* `TerminalShell` → `requestPopunder()` — injected on an explicit multi-chart
  layout action, only after ad consent.

### 11.2 Adsterra placement configuration

The config supports per-device overrides (all `NEXT_PUBLIC_*` values are
inlined at build time):

| Format | Desktop override | Mobile override |
| --- | --- | --- |
| Social Bar | `NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP` | `NEXT_PUBLIC_ADSTERRA_SOCIALBAR_MOBILE` |
| Popunder | `NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP` | `NEXT_PUBLIC_ADSTERRA_POPUNDER_MOBILE` |
| Terminal Native slot | `NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP` | `NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE` |

Legacy single-value variables remain fallbacks. The header Native Banner and
Sidebar Banner also have separate default publisher URLs / override variables;
see `src/lib/ads/config.ts` and `.env.example`. Built-in Social Bar and Popunder
URLs mean `ADS_ENABLED` can be true without environment variables. That flag is
not consent: **every network insertion still requires a fresh `granted` choice**.

Responsive slot visibility uses CSS and `matchMedia`; `scripts/ad-slots-check.mjs`
can prove the fixture-based placement behavior after a test-only opt-in. The test
uses local fixture scripts, not live Adsterra delivery.

### 11.3 Smartlinks and ad-block handling

The Smartlink kits (`/ads/landing-smartlinks.js`, `/ads/app-smartlinks.js`) are
served from this site. The reviewed source uses first-party storage for frequency
caps and contains no `fetch`, XHR or `sendBeacon`; the external, visibly sponsored
partner destination is reached only through a user click. This is kept separate
from automatic Adsterra delivery. Browser network verification is still pending.

If the visitor has allowed optional ads, a failed ad-delivery script may invoke
the existing soft-wall. Without consent or after rejection, the ad-block detector
and wall are not run. `?adwall=1` is a QA/demo path and also requires an explicit
consent seed; it does not override a real rejection.

* **I have donated** → two-step trust flow (`DonatedFlow`): the button asks for a
  rough size — **up to $5** or **over $5** (self-declared; no on-chain transaction
  verification and no account). Either choice sets the cosmetic `supporter` badge
  and starts the ask-free grace window: **48 h** for any donation, **5 days** above
  $5. Donation-grace behavior is implemented in `src/store/useViralStore.ts`.
* **Dismiss** → 7-day cooldown (`wallDismissedAt`).
* Three donation wallets (SOL / BTC / ETH) with copy feedback.

### 11.4 Viral loop & share-to-unlock

The **Share** button in the terminal toolbar opens a modal with a localized,
pre-filled share draft and deep link. X (`intent/tweet`) and Telegram
(`t.me/share/url`) buttons open the corresponding composer and unlock the two
premium skins **Matrix Green** and **Miami Vice Pink** in this browser; the app
does not verify that a post was published. The unlock is persisted in
`useViralStore.shareUnlocked` (`nc-viral-v1`) until browser storage is cleared.
Locked skins show a lock icon in the theme picker / command palette and open the
share modal instead of applying; the modal then offers to apply an unlocked theme.

Shared links carry `?ticker=SOL&price=…`; the terminal reads them at mount and
opens the chart described by the link.

### 10.4 Premium themes

`[data-theme='matrix']` (phosphor CRT, heavy scanlines) and
`[data-theme='miami']` (sunset noir pink/cyan) are full token sets in
`globals.css`; `chart-theme.ts` derives the lightweight-charts options from the
same CSS variables, so candles, watermark and drawings recolour instantly.

### 10.5 Open-Graph edge card (`/api/og`)

`generateMetadata` on `/terminal` emits `og:image` / `twitter:card` pointing at
`/api/og?ticker=…&price=…&locale=…`. The route (`runtime = 'edge'`) renders a
1200×630 cyberpunk card as **pure SVG** (`src/lib/og.ts`, all inputs sanitised +
XML-escaped) – no wasm or font dependency in the route. Worker quotas and any billing still follow
the active Cloudflare plan and traffic. Telegram/Discord/Reddit unfurl it; swapping the SVG body for a Satori PNG (X/Facebook) is the documented
upgrade path without touching route or meta wiring.

### 10.6 Verification

`chart-smoke` pins the pure logic (share-text template, intent URLs, OG
sanitiser/escaper, premium gating, unlock flow). `browser-check.mjs` proves the
running product: soft-wall copy + wallets + clipboard + cooldown, share modal +
X intent + unlock banner, matrix application, `/api/og` response, dynamic
`og:image` meta and the `?ticker=` deep link.

---

## 12. Security hardening & test matrix

Implemented hardening controls (rerun the verification commands below before each release):

| Area | Measure |
| --- | --- |
| Network | Provider JSON responses routed through `fetchJson()` are capped at **4 MiB** (`boundedJson()` content-length pre-check + streaming `TextDecoder` guard → `HttpError(413)` on overflow); request timeouts are also bounded. |
| localStorage | All three zustand persist stores (`useAppStore`, `useChartStore`, `useViralStore`) have `merge` **sanitizers**: hostile/corrupted payloads (bad theme, layout, timeframe, panes, indicators, drawings, flags) are field-validated against the real enums/validators and fall back to safe values instead of crashing or injecting state. |
| Theme boot | `ThemeBootScript.tsx` re-validates the persisted theme against an allowlist regex before touching `documentElement` (no injection via storage). |
| Headers | `next.config.mjs` sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a restrictive `Permissions-Policy`. **No `X-Frame-Options`/`frame-ancestors`** on purpose: the terminal is meant to be embeddable (previews/widgets). Add them if you deploy a hardened instance. |
| Public dir | Ad test fixtures live in `scripts/fixtures/ads-dev/` (never shipped). `ad-slots-check.mjs` copies them into `public/` only for the proof run. Note: `next start` snapshots `public/` at boot — copy fixtures **before** starting the server. |
| Sharing | Share modal encodes tweet/URL (`encodeURIComponent`), popups use `noopener`; clipboard via in-page stub in tests. |
| Dependencies | `npm audit --omit=dev`: **0 findings**. The full tree currently has **7 high dev/transitive findings** in the Tailwind/ESLint glob-brace chain. They are not shipped as app runtime dependencies, but still affect local tooling; clearing them requires compatible upstream fixes or major migrations. Puppeteer was upgraded to 25.12.0; browser QA with that version requires Node ≥22.12. The unused `tailwindcss-animate` plugin was removed. No `--force` downgrade was applied. |

Verification run on 2026-10-04. These checks cover local fixtures/builds; they do not establish
live provider availability, browser reachability from other regions, production quotas or deployment
behavior. The earlier release-era browser/beta inventory is not a substitute for rerunning those
checks against a release candidate.

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | Pass |
| Production build | `npm run build` | Pass; fonts are bundled locally, with no build-time Google Fonts fetch |
| Cloudflare build | `npm run cf:build` | Pass; emits a warning that Cloudflare Node.js middleware support is experimental; no deploy performed |
| Lint | `npm run lint` | Pass; 0 errors and 0 warnings in this run |
| Tailwind utility audit | `npm run audit:css` | Pass; 281 used, 756 defined, 0 missing utilities |
| i18n parity | `npm run check:i18n` | Pass; 1,188 keys × 5 locales |
| SEO audit | `BASE_URL=http://127.0.0.1:3100 node scripts/seo-audit.mjs` | 95 PASS / 0 FAIL against the local production server |
| SEO check | `BASE_URL=http://127.0.0.1:3100 node scripts/seo-check.mjs` | 578 PASS / 0 FAIL; one font preload per locale |
| Offline smoke suite | `npm run smoke:offline` | 410 PASS / 0 FAIL / 12 SKIP; deterministic fixtures pass, live WS probes are explicitly skipped |
| WebSocket smoke | `npm run ws:smoke:offline` | All 12 adapter fixture groups pass; live endpoint probes are not attempted |
| API budget | `npm run api:budget-smoke` | Pass (8 assertions) |
| API resilience | `npm run api:resilience-smoke` | Pass (fallback, partial-data and risk-result fixtures) |
| Chart / NodeCluster | `npm run chart:smoke` | Pass, including NodeCluster support/resistance fixture checks |
| Local HTTP/SSR baseline | `M12` via `npm run qa:offline` | Pass; headers, OG input escaping, 5 locale font preloads/assets, privacy SSR and invalid-locale response |
| Production dependency audit | `npm audit --omit=dev` | 0 findings |
| Full dependency audit | `npm audit` | 7 high dev/transitive findings remain; see the Dependencies row above |
| Offline release audit | `npm run qa:offline` | **445 PASS / 0 FAIL / 20 SKIP**; `RELEASE-AUDIT.md` lists each module and why browser checks were skipped |
| Browser/live-provider modules | `npm run qa:offline` | Browser-dependent checks are recorded as SKIP; live API probes were intentionally not repeated because sandbox egress is unavailable. No browser or live-provider PASS is claimed |

---

## 13. SEO programme (automated checks)

The SEO assertions below are encoded in `scripts/seo-audit.mjs`. Run that script
against the current production build after changes; listed targets are not a
fresh audit result or a ranking guarantee.

1. **Language mesh** – each locale page emits canonical + `hreflang` alternates for
   all five locales plus `x-default` (head links *and* sitemap alternates), so
   each language ranks independently instead of cannibalising the others.
   `og:locale` + four `og:locale:alternate` tags tell social platforms the same.
2. **Metadata discipline** – per-locale titles/descriptions from the message
   bundles, keyword sets, `robots` with `max-image-preview: large` / unlimited
   snippets, Twitter summary-large-image with the dynamic `/api/og` card. The
   base terminal is indexable; shared `?ticker`/`?price` variants are `noindex`
   and canonicalize to the base route.
3. **Structured data graph** (`src/lib/jsonld.ts` + `<JsonLd/>`):
   `Organization` + `WebSite` site-wide, `SoftwareApplication` with a feature
   list on the landing, `FAQPage` + `DefinedTermSet` glossary (34 indicators
   and 42 metrics) + `BreadcrumbList` on help, and `BreadcrumbList` on legal
   docs. Structured data mirrors the visible help content; eligibility for any
   search rich result is determined by the search platform, not guaranteed here.
4. **Visible, crawlable content** – the landing page includes its product
   overview and feature inventory. The help center contains the FAQ and glossary
   entries that are represented in its structured data; there is no separate
   six-question FAQ section on the landing page.
5. **Crawler hygiene** – `robots.ts` allows crawlable routes and publishes the
   sitemap + host; `sitemap.ts` lists 30 locale×route URLs with lastmod, change
   frequencies and hreflang. Shared terminal query variants are excluded from
   indexing by page metadata, not by blocking the crawler in `robots.txt`.
   Fonts are self-hosted Fontsource assets (no Google Fonts build-time request;
   CJK can fall back to system fonts), with semantic landmarks, one `h1` per
   indexed page, breadcrumb links and `llms.txt` for machine readers.
6. **Delivery and rendering** – static prerender for indexed routes and
   canvas-based chart paint. Automatic ad-delivery scripts are client-side and
   consent-gated; the header banner has non-terminal placements, while sidebar,
   Social Bar and Popunder use separate terminal paths. Smartlink kits are
   first-party files with sponsored partner navigation only after a user click.

## 14. Edge Suite (wave 7) — four chart-analysis modules

The calculations run in the browser using loaded candles and, where relevant,
available public market inputs. These are research aids, not exchange-position
feeds, predictions or guarantees. No user-provided API keys are required.

| Engine | What it does | Where |
| --- | --- | --- |
| **Liq Radar** | Estimates hypothetical 10x/25x/50x/100x liquidation-price zones from recent chart candles, weighted by volume and recency, and draws the strongest local clusters as bands. It does not read exchange positions or report actual liquidation levels. | `src/lib/liqradar.ts`, `LiqMagnetPrimitive` in `primitives.ts` |
| **Lag Oracle** | Cross-correlates your chart against a leader feed (default BTC on a major CEX, loaded only while the modal is open) to find the best candle lag, correlation, beta and jump hit-rate — then raises a live pulse when the leader has moved ≥1.5 σ and your coin has covered <40 % of the expected reaction. | `src/lib/leadlag.ts` |
| **Regime Compass** | Fuses ADX, short/long realized-vol ratio, 50-bar slope and (when live) funding, breadth and 5-min liquidation volume into one of five regimes with confidence + drivers, a rolling regime-history strip and one-click tool recommendations (e.g. liq-storm → Liq magnets + alerts). | `src/lib/regime.ts` |
| **Clock Edge** | Splits loaded candles by UTC hour and weekday, computes win rate and mean forward return per slot with a t-statistic gate (n ≥ 30, |t| ≥ 2) and highlights the current slot. It describes historical patterns; it is not a forecast. | `src/lib/seasonality.ts` |

All four live behind the neon **Edge** dropdown in the toolbar row
(`ToolMenu id="edge"`), are documented in the help center (category
"Edge Suite", 4 topics × 5 locales) and smoke-tested by
`scripts/edge-smoke.entry.ts` (41 offline checks, part of `npm run smoke`).

---

## 15. Roadmap (next parts)

* **Part 2 ✅ shipped** — CEX WebSocket manager (Binance/Bybit/OKX + reconnect + seeding),
  DEX REST aggregator (DexScreener + GeckoTerminal), Smart Search with security audits,
  rate-limit glitch overlay, whale ticker, `useMarketStore` / `useWhaleStore` / `useRateLimitStore`.
* **Part 3 ✅ shipped** — adapter expansion: **12 configured CEX adapters** (including derived
  candles for Coinbase/KuCoin/CoinEx), REST seeds where the browser policy permits, a 33-entry
  canonical chain/alias registry (not a live-coverage guarantee), partial Honeypot.is simulation
  fallback, region-aware candidate ranking + a best-effort per-browser HTTP/WS-opening probe
  (not an ongoing-stream check) + `<ExchangePicker/>`, `useExchangeStore` / `useExchangeSelection`,
  `proxy.ts` country cookie and offline smoke coverage.
* **Wave 3 ✅ shipped (analysis tools)** – bar replay with local indicator
  recomputation, strategy-lab backtester, provider-backed USDT screener with
  ad-hoc charts, provider-snapshot watchlist, risk calculator, CSV export, log/% axes,
  bar-close countdown and baseline charts; plus the support UX (tip-jar modal,
  rotating nudges, session milestones, supporter badge) – see §9 and
  `src/components/support/`.
* **Wave 4 ✅ shipped (market and chart tools)** – exotic chart types (Renko,
  Three-Line-Break, Kagi, Point & Figure), chart-pattern scanner with markers
  and confidence scores, six-timeframe technical-ratings matrix, market heatmap,
  candle trade-detail magnifier where provider data is available, persisted
  multi-condition alerts, trade journal with stats/CSV, custom N-minute
  intervals and regional source fallbacks (Gate→OKX) – see §9, §11 and
  `src/components/tools/`. Coverage, notification behavior and results depend
  on the browser and upstream sources.
* **Wave 5 ✅ shipped (scripting & docs)** – canvas watermark showing
  `www.NodeChart.cc` (`data-watermark` for tests); the **Script Lab** supports
  per-candle formulas, local testing, HTTPS text import (GitHub blob/gist links
  rewritten), local saves and CUSTOM line/price-overlay plots. It is a small
  formula evaluator, not Pine Script; imported/user code is not securely
  sandboxed and the UI warns users to run only trusted code. Help entries for
  indicators, market metrics and the lab are searchable across five locales –
  see §7.1, §9 and `src/lib/scripts.ts`, `src/components/tools/ScriptLabModal.tsx`,
  `src/components/help/`.
* **Wave 7 ✅ shipped (Edge Suite)** – four browser-side analysis modules:
  **Liq Radar** (candle-based hypothetical liquidation zones), **Lag Oracle**
  (historical lead/lag estimates and a conditional pulse), **Regime Compass**
  (five market regimes with confidence, drivers, history and tool suggestions)
  and **Clock Edge** (hour/weekday statistics from loaded candles). They are
  available in the toolbar `Edge` menu and documented in the help center; their
  inputs and outputs remain provider- and history-dependent – see §14.
* **Wave 6 ✅ shipped (clarity + search dominance)** – the terminal toolbar is
  grouped into three accessible dropdown menus (`ToolMenu`: Analyse · Tools ·
  Mehr, `role="menu"` + `aria-pressed` toggles, Escape/outside-click close,
  neon engaged-state on the trigger) so ~26 chips became ~12 calm controls;
  and a systematic SEO programme: JSON-LD graph (Organization, WebSite,
  SoftwareApplication, help-center FAQ, DefinedTermSet glossary, BreadcrumbList),
  crawlable landing features, og:locale alternates, route-specific meta,
  visual breadcrumbs and `llms.txt` for machine readers – audited by
  `scripts/seo-audit.mjs` and `scripts/seo-check.mjs` – see §13.
* **Part 4 ✅ shipped (chart engine)** — `lightweight-charts` canvas terminal with uncroppable
  watermark, editable indicators (technicalindicators) incl. oscillator panes, 1x1/2x1/2x2
  grid with zoom/crosshair/timeframe sync, data-space drawing tools with persistence, mobile
  force-enable gate and CORS-aware browser seeding; browser coverage is in `scripts/browser-check.mjs` and must be rerun for the release candidate.
* **Monetization ✅ shipped** — Adsterra AdManager (native/social bar/popunder, hydration-safe,
  env-gated), ad-block soft-wall + donation wallets, share-to-unlock premium themes,
  OG edge card (§10).
* **Part 5 (next)** — order book + depth ladder, optional KV-backed watchlist sync (subject to
  Cloudflare's current plan limits and pricing), price alerts via service worker, Satori-PNG upgrade
  for `/api/og`.

---

## 16. License — All Rights Reserved (proprietär)

NodeChart ist **keine** Open-Source-Software. Copyright © 2026 AndrexTheDev,
**alle Rechte vorbehalten** (`LICENSE.md`, `package.json: "license":
"UNLICENSED"`, Copyright-Header in jeder Quelldatei):

* Der Code ist auf GitHub **einsehbar** (Transparenz ist Projektdoktrin) —
  darüber hinaus wird **kein Nutzungsrecht** eingeräumt: kein Kopieren, kein
  Modifizieren, keine Derivate, keine Weiterverbreitung, **kein Betreiben
  eigener Instanzen oder SaaS-Klone** ohne schriftliche Genehmigung.
* Namen/Logo/„www.NodeChart.cc"-Wasserzeichen sind markenrechtlich geschützt
  und dürfen nicht entfernt oder geändert werden.
* Verbaute Third-Party-Bibliotheken (Next.js, React, Tailwind, lightweight-charts,
  …) bleiben unter ihren Original-Lizenzen (MIT/Apache-2.0/…) — die Vorbehalte
  gelten ausschließlich für den Eigencode dieses Repos.
* Lizenzanfragen: hippie.highho@gmail.com

## Contact

**AndrexTheDev** — [hippie.highho@gmail.com](mailto:hippie.highho@gmail.com)
