import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedTransactions } from '@/lib/bills/unifiedTransactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The unified feed: OpenBudget (bank truth) enriched with vendor names via the
// alias table, plus Huntington activity from QuickBooks (the one gap
// OpenBudget can't see). Separate from /api/qb/transactions, which stays as
// the QB-only view.
export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const start = searchParams.get('start') ?? new Date().toISOString().slice(0, 10);
  const end = searchParams.get('end') ?? new Date().toISOString().slice(0, 10);
  const limit = Number(searchParams.get('limit') ?? '1000');
  const store = searchParams.get('store');

  const { rows, openBudgetOk, warning } = await getUnifiedTransactions(start, end);
  // The client sends the QB company slug convention (lowercase: pines/miramar/
  // margate); rows here carry the display-cased store name ("Margate").
  const filtered = store ? rows.filter((r) => r.store?.toLowerCase() === store.toLowerCase()) : rows;

  return NextResponse.json({
    transactions: filtered.slice(0, limit),
    openBudgetOk,
    ...(warning ? { warning } : {}),
  });
}
