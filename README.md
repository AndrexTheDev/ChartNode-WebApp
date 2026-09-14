# NodeChart

> **NodeChart – Decode the Market. Free, Fast, Decentralized.**

A 100 % free, client-side TradingView alternative for **CEX & DEX** markets:
**12 centralised exchanges** over WebSocket, **33 chains / 700+ DEXes** over REST, region-aware
venue routing and multi-provider scam audits — all key-less, all in the browser.
Next.js App Router (SSG) · Tailwind cyberpunk design system · Zustand · next-intl (5 locales) ·
deployed to Cloudflare via `@opennextjs/cloudflare` — **$0 backend cost**.

---

## 1. Tech stack & architectural decisions

| Concern | Decision | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router) | Turbopack build, `proxy.ts`, fully static prerendering of all 5 locales |
| Deployment adapter | **`@opennextjs/cloudflare`** | `@cloudflare/next-on-pages` is frozen (caps Next at `<=15.5.2`) and unmaintained. OpenNext is the official successor, runs the Node.js runtime on Workers and supports GitHub → Cloudflare builds. Same $0 free tier. |
| i18n | **next-intl** | `localePrefix: 'always'` ⇒ `/en /de /es /zh /ru`, perfect canonical + hreflang + `og:locale` per language |
| Language auto-detection | **edge `proxy.ts`** (Accept-Language / NEXT_LOCALE cookie) + client `navigator.languages` banner as fallback | No JS needed for the common case; banner only asks once per session and never force-redirects |
| State | **Zustand** (`useAppStore`) with `persist` + `skipHydration` | Selector-scoped subscriptions ⇒ no re-render storms; persisted to localStorage |
| Styling | **Tailwind CSS 3** with a CSS-variable theme layer | Swapping `<html data-theme>` re-skins the whole app without re-rendering React |
| Charts (landing/terminal preview) | deterministic inline-SVG `MockChart` → `LiveCandles` once a feed is live | Seeded PRNG ⇒ SSR markup === client markup, zero hydration mismatch, zero image bytes |
| CEX market data | **direct WebSockets** (Binance · Bybit · OKX) | No backend, no API key, no proxy cost — the browser talks to the exchange |
| DEX market data | **DexScreener + GeckoTerminal REST**, merged & deduped | Covers EVM (ETH/Base/BSC/Arbitrum/Polygon/…) and Solana with one client-side call each |
| Token security | **RugCheck** (Solana) + **GoPlus** (EVM) | Free, key-less audits → instant Safe / Scam-Honeypot verdicts in the search dropdown |
| Rate limiting | global 429 cooldown (`beginCooldown` → overlay → retry) | Public APIs are shared; one 429 blocks *all* callers for 5 s instead of hammering |
| Whale stream | trade channels on the same sockets, ≥ $10 000 notional | Zero extra connections: candles and trades are multiplexed per endpoint |

### Why `proxy.ts` and not `middleware.ts`?
Next.js 16 renamed the file convention (`middleware.ts` → `proxy.ts`, `middleware()` → `proxy()`).
next-intl's `createMiddleware` is used unchanged; only the file name/export contract changed.

### Why a `/terminal` route in Part 1?
The Part-1 brief requires a working **"Launch Terminal"** CTA. A CTA that 404s is a defect, so the
route ships as a *state-driven workspace shell* (toolbar, watchlist, multi-pane grid, layout
switcher). Part 2 added the live feeds on top of it: candle streams, feed-status chip, live SVG
candles, whale ticker and the Smart Search in the header — only the full canvas chart engine
(indicators, drawing tools) is still pending.
It is `noindex` until then. Delete `src/app/[locale]/terminal/` + `src/components/terminal/` if you
prefer to defer it entirely.

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
│   │   ├── exchangeProbe.ts      # measures real latency/reachability of all 12 venues
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
│   │   │              IndicatorModal (unlimited instances, editable params) ·
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
│   │                  address (EVM/Move/TON/Solana CA detection) · chains (33 chains × 4
│   │                  provider mappings) · cex-universe · exchanges (venue metadata) ·
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
npm install            # local dev works on Node >= 20.9
npm run dev            # http://localhost:3000  (Turbopack)
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | local dev server on `0.0.0.0:3000` |

