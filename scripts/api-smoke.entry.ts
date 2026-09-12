/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Live smoke test for the DEX aggregator + security audit + rate-limit layer
 * (dev-only harness, not shipped). Hits the real public APIs exactly the way
 * the browser does: DexScreener, GeckoTerminal, GoPlus, RugCheck.
 *
 * Run with: npm run api:smoke
 */

// `window.setTimeout` is used by the rate-limit controller.
(globalThis as unknown as { window: unknown }).window = globalThis;

// Node 20 has no global WebSocket – the venue probe needs one for Crypto.com,
// whose REST API is unreachable and whose candles arrive over the socket.
const nodeRequire = (await import('node:module')).createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as { WebSocket: unknown };
(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;

const { smartSearch } = await import('@/api/search');
const { auditToken, isAuditableChain } = await import('@/api/security');
const { beginCooldown, endCooldown, isCoolingDown } = await import('@/api/rateLimit');
const { useRateLimitStore } = await import('@/store/useRateLimitStore');
const { classifyQuery } = await import('@/lib/address');

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}`);
  if (!condition) failures += 1;
}

const PEPE = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

/* ------------------------------ query classify ----------------------------- */
console.log('\n— query classification —');
check('evm address', classifyQuery(PEPE) === 'evm');
check('solana mint', classifyQuery(BONK) === 'solana');
check('plain text', classifyQuery('pepe') === 'text');
check('padded input', classifyQuery(`  ${PEPE}  `) === 'evm');

/* --------------------------------- smart search ---------------------------- */
console.log('\n— smart search (live) —');

const text = await smartSearch('sol');
const textCex = text.hits.filter((hit) => hit.kind === 'cex');
const textDex = text.hits.filter((hit) => hit.kind === 'dex');
check(
  `text "sol" → ${textCex.length} CEX + ${textDex.length} DEX hits in ${text.tookMs} ms`,
  textCex.length > 0 && textDex.length > 0,
);
if (textCex.length > 0) {
  const first = textCex[0];
  console.log(`        cex #1: ${first?.kind === 'cex' ? `${first.symbol} (${first.name})` : '?'}`);
}
for (const hit of textDex.slice(0, 3)) {
  if (hit.kind !== 'dex') continue;
  const p = hit.pair;
  console.log(`        dex   : ${p.chain}/${p.dex} ${p.baseSymbol}-${p.quoteSymbol} $${p.priceUsd} liq $${p.liquidityUsd}`);
}

const evmResult = await smartSearch(PEPE);
const evmDex = evmResult.hits.filter((hit) => hit.kind === 'dex');
check(`EVM CA lookup → ${evmDex.length} pool(s), kind=${evmResult.kind}`, evmResult.kind === 'evm' && evmDex.length > 0);
{
  const first = evmDex[0];
  if (first?.kind === 'dex') {
    const p = first.pair;
    console.log(`        best: ${p.chain}/${p.dex} ${p.baseSymbol}/${p.quoteSymbol} $${p.priceUsd} liq $${p.liquidityUsd} vol24h $${p.volume24h}`);
    check('CA hit points back at the queried contract', p.baseAddress.toLowerCase() === PEPE.toLowerCase());
  }
}

const solResult = await smartSearch(BONK);
const solDex = solResult.hits.filter((hit) => hit.kind === 'dex');
check(`Solana mint lookup → ${solDex.length} pool(s), kind=${solResult.kind}`, solResult.kind === 'solana' && solDex.length > 0);
{
  const first = solDex[0];
  if (first?.kind === 'dex') {
    console.log(`        best: ${first.pair.chain}/${first.pair.dex} ${first.pair.baseSymbol}/${first.pair.quoteSymbol} $${first.pair.priceUsd}`);
  }
}

// The merged list dedupes by pool, so ask both aggregators directly.
const { dexscreenerByToken, dexscreenerSearch } = await import('@/api/dexscreener');
const { geckoPoolsByToken, geckoSearchPools } = await import('@/api/geckoterminal');

