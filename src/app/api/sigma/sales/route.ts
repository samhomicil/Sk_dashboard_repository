import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getWeeklyNetSales } from '@/lib/bills/sigma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const force = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    const data = await getWeeklyNetSales(force);
    return NextResponse.json(data);
  } catch (e) {
    console.error('[sigma/sales] failed:', e);
    return NextResponse.json({ refreshedAt: new Date().toISOString(), trend: {}, error: String(e) }, { status: 200 });
  }
}
