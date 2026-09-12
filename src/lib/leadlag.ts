/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Lag Oracle – cross-symbol lead/lag engine (NodeChart original).
 *
 * BTC moves first, alts follow: that is folklore. The Oracle *measures* it:
 * normalised cross-correlation over a lag ladder finds how many bars the
 * follower historically trails the leader, a regression slope sizes the
 * typical reaction, and a hit-rate backtest answers "when BTC jumps, how
 * often does the follower actually follow within that lag?".
 *
 * Live, the same maths turns into a pending-reaction pulse: leader moved
 * beyond its own volatility band while the follower has not reacted yet –
 * the statistically documented edge window.
 */

export interface LeadLagStats {
  /** bars the follower trails the leader (0 = synchronous) */
  bestLag: number;
  /** correlation at bestLag (-1..1) */
  bestCorr: number;
  /** reaction size: follower bps per leader bps at bestLag */
  beta: number;
  /** share of leader jumps the follower followed within bestLag */
  hitRate: number | null;
  samples: number;
}

export interface PendingReaction {
  direction: 1 | -1;
  leaderMoveBps: number;
  expectedFollowerBps: number;
  followedSoFarBps: number;
}

function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]!;
    if (prev > 0) out.push(((closes[i]! - prev) / prev) * 10_000); // bps
  }
  return out;
}

function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  const denom = Math.sqrt(saa * sbb);
  return denom > 0 ? sab / denom : 0;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Correlation of leader[t] against follower[t+lag] for lag = 0..maxLag. */
export function lagCurve(leaderCloses: number[], followerCloses: number[], maxLag = 12) {
  const leader = returns(leaderCloses);
  const follower = returns(followerCloses);
  const curve: { lag: number; corr: number }[] = [];
  for (let lag = 0; lag <= maxLag; lag += 1) {
    if (lag >= follower.length) break;
    curve.push({ lag, corr: corr(leader.slice(0, leader.length - lag || undefined), follower.slice(lag)) });
  }
  return curve;
}

export function analyseLeadLag(leaderCloses: number[], followerCloses: number[], maxLag = 12): LeadLagStats {
  const curve = lagCurve(leaderCloses, followerCloses, maxLag);
  const leader = returns(leaderCloses);
  const follower = returns(followerCloses);
  const samples = Math.min(leader.length, follower.length);
  if (curve.length === 0 || samples < 60) {
    return { bestLag: 0, bestCorr: 0, beta: 0, hitRate: null, samples };
  }
  const best = curve.reduce((acc, entry) => (entry.corr > acc.corr ? entry : acc), curve[0]!);
  const bestLag = best.corr > 0.12 ? best.lag : 0;

  // regression slope of follower[t+bestLag] on leader[t]
  const lag = bestLag;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let t = 0; t + lag < leader.length && t + lag < follower.length; t += 1) {
    xs.push(leader[t]!);
    ys.push(follower[t + lag]!);
  }
  let beta = 0;
  if (xs.length > 8) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < xs.length; i += 1) {
      sxy += (xs[i]! - mx) * (ys[i]! - my);
      sxx += (xs[i]! - mx) ** 2;
    }
    beta = sxx > 0 ? sxy / sxx : 0;
  }

  // hit-rate backtest: leader jumps beyond 1.5σ → did follower follow in lag bars?
  const sigma = stdev(leader);
  let events = 0;
  let hits = 0;
  for (let t = 0; t + Math.max(lag, 1) < Math.min(leader.length, follower.length); t += 1) {
    if (sigma <= 0 || Math.abs(leader[t]!) < 1.5 * sigma) continue;
    let follow = 0;
    for (let k = 1; k <= Math.max(lag, 1); k += 1) follow += follower[t + k] ?? 0;
    events += 1;
    if (Math.sign(follow) === Math.sign(leader[t]!) && follow !== 0) hits += 1;
  }
  return {
    bestLag: lag,
    bestCorr: best.corr,
    beta,
    hitRate: events >= 8 ? hits / events : null,
    samples,
  };
}

/**
 * Live pulse: the leader just moved beyond its volatility band while the
 * follower has not yet delivered the statistically typical reaction.
 */
export function pendingReaction(
  stats: LeadLagStats,
  leaderCloses: number[],
  followerCloses: number[],
  lookback = 3,
): PendingReaction | null {
  if (stats.bestLag <= 0 || stats.bestCorr <= 0.12 || stats.beta <= 0) return null;
  const leader = returns(leaderCloses);
  const follower = returns(followerCloses);
  if (leader.length < 30 || follower.length < lookback) return null;
  const sigma = stdev(leader.slice(0, -lookback));
  const leaderMove = leader.slice(-lookback).reduce((a, b) => a + b, 0);
  if (sigma <= 0 || Math.abs(leaderMove) < 1.5 * sigma) return null;
  const followed = follower.slice(-lookback).reduce((a, b) => a + b, 0);
  const expected = leaderMove * stats.beta;
  // still pending while less than 40 % of the typical reaction has happened
  if (Math.sign(followed) === Math.sign(expected) && Math.abs(followed) >= 0.4 * Math.abs(expected)) return null;
  return {
    direction: leaderMove > 0 ? 1 : -1,
    leaderMoveBps: leaderMove,
    expectedFollowerBps: expected,
    followedSoFarBps: followed,
  };
}
