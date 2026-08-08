import { Bill, SalesData, dueDatesInRange, resolveAmount, iso, ymOf } from './billsEngine';

export interface MonthTotals {
  ym: string;
  fixed: number;
  estimate: number;
  percent: number;
  total: number;
  needsSales: boolean;
}

export interface Forecast {
  months: string[];
  rows: MonthTotals[];
  grandTotal: number;
}

const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const lastOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export function buildForecast(
  bills: Bill[],
  sales: SalesData,
  store: string,
  now: Date = new Date(),
  horizonMonths = 12,
): Forecast {
  const start = firstOfMonth(now);
  const end = lastOfMonth(new Date(now.getFullYear(), now.getMonth() + horizonMonths - 1, 1));
  const winStart = iso(start);
  const winEnd = iso(end);

  const months: string[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    months.push(ymOf(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }
  const blank = (ym: string): MonthTotals => ({ ym, fixed: 0, estimate: 0, percent: 0, total: 0, needsSales: false });
  const map: Record<string, MonthTotals> = Object.fromEntries(months.map((m) => [m, blank(m)]));

  const scoped = bills.filter((b) => b.active !== false && (store === 'All' || b.store === store));

  for (const bill of scoped) {
    const occ = dueDatesInRange(bill.recurrence, bill.anchor || null, bill.end || null, winStart, winEnd);
    for (const o of occ) {
      const ym = ymOf(o.due);
      const bucket = map[ym];
      if (!bucket) continue;
      const r = resolveAmount(bill, sales, ym, iso(o.due));
      if (bill.amountType === 'percent') {
        if (!r.known || r.val == null) { bucket.needsSales = true; continue; }
        bucket.percent += r.val;
      } else if (bill.amountType === 'estimate') {
        bucket.estimate += r.val ?? 0;
      } else {
        bucket.fixed += r.val ?? 0;
      }
    }
  }

  let grandTotal = 0;
  const rows = months.map((m) => {
    const r = map[m];
    r.total = r.fixed + r.estimate + r.percent;
    grandTotal += r.total;
    return r;
  });

  return { months, rows, grandTotal };
}
