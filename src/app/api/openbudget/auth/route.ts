import { requireOwner } from '@/lib/owner-guard';
import { NextResponse } from 'next/server';
import { newPkcePair, buildAuthUrl } from '@/lib/bills/openbudget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Starts the one-time (or re-auth) OpenBudget consent flow. Unlike QB's
// state=company, there's only one shared connection here, so state just needs
// to be an anti-CSRF nonce — the PKCE verifier does the real work of proving
// the callback belongs to this authorize call.
export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const { verifier, challenge } = await newPkcePair();
  const state = crypto.randomUUID();
  const url = await buildAuthUrl(challenge, state);

  const res = NextResponse.redirect(url);
  // httpOnly + short-lived: only the callback on this same browser round-trip
  // needs it. 10 minutes covers a slow consent screen without lingering after.
  res.cookies.set('ob_pkce_verifier', verifier, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/openbudget' });
  res.cookies.set('ob_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/openbudget' });
  return res;
}
