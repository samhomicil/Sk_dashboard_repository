import 'server-only';
import type { BillRecord } from './types';
import type { SalesData } from './billsEngine';
import { getPrisma } from './db';
import { resolveAccount } from './accountMap';

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
  const db = getPrisma();
  if (db) {
    const rows = await db.sales.findMany();
    const out: SalesData = {};
    for (const r of rows) {
      (out[r.store] ??= {})[r.ym] = { projected: r.projected, actual: r.actual };
    }
    return out;
  }
  return JSON.parse(JSON.stringify(_memSales));
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

export async function loadLastSyncedAt(): Promise<string | null> {
  const db = getPrisma();
  if (!db) return null;
  const row = await db.sales.findFirst({ orderBy: { updatedAt: 'desc' } });
  return row ? row.updatedAt.toISOString() : null;
}

export async function saveSales(
  store: string,
  ym: string,
  data: { projected?: number | null; actual?: number | null },
): Promise<void> {
  const db = getPrisma();
  if (db) {
    await db.sales.upsert({
      where: { store_ym: { store, ym } },
      update: { ...data },
      create: { store, ym, ...data },
    });
    return;
  }
  (_memSales[store] ??= {})[ym] = { ...(_memSales[store]?.[ym] ?? {}), ...data };
}
