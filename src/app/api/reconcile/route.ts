import { requireOwner } from '@/lib/owner-guard';
import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/bills/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const data = await getDashboardData();
  return NextResponse.json(data);
}
