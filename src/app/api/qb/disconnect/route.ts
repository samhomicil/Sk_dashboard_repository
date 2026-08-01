import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { deleteToken } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const body = await req.formData().catch(() => null);
  const company = body?.get('company') as string | null;
  if (!company) {
    return NextResponse.json({ error: 'Missing company' }, { status: 400 });
  }
  await deleteToken(company);
  return NextResponse.redirect(new URL('/settings?qb_disconnected=' + company, req.url));
}
