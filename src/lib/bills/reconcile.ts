import 'server-only';
import type { BillRecord } from './types';
import type { SalesData } from './billsEngine';
import type { ActualTxn } from './actual';
import { dueDatesInRange, resolveAmount, iso, ymOf, recurrenceIntervalDays } from './billsEngine';
import {
  BILL_MATCH_TOLERANCE, BILL_MATCH_EARLY_DAYS,
  BILL_MATCH_LATE_DAYS_AUTO, BILL_MATCH_LATE_DAYS_MANUAL,
} from '../core/targets';
import type { UnifiedTxn } from './unifiedTransactions';

export interface ReconciledOccurrence {
  billId: string;
  vendor: string;
  store: string;
  payment: string;
  due: string;
  original: string;
  shifted: boolean;
  expected: number | null;
  /** Nominal days between this bill's occurrences — bounds how far a transaction
   *  may sit from `due` and still plausibly be THIS occurrence's payment. */
  intervalDays: number;
  rollingEstimate?: boolean;
  status: 'paid' | 'due' | 'overdue' | 'missed' | 'upcoming';
  match?: {
    txnId: string;
    amount: number;
    variancePct: number | null;
  };
}

const DUE_DAYS = 3;          // days ahead that count as "due"
const MATCH_DAYS_BEFORE = 10; // how far before due date to look for a txn
const MATCH_DAYS_AFTER = 5;   // how far after due date to look for a txn

/**
 * Auto-match from the BANK FEED, for occurrences the QuickBooks path cannot reach.
 *
 * Why this exists. reconcile matched 0 of 618 occurrences, so 61 bills sat marked
 * overdue while every one of them had a payment in the bank feed — 14 of them
 * vendor-alias confirmed, same day, same amount to the dollar. Two causes, both
 * structural: 57 of 68 active bills have `account` NULL and reconcile skips any bill
 * without one, and the 11 that have it use four incompatible schemes ("BOA", two
 * UUIDs, a bank account number) that are not QuickBooks account ids. So the path
 * that MARKS BILLS PAID had no data, while the parallel path that only proposes had
 * 1,843 rows.
 *
 * This is deliberately the narrowest possible fix: it marks paid ONLY when all three
 * independent signals agree — the vendor-alias table resolved this exact transaction
 * to this exact bill, the amount is inside BILL_MATCH_TOLERANCE, and the date is
 * inside the same asymmetric window suggestMatch uses. Anything less than all three
 * stays unmatched and keeps showing as a SUGGESTION for a human to confirm, which is
 * the behaviour that already exists and is not weakened here.
 *
 * A transaction settles a given bill at most once, so one payment cannot clear two
 * months of the same bill.
 */
function bankAutoMatch(
  bill: BillRecord,
  dueISO: string,
  expected: number | null,
  feed: UnifiedTxn[],
  claimed: Set<string>,
): UnifiedTxn | undefined {
  if (expected == null || expected <= 0) return undefined;
  const late = bill.payment === 'auto' ? BILL_MATCH_LATE_DAYS_AUTO : BILL_MATCH_LATE_DAYS_MANUAL;
  const best = feed
    .filter((t) => {
      if (claimed.has(`${bill.id}|${t.id}`)) return false;
      if (!t.matched) return false;
      const settles = t.settledBillIds ?? (t.billId ? [t.billId] : []);
      if (!settles.includes(bill.id)) return false;
      const off = Math.round(
        (Date.parse(t.date + 'T00:00:00Z') - Date.parse(dueISO + 'T00:00:00Z')) / 86_400_000);
      if (off < -BILL_MATCH_EARLY_DAYS || off > late) return false;
      return Math.abs(Math.abs(t.amount) - expected) / expected <= BILL_MATCH_TOLERANCE;
    })
    .sort((a, b) =>
      Math.abs(Date.parse(a.date) - Date.parse(dueISO)) -
      Math.abs(Date.parse(b.date) - Date.parse(dueISO)))[0];
  return best;
}

