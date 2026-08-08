import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, saveTokens } from '@/lib/bills/openbudget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const verifier = req.cookies.get('ob_pkce_verifier')?.value;
  const expectedState = req.cookies.get('ob_state')?.value;

  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/settings?ob_error=${encodeURIComponent(reason)}`, req.url));
    res.cookies.delete('ob_pkce_verifier');
    res.cookies.delete('ob_state');
    return res;
  };

  if (error) return fail(error);
  if (!code || !verifier) return fail('missing_params');
  if (!state || state !== expectedState) return fail('state_mismatch');

  try {
    const tokens = await exchangeCode(code, verifier);
    await saveTokens(tokens);
    const res = NextResponse.redirect(new URL('/settings?ob_connected=1', req.url));
    res.cookies.delete('ob_pkce_verifier');
    res.cookies.delete('ob_state');
    return res;
  } catch (e) {
    console.error('[openbudget/callback]', e);
    return fail('token_exchange_failed');
  }
}
