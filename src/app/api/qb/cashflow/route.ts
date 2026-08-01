import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getConnections, getAllPurchases, getAllDeposits } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const months  = Math.min(Number(searchParams.get('months') ?? '6'), 24);
  const store   = searchParams.get('store') ?? null;

  // Build start date: first day of (months) months ago
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const start = startDate.toISOString().slice(0, 10);
  const end   = now.toISOString().slice(0, 10);

  const connections = await getConnections();
  const targets = store
    ? connections.filter((c) => c.company === store)
    : connections;

  // Aggregate across all matched companies (usually just one store)
  const byMonth: Record<string, { income: number; expenses: number }> = {};

  await Promise.all(
    targets.map(async ({ company }) => {
      let purchases, deposits;
      try {
        [purchases, deposits] = await Promise.all([
          getAllPurchases(company, start, end),
          getAllDeposits(company, start, end),
        ]);
      } catch (e) {
        console.error(`[qb/cashflow] failed for ${company}:`, e);
        return;
      }

      for (const d of deposits) {
        const ym = d.TxnDate.slice(0, 7); // YYYY-MM
        (byMonth[ym] ??= { income: 0, expenses: 0 }).income += d.TotalAmt;
      }
      for (const p of purchases) {
        const ym = p.TxnDate.slice(0, 7);
        (byMonth[ym] ??= { income: 0, expenses: 0 }).expenses += p.TotalAmt;
      }
    }),
  );

  // Fill every month in the window so the chart has a complete series
  const result: { month: string; income: number; expenses: number; net: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const { income = 0, expenses = 0 } = byMonth[ym] ?? {};
    result.push({ month: ym, income, expenses, net: income - expenses });
  }

  return NextResponse.json(result);
}
