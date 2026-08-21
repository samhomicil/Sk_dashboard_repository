import 'server-only';
import type { BillRecord } from './types';
import type { SalesData } from './billsEngine';
import { getPrisma } from './db';
import { resolveAccount } from './accountMap';
import { query } from '@/lib/db';
import { buildForecaster, type SalesRow } from '@/lib/core/forecast';
import { NET_SALES } from '@/lib/core/sources';
import { financialPeriods } from './periods';

export const dataMode = (): 'db' | 'seed' => (getPrisma() !== null ? 'db' : 'seed');

// Bills are stored without a resolved `account` id (it's derived, not persisted) — overlay it
// from ACCOUNT_MAP here so reconciliation always has an up-to-date QuickBooks account link.
const withResolvedAccount = (b: BillRecord): BillRecord => ({
  ...b,
  account: b.account ?? resolveAccount(b.store, b.paidFrom) ?? null,
});

// ---- Seed mode in-memory bill store (mutable across requests within an instance) ----
let _seedBills: BillRecord[] | null = null;

function getSeedBills(): BillRecord[] {
  if (_seedBills === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw: any[] = require('./bills.json');
    _seedBills = raw.map((b: any, i: number) => ({
      id: `seed-${i}`,
      store: b.store,
      vendor: b.vendor,
      category: b.category,
      recurrence: b.recurrence,
      amountType: b.amountType as BillRecord['amountType'],
      amountValue: Number(b.amountValue),
      payment: b.payment as BillRecord['payment'],
      account: b.account ?? null,
      paidFrom: b.paidFrom ?? null,
      anchor: b.anchor ?? null,
      end: b.end ?? null,
      notes: b.notes ?? null,
      active: b.active !== false,
    }));
  }
  return _seedBills!;
}

// Active bills only — used by reconciliation, forecast, calendar.
export async function loadBills(): Promise<BillRecord[]> {
  const db = getPrisma();
  if (db) {
    const rows = await db.bill.findMany({
      where: { active: true },
      orderBy: [{ store: 'asc' }, { vendor: 'asc' }],
    });
    return rows.map((r) => withResolvedAccount({
      ...r,
      recurrence: JSON.parse(r.recurrence) as BillRecord['recurrence'],
      amountType: r.amountType as BillRecord['amountType'],
      payment: r.payment as BillRecord['payment'],
    }));
  }
  return getSeedBills()
    .filter((b) => b.active !== false)
    .map((b) => withResolvedAccount({ ...b }));
}

// All bills including paused — used by the Vendors tab.
export async function loadAllBills(): Promise<BillRecord[]> {
  const db = getPrisma();
  if (db) {
    const rows = await db.bill.findMany({
      orderBy: [{ store: 'asc' }, { vendor: 'asc' }],
    });
    return rows.map((r) => withResolvedAccount({
      ...r,
      recurrence: JSON.parse(r.recurrence) as BillRecord['recurrence'],
      amountType: r.amountType as BillRecord['amountType'],
      payment: r.payment as BillRecord['payment'],
    }));
  }
  return getSeedBills().map((b) => withResolvedAccount({ ...b }));
}

export async function createBill(input: Omit<BillRecord, 'id'>): Promise<BillRecord> {
  const db = getPrisma();
  if (db) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db.bill.create as any)({
      data: {
        store: input.store,
        vendor: input.vendor,
        category: input.category,
        recurrence: JSON.stringify(input.recurrence),
        amountType: input.amountType,
        amountValue: input.amountValue,
        payment: input.payment,
        account: input.account ?? null,
        paidFrom: input.paidFrom ?? null,
        anchor: input.anchor ?? null,
        end: input.end ?? null,
        notes: input.notes ?? null,
        active: input.active !== false,
      },
    });
    return {
      ...row,
      recurrence: input.recurrence,
      amountType: row.amountType as BillRecord['amountType'],
      payment: row.payment as BillRecord['payment'],
    };
  }
  // Seed mode
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const bill: BillRecord = { ...input, id, active: input.active !== false };
  getSeedBills().push(bill);
  return { ...bill };
}

export async function updateBill(id: string, patch: Partial<BillRecord>): Promise<void> {
  const db = getPrisma();
  if (db) {
    const { recurrence, ...rest } = patch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.bill.update as any)({
      where: { id },
      data: {
        ...rest,
        ...(recurrence !== undefined ? { recurrence: JSON.stringify(recurrence) } : {}),
      },
    });
    return;
  }
  // Seed mode
  const bills = getSeedBills();
  const idx = bills.findIndex((b) => b.id === id);
  if (idx !== -1) bills[idx] = { ...bills[idx], ...patch };
}

