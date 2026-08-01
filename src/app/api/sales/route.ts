import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { loadSales, saveSales } from '@/lib/bills/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  return NextResponse.json(await loadSales());
}

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.store !== 'string' || typeof body.ym !== 'string') {
    return NextResponse.json({ error: 'Send { store, ym, projected?, actual? }.' }, { status: 400 });
  }
  const num = (v: unknown) =>
    v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : undefined;
  const projected = num(body.projected);
  const actual = num(body.actual);
  if (projected === undefined || actual === undefined) {
    return NextResponse.json({ error: 'projected/actual must be numbers or empty.' }, { status: 400 });
  }
  await saveSales(body.store, body.ym, { projected, actual });
  return NextResponse.json({ ok: true });
}
