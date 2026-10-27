import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from './db';
import { loadBills, markPaid } from './data';
import { getDashboardData } from './service';
import type { ReconciledOccurrence } from './reconcile';

/**
 * The one place a bank payment marks a bill paid without a click.
 *
 * WHY. 2026-08-21 Sam chose "suggestions": a three-signal bank match only proposed.
 * Nobody confirmed proposals after Oct 5, and on 2026-10-27 the Bills page read 114
 * bills missed or overdue with about 100 of them paid. Sam reversed the call that day
 * ("make [the] fix so it doesn't go stale"), with the CFO agent in Nexus reporting
 * what was cleared so it can be checked and undone.
 *
 * WHAT CLEARS. Only a reconcile `bankProposal` — the alias table resolved the exact
 * transaction to this bill, the amount is inside BILL_MATCH_TOLERANCE, the date is
 * inside the bill's window — and only when that alias rule is CONFIRMED. A weaker
 * suggestMatch suggestion never clears. The bank must show the payment POSTED, not pending.
 *
 * WHAT DOESN'T. Payments dated before AUTOCLEAR_FROM: everything up to then was
 * reconciled by hand on 2026-10-27, and re-deriving it would re-litigate decisions the
 * bank can't see (Margate's Oct 6 rent paid SEPTEMBER, not October). An occurrence Sam
 * un-marked after an auto-clear is never cleared again.
 *
 * OLDEST FIRST. A late rent, loan or insurance payment pays the oldest open month, the
 * way a landlord or lender applies it: Margate's October rent paid on Nov 3 clears
 * October, not November. See OLDEST_FIRST_CATEGORIES for why it stops there.
 */
export const AUTOCLEAR_FROM = '2026-10-27';
// Where arrears are real and a late payment is applied to the oldest month: rent, loans,
// insurance. Everything else (utilities, subscriptions, fees, food, payroll) is billed
// and drafted per period, so an older open month there is a gap to show, not a debt the
// next payment settles — applying it backwards would leave the CURRENT month reading
// unpaid forever. One period back at most, for the same reason.
const OLDEST_FIRST_CATEGORIES = new Set(['Rent / Lease', 'Loan / Debt', 'Insurance']);
const OLDEST_FIRST_LOOKBACK_DAYS = 45;
const daysBefore = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
};

export interface AutoCleared {
  billId: string; vendor: string; store: string; due: string;
  txnId: string; txnDate: string; amount: number; payee: string;
  /** Set when oldest-first moved the payment from the occurrence it matched. */
  movedFrom?: string;
  /** Every debit, when the payment came as a same-day split. */
  txnIds?: string[];
}
export interface AutoClearResult {
  dryRun: boolean;
  cleared: AutoCleared[];
  /** Proposals passed over, and why — the CFO note lists these as exceptions. */
  skipped: { billId: string; vendor: string; store: string; due: string; reason: string }[];
}

