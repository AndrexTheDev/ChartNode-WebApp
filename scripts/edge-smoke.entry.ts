/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Edge-Suite smoke test (dev-only harness, not shipped).
 *
 * Offline + deterministic coverage of the four wave-7 engines and their
 * store wiring:
 *   1. liqradar  – liquidation maths, bucket map, long/short placement
 *   2. leadlag   – lag detection, beta, pending-reaction pulse
 *   3. regime    – classification, drivers, confidence, history strip
 *   4. seasonality – hour/weekday buckets, significance, guard rails
 *   5. store     – liqMagnetsOn persistence + edge modal flags
 *
 * Run with: npm run edge:smoke
 */

(globalThis as unknown as { window: unknown }).window = globalThis;

{
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, String(value));
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
  };
}

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}
function near(a: number | undefined, b: number, eps = 1e-9): boolean {
  return typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= eps;
}

/** Deterministic PRNG so every run produces identical series. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import type { Candle } from '@/websockets/types';

const { LIQ_LEVERAGES, liquidationPrice, buildLiqMap } = await import('@/lib/liqradar');
const { analyseLeadLag, pendingReaction } = await import('@/lib/leadlag');
const { classifyRegime, regimeHistory, REGIME_IDS } = await import('@/lib/regime');
const { seasonality } = await import('@/lib/seasonality');
const { useChartStore } = await import('@/store/useChartStore');

const rnd = mulberry32(20260911);

function candles(count: number, start: number, stepFn: (i: number, prev: number) => number, vol = 1000): Candle[] {
  const out: Candle[] = [];
  let c = start;
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i += 1) {
    const next = stepFn(i, c);
    const o = c;
    c = next;
    const hi = Math.max(o, c) * (1 + rnd() * 0.002);
    const lo = Math.min(o, c) * (1 - rnd() * 0.002);
    out.push({ t: t0 + i * 3_600_000, o, h: hi, l: lo, c, v: vol * (0.5 + rnd()) });
  }
  return out;
}

console.log('\n[1] liqradar');
check('liquidationPrice long 10x', near(liquidationPrice(100, 10, 'long'), 90.4, 1e-9));
check('liquidationPrice short 10x', near(liquidationPrice(100, 10, 'short'), 109.6, 1e-9));
check('liquidationPrice long 100x tighter than 10x', liquidationPrice(100, 100, 'long') > liquidationPrice(100, 10, 'long'));
check('buildLiqMap rejects < 30 candles', buildLiqMap(candles(29, 100, (_i, p) => p)) === null);

const liqFeed = candles(500, 100, (_i, p) => p * (1 + (rnd() - 0.5) * 0.01), 5000);
const map = buildLiqMap(liqFeed);
check('buildLiqMap produces a map on a real feed', map !== null);
check('spot matches last close', map !== null && near(map.spot, liqFeed[liqFeed.length - 1]!.c));
check(
  'all long buckets sit below spot',
  map !== null && map.buckets.every((b) => (b.side === 'long' ? b.price < map.spot : b.price > map.spot)),
);
check('topLongs/topShorts capped at 3', map !== null && map.topLongs.length <= 3 && map.topShorts.length <= 3);
check(
  'intensities in [0.12, 1] and leverages from the ladder',
  map !== null &&
    map.buckets.every((b) => b.intensity >= 0.12 && b.intensity <= 1 && (LIQ_LEVERAGES as readonly number[]).includes(b.leverage)),
);
check(
  'topLongs sorted by proximity to spot',
  map !== null &&
    map.topLongs.every((b, i, arr) => i === 0 || Math.abs(b.distancePct) >= Math.abs(arr[i - 1]!.distancePct)),
);

// — deep probes: decay, window, bucket granularity, guards —
// two seeds in one feed: fresh @100 (age 0, decay 1) vs old @96 (age 39, decay e^-1.95)
const decayFeed = (recentVol: number, oldVol: number): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i < 40; i += 1) {
    const price = i === 39 ? 100 : i === 0 ? 96 : 100 + (i % 2 === 0 ? 0.4 : -0.4);
    const vol = i === 39 ? recentVol : i === 0 ? oldVol : 0;
    out.push({ t: Date.UTC(2026, 0, 1) + i * 3_600_000, o: price, h: price * 1.001, l: price * 0.999, c: price, v: vol });
  }
  return out;
};
const freshLiq = liquidationPrice(100, 100, 'long'); // ≈99.4 – only the fresh seed reaches here
const oldLiq = liquidationPrice(96, 10, 'long'); // ≈86.8 – only the old seed reaches here
const bucketNear = (m: ReturnType<typeof buildLiqMap>, price: number) =>
  m?.buckets.find((b) => Math.abs(b.price - price) / price < 0.004);
const decayA = buildLiqMap(decayFeed(1000, 2000));
check(
  'recency decay: fresh candle outranks a 2x-volume candle 39 bars old',
  bucketNear(decayA, freshLiq)?.intensity === 1 && (bucketNear(decayA, oldLiq)?.intensity ?? 1) < 0.5,
);
const decayB = buildLiqMap(decayFeed(1000, 8000));
check(
  'recency decay: 8x volume lets the old candle win instead',
  bucketNear(decayB, oldLiq)?.intensity === 1 && (bucketNear(decayB, freshLiq)?.intensity ?? 1) < 1,
);
const staleOnly = candles(500, 100, (_i, p) => p).map((c, i) => (i < 50 ? c : { ...c, v: 0 }));
check('window=400: volume outside the window yields no map', buildLiqMap(staleOnly) === null);
const zeroVol = candles(200, 100, (_i, p) => p).map((c) => ({ ...c, v: 0 }));
check('zero-volume feed yields no map', buildLiqMap(zeroVol) === null);
const corrupt = candles(120, 100, (_i, p) => p).map((c, i) => (i === 60 ? { ...c, c: 0, l: 0 } : c));
const corruptMap = buildLiqMap(corrupt);
check('zero-close candle is ignored (no $0 magnet)', corruptMap !== null && corruptMap.buckets.every((b) => b.price > 0));

check('strongest bucket normalises to exactly 1', map !== null && Math.max(...map.buckets.map((b) => b.intensity)) === 1);
const fine = buildLiqMap(liqFeed, 400, 0.001);
check('finer bucketPct produces at least as many buckets', fine !== null && map !== null && fine.buckets.length >= map.buckets.length);
check(
  'distancePct matches price distance from spot',
  map !== null && map.buckets.every((b) => near(b.distancePct, ((b.price - map.spot) / map.spot) * 100, 1e-6)),
);
check(
  'short distances positive, long distances negative',
  map !== null && map.buckets.every((b) => (b.side === 'short' ? b.distancePct > 0 : b.distancePct < 0)),
);
check(
  'liquidation math symmetric around the maintenance margin',
  near((liquidationPrice(200, 25, 'short') - 200) / 200, -( (liquidationPrice(200, 25, 'long') - 200) / 200 ), 1e-9),
);
check(
  'long liq rises and short liq falls with leverage',
  liquidationPrice(100, 100, 'long') > liquidationPrice(100, 50, 'long') &&
    liquidationPrice(100, 100, 'long') > liquidationPrice(100, 10, 'long') &&
    liquidationPrice(100, 100, 'short') < liquidationPrice(100, 10, 'short'),
);

console.log('\n[2] leadlag');
// follower trails the leader by exactly 3 bars
const leaderCloses: number[] = [];
let px = 100;
for (let i = 0; i < 300; i += 1) {
  px *= 1 + (rnd() - 0.5) * 0.006;
  leaderCloses.push(px);
}
const followerCloses = [leaderCloses[0]!, leaderCloses[0]!, leaderCloses[1]!]
  .concat(leaderCloses.slice(0, -3))
  .map((v) => v * (1 + (rnd() - 0.5) * 0.0008));
const stats = analyseLeadLag(leaderCloses, followerCloses);
check('detects the 3-bar lag', stats.bestLag === 3);
check('correlation at best lag is strong', stats.bestCorr > 0.6);
check('beta positive and plausible', stats.beta > 0.5 && stats.beta < 2);
check('samples counted', stats.samples >= 60);
check('hitRate null or a share', stats.hitRate === null || (stats.hitRate >= 0 && stats.hitRate <= 1));

const noiseStats = analyseLeadLag(leaderCloses, leaderCloses.map(() => 100 * (1 + (rnd() - 0.5) * 0.02)));
check('uncorrelated series yield bestLag 0', noiseStats.bestLag === 0);

// leader jumps hard on the last 3 bars, follower stays flat → pending pulse
const leaderJump = leaderCloses.concat(
  [leaderCloses[leaderCloses.length - 1]! * 1.02, leaderCloses[leaderCloses.length - 1]! * 1.04, leaderCloses[leaderCloses.length - 1]! * 1.06],
);
const followerFlat = followerCloses.concat([
  followerCloses[followerCloses.length - 1]!,
  followerCloses[followerCloses.length - 1]!,
  followerCloses[followerCloses.length - 1]!,
]);
const pulse = pendingReaction(stats, leaderJump, followerFlat);
check('pending reaction fires on an un-followed leader jump', pulse !== null && pulse.direction === 1);
check('expectation exceeds the covered move', pulse !== null && Math.abs(pulse.expectedFollowerBps) > Math.abs(pulse.followedSoFarBps));
// genuinely calm tail: last three bars flat on both sides
const leaderCalmTail = leaderCloses[leaderCloses.length - 4]!;
const followerCalmTail = followerCloses[followerCloses.length - 4]!;
const leaderCalm = leaderCloses.slice(0, -3).concat([leaderCalmTail, leaderCalmTail, leaderCalmTail]);
const followerCalm = followerCloses.slice(0, -3).concat([followerCalmTail, followerCalmTail, followerCalmTail]);
check('calm market produces no pulse', pendingReaction(stats, leaderCalm, followerCalm) === null);

// — deep probes: curve shape, beta scaling, hit-rate backtest, pulse gates —
const { lagCurve } = await import('@/lib/leadlag');
check('lagCurve spans lag 0..maxLag', lagCurve(leaderCloses, followerCloses, 6).map((entry) => entry.lag).join(',') === '0,1,2,3,4,5,6');

// follower reacts with 2x amplitude ONE BAR BEHIND the leader
const leaderRet = (i: number) => ((leaderCloses[i + 1]! - leaderCloses[i]!) / leaderCloses[i]!) * 10_000;
const doubleFollower: number[] = [100, 100];
for (let i = 1; i < leaderCloses.length - 1; i += 1) {
  doubleFollower.push(doubleFollower[doubleFollower.length - 1]! * (1 + (2 * leaderRet(i - 1)) / 10_000));
}
const doubleStats = analyseLeadLag(leaderCloses, doubleFollower);
check('beta recovers a 2x amplifier one bar behind', doubleStats.bestLag === 1 && Math.abs(doubleStats.beta - 2) < 0.2, `lag=${doubleStats.bestLag} beta=${doubleStats.beta.toFixed(2)}`);
const syncFollower: number[] = [100];
for (let i = 0; i < leaderCloses.length - 1; i += 1) {
  syncFollower.push(syncFollower[syncFollower.length - 1]! * (1 + (2 * leaderRet(i)) / 10_000));
}
const syncStats = analyseLeadLag(leaderCloses, syncFollower);
check('a synchronous 2x amplifier reads lag 0 with beta 2', syncStats.bestLag === 0 && Math.abs(syncStats.beta - 2) < 0.2, `lag=${syncStats.bestLag} beta=${syncStats.beta.toFixed(2)}`);

// deterministic hit-rate backtest: 10 planted 100bps jumps, follower follows 8
const jumpBars = new Set([30, 55, 80, 105, 130, 155, 180, 205, 230, 255]);
const followedJumps = new Set([30, 55, 80, 105, 130, 155, 180, 205]); // 8 of 10
const hitLeader: number[] = [100];
const hitFollower: number[] = [100];
let lp = 100;
let fp = 100;
for (let t = 0; t < 299; t += 1) {
  const jump = jumpBars.has(t) ? 100 : 0; // planted 100bps leader jump
  lp *= 1 + jump / 10_000;
  hitLeader.push(lp);
  const followed = followedJumps.has(t - 2) ? 60 : 0; // reaction two bars later
  fp *= 1 + followed / 10_000;
  hitFollower.push(fp);
}
const hitStats = analyseLeadLag(hitLeader, hitFollower);
check('hit-rate backtest counts 8 of 10 planted jumps', hitStats.bestLag === 2 && hitStats.hitRate === 0.8, `lag=${hitStats.bestLag} hit=${hitStats.hitRate}`);

check('short series degrade to zero stats', (() => { const s = analyseLeadLag(leaderCloses.slice(0, 40), followerCloses.slice(0, 40)); return s.samples < 60 && s.bestLag === 0 && s.bestCorr === 0 && s.hitRate === null; })());
check('weak correlation suppresses bestLag', (() => { const weak = leaderCloses.map((v, i) => v * (1 + (((i * 37) % 11) - 5) / 10_000)); const s = analyseLeadLag(leaderCloses, weak); return s.bestLag === 0; })());

// pulse gates: sigma of the base pattern [12,-12,...] is ~12bps
const baseReturns = Array.from({ length: 120 }, (_v, i) => (i % 2 === 0 ? 12 : -12));
const sigmaBase = 12.05;
const buildPulseSeries = (tailBps: number, followerTailBps: number | 'flip') => {
  const leaderClose: number[] = [100];
  for (const r of [...baseReturns, tailBps / 3, tailBps / 3, tailBps / 3]) leaderClose.push(leaderClose[leaderClose.length - 1]! * (1 + r / 10_000));
  const followerClose: number[] = [100];
  const followerTail = followerTailBps === 'flip' ? -Math.abs(tailBps) / 3 : followerTailBps / 3;
  for (const r of [...baseReturns, followerTail, followerTail, followerTail]) followerClose.push(followerClose[followerClose.length - 1]! * (1 + r / 10_000));
  return { leaderClose, followerClose };
};
const pulseStats = { bestLag: 1, bestCorr: 0.5, beta: 1, hitRate: null, samples: 120 };
const sub = buildPulseSeries(1.4 * sigmaBase, 0);
check('pulse stays silent below the 1.5 sigma gate', pendingReaction(pulseStats, sub.leaderClose, sub.followerClose) === null);
const over = buildPulseSeries(1.6 * sigmaBase, 0);
const overPulse = pendingReaction(pulseStats, over.leaderClose, over.followerClose);
check('pulse fires above the 1.5 sigma gate', overPulse !== null && overPulse.direction === 1);
const half = buildPulseSeries(1.6 * sigmaBase, 0.5 * 1.6 * sigmaBase);
check('pulse cancels once 40 %+ of the reaction landed', pendingReaction(pulseStats, half.leaderClose, half.followerClose) === null);
const flip = buildPulseSeries(1.6 * sigmaBase, 'flip');
const flipPulse = pendingReaction(pulseStats, flip.leaderClose, flip.followerClose);
check('a follower moving the wrong way keeps the pulse alive', flipPulse !== null && flipPulse.followedSoFarBps < 0);
check('pulse gates honour degenerate stats', pendingReaction({ ...pulseStats, beta: -1 }, over.leaderClose, over.followerClose) === null && pendingReaction({ ...pulseStats, bestLag: 0 }, over.leaderClose, over.followerClose) === null && pendingReaction({ ...pulseStats, bestCorr: 0.1 }, over.leaderClose, over.followerClose) === null);

console.log('\n[3] regime');
check('classifyRegime rejects < 80 candles', classifyRegime({ candles: candles(79, 100, (_i, p) => p) }) === null);

const up = candles(300, 100, (_i, p) => p * 1.004);
const upRead = classifyRegime({ candles: up });
check('clean uptrend reads trend-strong', upRead !== null && upRead.id === 'trend-strong');

const flat = candles(300, 100, (i) => 100 * (1 + Math.sin(i / 14) * 0.002));
const flatRead = classifyRegime({ candles: flat });
check('oscillating feed reads range', flatRead !== null && flatRead.id === 'range');

const storm = classifyRegime({ candles: flat, liq5mUsd: 9_000_000, liqMedianUsd: 1_000_000 });
check('3x+ liquidation ratio overrides to liq-storm', storm !== null && storm.id === 'liq-storm');
check('liq driver recorded', storm !== null && storm.drivers.some((d) => d.key === 'liq' && near(d.value, 9, 1e-6)));

const funding = classifyRegime({ candles: up, fundingRate: 0.09, advPct: 12 });
check('funding + breadth drivers appended', funding !== null && funding.drivers.some((d) => d.key === 'funding') && funding.drivers.some((d) => d.key === 'breadth'));
check('confidence inside [0.5, 0.95]', upRead !== null && upRead.confidence >= 0.5 && upRead.confidence <= 0.95);

const history = regimeHistory(candles(600, 100, (i, p) => p * (1 + Math.sin(i / 40) * 0.004 + 0.0006)));
check('regimeHistory yields ids from the ladder', history.length >= 2 && history.every((id) => REGIME_IDS.includes(id)));

// — deep probes: precedence, boundaries, drivers, history windowing —
const volExpandFeed = candles(240, 100, (i) => 100 * (1 + Math.sin(i / 14) * 0.002));
const last = volExpandFeed[volExpandFeed.length - 1]!;
volExpandFeed[volExpandFeed.length - 1] = { ...last, h: last.c * 1.05, l: last.c * 0.95 };
const volRead = classifyRegime({ candles: volExpandFeed });
check('range spike without trend reads vol-expand', volRead !== null && volRead.id === 'vol-expand', volRead?.id);
check('liq ratio outranks vol-expand (liq-storm wins)', classifyRegime({ candles: volExpandFeed, liq5mUsd: 4_000_000, liqMedianUsd: 1_000_000 })?.id === 'liq-storm');
check('extreme funding + vol spike also reads liq-storm', classifyRegime({ candles: volExpandFeed, fundingRate: 0.09 })?.id === 'liq-storm');
check('extreme funding alone does NOT override a clean trend', classifyRegime({ candles: up, fundingRate: 0.09 })?.id === 'trend-strong');

const mature = candles(200, 100, (_i, p) => p * 1.004);
// flat-ish alternating tail: ADX stays elevated (lagging) while the EMA slope collapses
const tailBase = mature[mature.length - 1]!.c;
const flatTail: Candle[] = [];
{
  let tc = tailBase;
  for (let i = 0; i < 80; i += 1) {
    const o = tc;
    tc = tc * (1 + (i % 2 === 0 ? 0.0005 : -0.0005));
    flatTail.push({ t: Date.UTC(2026, 0, 1) + (200 + i) * 3_600_000, o, h: Math.max(o, tc) * 1.001, l: Math.min(o, tc) * 0.999, c: tc, v: 1000 });
  }
}
const trendWeakRead = classifyRegime({ candles: [...mature, ...flatTail] });
check('mature trend with flat tail reads trend-weak', trendWeakRead !== null && trendWeakRead.id === 'trend-weak', trendWeakRead?.id);

check('boundary: exactly 80 candles classify', classifyRegime({ candles: candles(80, 100, (_i, p) => p * 1.001) }) !== null);
check(
  'every read carries >=3 finite drivers',
  [upRead, flatRead, storm, volRead, trendWeakRead].every(
    (read) => read !== null && read.drivers.length >= 3 && read.drivers.every((d) => Number.isFinite(d.value)),
  ),
);
check('breadth driver passes advPct through', classifyRegime({ candles: flat, advPct: 33 })?.drivers.find((d) => d.key === 'breadth')?.value === 33);
check('confidence floor holds on a flat feed', flatRead !== null && flatRead.confidence >= 0.5);

const shortHistory = regimeHistory(candles(100, 100, (_i, p) => p));
check('regimeHistory stays empty below its 120-bar window', shortHistory.length === 0);
const windowed = regimeHistory(candles(600, 100, (i, p) => p * (1 + Math.sin(i / 40) * 0.004 + 0.0006)), 120, 240);
check('regimeHistory honours step/span (2 reads over 240 bars)', windowed.length === 2, `${windowed.length}`);

console.log('\n[4] seasonality');
check('seasonality rejects < 100 candles', seasonality(candles(99, 100, (_i, p) => p)) === null);

// 1200 hourly candles; hours 6-9 UTC each pump +0.375 %, so the 4-bar window
// starting at hour 5 always ends +1.5 % up
const seasonFeed = candles(1200, 100, (i, p) => {
  const hour = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).getUTCHours();
  return hour >= 6 && hour <= 9 ? p * 1.00375 : p;
});
const season = seasonality(seasonFeed);
check('seasonality produces 24h + 7d buckets', season !== null && season.hours.length === 24 && season.weekdays.length === 7);
check('samples reported', season !== null && season.samples === 1200);
const bucket5 = season?.hours[5];
check('planted hour-5 edge is significant', bucket5 != null && bucket5.significant && bucket5.winRate === 1 && bucket5.meanBps > 0);
check('nowHour/nowWeekday resolved', season !== null && season.nowHour !== null && season.nowWeekday !== null);
check('t-gate: tiny samples never significant', season !== null && season.hours.every((h) => !(h.n < 30 && h.significant)));

// — deep probes: bucket accounting, forward window, t-gate, now-ring keys —
check('hour buckets account for every forward window', season !== null && season.hours.reduce((a, b) => a + b.n, 0) === 1200 - 4);
check('weekday buckets account for every forward window', season !== null && season.weekdays.reduce((a, b) => a + b.n, 0) === 1200 - 4);
check('planted hour-5 edge means ≈ +150 bps over 4 bars', bucket5 != null && bucket5.meanBps > 140 && bucket5.meanBps < 160, `${bucket5?.meanBps.toFixed(1)} bps`);
check('planted edge t-value is far beyond the gate', bucket5 != null && Math.abs(bucket5.t) >= 2 && bucket5.significant);
const oneBar = seasonality(seasonFeed, 1);
const hour5one = oneBar?.hours[5];
check('forward=1 reshapes the edge to one bar (+37.5 bps)', hour5one != null && hour5one.meanBps > 30 && hour5one.meanBps < 45, `${hour5one?.meanBps.toFixed(1)} bps`);

// noisy half-edge: mean far below its own std → must stay insignificant
const noisyFeed = candles(1200, 100, (i, p) => {
  const hour = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).getUTCHours();
  if (hour === 11) return p * (1 + (i % 2 === 0 ? 0.005 : -0.0045));
  return p;
});
const noisyHour = seasonality(noisyFeed)?.hours[11];
check('a noisy half-edge stays insignificant despite n >= 30', noisyHour != null && noisyHour.n >= 30 && !noisyHour.significant, `t=${noisyHour?.t.toFixed(2)}`);

const now = new Date();
check('nowHour/nowWeekday track the real UTC clock', season !== null && season.nowHour?.key === now.getUTCHours() && season.nowWeekday?.key === now.getUTCDay());
check('exactly 100 candles classify', seasonality(candles(100, 100, (_i, p) => p)) !== null);
const zeroed = seasonFeed.map((c, i) => (i % 240 === 7 ? { ...c, c: 0 } : c));
const zeroSeason = seasonality(zeroed);
check('zero-close candles are skipped, not bucketed', zeroSeason !== null && zeroSeason.hours.reduce((a, b) => a + b.n, 0) === 1200 - 4 - 5, `${zeroSeason?.hours.reduce((a, b) => a + b.n, 0)}`);
const sunday = seasonFeed.filter((c) => new Date(c.t).getUTCDay() === 0).length;
check('weekday bucket n matches the calendar count', season !== null && (season.weekdays[0]?.n ?? 0) === sunday - Math.min(4, Math.max(0, 4 - 0)) || season !== null && Math.abs((season.weekdays[0]?.n ?? 0) - sunday) <= 4, `n=${season?.weekdays[0]?.n} cal=${sunday}`);

console.log('\n[5] store wiring');
const initial = useChartStore.getState();
check('liqMagnetsOn defaults to false', initial.liqMagnetsOn === false);
check('edge modals default closed', !initial.edgeLiqOpen && !initial.edgeLagOpen && !initial.edgeRegimeOpen && !initial.edgeClockOpen);
useChartStore.getState().toggleLiqMagnets();
check('toggleLiqMagnets flips the flag', useChartStore.getState().liqMagnetsOn === true);
const persisted = JSON.parse((globalThis as unknown as { localStorage: { getItem: (k: string) => string | null } }).localStorage.getItem('nc-chart-v1') ?? '{}');
check('liqMagnetsOn persisted to localStorage', persisted?.state?.liqMagnetsOn === true);
check('edge flags stay out of localStorage', persisted?.state?.edgeLiqOpen === undefined && persisted?.state?.lagLeaderId === undefined);
useChartStore.getState().setEdgeLiqOpen(true);
useChartStore.getState().setLagLeader('cex:binance:ETHUSDT');
check('setEdgeLiqOpen / setLagLeader work', useChartStore.getState().edgeLiqOpen === true && useChartStore.getState().lagLeaderId === 'cex:binance:ETHUSDT');
useChartStore.getState().setEdgeLiqOpen(false);
check('setEdgeLiqOpen(false) closes again', useChartStore.getState().edgeLiqOpen === false);

console.log('');
if (failures > 0) {
  console.error(`✖ ${failures} edge-smoke failure(s).`);
  process.exit(1);
}
console.log('✔ edge-smoke: all checks passed.');
