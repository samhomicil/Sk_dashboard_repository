import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getConnections, getAccounts, getAllPurchases, getAllDeposits } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPANY_NAMES: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' };

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const start = searchParams.get('start') ?? new Date().toISOString().slice(0, 10);
  const end   = searchParams.get('end')   ?? new Date().toISOString().slice(0, 10);
  const store = searchParams.get('store') ?? null;

  const connections = await getConnections().catch(() => []);
  const targets = store
    ? connections.filter((c) => c.company === store)
    : connections;

  const stores = (
    await Promise.all(
      targets.map(async ({ company }) => {
        try {
          const [accounts, purchases, deposits] = await Promise.all([
            getAccounts(company),
            getAllPurchases(company, start, end),
            getAllDeposits(company, start, end),
          ]);

          const bankAccts = accounts.filter((a) => a.AccountType === 'Bank');
          const ccAccts   = accounts.filter((a) => a.AccountType === 'Credit Card');

          let checking = 0, savings = 0;
          const accountList: { id: string; name: string; balance: number }[] = [];
          for (const a of bankAccts) {
            // Prefer BankBalance (live bank feed) over book balance when available
            const balance = a.BankBalance ?? a.CurrentBalanceWithSubAccounts ?? a.CurrentBalance;
            const sub = a.AccountSubType ?? '';
            const isPettyCash = /petty/i.test(a.Name);
            accountList.push({ id: `${company}:${a.Id}`, name: a.Name, balance });
            if (isPettyCash) continue; // exclude petty cash from checking/savings totals
            const isSavings = sub === 'Savings' || /sav/i.test(a.Name);
            if (isSavings) savings += balance;
            else           checking += balance;
          }

          return {
            key: company,
            name: COMPANY_NAMES[company] ?? company,
            checking,
            savings,
            creditBalance: ccAccts.reduce((s, a) => s + Math.abs(a.CurrentBalance), 0),
            income:   deposits.reduce((s, d) => s + d.TotalAmt, 0),
            expenses: purchases.reduce((s, p) => s + p.TotalAmt, 0),
            accounts: accountList,
          };
        } catch (e) {
          console.error(`[qb/stores] failed for ${company}:`, e);
          return null;
        }
      }),
    )
  ).filter(Boolean);

  return NextResponse.json(stores);
}
