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
//   'amount' — no alias rule fired. Falls back to amount+date, but ONLY when
//              the transaction's own text also relates to the vendor name —
//              amount+date alone is not enough evidence on its own (proven:
//              it matched an AirTech repair call to a Local Marketing Fee
//              bill with nothing but coincidental timing and size).
export interface Suggestion {
  txnId: string;
  amount: number;   // absolute dollars
  date: string;      // ISO
  name: string;       // payee, to visually confirm against
  confidence: 'vendor' | 'amount';
  /** Other bills this SAME payment also settles (lump-sum drafts like Neal
   *  Realty's rent+CAM or MTC's rent+water) — the UI uses this to confirm
   *  every linked occurrence together, since it's genuinely one payment. */
  alsoSettles?: string[];
  /** due minus the transaction date, in days — positive means the payment
   *  landed BEFORE due (early), negative/zero means on time or after. A
   *  payment more than a few days early is a real caution sign: on a
   *  high-frequency bill it usually means a nearer transaction was claimed
   *  by a different occurrence (a tie-break issue, or a wrong-period
   *  pairing) rather than this payment genuinely arriving early. The UI
   *  flags anything at or above EARLY_FLAG_DAYS. */
  earlyByDays?: number;
}

// Mirrored as a local constant in BillsOverview.tsx (a client component can't
// import a value from this server-only module without pulling the whole
// module into the client bundle) — keep the two in sync if this changes.
export const EARLY_FLAG_DAYS = 5;

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

// Local Marketing Fee (1% of sales, all 3 stores) has NO dedicated ACH
// originator anywhere in the bank feed — verified 2026-08-08: Royalty's real
// draft is 1.0018x its pure-6%-of-sales expectation (no hidden extra 1%
// riding along), and a wide search of every Miramar transaction near the due
// date across three months found nothing sized right. Confirmed a false
// positive too: Pines' only "match" was the exact same transaction as an
// AirTech repair call already excluded elsewhere. Amount-only guessing for
// these three bills produces noise, not signal — Pass 2 skips them until a
// real bank descriptor for this fee is found (a corporate statement showing
// where it actually lands), rather than keep surfacing wrong suggestions.
const NO_AMOUNT_FALLBACK = /Local Marketing/i;

const occKey = (billId: string, due: string) => `${billId}|${due}`;
const daysBetween = (a: string, b: string) =>
  Math.abs((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86_400_000);

// Same style of tokenizer used to derive the vendor-alias spec in the first
// place — this is deliberately a SANITY GATE on top of amount+date, not a
// replacement for real vendor-alias resolution. A generic fuzzy matcher was
// tried at the very start of this work and scored ~0% (bank ACH originator
// names share no words with vendor labels: "SKFI OPERATING" vs "Royalty
// Fees"), which is exactly why Pass 1 exists. Here the bar is much lower —
// require ANY shared token — because the point isn't to find the match, only
// to reject an amount+date coincidence whose text is obviously unrelated
// (an "Airtech" charge has nothing to do with a "Local Marketing Fee" bill).
const STOP = new Set(['the', 'and', 'inc', 'llc', 'corp', 'co', 'of', 'group', 'fees', 'fee',
  'bill', 'payment', 'payments', 'monthly', 'package', 'program', 'policy', 'base', 'cost',
  'order', 'utilities', 'insurance', 'smoothie', 'king', 'corporate', 'market', 'marketing',
  'national', 'regional', 'royalty', 'technology', 'store']);
const tokenize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w));

function relatesToVendor(vendor: string, txnText: string): boolean {
  const vTok = tokenize(vendor);
  const tTok = tokenize(txnText);
  if (!vTok.length || !tTok.length) return false;
  return vTok.some((v) => tTok.some((t) =>
    v === t || (Math.min(v.length, t.length) >= 4 && (v.startsWith(t) || t.startsWith(v)))));
}

