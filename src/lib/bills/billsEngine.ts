// lib/billsEngine.ts
// Framework-agnostic bill scheduling engine extracted from the SK tracker.
// Pure functions, no DOM, no storage. Safe to import on server or client.

import { isFranchisePercentFee, periodForDraw, BASIS_FACTOR } from './periods';

export type RecurrenceRule =
  | { type: 'monthly_day'; day: number }
  | { type: 'monthly_last_day' }
  | { type: 'monthly_nth_weekday'; nth: number; weekday: number }
  | { type: 'semimonthly'; day1: number; day2: number }
  | { type: 'weekly'; weekday: number }
  | { type: 'biweekly' }
  | { type: 'every_n_days'; n: number }
  | { type: 'every_n_months'; n: number; day: number }
  | { type: 'yearly'; month: number; day: number };

/**
 * Nominal days between consecutive occurrences of a rule.
 *
 * Used to bound how far from its due date a transaction may sit and still plausibly
 * be THIS occurrence's payment. It is deliberately nominal — a month is 30 whether
 * it is February or March — because the only thing downstream of it is a symmetric
 * tolerance window, and a day either way there changes nothing.
 */
export function recurrenceIntervalDays(rule: RecurrenceRule): number {
  switch (rule.type) {
    case 'weekly': return 7;
    case 'biweekly': return 14;
    case 'semimonthly': return 15;
    case 'every_n_days': return Math.max(1, rule.n);
    case 'every_n_months': return Math.max(1, rule.n) * 30;
    case 'yearly': return 365;
    // monthly_day, monthly_last_day, monthly_nth_weekday
    default: return 30;
  }
}

export type AmountType = 'fixed' | 'estimate' | 'percent';
export type Payment = 'auto' | 'manual';

export interface Bill {
  id: string;
  store: string;
  vendor: string;
  category: string;
  recurrence: RecurrenceRule;
  amountType: AmountType;
  amountValue: number;
  payment: Payment;
  account?: string;
  anchor?: string | null;
  end?: string | null;
  notes?: string;
  active?: boolean;
}

export type SalesData = Record<string, Record<string, { projected?: number | null; actual?: number | null }>>;

