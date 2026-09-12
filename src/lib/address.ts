// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
export type QueryKind = 'evm' | 'solana' | 'move' | 'ton' | 'text';

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
/**
 * Sui / Aptos object ids and raw TON addresses: 0x + 64 hex, optionally with a
 * Move type suffix (`0x…::cetus::CETUS`).
 */
const MOVE_RE = /^0x[a-fA-F0-9]{64}(?:::[A-Za-z0-9_]+){0,2}$/;
/** TON user-friendly form: base64url, 48 chars, EQ/UQ prefix. */
const TON_RE = /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/;
/** Base58 (no 0, O, I, l), 32–44 chars – Solana mint/pubkey shape. */
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isEvmAddress(value: string): boolean {
  return EVM_RE.test(value);
}

export function isSolanaAddress(value: string): boolean {
  return !isEvmAddress(value) && SOLANA_RE.test(value);
}

/**
 * Decides which lookup pipeline a search string takes:
 *   pasted CA (EVM or Solana) → direct token lookup + security audit
 *   anything else             → name/symbol search across CEX + DEX
 */
/** Anything that is not plain text goes straight to the CA lookup pipeline. */
export function isAddressLookup(kind: QueryKind): boolean {
  return kind !== 'text';
}

/** Chip labels – technical identifiers, deliberately not translated. */
export const QUERY_KIND_LABEL: Record<Exclude<QueryKind, 'text'>, string> = {
  evm: 'EVM CA',
  solana: 'SOL CA',
  move: 'SUI·APTOS CA',
  ton: 'TON CA',
};

export function classifyQuery(raw: string): QueryKind {
  const value = raw.trim();
  if (isEvmAddress(value)) return 'evm';
  if (MOVE_RE.test(value)) return 'move';
  if (TON_RE.test(value)) return 'ton';
  if (isSolanaAddress(value)) return 'solana';
  return 'text';
}

export function shortenAddress(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
