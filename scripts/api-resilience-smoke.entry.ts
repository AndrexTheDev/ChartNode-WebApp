/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/** Deterministic provider fixtures for graceful degradation and fallbacks. */

(globalThis as unknown as { window: unknown }).window = globalThis;
const persistedFixture = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => persistedFixture.get(key) ?? null,
    setItem: (key: string, value: string) => persistedFixture.set(key, value),
    removeItem: (key: string) => persistedFixture.delete(key),
  },
});

let staleFixtureDown = false;
const OPEN_SOURCE = '0x000000000000000000000000000000000000a001';
const CLOSED_SOURCE = '0x000000000000000000000000000000000000a002';
const PARTIAL_AUDIT = '0x000000000000000000000000000000000000a003';
const GOPLUS_DOWN = '0x000000000000000000000000000000000000a004';
const FORENSICS_DOWN = '0x000000000000000000000000000000000000a005';
const FULL_FLAGS = {
  is_honeypot: '0',
  cannot_buy: '0',
  cannot_sell_all: '0',
  can_take_back_ownership: '0',
  hidden_owner: '0',
  is_mintable: '0',
  is_proxy: '0',
  is_open_source: '1',
  buy_tax: '0',
  sell_tax: '0',
  holder_count: '1000',
};

let failures = 0;
function check(name: string, passed: boolean): void {
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}`);
  if (!passed) failures += 1;
}

const requests: string[] = [];
const simulationCalls: string[] = [];
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input);
  requests.push(`${url.hostname}${url.pathname}`);
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;

  if (url.hostname === 'stale.test') {
    return staleFixtureDown
      ? json({ error: 'fixture upstream unavailable' }, 501)
      : json({ source: 'fresh-fixture' });
  }

  if (url.hostname === 'api.gopluslabs.io') {
    const address = (url.searchParams.get('contract_addresses') ?? '').toLowerCase();
    if (address === GOPLUS_DOWN || address === FORENSICS_DOWN) return json({ error: 'fixture unavailable' }, 501);
    const row = address === OPEN_SOURCE
      ? FULL_FLAGS
      : address === CLOSED_SOURCE
        ? { ...FULL_FLAGS, is_open_source: '0' }
        : address === PARTIAL_AUDIT
          ? { is_open_source: '1' }
          : null;
    return json({ code: 1, result: row ? { [address]: row } : {} });
  }

  if (url.hostname === 'api.honeypot.is') {
    const address = (url.searchParams.get('address') ?? '').toLowerCase();
    simulationCalls.push(address);
    return json({
      simulationSuccess: true,
      honeypotResult: { isHoneypot: false },
      simulationResult: { buyTax: 0, sellTax: 0 },
      summary: { risk: 'low' },
    });
  }

  if (url.hostname === 'mempool.space') return json({ error: 'fixture unavailable' }, 501);
  if (url.hostname === 'blockstream.info' && url.pathname === '/api/mempool') {
    return json({ count: 123, vsize: 1_234_000, total_fee: 42_000 });
  }
  if (url.hostname === 'blockstream.info' && url.pathname === '/api/fee-estimates') {
    return json({ '1': 15, '3': 12, '6': 9, '24': 4 });
  }

  if (url.hostname === 'eth.blockscout.com') {
    return json({ gas_prices: { average: '12.5' }, network_utilization_percentage: null });
  }
  if (url.hostname === 'base.blockscout.com') return json({ error: 'fixture unavailable' }, 501);
  if (url.hostname === 'base-rpc.publicnode.com') {
    const rpcBody = (Array.isArray(body) ? body[0] : body) as { id?: number; method?: string } | null;
    if (rpcBody?.method === 'eth_gasPrice') {
      return json({ jsonrpc: '2.0', id: 1, result: '0x3b9aca00' });
    }
  }

  if (url.hostname === 'solana-rpc.publicnode.com') return json({ error: 'batch unavailable' }, 501);
  if (url.hostname === 'api.mainnet-beta.solana.com') {
    const rpcBody = (Array.isArray(body) ? body[0] : body) as { id?: number; method?: string } | null;
    if (rpcBody?.method === 'getSlot') return json({ jsonrpc: '2.0', id: 1, result: 321 });
    if (rpcBody?.method === 'getRecentPerformanceSamples') {
      return json({
        jsonrpc: '2.0',
        id: 2,
        result: [{ numTransactions: 100, numNonVoteTransactions: 50, samplePeriodSecs: 5 }],
      });
    }
  }

  if (url.hostname === 'api.llama.fi' && url.pathname === '/v2/chains') {
    return json([{ name: 'Fixture Chain', tvl: 5_000_000_000 }]);
  }
  if (url.hostname === 'api.llama.fi' && url.pathname === '/v2/historicalChainTvl') {
    return json({ error: 'fixture unavailable' }, 501);
  }
  if (url.hostname === 'stablecoins.llama.fi') {
    return json({ peggedAssets: [{ circulating: { peggedUSD: 1_250_000_000 } }] });
  }

  if (url.hostname === 'api.coingecko.com') return json({ error: 'fixture unavailable' }, 501);
  if (url.hostname === 'api.alternative.me') {
    return json({ data: [
      { value: '51', value_classification: 'Neutral' },
      { value: '49', value_classification: 'Fear' },
    ] });
  }

  if (url.hostname === 'api.gateio.ws' && url.pathname === '/api/v4/futures/usdt/contracts/BTC_USDT') {
    return json({
      funding_rate: '0.0001',
      funding_interval: 43_200,
      funding_next_apply: 1_800_000_000,
      index_price: '99',
      mark_price: '100',
    });
  }
  if (url.hostname === 'api.gateio.ws' && url.pathname === '/api/v4/futures/usdt/contract_stats') {
    return json([{ open_interest: 100, open_interest_usd: 12_345, lsr_account: 1.2 }]);
  }
  if (url.hostname === 'api.gateio.ws' && url.pathname.endsWith('/order_book')) {
    return json({ error: 'fixture unavailable' }, 501);
  }
  if (url.hostname === 'api.gateio.ws' && url.pathname.endsWith('/tickers')) {
    return json({ error: 'fixture unavailable' }, 501);
  }
  if (url.hostname === 'www.okx.com' && url.pathname === '/api/v5/public/open-interest') {
    return json({ code: '0', data: [] });
  }
  if (url.hostname === 'www.okx.com' && url.pathname === '/api/v5/public/funding-rate') {
    return json({ code: '0', data: [] });
  }
  if (url.hostname === 'www.okx.com' && url.pathname === '/api/v5/market/books') {
    return json({ code: '0', data: [{ bids: [['100', '2']], asks: [['102', '1']] }] });
  }
  if (url.hostname === 'www.okx.com' && url.pathname === '/api/v5/market/tickers') {
    return json({ code: '0', data: [
      { instId: 'BTC-USDT', last: '102', open24h: '100', volCcy24h: '1000000', high24h: '110', low24h: '90' },
      { instId: 'ETH-USDT', last: '90', open24h: '100', volCcy24h: '500000', high24h: '105', low24h: '85' },
      { instId: 'ZERO-USDT', last: '4', open24h: '0', volCcy24h: '100', high24h: '4', low24h: '4' },
    ] });
  }
  if (url.hostname === 'www.deribit.com' && url.pathname.endsWith('/get_volatility_index_data')) {
    const latest = url.searchParams.get('currency') === 'ETH' ? 44 : 55;
    const previous = latest - 5;
    return json({ result: { data: [[1, previous, previous, previous, previous], [2, latest, latest, latest, latest]] } });
  }
  if (url.hostname === 'www.deribit.com' && url.pathname.endsWith('/get_book_summary_by_currency')) {
    return json({ result: [
      { instrument_name: 'BTC-25DEC26-90000-P', open_interest: 2, underlying_price: 100000, mark_iv: 50 },
      { instrument_name: 'BTC-25DEC26-110000-C', open_interest: 6, underlying_price: 100000, mark_iv: 48 },
    ] });
  }

  if (url.hostname === 'api.geckoterminal.com') return json({ error: 'fixture unavailable' }, 501);
  if (url.hostname === 'api.dexscreener.com' && url.pathname === '/token-boosts/top/v1') {
    return json([{ chainId: 'base', tokenAddress: OPEN_SOURCE, totalAmount: 12, description: 'fixture boost' }]);
  }

  return json({ error: `unhandled fixture: ${url.hostname}${url.pathname}` }, 501);
}) as typeof fetch;

const { fetchJson } = await import('@/api/http');
const { auditToken } = await import('@/api/security');
const { fetchBtcSignals, fetchDefiSignals, fetchDexHeat, fetchEvmChainSignals, fetchSolanaSignals, fetchTokenForensics } =
  await import('@/api/onchain');
const { fetchBreadth, fetchDerivSignals, fetchFlowSignals, fetchGlobalSignals, fetchHeatmap, fetchScreenerRows, fetchVolSignals } = await import('@/api/prometrics');

console.log('\n— shared transport cache and stale-source disclosure —');
const freshSeed = await fetchJson<{ source: string }>('https://stale.test/seed', {
  source: 'stale-fixture', retries: 0, persistKey: 'resilience-seed', staleTtlMs: 60_000,
});
staleFixtureDown = true;
let staleAgeMs: number | null = null;
const cachedSeed = await fetchJson<{ source: string }>('https://stale.test/seed', {
  source: 'stale-fixture', retries: 0, persistKey: 'resilience-seed', staleTtlMs: 60_000,
  onStale: (ageMs) => { staleAgeMs = ageMs; },
});
check('persisted candle fallback reports its stale age while preserving the cached value', freshSeed.source === 'fresh-fixture' && cachedSeed.source === 'fresh-fixture' && staleAgeMs != null && staleAgeMs >= 0);

console.log('\n— token-risk semantics and partial-result safety —');
const open = await auditToken('ethereum', OPEN_SOURCE);
check('GoPlus is_open_source="1" means open source, not a warning', open?.verdict === 'safe' && !open.flags.includes('not-open-source'));
const closed = await auditToken('ethereum', CLOSED_SOURCE);
check('GoPlus is_open_source="0" adds a closed-source warning', closed?.verdict === 'warn' && closed.flags.includes('not-open-source'));
const partial = await auditToken('ethereum', PARTIAL_AUDIT);
check('a sparse GoPlus row stays unknown after a low-risk simulation', partial?.verdict === 'unknown' && partial.riskScore === null && partial.flags.includes('partial-goplus-data'));
const fallbackAudit = await auditToken('ethereum', GOPLUS_DOWN);
check('GoPlus outage may return a Honeypot simulation as partial, not clean', fallbackAudit?.provider === 'honeypot' && fallbackAudit.verdict === 'unknown' && fallbackAudit.flags.includes('goplus-unavailable'));
check('static-clean rows do not fan out to unnecessary simulations', !simulationCalls.includes(OPEN_SOURCE) && !simulationCalls.includes(CLOSED_SOURCE));

console.log('\n— on-chain independent fallback and partial fields —');
const btc = await fetchBtcSignals();
check('Blockstream fills missing mempool and fee data; difficulty remains null', btc?.unconfirmed === 123 && btc.fastestFee === 15 && btc.difficultyChangePct === null);
const evm = await fetchEvmChainSignals('ethereum');
check('Blockscout partial response preserves known gas and leaves other fields null', evm?.gasAverage === 12.5 && evm.gasFast === null && evm.coinPriceUsd === null);
const solana = await fetchSolanaSignals();
check('Solana public RPC batch failure falls back to separate official RPC calls', solana?.slot === 321 && solana.tps === 20 && solana.nonVoteTps === 10);
const defi = await fetchDefiSignals();
check('DeFiLlama partial endpoints preserve chain TVL and stablecoin supply', defi?.totalTvlUsd === null && defi.topChains[0]?.tvlUsd === 5_000_000_000 && defi.stablecoinSupplyUsd === 1_250_000_000);
const forensics = await fetchTokenForensics('base', FORENSICS_DOWN);
check('Honeypot forensics retains taxes while unknown holder/LP/mint fields stay null', forensics?.provider === 'honeypot' && forensics.buyTaxPct === 0 && forensics.holderCount === null && forensics.lpLockedPct === null && forensics.isMintable === null);

console.log('\n— PRO source fallback and independent global data —');
const deriv = await fetchDerivSignals('BTC');
check('Gate open interest uses provider USD notional and exact 12-hour funding interval', deriv?.openInterestUsd === 12_345 && Math.abs((deriv?.fundingAnnualPct ?? 0) - 7.3) < 1e-9 && deriv?.nextFundingTime === 1_800_000_000_000);
const global = await fetchGlobalSignals();
check('Fear & Greed survives CoinGecko failure without inventing global market cap', global?.totalMcapUsd === null && global.fngValue === 51 && global.fngHistory.join(',') === '49,51');
const flow = await fetchFlowSignals('BTC');
check('OKX order book fills Gate outage and labels the actual source', flow?.source === 'okx' && flow.bestBid === 100 && flow.bestAsk === 102);
const heatmap = await fetchHeatmap(undefined, 3);
check('OKX ticker fallback retains source and leaves an unavailable 24 h change unknown', heatmap.length === 3 && heatmap[0]?.pair === 'BTC/USDT' && heatmap[0]?.changePct === 2 && heatmap[0]?.source === 'okx' && heatmap[2]?.changePct === null);
const screener = await fetchScreenerRows();
check('screener carries OKX provenance and missing change/range stay unknown', screener.length === 3 && screener.every((row) => row.source === 'okx') && screener[0]?.rangePos === 0.6 && screener.find((row) => row.pair === 'ZERO/USDT')?.changePct === null && screener.find((row) => row.pair === 'ZERO/USDT')?.rangePos === null);
const breadth = await fetchBreadth();
check('breadth counts only provider-reported changes and reports its source', breadth?.source === 'okx' && breadth.total === 2 && breadth.advancers === 1 && breadth.decliners === 1 && breadth.advPct === 50);
const dexHeat = await fetchDexHeat();
check('DexScreener boosts survive a GeckoTerminal outage', dexHeat.pools.length === 0 && dexHeat.boosts.length === 1 && dexHeat.boosts[0]?.chainId === 'base');
const vol = await fetchVolSignals();
check('Deribit call/put open-interest ratio uses calls divided by puts', vol?.callPutOi === 3);
check('DVOL is read as implied-volatility index data, separate from options open interest', vol?.dvolBtc === 55 && vol.dvolEth === 44 && vol.dvolBtcChange24h === 10);
check('max pain is calculated from the returned option open-interest snapshot', vol?.maxPain === 90_000);

console.log(`\n${failures === 0 ? '✔ API resilience smoke OK' : `✖ ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);

export {};