export async function deleteBill(id: string): Promise<void> {
  const db = getPrisma();
  if (db) {
    await db.bill.delete({ where: { id } });
    return;
  }
  // Seed mode
  const bills = getSeedBills();
  const idx = bills.findIndex((b) => b.id === id);
  if (idx !== -1) bills.splice(idx, 1);
}

// ---- Sales ----

// In-memory sales for seed mode (ephemeral — fine for demo).
const _memSales: Record<string, Record<string, { projected?: number | null; actual?: number | null }>> = {};

export async function loadSales(): Promise<SalesData> {
  // Canonical sales for percent-of-sales bills (royalty, marketing). Realized
  // monthly net comes from smoothieking.sales (the POS); the current + next 11
  // months are PROJECTED with the shared core forecaster (same-weekday mean)
  // summed over each month — the same engine Budget & Ops-Week use, so these
  // bills reconcile with those surfaces. Retires the manual sk_bills.Sales table
  // as a metric source (that table is left in place but no longer read here).
  try {
    const rows = await query<{ store: string; d: string; net: number }[]>(
      `SELECT store, CONVERT(char(10), closed_datetime, 23) AS d, ${NET_SALES} AS net
         FROM smoothieking.sales
        GROUP BY store, CONVERT(char(10), closed_datetime, 23)`,
    );
    if (!rows.length) return JSON.parse(JSON.stringify(_memSales));

    const forecastFor = buildForecaster(rows as SalesRow[]);
    const todayISO = new Date().toISOString().slice(0, 10);
    const curYm = todayISO.slice(0, 7);
    const stores = new Set(rows.map((r) => r.store));

    // Per-store daily actuals, for summing net over fiscal-period date ranges.
    const dailyByStore = new Map<string, Map<string, number>>();
    for (const r of rows) {
      let m = dailyByStore.get(r.store);
      if (!m) { m = new Map(); dailyByStore.set(r.store, m); }
      m.set(r.d, (m.get(r.d) ?? 0) + Number(r.net));
    }
    const addDaysISO = (d: string, n: number) => {
      const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    // Only the periods a franchise forecast can touch: from a year ago through ~14
    // months out (the bills forecast horizon plus the ~2-week draw lag).
    const perFrom = addDaysISO(todayISO, -400);
    const perTo = addDaysISO(todayISO, 430);
    const periods = financialPeriods().filter((p) => p.end >= perFrom && p.begin <= perTo);

    // realized monthly net for COMPLETE past months (current month is projected in full)
    const actual = new Map<string, number>(); // `${store}|${ym}` -> net
    for (const r of rows) {
      const ym = r.d.slice(0, 7);
      if (ym < curYm) actual.set(`${r.store}|${ym}`, (actual.get(`${r.store}|${ym}`) ?? 0) + Number(r.net));
    }

    const out: SalesData = {};
    const [cy, cm] = curYm.split('-').map(Number);
    for (const store of stores) {
      const rec: Record<string, { projected?: number | null; actual?: number | null }> = {};
      for (const [k, v] of actual) {
        if (k.startsWith(`${store}|`)) rec[k.slice(store.length + 1)] = { actual: Math.round(v), projected: null };
      }
      // project the current + next 11 months by summing the daily forecaster
      for (let i = 0; i < 12; i++) {
        const first = new Date(Date.UTC(cy, cm - 1 + i, 1));
        const y = first.getUTCFullYear(), mo = first.getUTCMonth();
        const ym = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        let proj = 0;
        for (let day = 1; day <= dim; day++) proj += forecastFor(store, `${ym}-${String(day).padStart(2, '0')}`);
        rec[ym] = { actual: rec[ym]?.actual ?? null, projected: Math.round(proj) };
      }

      // Fiscal-period net sales (keyed by period id, e.g. "2026-P04"), used by the
      // period-based franchise fees. A closed period = summed actual daily net; a
      // period still open or in the future = actual-to-date + same-weekday forecast
      // for its remaining days, so the current period isn't thrown away.
      const dm = dailyByStore.get(store) ?? new Map<string, number>();
      for (const p of periods) {
        let net = 0; let anyForecast = false;
        for (let d = p.begin; d <= p.end; d = addDaysISO(d, 1)) {
          const a = dm.get(d);
          if (a != null && d < todayISO) net += a;               // settled day
          else { net += forecastFor(store, d); anyForecast = true; } // open/future day
        }
        rec[p.id] = p.end < todayISO && !anyForecast
          ? { actual: Math.round(net), projected: null }
          : { actual: null, projected: Math.round(net) };
      }
      out[store] = rec;
    }
    return out;
  } catch {
    return JSON.parse(JSON.stringify(_memSales));
  }
}

// ---- Manual payment records ----

export async function loadManualPayments(billIds: string[]): Promise<Set<string>> {
  const db = getPrisma();
  if (!db || !billIds.length) return new Set();
  const rows = await db.billPayment.findMany({ where: { billId: { in: billIds } } });
  return new Set(rows.map((r) => `${r.billId}|${r.dueDate}`));
}

export async function markPaid(billId: string, dueDate: string): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  await db.billPayment.upsert({
    where: { billId_dueDate: { billId, dueDate } },
    create: { billId, dueDate },
    update: { paidAt: new Date() },
  });
}