export interface Occurrence {
  original: Date;
  due: Date;
  shifted: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

function nthWeekday(y: number, m: number, weekday: number, nth: number): Date | null {
  if (nth === -1) { for (let day = daysInMonth(y, m); day >= 1; day--) { const dt = new Date(y, m, day); if (dt.getDay() === weekday) return dt; } }
  let c = 0;
  for (let day = 1; day <= daysInMonth(y, m); day++) { const dt = new Date(y, m, day); if (dt.getDay() === weekday) { c++; if (c === nth) return dt; } }
  return null;
}

function holidaysObserved(year: number): Set<string> {
  const set = new Set<string>();
  const add = (y: number, m: number, d: number) => { let dt = new Date(y, m, d); const wd = dt.getDay(); if (wd === 6) dt = addDays(dt, -1); else if (wd === 0) dt = addDays(dt, 1); set.add(iso(dt)); };
  add(year, 0, 1);
  set.add(iso(nthWeekday(year, 0, 1, 3)!));
  set.add(iso(nthWeekday(year, 1, 1, 3)!));
  set.add(iso(nthWeekday(year, 4, 1, -1)!));
  add(year, 5, 19);
  add(year, 6, 4);
  set.add(iso(nthWeekday(year, 8, 1, 1)!));
  set.add(iso(nthWeekday(year, 9, 1, 2)!));
  add(year, 10, 11);
  set.add(iso(nthWeekday(year, 10, 4, 4)!));
  add(year, 11, 25);
  return set;
}
const holCache: Record<number, Set<string>> = {};
function isHoliday(d: Date) { const y = d.getFullYear(); if (!holCache[y]) holCache[y] = holidaysObserved(y); return holCache[y].has(iso(d)); }
export function isBusinessDay(d: Date) { const wd = d.getDay(); return wd !== 0 && wd !== 6 && !isHoliday(d); }
export function shiftToBusinessDay(d: Date): Occurrence { let x = new Date(d), shifted = false; while (!isBusinessDay(x)) { x = addDays(x, 1); shifted = true; } return { original: d, due: x, shifted }; }

export function dueDatesInRange(rule: RecurrenceRule, anchorISO: string | null, endISO: string | null, winStartISO: string, winEndISO: string): Occurrence[] {
  const ws = parseISO(winStartISO), we = parseISO(winEndISO);
  const anchor = anchorISO ? parseISO(anchorISO) : null;
  const end = endISO ? parseISO(endISO) : null;
  const out: Occurrence[] = [];
  const push = (nat: Date) => { if (nat < ws || nat > we) return; if (anchor && nat < anchor) return; if (end && nat > end) return; out.push(shiftToBusinessDay(nat)); };
  const t = rule.type;
  if (['monthly_day', 'monthly_last_day', 'monthly_nth_weekday', 'semimonthly', 'yearly', 'every_n_months'].includes(t)) {
    let cur = new Date(ws.getFullYear(), ws.getMonth() - 1, 1);
    const stop = new Date(we.getFullYear(), we.getMonth() + 2, 1);
    while (cur < stop) {
      const cy = cur.getFullYear(), cm = cur.getMonth();
      if (rule.type === 'monthly_day') push(new Date(cy, cm, Math.min(rule.day, daysInMonth(cy, cm))));
      else if (rule.type === 'monthly_last_day') push(new Date(cy, cm, daysInMonth(cy, cm)));
      else if (rule.type === 'monthly_nth_weekday') { const dt = nthWeekday(cy, cm, rule.weekday, rule.nth); if (dt) push(dt); }
      else if (rule.type === 'semimonthly') [rule.day1, rule.day2].forEach(dd => push(new Date(cy, cm, Math.min(dd, daysInMonth(cy, cm)))));
      else if (rule.type === 'yearly') { if (cm === rule.month) push(new Date(cy, cm, Math.min(rule.day, daysInMonth(cy, cm)))); }
      else if (rule.type === 'every_n_months' && anchor) { const md = (cy - anchor.getFullYear()) * 12 + (cm - anchor.getMonth()); if (md >= 0 && md % rule.n === 0) push(new Date(cy, cm, Math.min(rule.day, daysInMonth(cy, cm)))); }
      cur = new Date(cy, cm + 1, 1);
    }
  } else if (rule.type === 'weekly' || rule.type === 'biweekly' || rule.type === 'every_n_days') {
    if (!anchor) return out;
    const step = rule.type === 'weekly' ? 7 : rule.type === 'biweekly' ? 14 : rule.n;
    let first = new Date(anchor);
    if (rule.type === 'weekly' && typeof rule.weekday === 'number') { while (first.getDay() !== rule.weekday) first = addDays(first, 1); }
    if (first < ws) { const gap = Math.floor((+ws - +first) / (86400000 * step)); first = addDays(first, gap * step); }
    let cur = new Date(first);
    while (cur <= we) { push(cur); cur = addDays(cur, step); }
  }
  out.sort((a, b) => +a.due - +b.due);
  return out;
}

export function resolveAmount(
  bill: Bill,
  sales: SalesData,
  ym: string,
  dueISO?: string,
): { val: number | null; known: boolean; salesBasis?: 'actual' | 'projected' } {
  if (bill.amountType === 'fixed' || bill.amountType === 'estimate') return { val: +bill.amountValue || 0, known: true };

  // Franchise %-of-sales fees (royalty / national+regional ad fund) bill on the
  // just-CLOSED fiscal period's net sales — not the calendar month of the draw —
  // and against SK's slightly-lower reportable net (per-store BASIS_FACTOR). See
  // ./periods.ts. Falls back to the monthly path if we don't have a draw date.
  if (isFranchisePercentFee(bill) && dueISO) {
    const period = periodForDraw(dueISO);
    const s = period ? sales?.[bill.store]?.[period.id] : undefined;
    const basis = BASIS_FACTOR[bill.store] ?? 1;
    if (s?.actual != null) return { val: (+bill.amountValue / 100) * +s.actual * basis, known: true, salesBasis: 'actual' };
    if (s?.projected != null) return { val: (+bill.amountValue / 100) * +s.projected * basis, known: true, salesBasis: 'projected' };
    return { val: null, known: false };
  }

  const s = sales?.[bill.store]?.[ym];
  const actual = s?.actual, projected = s?.projected;
  if (actual != null && actual !== ('' as any)) return { val: (+bill.amountValue / 100) * +actual, known: true, salesBasis: 'actual' };
  if (projected != null && projected !== ('' as any)) return { val: (+bill.amountValue / 100) * +projected, known: true, salesBasis: 'projected' };
  return { val: null, known: false };
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function scheduleLabel(r: RecurrenceRule): string {
  const ord = (n: number) => n === -1 ? 'last' : ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' } as any)[n] || n + 'th';
  switch (r.type) {
    case 'monthly_day': return `Monthly · ${ord(r.day)}`;
    case 'monthly_last_day': return 'Monthly · last day';
    case 'monthly_nth_weekday': return `${ord(r.nth)} ${WD[r.weekday]} monthly`;
    case 'semimonthly': return `Twice monthly · ${ord(r.day1)} & ${ord(r.day2)}`;
    case 'weekly': return `Weekly · ${WDFULL[r.weekday]}`;
    case 'biweekly': return 'Every 2 weeks';
    case 'every_n_days': return `Every ${r.n} days`;
    case 'every_n_months': return r.n === 3 ? `Quarterly · ${ord(r.day)}` : r.n === 2 ? `Every 2 months · ${ord(r.day)}` : `Every ${r.n} months · ${ord(r.day)}`;
    case 'yearly': return `Yearly · ${MON[r.month]} ${r.day}`;
  }
}
