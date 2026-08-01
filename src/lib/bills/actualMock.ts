import { SalesData, dueDatesInRange, resolveAmount, iso, ymOf } from './billsEngine';
import type { BillRecord } from './types';
import type { ActualTxn } from './actual';

const DEMO_UNPAID = new Set<string>([
  'Capital One — CC Bill',
  'Rent — Base Rent',
]);

const ASSUMED_SALES: Record<string, number> = { Margate: 64000, Miramar: 58000, Pines: 71000 };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
};

export function buildMockTxns(
  bills: BillRecord[],
  sales: SalesData,
  startISO: string,
  now: Date,
): Record<string, ActualTxn[]> {
  const nowISO = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const curYM = ymOf(now);
  const byAccount: Record<string, ActualTxn[]> = {};

  for (const bill of bills) {
    if (bill.active === false || !bill.account) continue;
    const occ = dueDatesInRange(bill.recurrence, bill.anchor || null, bill.end || null, startISO, nowISO);

    for (const o of occ) {
      const dueISO = iso(o.due);
      if (DEMO_UNPAID.has(bill.vendor) && ymOf(o.due) === curYM) continue;

      let amt = resolveAmount(bill as any, sales, ymOf(o.due)).val;
      if (amt == null) {
        amt = (bill.amountValue / 100) * (ASSUMED_SALES[bill.store] ?? 60000);
      }
      if (bill.amountType !== 'fixed') {
        const jitter = (hash(`${bill.id}:${dueISO}`) - 0.5) * 0.08;
        amt = amt * (1 + jitter);
      }
      const cents = -Math.round(amt * 100);

      (byAccount[bill.account] ||= []).push({
        id: `mock:${bill.id}:${dueISO}`,
        account: bill.account,
        date: dueISO,
        amount: cents,
        payee_name: bill.vendor,
        cleared: true,
      });
    }
  }
  return byAccount;
}

export function mockAccountsMap(bills: BillRecord[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of bills) {
    if (!b.account) continue;
    const name = `${b.store} · ${b.paidFrom || 'Unassigned'} (mock)`;
    out[name] = b.account;
  }
  return out;
}
