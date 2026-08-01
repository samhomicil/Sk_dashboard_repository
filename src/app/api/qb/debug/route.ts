import { requireOwner } from '@/lib/owner-guard';
import { NextResponse } from 'next/server';
import { getConnections, getRawAccounts, getRawAccountById } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reads each bank account individually to check for BankBalance field (bank feed balance)
export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const connections = await getConnections().catch(() => []);
  const out: Record<string, unknown> = {};

  for (const { company } of connections) {
    try {
      const accounts = await getRawAccounts(company, false) as { Id: string; Name: string }[];
      // Read first 3 bank accounts individually — individual reads expose more fields
      const detailed = await Promise.all(
        accounts.slice(0, 3).map((a) => getRawAccountById(company, a.Id)),
      );
      out[company] = detailed.filter(Boolean);
    } catch (e: unknown) {
      out[company] = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json(out);
}
