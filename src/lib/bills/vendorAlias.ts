// Resolves a bank transaction to the Bill it pays.
//
// reconcile.ts matches on amount + date window alone; it never looks at who was
// paid. That works for fixed monthly bills and mis-fires on everything variable.
// This module supplies the missing dimension — vendor identity — by matching the
// raw bank descriptor against an explicit alias table.
//
// Pure and side-effect free so it can be exercised against transaction history
// without a database.

export interface AliasRule {
  id: string;
  pattern: string;
  matchType: 'contains' | 'prefix' | 'regex';
  field: 'name' | 'merchant';
  store: string | null;
  amountMin: number | null;
  amountMax: number | null;
  billId: string;
  /** Other bills this one charge settles at the same time. */
  alsoSettles: string[];
  /** Bill amount is a placeholder (card payments); do not judge over/underpayment. */
  variableAmount: boolean;
  /** Day numbers (0=Sun..6=Sat) this rule applies to; empty = any day. */
  weekday: number[];
  priority: number;
  confirmed: boolean;
  enabled: boolean;
  note?: string | null;
}

export interface AliasTxn {
  id: string;
  /** Raw bank descriptor, e.g. "SKFI OPERATING DES:P4_ROYALTY ID:1392 INDN:..." */
  name: string;
  /** Feed-normalised merchant, e.g. "Florida Power & Light". Often null. */
  merchant?: string | null;
  /** Signed amount as the feed reports it. */
  amount: number;
  account: string;
  date: string;
}

export interface AliasResolution {
  billId: string;
  /** Every bill this payment settles, billId first. Usually length 1. */
  settles: string[];
  ruleId: string;
  confirmed: boolean;
  /** Other rules that also matched — a sign the table needs tightening. */
  ambiguous: string[];
}

/**
 * The OpenBudget/Plaid feed reports outflows as POSITIVE and deposits as
 * NEGATIVE — the opposite of ActualTxn in actual.ts, whose amounts are negative
 * cents for money out. Everything here works in absolute dollars to stay out of
 * that argument; callers converting to ActualTxn must flip the sign.
 */
export const outflowDollars = (t: AliasTxn): number => Math.abs(t.amount);
export const isOutflow = (t: AliasTxn): boolean => t.amount > 0;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function textMatches(rule: AliasRule, txn: AliasTxn): boolean {
  const raw = rule.field === 'merchant' ? txn.merchant : txn.name;
  if (!raw) return false;
  const hay = norm(raw);
  const needle = norm(rule.pattern);
  if (rule.matchType === 'prefix') return hay.startsWith(needle);
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(raw);
    } catch {
      return false; // a bad pattern must never take reconciliation down
    }
  }
  return hay.includes(needle);
}

function constraintsHold(rule: AliasRule, txn: AliasTxn, store: string | null): boolean {
  // Each store keeps its own bills and its own vendor records — Margate's Comcast
  // bill and Pines' Comcast bill are separate rows, not one shared vendor. So a
  // transaction may only ever settle a bill belonging to the store that owns the
  // account it was paid from. No cross-store matching, and no matching at all
  // from an account whose store is unknown.
  if (rule.store !== store) return false;
  const amt = outflowDollars(txn);
  if (rule.amountMin != null && amt < rule.amountMin) return false;
  if (rule.amountMax != null && amt > rule.amountMax) return false;
  // Delivery day separates a vendor's multiple weekly bills for the same store.
  // Parsed as UTC so a local timezone cannot shift a Monday order into Sunday.
  if (rule.weekday.length > 0) {
    const day = new Date(`${txn.date}T00:00:00Z`).getUTCDay();
    if (!rule.weekday.includes(day)) return false;
  }
  return true;
}

/** Longest, highest-priority confirmed rule wins. */
function rank(a: AliasRule, b: AliasRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
  return b.pattern.length - a.pattern.length;
}

export function resolveVendor(
  txn: AliasTxn,
  rules: AliasRule[],
  storeByAccount: Record<string, string | null>,
): AliasResolution | null {
  if (!isOutflow(txn)) return null; // bills are money leaving; deposits are sales
  const store = storeByAccount[txn.account] ?? null;
  // An unattributed account cannot settle anyone's bill — bills belong to a store.
  if (store === null) return null;

  const hits = rules
    .filter((r) => r.enabled && textMatches(r, txn) && constraintsHold(r, txn, store))
    .sort(rank);

  if (hits.length === 0) return null;
  const [best, ...rest] = hits;
  return {
    billId: best.billId,
    settles: [best.billId, ...best.alsoSettles],
    ruleId: best.id,
    confirmed: best.confirmed,
    ambiguous: rest.filter((r) => r.billId !== best.billId).map((r) => r.id),
  };
}

/** Convenience for bulk runs: transaction id -> resolution. */
export function resolveAll(
  txns: AliasTxn[],
  rules: AliasRule[],
  storeByAccount: Record<string, string | null>,
): Map<string, AliasResolution> {
  const out = new Map<string, AliasResolution>();
  for (const t of txns) {
    const r = resolveVendor(t, rules, storeByAccount);
    if (r) out.set(t.id, r);
  }
  return out;
}