export function reconcile(
  bills: BillRecord[],
  sales: SalesData,
  txnsByAccount: Record<string, ActualTxn[]>,
  manualPaid: Set<string>,
  lookbackISO: string,
  horizonISO: string,
  now: Date,
  /** Bank feed, for the auto-match above. Omitted in callers that have none. */
  feed: UnifiedTxn[] = [],
): ReconciledOccurrence[] {
  const nowISO = iso(now);
  const dueWindowEnd = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + DUE_DAYS));
  const out: ReconciledOccurrence[] = [];

  for (const bill of bills) {
    if (bill.active === false) continue;
    const occ = dueDatesInRange(bill.recurrence, bill.anchor ?? null, bill.end ?? null, lookbackISO, horizonISO);
    const txns = bill.account ? (txnsByAccount[bill.account] ?? []) : [];
    const claimed = new Set<string>();
    // Separate ledger for bank-feed claims: the QB set is keyed by txn id alone and
    // scoped to one bill's account, whereas one bank payment can legitimately settle
    // several DIFFERENT bills (Neal Realty's draft covers rent and property expense),
    // so this is keyed by bill+txn.
    const bankClaimed = new Set<string>();
    // Rolling buffer: last 3 confirmed transaction amounts (dollars) for this bill.
    // Used to estimate upcoming occurrences instead of relying on stale fixed/percent values.
    const rollingBuf: number[] = [];

    for (const o of occ) {
      const dueISO = iso(o.due);
      const ym = ymOf(o.due);
      const { val: staticExpected } = resolveAmount(bill as any, sales, ym, dueISO);

      // For matching past/current: use static expected so we don't miss transactions outside rolling tolerance.
      let match: ActualTxn | undefined;
      const matchBasis = staticExpected ?? (rollingBuf.length > 0 ? rollingBuf.reduce((a, b) => a + b) / rollingBuf.length : null);
      if (matchBasis != null && bill.account) {
        const winStart = new Date(o.due); winStart.setDate(winStart.getDate() - MATCH_DAYS_BEFORE);
        const winEnd = new Date(o.due); winEnd.setDate(winEnd.getDate() + MATCH_DAYS_AFTER);
        const winStartISO = iso(winStart);
        const winEndISO = iso(winEnd);

        match = txns.find((t) => {
          if (claimed.has(t.id)) return false;
          if (t.date < winStartISO || t.date > winEndISO) return false;
          const dollars = Math.abs(t.amount) / 100;
          const variance = matchBasis > 0 ? Math.abs(dollars - matchBasis) / matchBasis : 0;
          return variance <= BILL_MATCH_TOLERANCE;
        });
      }

      if (match) claimed.add(match.id);

      // QuickBooks reaches almost nothing (see bankAutoMatch). Fall back to the bank
      // feed, but only on a three-signal agreement.
      let bankMatch: UnifiedTxn | undefined;
      if (!match) {
        bankMatch = bankAutoMatch(bill, dueISO, staticExpected ?? matchBasis, feed, bankClaimed);
        if (bankMatch) bankClaimed.add(`${bill.id}|${bankMatch.id}`);
      }

      const manualKey = `${bill.id}|${dueISO}`;
      let status: ReconciledOccurrence['status'];
      if (manualPaid.has(manualKey) || match || bankMatch) {
        status = 'paid';
      } else if (dueISO > dueWindowEnd) {
        status = 'upcoming';
      } else if (dueISO >= nowISO) {
        status = 'due';
      } else if (bill.payment === 'auto') {
        status = 'missed';
      } else {
        status = 'overdue';
      }

      // ActualTxn amounts are CENTS; UnifiedTxn amounts are DOLLARS and
      // outflow-negative. Getting this wrong would report a $2,000 bill as $200,000.
      const matchDollars = match
        ? Math.abs(match.amount) / 100
        : bankMatch ? Math.abs(bankMatch.amount) : null;
      if (matchDollars != null) {
        rollingBuf.push(matchDollars);
        if (rollingBuf.length > 3) rollingBuf.shift();
      }

      // For upcoming occurrences: override expected with rolling average if we have history.
      const rollingAvg = rollingBuf.length > 0 ? rollingBuf.reduce((a, b) => a + b) / rollingBuf.length : null;
      const expectedDollars = status === 'upcoming' && rollingAvg != null ? rollingAvg : staticExpected;

      // Either kind of match — this tested `match` alone, so every bank-matched
      // occurrence reported a null variance and the UI would have shown a 15% miss
      // as no miss at all.
      const variancePct =
        (match || bankMatch) && expectedDollars != null && expectedDollars > 0
          ? (matchDollars! - expectedDollars) / expectedDollars
          : null;

      out.push({
        billId: bill.id,
        vendor: bill.vendor,
        store: bill.store,
        payment: bill.payment,
        due: dueISO,
        original: iso(o.original),
        shifted: o.shifted,
        expected: expectedDollars,
        intervalDays: recurrenceIntervalDays(bill.recurrence),
        rollingEstimate: status === 'upcoming' && rollingAvg != null,
        status,
        match: match
          ? { txnId: match.id, amount: matchDollars!, variancePct }
          : bankMatch
            ? { txnId: bankMatch.id, amount: matchDollars!, variancePct }
            : undefined,
      });
    }
  }

  return out;
}
