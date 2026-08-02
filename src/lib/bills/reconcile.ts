import 'server-only';
import type { BillRecord } from './types';
import type { SalesData } from './billsEngine';
import type { ActualTxn } from './actual';
import { dueDatesInRange, resolveAmount, iso, ymOf } from './billsEngine';

export interface ReconciledOccurrence {
  billId: string;
  vendor: string;
  store: string;
  payment: string;
  due: string;
  original: string;
  shifted: boolean;
  expected: number | null;
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
const MATCH_TOLERANCE = 0.25; // 25% variance — wide enough for variable payroll/COGS

export function reconcile(
  bills: BillRecord[],
  sales: SalesData,
  txnsByAccount: Record<string, ActualTxn[]>,
  manualPaid: Set<string>,
  lookbackISO: string,
  horizonISO: string,
  now: Date,
): ReconciledOccurrence[] {
  const nowISO = iso(now);
  const dueWindowEnd = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + DUE_DAYS));
  const out: ReconciledOccurrence[] = [];

  for (const bill of bills) {
    if (bill.active === false) continue;
    const occ = dueDatesInRange(bill.recurrence, bill.anchor ?? null, bill.end ?? null, lookbackISO, horizonISO);
    const txns = bill.account ? (txnsByAccount[bill.account] ?? []) : [];
    const claimed = new Set<string>();
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
          return variance <= MATCH_TOLERANCE;
        });
      }

      if (match) claimed.add(match.id);

      const manualKey = `${bill.id}|${dueISO}`;
      let status: ReconciledOccurrence['status'];
      if (manualPaid.has(manualKey) || match) {
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

      const matchDollars = match ? Math.abs(match.amount) / 100 : null;
      if (matchDollars != null) {
        rollingBuf.push(matchDollars);
        if (rollingBuf.length > 3) rollingBuf.shift();
      }

      // For upcoming occurrences: override expected with rolling average if we have history.
      const rollingAvg = rollingBuf.length > 0 ? rollingBuf.reduce((a, b) => a + b) / rollingBuf.length : null;
      const expectedDollars = status === 'upcoming' && rollingAvg != null ? rollingAvg : staticExpected;

      const variancePct =
        match && expectedDollars != null && expectedDollars > 0
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
        rollingEstimate: status === 'upcoming' && rollingAvg != null,
        status,
        match: match ? { txnId: match.id, amount: matchDollars!, variancePct } : undefined,
      });
    }
  }

  return out;
}
