import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getConnections, getPnlReport, getPnlTrend } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPANY_NAMES: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' };

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const store  = searchParams.get('store');
  const start  = searchParams.get('start') ?? new Date().toISOString().slice(0, 7) + '-01';
  const end    = searchParams.get('end')   ?? new Date().toISOString().slice(0, 10);
  const basis  = (searchParams.get('basis') ?? 'Accrual') as 'Accrual' | 'Cash';
  const byMonth = searchParams.get('by') === 'month';

  const connections = await getConnections().catch(() => []);
  const targets = store ? connections.filter(c => c.company === store) : connections;

  if (byMonth) {
    const debug = searchParams.get('debug') === '1';
    if (debug) {
      const { getRawPnlMonthly } = await import('@/lib/bills/qb');
      const raw: Record<string, unknown> = {};
      for (const { company } of targets) {
        raw[company] = await getRawPnlMonthly(company, start, end, basis).catch(e => String(e));
      }
      return NextResponse.json(raw);
    }

    const results = await Promise.all(
      targets.map(async ({ company }) => {
        try {
          const trend = await getPnlTrend(company, start, end, basis);
          return { company, name: COMPANY_NAMES[company] ?? company, trend };
        } catch (e) {
          console.error(`[qb/pnl/trend] failed for ${company}:`, e);
          return { company, name: COMPANY_NAMES[company] ?? company, trend: [], error: String(e) };
        }
      }),
    );
    return NextResponse.json(results);
  }

  const results = await Promise.all(
    targets.map(async ({ company }) => {
      try {
        const report = await getPnlReport(company, start, end, basis);
        return { company, name: COMPANY_NAMES[company] ?? company, report };
      } catch (e) {
        console.error(`[qb/pnl] failed for ${company}:`, e);
        return { company, name: COMPANY_NAMES[company] ?? company, report: null, error: String(e) };
      }
    }),
  );

  return NextResponse.json(results);
}