const [ds, gt, dsSearch, gtSearch] = await Promise.all([
  dexscreenerByToken([PEPE]),
  geckoPoolsByToken('ethereum', PEPE),
  dexscreenerSearch('pepe'),
  geckoSearchPools('pepe'),
]);
check(`DexScreener token lookup → ${ds.length} pair(s)`, ds.length > 0);
check(`GeckoTerminal pools → ${gt.length} pool(s)`, gt.length > 0);
check(`DexScreener search → ${dsSearch.length} pair(s)`, dsSearch.length > 0);
check(`GeckoTerminal search → ${gtSearch.length} pool(s)`, gtSearch.length > 0);
if (ds.length > 0 && gt.length > 0) {
  const a = ds[0]!;
  const b = gt[0]!;
  console.log(`        dexscreener: ${a.chain}/${a.dex} ${a.baseSymbol}/${a.quoteSymbol} $${a.priceUsd} liq $${a.liquidityUsd}`);
  console.log(`        geckoterm. : ${b.chain}/${b.dex} ${b.baseSymbol}/${b.quoteSymbol} $${b.priceUsd} liq $${b.liquidityUsd}`);
}

/* ------------------------------ security audits ---------------------------- */
console.log('\n— security audits (live) —');

const goplus = await auditToken('ethereum', PEPE);
check(
  `GoPlus/ethereum PEPE → ${goplus?.verdict ?? 'unaudited'} risk=${goplus?.riskScore ?? '-'} flags=[${goplus?.flags.join(',') ?? ''}]`,
  goplus !== null && goplus.provider === 'goplus' && goplus.verdict !== 'danger',
);

const rug = await auditToken('solana', BONK);
check(
  `RugCheck/solana BONK → ${rug?.verdict ?? 'unaudited'} risk=${rug?.riskScore ?? '-'} flags=[${rug?.flags.join(',') ?? ''}]`,
  rug !== null && rug.provider === 'rugcheck' && rug.verdict !== 'danger',
);

const empty = await auditToken('ethereum', '0x0000000000000000000000000000000000000001');
check(
  `unknown contract never throws (${empty === null ? 'null' : empty.verdict})`,
  empty === null || typeof empty.verdict === 'string',
);

const cached = await auditToken('ethereum', PEPE);
check('audit cache returns the identical verdict', cached?.verdict === goplus?.verdict && cached?.checkedAt === goplus?.checkedAt);

check(
  'chain gate: solana + EVM auditable, others not',
  isAuditableChain('solana') && isAuditableChain('base') && isAuditableChain('bsc') && !isAuditableChain('bitcoin'),
);

/* -------------------------------- rate limit ------------------------------- */
console.log('\n— rate-limit controller —');

void beginCooldown('smoke');
check('429 → cooldown active + source stored', isCoolingDown() && useRateLimitStore.getState().source === 'smoke');
check('deadline is ~5 s ahead', useRateLimitStore.getState().deadline - Date.now() > 4_000);
void beginCooldown('geckoterminal');
check('concurrent 429 joins the running cooldown (no stacking)', useRateLimitStore.getState().hits === 2);
endCooldown();
check('countdown end → cooldown cleared', !isCoolingDown() && useRateLimitStore.getState().source === null);

/* -------------------------------- whale filter ----------------------------- */
console.log('\n— whale tracker ($10 000 threshold) —');

const { whaleTracker } = await import('@/websockets/whale');
const { useWhaleStore } = await import('@/store/useWhaleStore');

useWhaleStore.getState().clear();
useWhaleStore.getState().setEnabled(true);
check('default threshold is 10 000 USD', useWhaleStore.getState().thresholdUsd === 10_000);

const now = Date.now();
whaleTracker.observe({ exchange: 'binance', symbol: 'BTC/USDT', price: 78_000, qty: 0.05, side: 'buy', ts: now }); // 3 900 → ignored
whaleTracker.observe({ exchange: 'binance', symbol: 'BTC/USDT', price: 78_000, qty: 0.5, side: 'buy', ts: now + 1 }); // 39 000 → whale
whaleTracker.observe({ exchange: 'okx', symbol: 'ETH/USDT', price: 3_000, qty: 10, side: 'sell', ts: now + 2 }); // 30 000 → whale

await new Promise((resolve) => setTimeout(resolve, 700)); // FLUSH_MS = 400

