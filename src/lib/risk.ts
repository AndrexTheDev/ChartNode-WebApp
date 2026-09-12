/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Position-size / risk-reward calculator – the maths behind TV's position
 * tool, as a keyboard-friendly modal. Pure, no dependencies.
 */

export interface RiskInput {
  accountUsd: number;
  riskPct: number;
  entry: number;
  stop: number;
  target: number;
  /** Optional leverage for margin estimate. */
  leverage: number;
}

export interface RiskResult {
  riskUsd: number;
  /** Base-asset units so that hitting the stop loses exactly riskUsd. */
  positionUnits: number;
  positionNotionalUsd: number;
  marginUsd: number;
  rewardUsd: number;
  rr: number | null;
  /** Percent move entry → stop / entry → target. */
  stopDistPct: number;
  targetDistPct: number;
  /** Account change if the target / the stop hits. */
  accountAtTargetPct: number;
  accountAtStopPct: number;
}

export function computeRisk(input: RiskInput): RiskResult | null {
  const { accountUsd, riskPct, entry, stop, target, leverage } = input;
  if (![accountUsd, riskPct, entry, stop, target].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (entry === stop) return null;

  const riskUsd = (accountUsd * riskPct) / 100;
  const perUnit = Math.abs(entry - stop);
  const positionUnits = perUnit > 0 ? riskUsd / perUnit : 0;
  const notional = positionUnits * entry;
  const lev = Number.isFinite(leverage) && leverage >= 1 ? leverage : 1;
  const rewardUsd = positionUnits * Math.abs(target - entry);
  const rr = riskUsd > 0 ? rewardUsd / riskUsd : null;

  return {
    riskUsd,
    positionUnits,
    positionNotionalUsd: notional,
    marginUsd: notional / lev,
    rewardUsd,
    rr,
    stopDistPct: ((stop - entry) / entry) * 100,
    targetDistPct: ((target - entry) / entry) * 100,
    accountAtTargetPct: accountUsd > 0 ? (rewardUsd / accountUsd) * 100 : 0,
    accountAtStopPct: -riskPct,
  };
}