export async function markUnpaid(billId: string, dueDate: string): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  await db.billPayment.deleteMany({ where: { billId, dueDate } });
}

/**
 * When the Bills page's data was last refreshed.
 *
 * This read sk_bills.Sales, which is a TOMBSTONE: loadSales above retired that
 * table as a metric source, saveSales was deleted, and nothing has written it since
 * a manual backfill on 2026-06-28. So the header cheerfully reported "synced 52d
 * ago" while every figure on the screen was a day old — a freshness indicator
 * measuring a table the page does not use, counting up forever.
 *
 * QbBalance is the honest source. /api/sync writes it daily and deliberately stamps
 * updatedAt with each account's BALANCE DATE rather than the run time, in its own
 * words "so freshness is honest — a broken feed shows an old timestamp instead of
 * silently looking current". That is exactly the property a sync label needs, and
 * it is the cash the coverage panel on this page is drawn from.
 */
/**
 * Payroll amounts the cash forecast has already computed, keyed `store|YYYY-MM-DD`.
 *
 * Sam: "the payroll estimates should be coming from the forecast module. I should
 * have exactly what the payroll is going to be on the cash flow, so use that."
 * He is right, and the static estimates were all high — Margate $6,000 against a
 * forecast $4,805.90, Pines $9,500 against $8,049.35, Miramar $11,000 against
 * $10,284.89. A bill schedule that overstates payroll every fortnight overstates
 * every cash position downstream of it.
 *
 * The forecast is the better number because it is computed from ACTUAL HOURS —
 * "hours Aug 3-Aug 16 · wages + tips + 11.4% tax & WC" — rather than a figure typed
 * once and left. Its horizon is short (about four weeks), so callers must fall back
 * to the bill's own estimate beyond it rather than reporting zero.
 */
export async function loadPayrollForecast(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await query<{ store: string; d: string; detail: string | null }[]>(
      `SELECT store, CONVERT(char(10), d, 23) d, detail
         FROM sk_bills.Forecast WHERE detail IS NOT NULL`);
    for (const r of rows) {
      if (!r.detail) continue;
      let items: { label?: string; amt?: number; kind?: string }[];
      try { items = JSON.parse(r.detail); } catch { continue; }
      for (const it of items) {
        // The forecast labels every store's payroll "Payroll (ADP draft)", including
        // MARGATE, which does not use ADP — its payroll runs through Workstream. That
        // is a naming artefact in cash-forecast/forecast.py, so match on the word
        // payroll and exclude the per-month software lines that also contain it
        // ("ADP — Payroll Processing", "Workstream — Payroll Module").
        const label = String(it.label ?? '');
        if (!/payroll/i.test(label)) continue;
        if (/processing|module/i.test(label)) continue;
        if (typeof it.amt !== 'number') continue;
        out.set(`${r.store}|${String(r.d).slice(0, 10)}`, it.amt);
      }
    }
  } catch (e) {
    console.error('[data] payroll forecast unavailable:', e);
  }
  return out;
}

export async function loadLastSyncedAt(): Promise<string | null> {
  const db = getPrisma();
  if (!db) return null;
  const row = await db.qbBalance.findFirst({ orderBy: { updatedAt: 'desc' } });
  return row ? row.updatedAt.toISOString() : null;
}

// saveSales was removed: sales are a single derived source now (loadSales pulls
// realized net from smoothieking.sales + projects with the shared forecaster), so
// there is no manual write path that could diverge from Budget / Weekly Ops.
