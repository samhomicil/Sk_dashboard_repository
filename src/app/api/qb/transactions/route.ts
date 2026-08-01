import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getConnections, getAllPurchases, getAllDeposits, getAccounts } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const start  = searchParams.get('start') ?? new Date().toISOString().slice(0, 10);
  const end    = searchParams.get('end')   ?? new Date().toISOString().slice(0, 10);
  const limit  = Number(searchParams.get('limit') ?? '1000');
  const store  = searchParams.get('store') ?? null;

  const connections = await getConnections();
  const targets = store
    ? connections.filter((c) => c.company === store)
    : connections;

  const rows: {
    id: string; date: string; amount: number; payee: string;
    store: string; accountId: string; accountLabel: string;
    notes?: string; isTransfer: boolean; cleared: boolean;
  }[] = [];

  await Promise.all(
    targets.map(async ({ company }) => {
      let accounts, purchases, deposits;
      try {
        [accounts, purchases, deposits] = await Promise.all([
          getAccounts(company),
          getAllPurchases(company, start, end),
          getAllDeposits(company, start, end),
        ]);
      } catch (e) {
        console.error(`[qb/transactions] failed for ${company}:`, e);
        return;
      }

      const acctName = (id: string) =>
        accounts.find((a) => a.Id === id)?.Name ?? id;

      for (const p of purchases) {
        rows.push({
          id: `${company}:p:${p.Id}`,
          date: p.TxnDate,
          amount: -p.TotalAmt,          // outflow → negative dollars
          payee: p.EntityRef?.name ?? 'Unknown',
          store: company,
          accountId: `${company}:${p.AccountRef.value}`,
          accountLabel: acctName(p.AccountRef.value),
          notes: p.PrivateNote,
          isTransfer: false,
          cleared: true,
        });
      }

      for (const d of deposits) {
        rows.push({
          id: `${company}:d:${d.Id}`,
          date: d.TxnDate,
          amount: d.TotalAmt,           // inflow → positive dollars
          payee: 'Deposit',
          store: company,
          accountId: `${company}:${d.DepositToAccountRef.value}`,
          accountLabel: acctName(d.DepositToAccountRef.value),
          notes: d.PrivateNote,
          isTransfer: false,
          cleared: true,
        });
      }
    }),
  );

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return NextResponse.json(rows.slice(0, limit));
}
