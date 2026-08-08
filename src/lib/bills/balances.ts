import 'server-only';
import { getPrisma } from './db';

// The ONE place that reads sk_bills.QbBalance (OpenBudget-sourced, written daily
// by /api/sync). Cash Flow and Bills both call this rather than each running
// their own query — Bills used to hit QuickBooks live instead (/api/qb/stores),
// which silently falls back to QBO's lagging book balance since QBO never
// actually populates the BankBalance field it claims to prefer. That meant
// Cash Flow and Bills could show two different cash figures for the same store
// with no indication they weren't the same thing. One function, one number,
// used everywhere "how much cash do we have right now" is asked.

export interface LiveBalance {
  store: string;
  checking: number;
  savings: number;
  cashTotal: number;
  creditCard: number;
  updatedAt: string; // ISO
  ageHours: number;
  stale: boolean;
}

const STALE_HOURS = Number(process.env.OPENBUDGET_STALE_HOURS ?? 24);

export async function getLiveBalances(): Promise<LiveBalance[]> {
  const db = getPrisma();
  if (!db) return [];
  type Row = {
    store: string; checking: number; savings: number;
    creditCard: number; cashTotal: number; updatedAt: Date;
  };
  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT store, checking, savings, creditCard, cashTotal, updatedAt FROM sk_bills.QbBalance`,
  ).catch(() => [] as Row[]);

  const now = Date.now();
  return rows.map((r) => {
    const ageHours = (now - new Date(r.updatedAt).getTime()) / 3_600_000;
    return {
      store: r.store, checking: r.checking, savings: r.savings,
      cashTotal: r.cashTotal, creditCard: r.creditCard,
      updatedAt: new Date(r.updatedAt).toISOString(),
      ageHours, stale: ageHours > STALE_HOURS,
    };
  });
}
