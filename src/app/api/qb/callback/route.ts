import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, saveToken } from '@/lib/bills/qb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const company = searchParams.get('state'); // we set state=company in the auth URL
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/settings?qb_error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !realmId || !company) {
    return NextResponse.redirect(new URL('/settings?qb_error=missing_params', req.url));
  }

  try {
    const tokens = await exchangeCode(code);
    await saveToken(company, realmId, tokens.access_token, tokens.refresh_token, tokens.expires_in);
    return NextResponse.redirect(new URL(`/settings?qb_connected=${company}`, req.url));
  } catch (e) {
    console.error('[qb/callback]', e);
    return NextResponse.redirect(new URL('/settings?qb_error=token_exchange_failed', req.url));
  }
}
