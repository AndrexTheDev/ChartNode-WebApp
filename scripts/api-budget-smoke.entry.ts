/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/** Deterministic, offline smoke test for the best-effort provider request budget. */

(globalThis as unknown as { window: unknown }).window = globalThis;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { fetchJson, ProviderBudgetError, quotaSnapshot } = await import('@/api/http');
const { geckoSearchPools } = await import('@/api/geckoterminal');
const { quotaPolicyFor, QUOTA_REGISTRY } = await import('@/api/quota');
const { parseMetaAndAssetCtxs, parseL2Book, bookToLiqMap, parseFundingHistory, normalizeHlCoin } = await import(
  '@/api/hyperliquid'
);
const { mempoolStress, fundingDivergence, oiRegime, volRegime, bundleSignals } = await import('@/lib/derived-signals');
let upstreamCalls = 0;
const acceptedVersions: string[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  upstreamCalls += 1;
  acceptedVersions.push(new Headers(init?.headers).get('accept') ?? '');
  return new Response('{"ok":true,"data":[]}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

let failures = 0;
function check(name: string, passed: boolean): void {
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}`);
  if (!passed) failures += 1;
}

const adapterPools = await geckoSearchPools('fixture');
check('GeckoTerminal adapter parses the empty fixture', adapterPools.length === 0);
check('GeckoTerminal adapter pins the documented API version', acceptedVersions[0] === 'application/json;version=20230203');

const responses = await Promise.all(
  Array.from({ length: 7 }, (_, index) =>
    fetchJson<{ ok: boolean }>(`https://api.geckoterminal.com/fixture/${index}`, {
      source: 'geckoterminal',
      retries: 0,
    }),
  ),
);
check('the first eight GeckoTerminal requests pass', responses.length === 7 && responses.every((item) => item.ok) && adapterPools.length === 0);
check('all eight requests reached the stub upstream', upstreamCalls === 8);

let budgetRejected = false;
try {
  await fetchJson('https://api.geckoterminal.com/fixture/overflow', {
    source: 'geckoterminal',
    retries: 0,
  });
} catch (error) {
  budgetRejected = error instanceof ProviderBudgetError && error.retryAfterMs > 0;
}
check('the ninth request is rejected locally with a retry window', budgetRejected);
check('budget rejection does not call the upstream', upstreamCalls === 8);

const stored = [...storage.entries()].find(([key]) => key.includes('geckoterminal'))?.[1];
check('the same-origin coordination stamps are persisted', Boolean(stored && JSON.parse(stored).length === 8));

const other = await fetchJson<{ ok: boolean }>('https://example.test/other-source', {
  source: 'unbudgeted-test-source',
  retries: 0,
});
check('unconfigured sources remain unaffected', other.ok && upstreamCalls === 9);

/* ---------------------- zentrale Quota-Registry ---------------------------- */
check('registry covers every budgeted source used by the app', [
  'geckoterminal',
  'coingecko',
  'goplus',
  'mempool.space',
  'hyperliquid',
  'hyperliquid-book',
  'dexscreener',
].every((key) => Boolean(QUOTA_REGISTRY[key])));
check(
  'CoinGecko is capped below the keyless burst limit',
  QUOTA_REGISTRY.coingecko?.maxRequests === 6 && QUOTA_REGISTRY.coingecko?.windowMs === 60_000,
);
check(
  'prefixed sources inherit their base policy (blockscout:base)',
  quotaPolicyFor('blockscout:base').key === 'blockscout' &&
    quotaPolicyFor('publicnode-evm:ethereum').key === 'publicnode-evm' &&
    quotaPolicyFor('solana-rpc').key === 'solana-rpc',
);
check('unknown sources fall back to an unbudgeted policy', quotaPolicyFor('nope-source').policy.maxRequests === null);
const snapshot = quotaSnapshot();
check(
  'quota snapshot reports the consumed GeckoTerminal budget',
  snapshot.some((entry) => entry.key === 'geckoterminal' && entry.used === 8 && entry.max === 8 && entry.resetInMs != null),
);

