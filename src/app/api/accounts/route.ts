import { requireOwner } from '@/lib/owner-guard';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface AccountOption {
  id: string;
  name: string;
  store: string;
}

export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const PROXY = process.env.PROXY_URL ?? 'http://localhost:3001';
  const today = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`${PROXY}/stores?start=${today}&end=${today}`, {
      headers: { 'ngrok-skip-browser-warning': '1' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    const stores = await r.json() as { name: string; accounts?: { id: string; name: string }[] }[];
    const accounts: AccountOption[] = stores.flatMap(s =>
      (s.accounts ?? []).map(a => ({ id: a.id, name: a.name, store: s.name }))
    );
    return NextResponse.json(accounts);
  } catch {
    return NextResponse.json([]);
  }
}
