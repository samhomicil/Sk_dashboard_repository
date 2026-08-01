import { requireOwnerPage } from '@/lib/owner-guard';
// src/app/bills/page.tsx
import { Suspense } from 'react';
import { getDashboardData } from '@/lib/bills/service';
import { loadBills, loadAllBills, loadSales, loadLastSyncedAt } from '@/lib/bills/data';
import type { BillRecord } from '@/lib/bills/types';
import BillsClient from './BillsClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ClientBill = Pick<
  BillRecord,
  | 'id' | 'store' | 'vendor' | 'category' | 'recurrence' | 'amountType'
  | 'amountValue' | 'payment' | 'paidFrom' | 'anchor' | 'end' | 'active' | 'notes'
>;

export function mapBill(b: BillRecord): ClientBill {
  return {
    id: b.id,
    store: b.store,
    vendor: b.vendor,
    category: b.category,
    recurrence: b.recurrence,
    amountType: b.amountType,
    amountValue: b.amountValue,
    payment: b.payment,
    paidFrom: b.paidFrom ?? null,
    anchor: b.anchor ?? null,
    end: b.end ?? null,
    active: b.active ?? true,
    notes: b.notes ?? null,
  };
}

export default async function BillsPage() {
  await requireOwnerPage();

  const [dash, bills, allBills, sales, lastSyncedAt] = await Promise.all([
    getDashboardData(),
    loadBills(),
    loadAllBills(),
    loadSales(),
    loadLastSyncedAt(),
  ]);

  return (
    <Suspense fallback={null}>
      <BillsClient
        dash={dash}
        bills={bills.map(mapBill)}
        allBills={allBills.map(mapBill)}
        sales={sales}
        lastSyncedAt={lastSyncedAt}
      />
    </Suspense>
  );
}
