import 'server-only';
import type { ReconciledOccurrence } from './reconcile';
import type { UnifiedTxn } from './unifiedTransactions';

// Suggests a transaction for each still-open bill occurrence, so Sam can
// eyeball it and confirm rather than the app silently deciding for him.
// reconcile.ts already auto-marks an occurrence "paid" from a QuickBooks
// amount+date match with no human step — this is deliberately separate and
// additive: it never marks anything paid on its own, only proposes.
//
// Two confidence tiers:
//   'vendor' — the vendor-alias table already resolved this exact transaction
//              to this exact bill (see unifiedTransactions.ts). High trust:
//              vendor identity is real evidence, not a coincidence.
//   'amount' — no alias rule fired, so fall back to "amount matches and it's
//              around the due date" (same store, same tolerance/window
//              reconcile.ts uses) — weaker, but still useful for bills that
//              don't have an alias rule yet.
export interface Suggestion {
  txnId: string;
  amount: number;   // absolute dollars
  date: string;      // ISO
  name: string;       // payee, to visually confirm against
  confidence: 'vendor' | 'amount';
}

const MATCH_DAYS_BEFORE = 10;
const MATCH_DAYS_AFTER = 5;
const MATCH_TOLERANCE = 0.25; // matches reconcile.ts's own tolerance
// A recurring bill (monthly rent, etc.) has many occurrences but OpenBudget's
// history only goes back so far. Once the transaction actually near a given
// occurrence gets claimed by it, a naive "closest remaining" search on a
// vendor-confirmed match will happily pair a leftover occurrence with a
// transaction from a completely different billing period — vendor identity
// says it's the right BILL, not the right OCCURRENCE. Cap both passes to the
// same window so a wrong-period pairing is dropped instead of shown as if
// it were reliable just because the vendor matched.
const MAX_VENDOR_MATCH_DAYS = 20;

const occKey = (billId: string, due: string) => `${billId}|${due}`;
const daysBetween = (a: string, b: string) =>
  Math.abs((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86_400_000);

export function suggestMatches(
  occurrences: ReconciledOccurrence[],
  txns: UnifiedTxn[],
): Map<string, Suggestion> {
  // Candidates: real outflows only — not transfers/card-payment echoes, not
  // deposits. UnifiedTxn convention is outflow-negative (see its own docstring).
  const outflows = txns.filter((t) => t.amount < 0 && !t.isTransfer);
  const claimed = new Set<string>();
  const out = new Map<string, Suggestion>();

  const open = occurrences
    .filter((o) => o.status !== 'paid')
    .sort((a, b) => a.due.localeCompare(b.due));

  const toSuggestion = (t: UnifiedTxn): Suggestion => ({
    txnId: t.id, amount: Math.abs(t.amount), date: t.date,
    name: t.payee, confidence: 'vendor',
  });

  // Pass 1 — vendor-confirmed. Grouped by billId so each bill only draws from
  // its own transactions, then each occurrence claims its date-nearest one.
  const byBillId = new Map<string, UnifiedTxn[]>();
  for (const t of outflows) {
    if (!t.matched || !t.billId) continue;
    (byBillId.get(t.billId) ?? byBillId.set(t.billId, []).get(t.billId)!).push(t);
  }
  for (const o of open) {
    const candidates = (byBillId.get(o.billId) ?? [])
      .filter((t) => !claimed.has(t.id) && daysBetween(t.date, o.due) <= MAX_VENDOR_MATCH_DAYS);
    if (!candidates.length) continue;
    candidates.sort((a, b) => daysBetween(a.date, o.due) - daysBetween(b.date, o.due));
    const best = candidates[0];
    claimed.add(best.id);
    out.set(occKey(o.billId, o.due), toSuggestion(best));
  }

  // Pass 2 — amount+date fallback, for occurrences pass 1 didn't cover.
  for (const o of open) {
    const k = occKey(o.billId, o.due);
    if (out.has(k) || o.expected == null || o.expected <= 0) continue;
    const winStart = new Date(o.due + 'T00:00:00Z'); winStart.setUTCDate(winStart.getUTCDate() - MATCH_DAYS_BEFORE);
    const winEnd = new Date(o.due + 'T00:00:00Z'); winEnd.setUTCDate(winEnd.getUTCDate() + MATCH_DAYS_AFTER);
    const winStartISO = winStart.toISOString().slice(0, 10);
    const winEndISO = winEnd.toISOString().slice(0, 10);

    const candidates = outflows.filter((t) => {
      if (claimed.has(t.id)) return false;
      if (t.store && t.store !== o.store) return false; // don't cross stores on a guess
      if (t.date < winStartISO || t.date > winEndISO) return false;
      const variance = Math.abs(Math.abs(t.amount) - o.expected!) / o.expected!;
      return variance <= MATCH_TOLERANCE;
    });
    if (!candidates.length) continue;
    candidates.sort((a, b) => daysBetween(a.date, o.due) - daysBetween(b.date, o.due));
    const best = candidates[0];
    claimed.add(best.id);
    out.set(k, { ...toSuggestion(best), confidence: 'amount' });
  }

  return out;
}