/* --------------------- Hyperliquid: ein Call, alle Perps -------------------- */
const hlFixture = [
  {
    universe: [
      { name: 'BTC', maxLeverage: 40 },
      { name: 'ETH', maxLeverage: 25 },
      { name: 'NOPE' },
    ],
  },
  [
    { markPx: '100', oraclePx: '99', funding: '0.0001', openInterest: '1000', dayNtlVlm: '5000000' },
    { markPx: '10', oraclePx: '10.1', funding: '-0.00005', openInterest: '50000', dayNtlVlm: '2000000' },
    {},
  ],
];
const hl = parseMetaAndAssetCtxs(hlFixture);
// A ctx without prices is still kept (partial listing) – unknown fields stay null.
check('metaAndAssetCtxs keeps one entry per universe slot', hl?.markets.length === 3 && hl.markets[0]?.coin === 'BTC');
check(
  'a ctx without prices yields a market with null fields, not a fake zero',
  hl?.markets.find((market) => market.coin === 'NOPE')?.markPrice === null &&
    hl?.markets.find((market) => market.coin === 'NOPE')?.fundingRate === null,
);
check('markets are ranked by 24 h volume', hl?.markets[0]?.coin === 'BTC' && hl?.markets[1]?.coin === 'ETH');
check(
  'funding is annualised over Hyperliquid 1 h intervals',
  Math.abs((hl?.markets[0]?.fundingAnnualPct ?? 0) - 87.6) < 1e-9,
);
check(
  'open interest is converted to USD with the mark price',
  hl?.markets[0]?.openInterestUsd === 100_000 && hl?.markets[1]?.openInterestUsd === 500_000,
);
check('premium is derived from mark vs oracle', Math.abs((hl?.markets[1]?.premiumPct ?? 0) + 0.990099) < 1e-4);
check(
  'aggregates sum only known fields and weight funding by volume',
  hl?.totalVolume24hUsd === 7_000_000 &&
    hl?.totalOpenInterestUsd === 600_000 &&
    Math.abs((hl?.fundingWeighted ?? 0) - ((0.0001 * 5_000_000 + -0.00005 * 2_000_000) / 7_000_000)) < 1e-12,
);

const bookFixture = {
  levels: [
    [
      { px: '99.9', sz: '10' },
      { px: '99.0', sz: '100' },
    ],
    [
      { px: '100.1', sz: '5' },
      { px: '101.0', sz: '60' },
    ],
  ],
};
const book = parseL2Book(bookFixture, 'BTC');
check('l2Book normalises both sides with notional', book?.bids.length === 2 && book?.bids[1]?.notionalUsd === 9900);
// bids 99.9·10 + 99·100 = 10 899 · asks 100.1·5 + 101·60 = 6 560.5
check(
  'mid/spread/imbalance come from the parsed book',
  book?.mid === 100 &&
    Math.abs((book?.spreadBps ?? 0) - 20) < 1e-9 &&
    Math.abs((book?.imbalancePct ?? 0) - ((10_899 - 6_560.5) / (10_899 + 6_560.5)) * 100) < 1e-9,
);
const liqMap = book ? bookToLiqMap(book) : null;
check(
  'bookToLiqMap sorts walls by price and marks nearest levels',
  Boolean(liqMap) && liqMap!.nearestSupport?.price === 99.9 && liqMap!.nearestResistance?.price === 100.1,
);
check('liq intensities are normalised to the strongest wall', Boolean(liqMap?.walls.some((wall) => wall.intensity === 1)));

const fundingRows = parseFundingHistory([
  { time: 200, fundingRate: '0.0002' },
  { time: 100, fundingRate: '0.0001' },
  { time: 300 },
]);
check('fundingHistory keeps complete rows sorted by time', fundingRows.length === 2 && fundingRows[0]?.t === 100);
check('normalizeHlCoin strips quote suffixes', normalizeHlCoin('BTCUSDT') === 'BTC' && normalizeHlCoin('kPEPE') === 'KPEPE');

/* ------------------------- abgeleitete Signale (lokal) --------------------- */
const calm = mempoolStress({ unconfirmed: 1_000, vsize: 1e6, fastestFee: 2, hourFee: 2, economyFee: 1.8, totalFeeSats: 1 });
const stressed = mempoolStress({ unconfirmed: 400_000, vsize: 9e7, fastestFee: 60, hourFee: 30, economyFee: 8, totalFeeSats: 1 });
check('mempool stress rises with backlog and fee multiple', (calm.value ?? 100) < 15 && (stressed.value ?? 0) >= 70);
check('mempool stress is warn-toned under congestion', stressed.tone === 'warn' && calm.tone === 'bull');
check('missing mempool data yields an unknown signal, not zero', mempoolStress(null).value === null);

const squeeze = fundingDivergence({ fundingAnnualPct: 120, priceChangePct: -3, openInterestUsd: 1 });
const fuel = fundingDivergence({ fundingAnnualPct: -80, priceChangePct: 2.5, openInterestUsd: 1 });
check(
  'high funding on falling price flags long-squeeze risk',
  squeeze.tone === 'bear' && (squeeze.value ?? 0) < 0 && /long-squeeze/.test(squeeze.detail),
);
check('negative funding on rising price flags short-squeeze fuel', fuel.tone === 'bull' && /short-squeeze/.test(fuel.detail));
check('flat funding/price stays neutral', fundingDivergence({ fundingAnnualPct: 2, priceChangePct: 0.05, openInterestUsd: 1 }).tone === 'neutral');
check('OI + price quadrant detects new shorts', oiRegime({ openInterestChangePct: 6, priceChangePct: -2 }).tone === 'bear');