const whales = useWhaleStore.getState().trades;
check(`only ≥ $10k trades reach the ticker (${whales.length}/3 observed)`, whales.length === 2);
check(
  'sides + notionals preserved (neon green buy / neon red sell)',
  whales.some((t) => t.side === 'buy' && t.notional === 39_000) &&
    whales.some((t) => t.side === 'sell' && t.notional === 30_000),
);
check('newest whale first', whales[0]?.side === 'sell');
check(
  'session totals aggregated',
  useWhaleStore.getState().count === 2 && useWhaleStore.getState().totalNotional === 69_000,
);

useWhaleStore.getState().setEnabled(false);
whaleTracker.observe({ exchange: 'bybit', symbol: 'BTC/USDT', price: 78_000, qty: 5, side: 'buy', ts: now + 3 });
await new Promise((resolve) => setTimeout(resolve, 700));
check('stream off → no new whales subscribed/counted', useWhaleStore.getState().count === 2);

/* --------------------------------- chains ---------------------------------- */
console.log('\n— chain registry (DEX coverage) —');

const { normaliseDexscreenerChain, GECKO_NETWORK_TO_CHAIN, CHAIN_TO_GECKO_NETWORK, GOPLUS_CHAIN_ID, HONEYPOT_CHAIN_ID, CHAIN_IDS } =
  await import('@/lib/chains');

check(`${CHAIN_IDS.length} canonical chains registered`, CHAIN_IDS.length >= 30);
check('DexScreener reports Sei as `seiv2`', normaliseDexscreenerChain('seiv2') === 'sei');
check('GeckoTerminal `avax`/`xdai`/`ftm` map correctly', GECKO_NETWORK_TO_CHAIN.avax === 'avalanche' && GECKO_NETWORK_TO_CHAIN.xdai === 'gnosis' && GECKO_NETWORK_TO_CHAIN.ftm === 'fantom');
check(
  'every canonical chain has a GeckoTerminal network',
  CHAIN_IDS.every((chain) => typeof CHAIN_TO_GECKO_NETWORK[chain] === 'string'),
);
check('GoPlus ids verified against /supported_chains', GOPLUS_CHAIN_ID.blast === '81457' && GOPLUS_CHAIN_ID.sonic === '146' && GOPLUS_CHAIN_ID.unichain === '130');
check('honeypot.is covers the big five EVM chains', Object.keys(HONEYPOT_CHAIN_ID).length === 5);

// Real contract addresses on chains added in this pass (all verified live).
const BASE_AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';
const SUI_CETUS = '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS';
const BERA_WBERA = '0x6969696969696969696969696969696969696969';

check('Sui/Aptos object ids take the CA pipeline', classifyQuery(SUI_CETUS) === 'move');
check('TON friendly addresses take the CA pipeline', classifyQuery('EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT') === 'ton');

const baseLookup = await smartSearch(BASE_AERO);
const baseChains = new Set(baseLookup.hits.filter((h) => h.kind === 'dex').map((h) => (h.kind === 'dex' ? h.pair.chain : '')));
check(`Base token → pool(s) on ${[...baseChains].join(', ') || '∅'}`, baseChains.has('base'));

const suiLookup = await smartSearch(SUI_CETUS);
const suiChains = new Set(suiLookup.hits.filter((h) => h.kind === 'dex').map((h) => (h.kind === 'dex' ? h.pair.chain : '')));
check(`Sui token → pool(s) on ${[...suiChains].join(', ') || '∅'}`, suiChains.has('sui'));

check('Sui has no EVM auditor → no verdict is claimed', !isAuditableChain('sui') && (await auditToken('sui', SUI_CETUS)) === null);

const beraAudit = await auditToken('berachain', BERA_WBERA);
check(
  `Berachain (GoPlus 80094) audits: verdict=${beraAudit?.verdict ?? '∅'} provider=${beraAudit?.provider ?? '∅'}`,
  beraAudit !== null,
);
const baseAudit = await auditToken('base', BASE_AERO);
console.log(`        base AERO → verdict=${baseAudit?.verdict} risk=${baseAudit?.riskScore} provider=${baseAudit?.provider} flags=[${(baseAudit?.flags ?? []).join(', ')}]`);
check('Base (GoPlus 8453) is audited too', baseAudit !== null && baseAudit.verdict !== 'danger');

/* ----------------------------- honeypot.is contract ------------------------- */
console.log('\n— honeypot.is simulation (second opinion) —');