export async function ensureAutoClearTable(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='sk_bills' AND TABLE_NAME='BillAutoClear')
     CREATE TABLE sk_bills.BillAutoClear (
       id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       billId NVARCHAR(64) NOT NULL, dueDate NVARCHAR(10) NOT NULL,
       store NVARCHAR(20) NULL, vendor NVARCHAR(200) NULL,
       txnId NVARCHAR(64) NOT NULL, txnIds NVARCHAR(400) NULL, txnDate NVARCHAR(10) NOT NULL,
       amount FLOAT NOT NULL, payee NVARCHAR(200) NULL, movedFrom NVARCHAR(10) NULL,
       clearedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), undoneAt DATETIME2 NULL,
       CONSTRAINT UQ_BillAutoClear_bill_due UNIQUE (billId, dueDate))`,
  );
}

const isOpen = (o: ReconciledOccurrence) => o.status === 'missed' || o.status === 'overdue' || o.status === 'due';

/**
 * Pure: which occurrences the bank clears, given the reconciled view. Kept apart from
 * the writes so it can be checked against real data without touching the database.
 */
export function planAutoClear(
  occurrences: ReconciledOccurrence[],
  categoryOf: (billId: string) => string,
  undone: Set<string>,
  /** Earliest payment date eligible. Only tests move it. */
  from: string = AUTOCLEAR_FROM,
): Pick<AutoClearResult, 'cleared' | 'skipped'> {
  const byBill = new Map<string, ReconciledOccurrence[]>();
  for (const o of occurrences) byBill.set(o.billId, [...(byBill.get(o.billId) ?? []), o]);
  const out: Pick<AutoClearResult, 'cleared' | 'skipped'> = { cleared: [], skipped: [] };
  for (const [billId, occs] of byBill) {
    occs.sort((a, b) => a.due.localeCompare(b.due));
    const taken = new Set<string>();
    const oldestFirst = OLDEST_FIRST_CATEGORIES.has(categoryOf(billId));
    const proposals = occs
      .filter((o) => isOpen(o) && o.bankProposal)
      .sort((a, b) => a.bankProposal!.date.localeCompare(b.bankProposal!.date));
    for (const p of proposals) {
      const bp = p.bankProposal!;
      const skip = (reason: string) => out.skipped.push({ billId, vendor: p.vendor, store: p.store, due: p.due, reason });
      if (bp.date < from) continue; // reconciled by hand before the job existed
      if (bp.cleared === false) { skip('payment still pending at the bank'); continue; }
      if (bp.confirmed === false) { skip('matched by a rule that is not confirmed yet'); continue; }
      let target = p;
      if (oldestFirst) {
        const floor = daysBefore(p.due, OLDEST_FIRST_LOOKBACK_DAYS);
        const older = occs.find((o) => isOpen(o) && o.due < p.due && o.due >= floor && !taken.has(o.due)
          && !undone.has(`${billId}|${o.due}`));
        if (older) target = older;
      }
      if (taken.has(target.due)) { skip('payment already applied to this occurrence'); continue; }
      if (undone.has(`${billId}|${target.due}`)) { skip('you un-marked this one after an earlier auto-clear'); continue; }
      taken.add(target.due);
      out.cleared.push({
        billId, vendor: target.vendor, store: target.store, due: target.due,
        txnId: bp.txnId, txnDate: bp.date, amount: Math.round(bp.amount * 100) / 100, payee: bp.payee,
        ...(target.due !== p.due ? { movedFrom: p.due } : {}),
        ...(bp.txnIds ? { txnIds: bp.txnIds } : {}),
      });
    }
  }
  return out;
}

export async function runAutoClear(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<AutoClearResult> {
  const dryRun = !!opts.dryRun;
  const db = getPrisma();
  if (!db) throw new Error('db not configured');
  await ensureAutoClearTable(db);
  const prior = await db.$queryRaw<{ billId: string; dueDate: string; undoneAt: Date | null }[]>`
    SELECT billId, dueDate, undoneAt FROM sk_bills.BillAutoClear`;
  const undone = new Set(prior.filter((r) => r.undoneAt).map((r) => `${r.billId}|${r.dueDate}`));

  const [data, bills] = await Promise.all([getDashboardData(now), loadBills()]);
  const category = new Map(bills.map((b) => [b.id, b.category]));
  const plan = planAutoClear(data.occurrences, (id) => category.get(id) ?? '', undone);
  if (!dryRun) {
    for (const row of plan.cleared) {
      await markPaid(row.billId, row.due);
      const txnIds = row.txnIds?.join(',') ?? null;
      await db.$executeRaw`IF NOT EXISTS (SELECT 1 FROM sk_bills.BillAutoClear WHERE billId = ${row.billId} AND dueDate = ${row.due})
        INSERT INTO sk_bills.BillAutoClear (billId, dueDate, store, vendor, txnId, txnIds, txnDate, amount, payee, movedFrom)
        VALUES (${row.billId}, ${row.due}, ${row.store}, ${row.vendor}, ${row.txnId}, ${txnIds}, ${row.txnDate},
                ${row.amount}, ${row.payee}, ${row.movedFrom ?? null})`;
    }
  }
  return { dryRun, ...plan };
}

/** Auto-clears from the last `days` days that are still standing — the CFO note's "handled" list. */
export async function recentAutoClears(days: number): Promise<AutoCleared[]> {
  const db = getPrisma();
  if (!db) return [];
  try {
    const rows = await db.$queryRaw<{ billId: string; dueDate: string; store: string; vendor: string; txnId: string;
      txnDate: string; amount: number; payee: string | null; movedFrom: string | null }[]>`
      SELECT billId, dueDate, store, vendor, txnId, txnDate, amount, payee, movedFrom FROM sk_bills.BillAutoClear
      WHERE undoneAt IS NULL AND clearedAt >= DATEADD(day, ${-days}, SYSUTCDATETIME()) ORDER BY clearedAt DESC`;
    return rows.map((r) => ({ billId: r.billId, vendor: r.vendor, store: r.store, due: r.dueDate, txnId: r.txnId,
      txnDate: r.txnDate, amount: r.amount, payee: r.payee ?? '', ...(r.movedFrom ? { movedFrom: r.movedFrom } : {}) }));
  } catch {
    return []; // no clear has run yet
  }
}
