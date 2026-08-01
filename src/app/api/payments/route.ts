import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { markPaid, markUnpaid } from '@/lib/bills/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { billId, dueDate } = await req.json().catch(() => ({}));
  if (!billId || !dueDate) return NextResponse.json({ ok: false, error: 'Missing billId or dueDate' }, { status: 400 });
  await markPaid(billId, dueDate);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const { billId, dueDate } = await req.json().catch(() => ({}));
  if (!billId || !dueDate) return NextResponse.json({ ok: false, error: 'Missing billId or dueDate' }, { status: 400 });
  await markUnpaid(billId, dueDate);
  return NextResponse.json({ ok: true });
}