try {
  const hp = (await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${PEPE}&chainID=1`, {
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.json())) as {
    simulationSuccess?: boolean;
    honeypotResult?: { isHoneypot?: boolean };
    simulationResult?: { buyTax?: number; sellTax?: number };
    summary?: { risk?: string };
  };
  check(
    `simulation responded (risk=${hp.summary?.risk}, honeypot=${hp.honeypotResult?.isHoneypot}, buyTax=${hp.simulationResult?.buyTax})`,
    typeof hp.simulationSuccess === 'boolean' && typeof hp.honeypotResult?.isHoneypot === 'boolean',
  );
  check('PEPE is not a honeypot and trades tax-free', hp.honeypotResult?.isHoneypot === false && (hp.simulationResult?.buyTax ?? 1) === 0);
} catch (error) {
  check(`honeypot.is reachable (${error instanceof Error ? error.name : 'error'})`, false);
}

/* ------------------------------- region logic ------------------------------ */
console.log('\n— region detection & venue ranking —');

const { countryFromTimezone, detectRegion, isRestrictedIn } = await import('@/lib/region');
const { pickExchange, rankExchanges } = await import('@/lib/exchange-select');
const { EXCHANGE_META } = await import('@/lib/exchanges');

check('timezone → country for unambiguous zones', countryFromTimezone('Europe/Madrid') === 'ES' && countryFromTimezone('Asia/Tokyo') === 'JP');
check('ambiguous zones are not guessed', countryFromTimezone('CET') === null);
check('detectRegion never throws', typeof detectRegion() === 'object');
check('Binance is flagged for US visitors, Kraken is not', isRestrictedIn('binance', 'US') && !isRestrictedIn('kraken', 'US'));

const base = { symbol: 'BTC/USDT', timeframe: '1m' as const, country: null, reach: {}, unsupported: {}, preferred: {} };
check('cold start prefers the deepest venue', pickExchange(base) === 'binance');
check(
  'a geo-blocked venue is skipped',
  pickExchange({ ...base, reach: { binance: { status: 'blocked', ms: null, note: 'region', checkedAt: Date.now() } } }) === 'okx',
);
check(
  'the fastest reachable venue wins',
  pickExchange({
    ...base,
    reach: {
      binance: { status: 'ok', ms: 900, note: null, checkedAt: Date.now() },
      okx: { status: 'ok', ms: 40, note: null, checkedAt: Date.now() },
    },
  }) === 'okx',
);
check('a manual choice beats the ranking', pickExchange({ ...base, preferred: { 'BTC/USDT': 'kraken' } }) === 'kraken');
check(
  'a blocked manual choice is overridden',
  pickExchange({ ...base, preferred: { 'BTC/USDT': 'kraken' }, reach: { kraken: { status: 'blocked', ms: null, note: null, checkedAt: Date.now() } } }) !== 'kraken',
);
check('unlisted pairs are skipped', pickExchange({ ...base, unsupported: { binance: ['BTC/USDT'] } }) === 'okx');
check(
  'Bitfinex is excluded for 4h (no such candle bucket)',
  rankExchanges({ ...base, timeframe: '4h' }).find((entry) => entry.id === 'bitfinex')?.supportedTimeframe === false,
);
check('Coinbase cannot chart 1w', rankExchanges({ ...base, timeframe: '1w' }).find((entry) => entry.id === 'coinbase')?.supportedTimeframe === false);
check('all twelve venues are ranked', rankExchanges(base).length === Object.keys(EXCHANGE_META).length);

/* ------------------------------ live reachability --------------------------- */
console.log('\n— live venue probe (12 exchanges) —');

const { probeAllExchanges } = await import('@/api/exchangeProbe');
const { useExchangeStore } = await import('@/store/useExchangeStore');

const outcomes = await probeAllExchanges({ symbol: 'BTC/USDT', timeframe: '1m' });
for (const outcome of outcomes.sort((a, b) => (a.ms ?? 1e9) - (b.ms ?? 1e9))) {
  console.log(`        ${outcome.exchange.padEnd(10)} ${outcome.status.padEnd(8)} ${outcome.ms != null ? `${outcome.ms} ms` : '-'} ${outcome.note ?? ''}`);
}
const reachable = outcomes.filter((o) => o.status === 'ok' || o.status === 'slow');
check(`${reachable.length}/${outcomes.length} venues reachable from here`, reachable.length >= 8);
check('results are persisted into the store', Object.keys(useExchangeStore.getState().reach).length === outcomes.length);
check('probing flag is released', useExchangeStore.getState().probing === false);
const picked = pickExchange({
  symbol: 'BTC/USDT',
  timeframe: '1m',
  country: useExchangeStore.getState().country,
  reach: useExchangeStore.getState().reach,
  unsupported: useExchangeStore.getState().unsupported,
  preferred: {},
});
console.log(`        auto-picked venue for BTC/USDT: ${picked}`);
check('auto-pick chooses a measured-reachable venue', reachable.some((o) => o.exchange === picked));


/* --------------------------- on-chain signal sources ------------------------ */
console.log('\n— on-chain signals (live, keyless) —');

const {
  fetchBtcSignals,
  fetchEvmSignals,
  fetchSolanaSignals,
  fetchDefiSignals,
  fetchDexHeat,
  fetchTokenForensics,
} = await import('@/api/onchain');

const btc = await fetchBtcSignals();
console.log(`        btc: fees ${btc?.fastestFee}/${btc?.halfHourFee}/${btc?.economyFee} sat/vB · unconfirmed ${btc?.unconfirmed} · diffΔ ${btc?.difficultyChangePct?.toFixed(2)}%`);
check('BTC mempool/fees/difficulty parse', Boolean(btc && btc.unconfirmed > 0 && btc.fastestFee >= 0 && Number.isFinite(btc.difficultyChangePct)));

const evm = await fetchEvmSignals();
const evmNames = Object.keys(evm);
console.log(`        evm: ${evmNames.map((name) => `${name} gas=${evm[name]?.gasAverage}`).join(' · ')}`);
check('EVM chains report gas (>=3 of 4)', evmNames.length >= 3 && evmNames.every((name) => evm[name]?.gasAverage != null || evm[name]?.coinPriceUsd != null));

const sol = await fetchSolanaSignals();
console.log(`        solana: ${sol?.tps.toFixed(0)} TPS (${sol?.nonVoteTps.toFixed(0)} non-vote) @ slot ${sol?.slot}`);
check('Solana slot + TPS parse', Boolean(sol && sol.slot > 0 && sol.tps > 0 && sol.nonVoteTps > 0 && sol.nonVoteTps <= sol.tps));

const defi = await fetchDefiSignals();
console.log(`        defi: TVL ${(((defi?.totalTvlUsd ?? 0) / 1e9).toFixed(1))}B · stables ${(((defi?.stablecoinSupplyUsd ?? 0) / 1e9).toFixed(1))}B · chains ${defi?.topChains.length}`);
check('DeFi TVL + stablecoins + top chains', Boolean(defi && defi.totalTvlUsd > 1e9 && defi.stablecoinSupplyUsd > 1e9 && defi.topChains.length === 6));

const dex = await fetchDexHeat();
console.log(`        dex heat: ${dex.pools.length} trending pools · ${dex.boosts.length} boosted tokens`);
check('DEX heat: trending pools + boosts', dex.pools.length > 0 && dex.pools.every((pool) => pool.name.length > 0) && dex.boosts.length > 0 && dex.boosts.every((boost) => boost.address.length > 10));

const forensics = await fetchTokenForensics('ethereum', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
console.log(`        forensics WBTC: holders ${forensics?.holderCount} taxes ${forensics?.buyTaxPct}/${forensics?.sellTaxPct} top10 ${forensics?.top10Pct?.toFixed(1)}% lp ${forensics?.lpLockedPct}`);
check('GoPlus forensics parse for WBTC', Boolean(forensics && (forensics.holderCount ?? 0) > 0 && !forensics.isHoneypot));
const noForensics = await fetchTokenForensics('solana', 'So11111111111111111111111111111111111111112');
check('forensics refuses unsupported chain gracefully', noForensics === null);


/* ------------------------------ PRO metrics (live) -------------------------- */
console.log('\n— pro metrics (derivatives / flow / global / heat / options) —');

const {
  fetchDerivSignals,
  fetchFlowSignals,
  fetchGlobalSignals,
  fetchHeatmap,
  fetchVolSignals,
} = await import('@/api/prometrics');
const { volumeProfile, anchoredVwap } = await import('@/lib/premium');

const deriv = await fetchDerivSignals('BTC');
console.log(`        deriv: funding ${deriv?.fundingRate} annual ${deriv?.fundingAnnualPct?.toFixed(1)}% OI ${((deriv?.openInterestUsd ?? 0) / 1e9).toFixed(2)}B L/S ${deriv?.lsrAccounts}/${deriv?.lsrTaker}/${deriv?.topLsr} liq S/L ${deriv?.liqShortUsd}/${deriv?.liqLongUsd}`);
check('derivatives: funding + OI + long/short + liquidations', Boolean(deriv && deriv.fundingRate != null && (deriv.openInterestUsd ?? 0) > 1e8 && (deriv.lsrAccounts ?? 0) > 0 && deriv.liqShortUsd != null));

const flow = await fetchFlowSignals('BTC');
console.log(`        flow: spread ${flow?.spreadBps?.toFixed(2)} bps imbalance ${flow?.imbalancePct?.toFixed(1)}% book ${((flow?.bidNotional ?? 0) / 1e3).toFixed(0)}k/${((flow?.askNotional ?? 0) / 1e3).toFixed(0)}k`);
check('order flow: spread + imbalance within bounds', Boolean(flow && (flow.spreadBps ?? -1) >= 0 && Math.abs(flow.imbalancePct ?? 200) <= 100 && (flow.bidNotional ?? 0) > 0));

const global = await fetchGlobalSignals();
console.log(`        global: mcap ${((global?.totalMcapUsd ?? 0) / 1e12).toFixed(2)}T BTC.D ${global?.btcDominancePct?.toFixed(1)}% F&G ${global?.fngValue} (${global?.fngLabel}) hist ${global?.fngHistory.length}`);
check('global: market cap + dominance + fear&greed history', Boolean(global && global.totalMcapUsd > 1e12 && (global.btcDominancePct ?? 0) > 20 && (global.fngValue ?? -1) >= 0 && global.fngHistory.length >= 7));

const heat = await fetchHeatmap();
console.log(`        heat: ${heat.length} tiles, top ${heat[0]?.pair} ${heat[0]?.changePct?.toFixed(1)}% vol ${((heat[0]?.quoteVolumeUsd ?? 0) / 1e6).toFixed(0)}M`);
check('heatmap: >=10 USDT tiles sorted by volume', heat.length >= 10 && heat.every((tile, i) => i === 0 || heat[i - 1]!.quoteVolumeUsd >= tile.quoteVolumeUsd));

const vol = await fetchVolSignals();
console.log(`        vol: DVOL BTC ${vol?.dvolBtc?.toFixed(1)} (${vol?.dvolBtcChange24h?.toFixed(1)}%) ETH ${vol?.dvolEth?.toFixed(1)} P/C ${vol?.putCallOi?.toFixed(2)} maxPain ${vol?.maxPain}`);
check('options: DVOL + put/call + max pain sane', Boolean(vol && (vol.dvolBtc ?? 0) > 5 && (vol.dvolBtc ?? 0) < 200 && (vol.putCallOi ?? 0) > 0 && (vol.maxPain ?? 0) > 0));

/* deterministic premium maths (no network) */
const synthetic = Array.from({ length: 120 }, (_, i) => {
  const base = 100 + Math.sin(i / 9) * 8;
  return { t: i * 60_000, o: base, h: base + 1.5, l: base - 1.5, c: base + Math.cos(i / 5), v: 10 + (i % 7) };
});
const profile = volumeProfile(synthetic);
check('volume profile: POC inside value area, bins cover range', Boolean(profile && profile.val <= profile.poc && profile.poc <= profile.vah && profile.bins.length === 48 && profile.maxVol > 0));
const vwap = anchoredVwap(synthetic, synthetic[40]!.t);
const firstTypical = (synthetic[40]!.h + synthetic[40]!.l + synthetic[40]!.c) / 3;
check('anchored VWAP starts at the anchor candle', vwap.length === 80 && Math.abs(vwap[0]!.value - firstTypical) < 1e-9);
check('anchored VWAP ignores unknown anchors', anchoredVwap(synthetic, 999_999_999_999).length === 0);

console.log(failures === 0 ? '\n✔ api smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

export {};