export function suggestMatches(
  occurrences: ReconciledOccurrence[],
  txns: UnifiedTxn[],
): Map<string, Suggestion> {
  // Candidates: real outflows only — not transfers/card-payment echoes, not
  // deposits, and not sub-$1 bank-verification pennies (CASHRECJNL-style ACH
  // originators send these and they enrich to the same merchant name as real
  // payments — no bill in this system is legitimately under a dollar, so
  // excluding them outright is safe and stops them from ever winning a
  // same-day tie or lingering as a leftover "match" on some other occurrence).
  // UnifiedTxn convention is outflow-negative (see its own docstring).
  const outflows = txns.filter((t) => t.amount < 0 && Math.abs(t.amount) >= 1 && !t.isTransfer);
  // Cross-pass dedup: once ANY bill uses a transaction, Pass 2 must never
  // reassign it to a different, unrelated bill on a weaker coincidental match.
  const globallyClaimed = new Set<string>();
  // Per-bill dedup for Pass 1: a lump-sum payment (Neal Realty, MTC) rightly
  // settles several DIFFERENT bills at once, so it must stay claimable once
  // per bill it actually settles — just never twice for the SAME bill (which
  // would let one payment cover two different months of the same bill).
  const claimedByBill = new Map<string, Set<string>>();
  const out = new Map<string, Suggestion>();

  const open = occurrences
    .filter((o) => o.status !== 'paid')
    .sort((a, b) => a.due.localeCompare(b.due));

  const toSuggestion = (t: UnifiedTxn, confidence: Suggestion['confidence'], due: string): Suggestion => ({
    txnId: t.id, amount: Math.abs(t.amount), date: t.date, name: t.payee, confidence,
    alsoSettles: t.settledBillIds,
    earlyByDays: Math.round((new Date(due + 'T00:00:00Z').getTime() - new Date(t.date + 'T00:00:00Z').getTime()) / 86_400_000),
  });

  // Pass 1 — vendor-confirmed. A transaction is registered under EVERY bill it
  // settles (usually one; alsoSettles bills for lump-sum drafts), then each
  // occurrence claims its date-nearest still-available one from its own bill.
  // Date-nearest alone isn't enough of a tiebreaker: a high-frequency bill like
  // PFG's twice-weekly food cost can have a real payment land the same day as
  // an incidental $0.01 bank-verification ping (seen for real — those "penny"
  // debits from CASHRECJNL-style ACH originators enrich to the same merchant
  // name PFG does), and a pure date sort has no way to prefer the real payment
  // over the penny when both are dated the same. Amount-closeness to what's
  // actually expected breaks that tie — it's what caught this in the first
  // place: the $0.01 won a same-day tie for the 8/3 occurrence, and the real
  // ~$2,021 payment got pushed onto the *next* occurrence 7 days later,
  // looking like an early match instead of the correct one.
  const byBillId = new Map<string, UnifiedTxn[]>();
  for (const t of outflows) {
    if (!t.matched) continue;
    for (const id of t.settledBillIds ?? (t.billId ? [t.billId] : [])) {
      (byBillId.get(id) ?? byBillId.set(id, []).get(id)!).push(t);
    }
  }
  for (const o of open) {
    const usedByThisBill = claimedByBill.get(o.billId);
    const candidates = (byBillId.get(o.billId) ?? [])
      .filter((t) => !usedByThisBill?.has(t.id) && daysBetween(t.date, o.due) <= MAX_VENDOR_MATCH_DAYS);
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const byDate = daysBetween(a.date, o.due) - daysBetween(b.date, o.due);
      if (byDate !== 0) return byDate;
      if (o.expected == null) return 0;
      return Math.abs(Math.abs(a.amount) - o.expected) - Math.abs(Math.abs(b.amount) - o.expected);
    });
    const best = candidates[0];
    (claimedByBill.get(o.billId) ?? claimedByBill.set(o.billId, new Set()).get(o.billId)!).add(best.id);
    globallyClaimed.add(best.id);
    out.set(occKey(o.billId, o.due), toSuggestion(best, 'vendor', o.due));
  }

  // Pass 2 — amount+date fallback, for occurrences pass 1 didn't cover.
  // Never touches an already-matched transaction (it's real evidence it
  // belongs to a DIFFERENT, specific bill — reassigning it on a coincidence
  // would be strictly worse than showing nothing), and requires the
  // transaction's own text to relate to the vendor name, not amount+date alone.
  for (const o of open) {
    const k = occKey(o.billId, o.due);
    if (out.has(k) || o.expected == null || o.expected <= 0) continue;
    if (NO_AMOUNT_FALLBACK.test(o.vendor)) continue;
    const winStart = new Date(o.due + 'T00:00:00Z'); winStart.setUTCDate(winStart.getUTCDate() - MATCH_DAYS_BEFORE);
    const winEnd = new Date(o.due + 'T00:00:00Z'); winEnd.setUTCDate(winEnd.getUTCDate() + MATCH_DAYS_AFTER);
    const winStartISO = winStart.toISOString().slice(0, 10);
    const winEndISO = winEnd.toISOString().slice(0, 10);

    const candidates = outflows.filter((t) => {
      if (t.matched || globallyClaimed.has(t.id)) return false;
      if (t.store && t.store !== o.store) return false; // don't cross stores on a guess
      if (t.date < winStartISO || t.date > winEndISO) return false;
      const variance = Math.abs(Math.abs(t.amount) - o.expected!) / o.expected!;
      if (variance > MATCH_TOLERANCE) return false;
      // t.notes is only ever populated for already-matched transactions
      // (excluded above), so payee — the raw merchant/descriptor text for an
      // unmatched one — is the only useful field here.
      return relatesToVendor(o.vendor, t.payee);
    });
    if (!candidates.length) continue;
    candidates.sort((a, b) => daysBetween(a.date, o.due) - daysBetween(b.date, o.due));
    const best = candidates[0];
    globallyClaimed.add(best.id);
    out.set(k, toSuggestion(best, 'amount', o.due));
  }

  return out;
}
