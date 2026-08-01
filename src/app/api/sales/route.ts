import { requireOwner } from '@/lib/owner-guard';
import { NextResponse } from 'next/server';
import { loadSales } from '@/lib/bills/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sales are now auto-derived from smoothieking.sales (realized) + the shared core
// forecaster (projected) in loadSales — see src/lib/bills/data.ts. There is no
// manual write path: a single source keeps % -of-sales bills in step with Budget
// and Weekly Ops. (The legacy POST that wrote sk_bills.Sales was removed.)
export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  return NextResponse.json(await loadSales());
}
