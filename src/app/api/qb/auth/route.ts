import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_COMPANIES = ['pines', 'miramar', 'margate'] as const;

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const company = req.nextUrl.searchParams.get('company');
  if (!company || !VALID_COMPANIES.includes(company as (typeof VALID_COMPANIES)[number])) {
    return NextResponse.json({ error: 'company must be one of: pines, miramar, margate' }, { status: 400 });
  }
  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_REDIRECT_URI) {
    return NextResponse.json({ error: 'QBO_CLIENT_ID and QBO_REDIRECT_URI must be set' }, { status: 500 });
  }
  return NextResponse.redirect(buildAuthUrl(company));
}