> **Node version:** local `dev`/`build` run on Node ≥ 20.9 (Next's floor). The Cloudflare CI and
> all `cf:*` scripts need **Node 22** (wrangler/miniflare) — the committed `.nvmrc` pins that.
| `npm run build` | plain `next build` (static export of all locales) |
| `npm start` | serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint flat config (`next lint` was removed in Next 16) |
| `npm run check:i18n` | locale bundle parity (keys + `{placeholders}`) |
| `npm run smoke` | live proof: WS adapters + DEX/audit layer (see §6) |
| `npm run ws:smoke` | adapter fixtures + real Binance/Bybit/OKX sockets |
| `npm run api:smoke` | real DexScreener/GeckoTerminal/GoPlus/RugCheck calls + rate-limit + whale filter |
| `npm run cf:build` | `opennextjs-cloudflare build` → `.open-next/` |
| `npm run cf:preview` | build + `wrangler dev` (local Cloudflare runtime) |
| `npm run cf:deploy` | build + `wrangler deploy` |
| `CF_LOCAL_BINDINGS=1 npm run dev` | boot miniflare so KV/D1 bindings exist in dev |

---

## 4. Deploy: GitHub → Cloudflare (free tier)

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
5. Done: every locale is prerendered HTML served from the edge; only language detection and the
   (future) API routes touch compute.

> `wrangler.jsonc` already contains the correct `main`, `assets`, `compatibility_flags`
> (`nodejs_compat`) and commented-out KV/D1 bindings for Part 2. Committing it prevents Wrangler
> from re-auto-configuring your project on deploy.

---

## 5. i18n & SEO guarantees

* **5 locales** — `en de es zh ru`, each with a complete message bundle (300 keys, parity-checked).
* **Static** — every `(locale × route)` pair is prerendered via `generateStaticParams` (36 static pages).
* **`<html lang>`** — exact BCP-47 tags: `en`, `de-DE`, `es-ES`, `zh-Hans`, `ru-RU`.
* **hreflang** — `x-default` + all 5 languages on every page and in `sitemap.xml`.
* **canonical / og:url / og:locale** — per-locale, absolute, derived from `NEXT_PUBLIC_SITE_URL`.
* **Fonts** — self-hosted via `next/font` (Exo 2 + Manrope + JetBrains Mono cover Latin & Cyrillic;
  CJK falls back to system fonts to avoid shipping megabytes).
* **robots/sitemap/manifest/icon.svg** — generated at build time; `/terminal` is `noindex` while the chart engine is pending.

---

## 6. Live data layer (Parts 2–3)

Everything below runs **in the browser** — no server, no API keys, $0 infra.

### 6.1 Endpoints (all verified against production)

| Feed | Endpoint | Notes |
| --- | --- | --- |
| DEX search | `api.dexscreener.com/latest/dex/search`, `/tokens/{addr}` | 300 req/min/IP, results cached 30 s, 33 chains |
| DEX search | `api.geckoterminal.com/api/v2/search/pools`, `/networks/{n}/tokens/{addr}/pools` | 30 calls/min — the tightest limit in the stack, 80 networks |
| EVM audit | `api.gopluslabs.io/api/v1/token_security/{chainId}` | every flag is a **string** (`"1"`/`"0"`); 19 EVM chains (list verified via `/supported_chains`) |
| EVM audit (2nd opinion) | `api.honeypot.is/v2/IsHoneypot?address=…&chainID=…` | key-less on-chain **simulation**; chains 1/56/8453/42161/81457 |
| Solana audit | `api.rugcheck.xyz/v1/tokens/{mint}/report/summary` | `score_normalised` 0–100, **higher = riskier** |
| CEX candle seed | see §6.3 per venue | 300–1000 candles, normalised to ascending open time |
| KuCoin socket URL | `api.kucoin.com/api/v1/bullet-public` | token + `instanceServers[0].endpoint`, POST, no auth |

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
* **Rate limits** — any 429 flips `useRateLimitStore` → `<RateLimitOverlay/>` renders the CSS-glitch
  `RATE LIMIT EXCEEDED / BYPASSING…` panel with a 100 ms-accurate 5 s countdown; the blocked fetch
  *awaits* the cooldown and then retries (2 attempts). Concurrent 429s join the running cooldown
  instead of stacking overlays, and a safety timer guarantees nothing can hang.

### 6.3 Exchange coverage — 12 CEX venues

All public, key-less and free. **Every** one was captured live; the wire payloads are replayed as
fixtures in `npm run ws:smoke`.

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
buckets their trade stream into OHLCV (`CandleDeriver`) and continues the REST-seeded candle instead
of starting a new bucket, so the chart is gap-free and identical in shape to a native feed. The
smoke test asserts rollover *and* seed-continuation.

**Deliberately skipped** (measured, not guessed): MEXC (IP-blocked 403), Bitstamp (invalid
subscription answer), AscendEX (403 on the public socket), Upbit (binary protobuf protocol).

### 6.4 Region-aware routing

```
proxy.ts  →  cf-ipcountry header mirrored into the nc_country cookie (7 d, lax)
           ↘ fallback in the browser: Intl.DateTimeFormat().resolvedOptions().timeZone
```

`detectRegion()` returns `{ country, source }` (`edge` or `timezone`), `isRestrictedIn(exchange,
country)` knows the public geo-blocks (Binance/Bybit/OKX/Gate/HTX/Bitget in the US, Binance in CA/UK
derivatives regions, …), and `exchangeProbe.ts` measures the **real** latency of every venue for the
current pair (REST seed where available, WebSocket handshake for Crypto.com) once per session.

Ranking (`exchange-select.ts`) — lower score wins:

| Contribution | Value |
| --- | --- |
| measured reachable (`ok`) | `0` |
| measured slow (`slow`) | `0.5` |
| unknown / stale | `1` |
| measured unreachable (`blocked`, `error`) | `2` |
| geo-restricted for this country | `+1` |
| latency | `+0 … +0.4` (capped at 1500 ms) |
| liquidity preference rank | `+0.05` per step (binance → okx → bybit → …) |

So a venue one rank down the liquidity list must be ~190 ms faster to win — deep books chart
better, but a genuinely closer exchange (the usual case for non-US users) takes over automatically.
A manual choice in `<ExchangePicker/>` always wins unless that venue is blocked or cannot chart the
timeframe; the picker then shows a "rerouted" chip. **No exchange is ever hidden** — restricted
venues stay selectable because their public market data usually still works.

### 6.5 DEX coverage — 33 chains, 700+ venues

`src/lib/chains.ts` holds four mapping tables, each verified against a live API response:
`GECKO_NETWORK_TO_CHAIN` (80 slugs, incl. `avax`/`xdai`/`sei-network`/`sui-network`),
`CHAIN_TO_GECKO_NETWORK`, `GOPLUS_CHAIN_ID` (19 EVM chains), `HONEYPOT_CHAIN_ID` (5), and
`DEXSCREENER_TO_CHAIN` (34 ids — note Sei is `seiv2`).

Search classification (`src/lib/address.ts`) routes pasted contracts straight to the CA pipeline:
EVM (`0x` + 40 hex), **Sui/Aptos/raw TON** (`0x` + 64 hex, optional `::module::Type` suffix), TON
friendly (`EQ…`/`UQ…`) and Solana (base58). Anything else is a symbol/name search across the CEX
universe (~50 instruments) plus both DEX aggregators.

### 6.6 Security verdicts (`src/api/security.ts`)

| Verdict | Rule |
| --- | --- |
| `danger` (red, pulsing skull) | GoPlus: `is_honeypot`, `cannot_buy`, `cannot_sell_all`, `can_take_back_ownership`, `hidden_owner` = `"1"` or tax > 5 % · honeypot.is: `isHoneypot` or buy/sell tax > 5 % · RugCheck: any risk `level === 'danger'` or `score_normalised > 60` |
| `warn` (amber) | tax > 0, mintable, proxy, not open-source, < 50 holders · RugCheck `score_normalised > 25` or `level === 'warn'` |
| `safe` (green glow) | audited and none of the above |
| `unknown` (muted) | audit failed / chain not supported — never blocks the search |

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
npm run smoke        # ws + api
```

`ws:smoke` replays recorded wire payloads for all 12 adapters, unit-tests `CandleDeriver` and the
HTX gzip path, and then opens **real** sockets (concurrency 4, 14 s per venue):

```
— live public streams (12 venues) —
  PASS  binance    live: 20 candles / 248 trades (last sell @ 78126.23)
  PASS  coinbase   live: 0 candles / 134 trades → 134 derived (last sell @ 78099.89)
  PASS  kucoin     live: 0 candles / 128 trades → 128 derived (last sell @ 78133.7)
  PASS  coinex     live: 0 candles / 103 trades → 24 derived (last buy @ 78124)
  … 12/12 venues streaming
```

`api:smoke` runs the real search + audit + rate-limit + whale + region + ranking paths: multi-chain
CA lookups (Base `AERO`, Sui `CETUS`), live GoPlus audits on `ethereum`/`base`/`berachain`, the
honeypot.is simulation for `PEPE`, timezone→country detection, the scoring unit tests, and finally
`probeAllExchanges` against all 12 venues with the auto-pick assertion. The harnesses are bundled
with esbuild so the production TS sources run unmodified; they are dev-only and never shipped.

---

## 7. Chart engine (Part 4)

The terminal at `/terminal` renders real exchange data on
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5 (the open-source
TradingView canvas engine) — no iframe, no paid widget, no backend. Indicator mathematics comes
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

### 7.2 Indicators — unlimited, editable, multi-pane

* Any number of indicator instances per pane (`useChartStore.indicators`), each with its own
  parameters; instances render as overlay lines (EMA/SMA/Bollinger/VWAP…) or in their own
  oscillator pane (RSI/MACD/Stochastic/ATR/Williams %R/AO/ROC) — `chart.addSeries(def, opts,
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

Browsers enforce CORS on `fetch`, Node does not — four venues (`bybit`, `kucoin`, `coinex`,
`bitfinex`) answer their public REST history **without** `Access-Control-Allow-Origin`, so a page
can never read it, while their WebSocket streams work fine (sockets are not CORS-bound).
NodeChart handles this in two places:

1. `exchangeProbe` treats a CORS rejection (`TypeError`) as inconclusive and falls back to a
   WebSocket-handshake probe, so such venues are ranked by real stream reachability, not
   condemned as dead.
2. `CexSocketManager.seedWithFallback()` seeds the history from the nearest CORS-friendly venue
   (`CORS_FRIENDLY_SEEDS`: binance → okx → kraken → gate → bitget → htx) when the chosen venue's
   REST is unreachable *from the page*. Live updates keep flowing over the chosen venue's socket;
   the status chip discloses the substitute: `Live · Historie via binance`.

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

## 8. On-chain signals (free, keyless, live)

Toolbar toggle **ON-CHAIN** (Radar icon) docks a right-hand panel with real
on-chain readings from seven keyless, CORS-enabled sources. The panel fetches
only while open (15 s heartbeat; per-group deadlines below); closed = zero
requests. Every group fails soft (OFFLINE LED + last good reading).

| Group | Source | Signals | Refresh |
| --- | --- | --- | --- |
| Bitcoin | `mempool.space` | unconfirmed tx, mempool size, fee estimates (express/30 min/economy sat/vB), difficulty adjustment Δ, avg block time | 60 s |
| EVM networks | `eth/base/arbitrum/polygon.blockscout.com` | gas slow→fast (gwei), block utilisation, tx today, avg block time, coin price Δ24h, chain TVL (Base) | 60 s |
| Solana | `solana-rpc.publicnode.com` (batched JSON-RPC) | slot, total TPS, non-vote (user) TPS | 45 s |
| DeFi capital | `api.llama.fi` + `stablecoins.llama.fi` | total TVL + 24 h Δ, global stablecoin supply, top-6 chains by TVL | 5 min |
| DEX heat | `api.geckoterminal.com` + `api.dexscreener.com` | trending pools (eth/solana/base/bsc, h24 Δ + volume), top boosted tokens | 2 min |
| Token forensics | `api.gopluslabs.io` | holder count, buy/sell tax, top-10 holder share, locked LP share, mintable/honeypot badge — for the active DEX token | 10 min |

Implementation notes: `src/api/onchain.ts` (all parsers defensive → `null` on
malformed payloads), `src/store/useOnChainStore.ts` (memory-only, in-flight
guards, per-group deadlines), `src/components/onchain/OnChainPanel.tsx`.
RPC calls go through `fetchJson` with `body` support (POST) added in
`src/api/http.ts`, so timeout + 4 MiB cap + 429 cooldown apply to them too.
Rate-limit budget stays far below every provider's public limit
(≈ 12 req/min worst case while open).

---

## 9. PRO metrics & premium chart analytics (free)

Toolbar toggle **PRO** (Gauge icon) docks the metrics paid terminals sell:

| Group | Source | Signals | Refresh |
| --- | --- | --- | --- |
| Derivatives | `api.gateio.ws` + `www.okx.com` | funding rate (+ annualised), **next-funding countdown**, mark/index + premium %, open interest (USD), long/short (accounts / taker / top traders), liquidations per 5 m (long vs short), **OI / L-S-taker / funding-history sparklines** (30 × 5 m stats + 24 × 8 h settled funding) | 60 s |
| Order flow | `api.gateio.ws` book + **live tape** | best bid/ask, spread (bps), book imbalance (top 50 levels), **cumulative depth chart** (±0.5 % around mid, SVG), session **CVD** + Δ60 s from the whale trade stream (throttled 600 ms) | 15 s |
| Market breadth | `api.gateio.ws` spot tickers | advancers vs decliners across **all ~2 000 quoted USDT pairs**, advancer share bar, median 24 h change (shares the cached heatmap response – zero extra calls) | 5 min |
| Global market | `api.coingecko.com` + `api.alternative.me` | total market cap + 24 h Δ, volume, BTC/ETH dominance, coin count, Fear & Greed + 14-day sparkline | 5 min |
| Heatmap | `api.gateio.ws` spot tickers | top-28 USDT pairs as intensity tiles (change × volume) | 5 min |
| Options & IV | `www.deribit.com` | DVOL implied-vol index (BTC/ETH) + 24 h Δ, put/call open interest, **max pain** computed from the full chain (~950 strikes), pain distance to spot, **IV smile** (OI-weighted mark IV per 10 % moneyness bucket, nearest expiry) + **IV term structure** (ATM band across 10 expiries) | 10 min |

Implementation: `src/api/prometrics.ts`, `src/store/useProStore.ts` (same
open-only-fetch lifecycle as the on-chain panel), `src/components/pro/ProMetricsPanel.tsx`.
CVD accumulates from `tradeBus` in `src/websockets/manager.ts` – zero extra requests.

### Premium chart tools (computed locally, in-canvas)

* **Volume Profile Visible Range** – chip `VP`: price-binned volume histogram
  anchored to the pane edge, POC line + dashed VAH/VAL (70 % value area),
  painted by `VolumeProfilePrimitive` so screenshots keep it.
* **Anchored VWAP** – chip `aVWAP`: arm, click a candle, get the session VWAP
  from that anchor (click chip cycles arm → anchored → cleared).
* **34 indicator kinds** (unlimited instances each): the 7 classics plus
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
  price overlay. Engine: `src/lib/scripts.ts` (`new Function` sandbox without
  DOM/network bindings, 4000-char cap, memoised helper series); UI:
  `src/components/tools/ScriptLabModal.tsx`. This is Pine Script territory –
  tradingview locks custom scripts behind paid plans, here they are free.
* **Auto support/resistance** – chip `S/R Auto`: fractal pivots clustered by
  proximity into the strongest levels, drawn as dashed S/R price lines with
  touch counts (`supportResistance()` in `src/lib/premium.ts`).
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
  transport that hides candles from the right edge while **all 33 indicators,
  the volume profile and S/R recompute live** on the sliced buffer
  (TradingView sells intraday replay as a subscription).
* **Strategy lab (backtester)** – chip `Backtest`: six zero-config strategies
  (EMA cross, RSI reversion, Bollinger reversion, Supertrend flip, MACD cross,
  Donchian breakout) with fees per side, mark-to-market equity curve, win
  rate, profit factor, max drawdown, exposure, and one click to paint every
  round trip onto the chart (`src/lib/backtest.ts`). Deep backtesting is
  Premium/Ultimate territory on TradingView.
* **Market screener** – chip `Screener`: all ~2 000 quoted Gate USDT pairs,
  sortable (price / 24 h % / volume / range position), filterable
  (gainers / losers / whale volume / near high), searchable, CSV-exportable –
  and every row opens a real chart, including ad-hoc pairs outside the seed
  list.
* **Live watchlist** – chip `Watchlist`: unlimited symbols with live quotes
  from the shared ticker sweep (zero extra requests); TradingView caps the
  free tier at one list of 30.
* **Risk & position calculator** – chip `Risk`: account, risk %, entry, stop,
  target, leverage → size, notional, margin, R:R and account impact
  (`src/lib/risk.ts`).
* **QoL pack** – log & percent price scales, countdown to bar close in the
  legend, baseline chart type, OHLCV **CSV export** per pane (TradingView
  charges for data export).
* **Real DEX candles** – DEX tokens chart genuine OHLCV history from
  GeckoTerminal (`fetchDexCandles`), with 15 s retry backoff when the public
  rate limit bites on shared IPs; refresh every 60 s while mounted.

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

## 11. Monetization & survival (ads + donations, no paywalls)

NodeChart stays free to use – no paywalls, no accounts, nothing hidden behind a
plan. Keeping it alive is not free: one dev, server-less but hungry, funded by
Adsterra ad formats plus optional crypto donations; growth comes from a
share-to-unlock loop. Everything here is client-side or edge-side – the
Cloudflare free tier is never left.

### 10.1 Adsterra (AdManager)

Placements are configured purely through environment variables (`.env.example`):

Adsterra bids mobile and desktop traffic separately, so **every format has two
placements and the UI has two containers** (`<AdSlot variant="mobile|desktop"/>`):

| Container / format | Desktop (≥ lg) | Mobile (< lg) |
| --- | --- | --- |
| Native Banner | right rail beside the grid (`data-ad-slot="desktop"`) | horizontal strip between toolbar and grid (`data-ad-slot="mobile"`) |
| Social Bar | `NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP` | `…_SOCIALBAR_MOBILE` |
| Popunder (2x1/2x2 gesture) | `NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP` | `…_POPUNDER_MOBILE` |
| Native placement | `NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP` | `NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE` |

Visibility is pure CSS (`hidden lg:block` / `lg:hidden`), so rotation and
resize flip instantly; the *injection* follows the same breakpoint via
`matchMedia` and lazy-loads the other placement when a visitor crosses it
(proven by `scripts/ad-slots-check.mjs`, incl. the resize flip). The legacy
single-value variables (`…_NATIVE`, `…_SOCIALBAR`, `…_POPUNDER`) still work as
fallback for both devices. `NEXT_PUBLIC_*` values are inlined at build time –
set them in the Cloudflare dashboard **before** building.

`src/lib/ads/adsterra.ts` injects each script exactly once from `useEffect`
(never during render) – server and client HTML stay identical, so there are no
hydration errors and no `next/script` strategy surprises. Containers remember
their script in `data-ad-src`, so breakpoint flips never double-inject, and a
shared fallback URL can serve both slots. Unfilled slots keep a tiny
"GESPONSERT" corner tag so a blocked script never looks like a broken layout. The popunder script
is appended *inside* the multi-chart click handler because Adsterra arms its
popunder on the next observed gesture; a sessionStorage flag caps it at one per
session. With no variables set `ADS_ENABLED` is false: zero slots, zero calls.

### 10.2 Ad-block soft-wall & donations

`src/lib/ads/adblock.ts` combines two signals (DOM bait classes + a self-hosted
`/ads.js` script bait that filter lists cancel). A blocked visitor sees the
cyberpunk soft-wall **"NodeChart is free. Support the rebellion."** after first
paint – never before, never blocking any feature:

* **I have donated** → two-step trust flow (`DonatedFlow`): the button asks for a
  rough size – **up to $5** or **over $5** (self-declared; a $0 backend cannot
  attribute on-chain transactions, and NodeChart keeps no accounts). Either
  choice sets the permanent cosmetic `supporter` badge **and** starts the
  ask-free grace window: **48 h** for any donation, **5 days** above $5.
  While the grace runs, *every* donation ask stays silent – nudge toasts,
  milestone cards, tool nudge, celebration ribbon **and** the soft-wall
  (even via `?adwall=1`): one gate, `donationGraceActive()` in
  `src/store/useViralStore.ts`. Pre-grace legacy profiles migrate once into a
  48-h window instead of being asked again immediately.
* **Dismiss** → 7-day cooldown (`wallDismissedAt`).
* Three donation wallets (SOL / BTC / ETH) with copy-to-clipboard (Clipboard API
  + `execCommand` fallback) and neon "Copied!" feedback.
* `?adwall=1` force-opens the wall (used by the browser proof and for demos).

### 10.3 Viral loop & share-to-unlock

The **Share** button in the terminal toolbar opens a modal that previews the
exact post: *"Found an insane setup for $TICKER on NodeChart. Zero fees,
real-time on-chain data. #Crypto #Trading"* + deep link. X (`intent/tweet`) and
Telegram (`t.me/share/url`) buttons open the intent **and** flip
`useViralStore.shareUnlocked` (persisted as `nc-viral-v1`), which permanently
unlocks the two premium skins **Matrix Green** and **Miami Vice Pink**
(`PREMIUM_THEMES` in `src/lib/theme.ts`). Locked skins show a lock icon in the
theme picker / command palette and open the share modal instead of applying –
the modal immediately offers to apply the freshly unlocked theme.

Shared links carry `?ticker=SOL&price=…`; the terminal reads them at mount and
opens exactly the chart that was posted.

### 10.4 Premium themes

`[data-theme='matrix']` (phosphor CRT, heavy scanlines) and
`[data-theme='miami']` (sunset noir pink/cyan) are full token sets in
`globals.css`; `chart-theme.ts` derives the lightweight-charts options from the
same CSS variables, so candles, watermark and drawings recolour instantly.

### 10.5 Open-Graph edge card (`/api/og`)

`generateMetadata` on `/terminal` emits `og:image` / `twitter:card` pointing at
`/api/og?ticker=…&price=…&locale=…`. The route (`runtime = 'edge'`) renders a
1200×630 cyberpunk card as **pure SVG** (`src/lib/og.ts`, all inputs sanitised +
XML-escaped) – no wasm, no fonts, free-tier safe. Telegram/Discord/Reddit unfurl
it today; swapping the SVG body for a Satori PNG (X/Facebook) is the documented
upgrade path without touching route or meta wiring.

### 10.6 Verification

`chart-smoke` pins the pure logic (share-text template, intent URLs, OG
sanitiser/escaper, premium gating, unlock flow). `browser-check.mjs` proves the
running product: soft-wall copy + wallets + clipboard + cooldown, share modal +
X intent + unlock banner, matrix application, `/api/og` response, dynamic
`og:image` meta and the `?ticker=` deep link.

---

## 12. Security hardening & test matrix

Hardening pass (audited + fixed, all gates re-run green):

| Area | Measure |
| --- | --- |
| Network | `boundedJson()` in `src/api/http.ts` caps every JSON response at **4 MiB** (content-length pre-check + streaming `TextDecoder` guard → `HttpError(413)` on overflow). Timeouts were already in place. |
| localStorage | All three zustand persist stores (`useAppStore`, `useChartStore`, `useViralStore`) have `merge` **sanitizers**: hostile/corrupted payloads (bad theme, layout, timeframe, panes, indicators, drawings, flags) are field-validated against the real enums/validators and fall back to safe values instead of crashing or injecting state. |
| Theme boot | `ThemeBootScript.tsx` re-validates the persisted theme against an allowlist regex before touching `documentElement` (no injection via storage). |
| Headers | `next.config.mjs` sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a restrictive `Permissions-Policy`. **No `X-Frame-Options`/`frame-ancestors`** on purpose: the terminal is meant to be embeddable (previews/widgets). Add them if you deploy a hardened instance. |
| Public dir | Ad test fixtures live in `scripts/fixtures/ads-dev/` (never shipped). `ad-slots-check.mjs` copies them into `public/` only for the proof run. Note: `next start` snapshots `public/` at boot — copy fixtures **before** starting the server. |
| Sharing | Share modal encodes tweet/URL (`encodeURIComponent`), popups use `noopener`; clipboard via in-page stub in tests. |
| Deps | `npm audit --omit=dev`: **0 vulnerabilities**. The 3 dev-only highs sit in `sharp` under `miniflare` ← `wrangler` (local Cloudflare emulator, never shipped, never processes untrusted input). Not force-fixed: `audit fix --force` would pull `wrangler` outside the range supported by `@opennextjs/cloudflare` 1.20.6. |

Test matrix (all green as of this commit):

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | 0 errors |
| Lint | `npx eslint src` | 0 errors |
| i18n parity | `node scripts/check-i18n.mjs` | 1098 keys × 5 locales |
| Unit/smoke (Node) | `npm run smoke` | ws + api + chart smoke ✔ (**211 chart checks** incl. all 34 indicator kinds, wave-2 oscillator maths, S/R clustering, divergence scanner, realized vol, session stats, alert store, **backtester fee/equity/marker proofs for all 6 strategies, risk maths**, **wave-5 script engine: helper maths vs references, error taxonomy, GitHub/gist raw-URL rewriting, script storage cap, CUSTOM store flow, hostile-persist script healing**; 7 live on-chain sources; live PRO-metric checks; **wave-7 edge-smoke: 41 checks** over Liq Radar bucket maths/placement, lead-lag lag+beta+pending pulse, regime classification/drivers/history, seasonality significance gates, edge store flags + persistence) |
| Browser E2E | `node scripts/browser-check.mjs` | **169/169** (on-chain panel, PRO panel incl. countdown/sparklines/depth/breadth/smile/term, VP/aVWAP, S/R + divergence + alert + compare chips, session strip, 12 wave-2 indicators in the modal, replay transport + stepping + playback, strategy lab + markers, 150-row screener, risk calculator, watchlist popover, log/% axes, bar countdown, tip jar + celebration ribbon + usage nudge, wave-4 tools: pattern scanner + marker toggle, ratings matrix, heatmap treemap + tile-load, journal entry + stats, bar magnifier, alert create/persist, Renko & P&F switches, custom 7m legend, **wave-5: `www.NodeChart.cc` watermark attribute, Script Lab open/test/syntax-error/apply → CUSTOM legend chip, CUSTOM tile → lab routing, help center 34 indicator + 42 metric + 3 script docs with badges & search**, **wave-6: toolbar dropdown menus (role=menu, escape/outside close, aria-pressed toggles) + menu-routed tool flows**, **wave-7: Edge menu with all four engines, Liq Radar modal + `data-liq-radar` canvas flag toggle, Lag Oracle live stats + CEX leader select, Regime Compass readout, Clock Edge heatmaps, help Edge-Suite category (4 topics)**, landing survival section + wave-4/5/7 feature grids, DEX candles) |
| SEO audit | `node scripts/seo-audit.mjs` | **~95/95** (per locale: title/description length, canonical, hreflang mesh 5+x-default, OG + locale alternates, twitter card, robots meta, JSON-LD graph types, single h1, visible FAQ, internal links; help: FAQPage+DefinedTermSet+BreadcrumbList; legal breadcrumbs; terminal noindex; robots.txt, sitemap 25 URLs + alternates, llms.txt) |
| Ad containers | `node scripts/ad-slots-check.mjs` (fixture build :3001) | 13/13 |
| Wave-7 QA (modular) | `npm run edge:smoke` + `node scripts/qa-edge-visual.mjs <step>` + `node scripts/qa-i18n-usage.mjs` | **steps 1–10 green (series complete; Step-Protokoll in der Git-Historie)**: Liq Radar 22 engine + 22 browser checks (pixel proof of magnet bands + leverage tags, modal DOM, persistence, sanitizer); Lag Oracle 20 engine + 16 browser checks (beta/hit-rate reconstruction, pulse gates, kline-subscribe lifecycle: leader feed only while the modal is open, unsubscribe on switch/close); Regime Compass 19 engine + 10 browser checks (precedence rules, boundary 80, history windowing, recommendation buttons proven to flip real tool toggles); Clock Edge 16 engine + 11 browser checks (bucket accounting, t-gate positive+negative, now-ring uniqueness, computed tint proof); Edge menu/toolbar 17 browser checks (ARIA semantics, engaged neon lifecycle, viral nudge, 1280/1024/768 layout integrity after a pre-existing header-wrap fix); primitive lifecycle 9 browser checks (setSource(null) clears every band row, theme-palette tint fingerprint acid→matrix→acid, 2x2 all-pane painting, chart-type re-attach, resize); i18n browser sweep 40/40 (5 locales × menu, four modals, help category, landing feature, zero intl errors); mobile & graceful failure 13/13 (390px gate + four modals fit/scroll, total feed outage via patched fetch/WebSocket → pane placeholder + need-hints in all four modals, armed magnets paint nothing, zero crashes); full regression sweep green (tsc, eslint, i18n parity 1098×5, production build, ws/api/chart/edge smoke, beta 30/30, browser-check 169, seo audit); docs & artifacts audit green (feature matrix, 4×5 edge help topics, screenshot inventory, donation-doctrine consistency); 62/62 edge i18n keys ×5 |
| Beta journeys | `npm run beta` (fresh profiles: 5 locales × 4 routes, desktop/mobile newcomer, on-chain + PRO panels incl. wave-2 cards, S/R + divergence + alert tools, ad-block soft-wall, share-unlock, deep link + OG, 404/unknown-locale/hostile-param) | **30/30** |

---

## 13. SEO programme (systematic, audited)

Everything below is verified per locale by `scripts/seo-audit.mjs` against a
running production build – SEO here is measured, not hoped for.

1. **Language mesh** – every route emits canonical + `hreflang` alternates for
   all five locales plus `x-default` (head links *and* sitemap alternates), so
   each language ranks independently instead of cannibalising the others.
   `og:locale` + four `og:locale:alternate` tags tell social platforms the same.
2. **Metadata discipline** – per-locale titles/descriptions from the message
   bundles (descriptions kept inside the 70–170 char snippet window), keyword
   sets, `robots` with `max-image-preview: large` / unlimited snippets,
   Twitter summary-large-image with the dynamic `/api/og` card, terminal
   deliberately `noindex` (client workspace = thin content for crawlers).
3. **Structured data graph** (`src/lib/jsonld.ts` + `<JsonLd/>`):
   `Organization` + `WebSite` site-wide, `SoftwareApplication` (free offer,
   full featureList) and `FAQPage` on the landing, `FAQPage` + `DefinedTermSet`
   glossary (all 34 indicators + 42 metrics) + `BreadcrumbList` on help,
   `BreadcrumbList` on legal docs. Rich-result eligible: FAQ, glossary,
   breadcrumbs, software.
4. **Visible, crawlable content** – the landing FAQ ships as zero-JS
   `<details>` markup in six keyword-rich Q/As per locale (funding model,
   venue coverage, script lab, privacy, TradingView comparison); help docs and
   FAQ mirror 1:1 into schema so nothing is cloaked.
5. **Crawler hygiene** – `robots.ts` (allow all, workspace disallowed, sitemap
   + host), `sitemap.ts` (25 URLs, lastmod, change frequencies, hreflang),
   self-hosted `next/font` subsets (no external font requests, no CLS),
   semantic landmarks, exactly one `h1` per indexed page, breadcrumb navs as
   internal links, `llms.txt` so AI answer engines cite NodeChart correctly.
6. **Performance = ranking** – static prerender for all indexed routes,
   canvas-only chart paint (no DOM churn), zero third-party scripts on
   indexed pages (ads load client-side on the terminal only).

## 14. Edge Suite (wave 7) — four signals no classic chart app ships

Everything below runs 100 % client-side on the candles your feed already
delivers. No exchange positioning data, no paid tiers, no keys.

| Engine | What it does | Where |
| --- | --- | --- |
| **Liq Radar** | Projects where 10x/25x/50x/100x positions opened in the last 400 candles would liquidate, weights them by volume + exponential recency decay and draws the strongest clusters as magnet bands on the canvas (leverage tags left, intensity right). Modal lists the three nearest long/short magnets with distance + strength. | `src/lib/liqradar.ts`, `LiqMagnetPrimitive` in `primitives.ts` |
| **Lag Oracle** | Cross-correlates your chart against a leader feed (default BTC on a major CEX, loaded only while the modal is open) to find the best candle lag, correlation, beta and jump hit-rate — then raises a live pulse when the leader has moved ≥1.5 σ and your coin has covered <40 % of the expected reaction. | `src/lib/leadlag.ts` |
| **Regime Compass** | Fuses ADX, short/long realized-vol ratio, 50-bar slope and (when live) funding, breadth and 5-min liquidation volume into one of five regimes with confidence + drivers, a rolling regime-history strip and one-click tool recommendations (e.g. liq-storm → Liq magnets + alerts). | `src/lib/regime.ts` |
| **Clock Edge** | Splits your loaded candles by UTC hour and weekday, computes win-rate + mean forward return per slot with a t-statistic gate (n ≥ 30, |t| ≥ 2) and highlights the current hour/weekday — your personal seasonality, never a sold indicator. | `src/lib/seasonality.ts` |

All four live behind the neon **Edge** dropdown in the toolbar row
(`ToolMenu id="edge"`), are documented in the help center (category
"Edge Suite", 4 topics × 5 locales) and smoke-tested by
`scripts/edge-smoke.entry.ts` (41 offline checks, part of `npm run smoke`).

---

## 15. Roadmap (next parts)

* **Part 2 ✅ shipped** — CEX WebSocket manager (Binance/Bybit/OKX + reconnect + seeding),
  DEX REST aggregator (DexScreener + GeckoTerminal), Smart Search with security audits,
  rate-limit glitch overlay, whale ticker, `useMarketStore` / `useWhaleStore` / `useRateLimitStore`.
* **Part 3 ✅ shipped** — coverage explosion: **12 CEX adapters** (incl. derived candles for
  Coinbase/KuCoin/CoinEx), REST seeds for all of them, 33-chain DEX registry, honeypot.is as a second
  audit opinion, region-aware venue ranking + live latency probe + `<ExchangePicker/>`,
  `useExchangeStore` / `useExchangeSelection`, `proxy.ts` country cookie, 96 smoke assertions.
* **Wave 3 ✅ shipped (TV-premium killer)** – bar replay with live indicator
  recomputation, strategy-lab backtester, 2 000-pair screener with ad-hoc
  charts, unlimited live watchlist, risk calculator, CSV export, log/% axes,
  bar-close countdown, baseline charts; plus the survival UX (tip-jar modal,
  rotating nudges, session milestones, premium-celebration ribbon, SUPPORTER
  badge) and the landing survival section – see §9 and `src/components/support/`.
* **Wave 4 ✅ shipped (TV-ultimate killer)** – exotic chart types (Renko,
  Three-Line-Break, Kagi, Point & Figure) on every timeframe, auto chart-pattern
  scanner with on-chart markers + confidence list (TV: Ultimate $239.95),
  six-timeframe technical-ratings matrix with gauge, market heatmap treemap
  (click-to-load), bar magnifier over the raw trade tape (taker delta + whale
  prints), unlimited persisted multi-condition alerts with browser
  notifications + beep, trade journal with stats & CSV (TV has none), custom
  N-minute intervals (TV: Essential+), regional source fallbacks (Gate→OKX) and
  the usage-based tip nudge after six tools per session – see §9, §11 and
  `src/components/tools/`.
* **Wave 5 ✅ shipped (scripting & docs)** – TradingView-style canvas watermark
  showing exactly `www.NodeChart.cc` (centred, auto-fitted, collision-free,
  `data-watermark` for tests), the **Script Lab**: write per-candle indicator
  formulas, test them live, import via https raw URLs (GitHub blob/gist links
  auto-rewritten), save locally and plot them as CUSTOM line or price overlay –
  Pine without the paywall; and the help center now documents **every one of
  the 34 indicators, all 42 market metrics and the lab itself in all five
  languages** (searchable + category-filterable, generated from the i18n
  bundles so nothing can drift) – see §7.1, §9 and `src/lib/scripts.ts`,
  `src/components/tools/ScriptLabModal.tsx`, `src/components/help/`.
* **Wave 7 ✅ shipped (Edge Suite)** – four in-house signal engines that turn
  your own candles into edges classic charting does not sell at any tier:
  **Liq Radar** (liquidation-magnet bands on the canvas, 10x–100x projection
  with recency-decayed volume mass), **Lag Oracle** (leader/follower lag,
  beta + live "jump only partly followed" pulse), **Regime Compass**
  (five market regimes with confidence, drivers, history strip + one-click
  tool recommendations) and **Clock Edge** (t-gated hour/weekday seasonality
  heatmaps). Toolbar `Edge` menu, help center category, 41 offline smoke
  checks and full ×5-locale copy – see §14.
* **Wave 6 ✅ shipped (clarity + search dominance)** – the terminal toolbar is
  grouped into three accessible dropdown menus (`ToolMenu`: Analyse · Tools ·
  Mehr, `role="menu"` + `aria-pressed` toggles, Escape/outside-click close,
  neon engaged-state on the trigger) so ~26 chips became ~12 calm controls;
  and a systematic SEO programme: JSON-LD graph (Organization, WebSite,
  SoftwareApplication, FAQPage, DefinedTermSet glossary, BreadcrumbList),
  visible keyword-rich FAQ on the landing (zero-JS `<details>`, ×5 locales),
  og:locale alternates, trimmed meta descriptions, visual breadcrumbs,
  `llms.txt` for AI answer engines – audited by `scripts/seo-audit.mjs`
  (~95 checks across 5 locales × 4 routes) – see §13.
* **Part 4 ✅ shipped (chart engine)** — `lightweight-charts` canvas terminal with uncroppable
  watermark, unlimited editable indicators (technicalindicators) incl. oscillator panes, 1x1/2x1/2x2
  grid with zoom/crosshair/timeframe sync, data-space drawing tools with persistence, mobile
  force-enable gate, CORS-aware browser seeding; browser-verified via Puppeteer (§7).
* **Monetization ✅ shipped** — Adsterra AdManager (native/social bar/popunder, hydration-safe,
  env-gated), ad-block soft-wall + donation wallets, share-to-unlock premium themes,
  OG edge card (§10).
* **Part 5 (next)** — order book + depth ladder, optional KV-backed watchlist sync (free tier),
  price alerts via service worker, Satori-PNG upgrade for `/api/og`.

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
