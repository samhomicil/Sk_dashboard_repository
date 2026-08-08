import { requireOwner } from '@/lib/owner-guard';
import { NextResponse } from 'next/server';
import { getLiveBalances } from '@/lib/bills/balances';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Today's live cash position per store, straight from sk_bills.QbBalance
// (OpenBudget). The one balance endpoint every surface should read — see
// lib/bills/balances.ts for why this replaced Bills' old QuickBooks-live fetch.
export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const balances = await getLiveBalances();
  return NextResponse.json(balances);
}