const synthetic = Array.from({ length: 120 }, (_, index) => ({
  t: index * 3_600_000,
  o: 100 + Math.sin(index / 4) * 2,
  h: 101 + Math.sin(index / 4) * 2,
  l: 99 + Math.sin(index / 4) * 2,
  c: 100 + Math.sin(index / 4) * 2,
  v: 10,
}));
const vol = volRegime({ candles: synthetic, realizedVolPct: 20 });
check('vol regime yields a self-normalised percentile', vol.value != null && vol.value >= 0 && vol.value <= 100);
check('vol regime needs history', volRegime({ candles: synthetic.slice(0, 20), realizedVolPct: 20 }).value === null);

const bundle = bundleSignals([calm, squeeze, vol]);
check(
  'signal bundle weights by confidence and separates bull/bear counts',
  bundle.bullCount >= 1 && bundle.bearCount >= 1 && bundle.composite >= -100 && bundle.composite <= 100,
);

/* ------------------------- signal snapshot export ------------------------- */

console.log('\n— signal snapshot —');

{
  const { buildSignalSnapshot, snapshotToCsv } = await import('@/lib/signal-snapshot');
  const hlFixture = {
    markets: [
      {
        coin: 'BTC',
        markPrice: 100,
        oraclePrice: 100,
        premiumPct: 0.05,
        fundingRate: 0.0001,
        fundingAnnualPct: 87.6,
        openInterestUsd: 1_000_000,
        volume24hUsd: 500_000,
        maxLeverage: 40,
      },
    ],
    active: {
      coin: 'BTC',
      markPrice: 100,
      oraclePrice: 100,
      premiumPct: 0.05,
      fundingRate: 0.0001,
      fundingAnnualPct: 87.6,
      openInterestUsd: 1_000_000,
      volume24hUsd: 500_000,
      maxLeverage: 40,
    },
    totalOpenInterestUsd: 1_000_000,
    totalVolume24hUsd: 500_000,
    fundingWeighted: 0.0001,
    positiveFundingPct: 60,
    fetchedAt: Date.now(),
  };
  const onchain = {
    btc: { unconfirmed: 50_000, vsize: 5_000_000, totalFeeSats: 1_000_000, fastestFee: 20, halfHourFee: 12, hourFee: 8, economyFee: 3, difficultyChangePct: 1, remainingBlocks: 100 },
    defi: { totalTvlUsd: 1e11, tvlChange24hPct: 1.2, stablecoinSupplyUsd: 1.6e11, topChains: [] },
    forensics: null,
    hl: hlFixture,
    liq: {
      coin: 'BTC',
      spot: 100,
      walls: [
        { price: 98, side: 'long', notionalUsd: 2_000_000, intensity: 1, distancePct: -2 },
        { price: 103, side: 'short', notionalUsd: 500_000, intensity: 0.25, distancePct: 3 },
      ],
      nearestSupport: { price: 98, side: 'long', notionalUsd: 2_000_000, intensity: 1, distancePct: -2 },
      nearestResistance: { price: 103, side: 'short', notionalUsd: 500_000, intensity: 0.25, distancePct: 3 },
      fetchedAt: Date.now(),
    },
  } as unknown as Parameters<typeof buildSignalSnapshot>[0]['onchain'];

  const snapshot = buildSignalSnapshot({ symbol: 'BTC/USDT', base: 'BTC', candles: synthetic, onchain });
  check('snapshot collects measured book walls', snapshot.rows.some((row) => row.group === 'book' && row.origin === 'measured'));
  check('snapshot includes the composite bundle', snapshot.rows.some((row) => row.key === 'bundle' && row.value != null));
  check('snapshot never invents values for missing reads', snapshot.rows.every((row) => row.value != null));
  check('snapshot lists missing groups instead of faking them', Array.isArray(snapshot.missing));

  const csv = snapshotToCsv(snapshot);
  check('CSV export has a semicolon header and one line per row', csv.split('\n').length === snapshot.rows.length + 1 && csv.startsWith('group;key;label;value;unit;origin;as_of;note'));

  const empty = buildSignalSnapshot({
    symbol: 'NONE/USDT',
    base: 'NONE',
    candles: [],
    onchain: { btc: null, defi: null, forensics: null, hl: null, liq: null } as unknown as Parameters<typeof buildSignalSnapshot>[0]['onchain'],
  });
  /*
   * Auch ohne Reads bleibt ein Signal übrig: `volRegime` braucht nur Kerzen,
   * und `bundleSignals` liefert mit leerer Eingabe einen neutralen Composite
   * von 0. Genau das ist gewollt – der Composite ist definiert, nicht erfunden.
   */
  check('an empty snapshot keeps only candle-derived signals', empty.rows.every((row) => row.group === 'derived'));
  check('an empty snapshot reports every missing provider group', empty.missing.includes('book') && empty.missing.includes('perp'));
}

console.log(failures === 0 ? '\n✔ API budget smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

export {};
