import { requireOwner } from '@/lib/owner-guard';
import { NextRequest, NextResponse } from 'next/server';
import { createBill, updateBill, deleteBill, loadAllBills } from '@/lib/bills/data';
import type { BillRecord } from '@/lib/bills/types';

export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const bills = await loadAllBills();
  return NextResponse.json(bills);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.vendor || !body.store || !body.recurrence) {
    return NextResponse.json({ error: 'Missing required fields (vendor, store, recurrence).' }, { status: 400 });
  }
  try {
    const bill = await createBill({
      store: body.store,
      vendor: body.vendor,
      category: body.category || 'Other',
      recurrence: body.recurrence,
      amountType: body.amountType || 'fixed',
      amountValue: Number(body.amountValue) || 0,
      payment: body.payment || 'manual',
      account: body.account ?? null,
      paidFrom: body.paidFrom ?? null,
      anchor: body.anchor || null,
      end: body.end || null,
      notes: body.notes || null,
      active: body.active !== false,
    });
    return NextResponse.json({ ok: true, bill });
  } catch (e) {
    console.error('[api/bills POST]', e);
    return NextResponse.json({ error: 'Failed to create bill.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  }
  const { id, ...patch } = body;
  const p: Partial<BillRecord> = {};
  if (patch.store !== undefined) p.store = patch.store;
  if (patch.vendor !== undefined) p.vendor = patch.vendor;
  if (patch.category !== undefined) p.category = patch.category;
  if (patch.recurrence !== undefined) p.recurrence = patch.recurrence;
  if (patch.amountType !== undefined) p.amountType = patch.amountType;
  if (patch.amountValue !== undefined) p.amountValue = Number(patch.amountValue);
  if (patch.payment !== undefined) p.payment = patch.payment;
  if (patch.account !== undefined) p.account = patch.account || null;
  if (patch.paidFrom !== undefined) p.paidFrom = patch.paidFrom || null;
  if (patch.anchor !== undefined) p.anchor = patch.anchor || null;
  if (patch.end !== undefined) p.end = patch.end || null;
  if (patch.notes !== undefined) p.notes = patch.notes || null;
  if (patch.active !== undefined) p.active = Boolean(patch.active);
  try {
    await updateBill(id, p);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/bills PATCH]', e);
    return NextResponse.json({ error: 'Failed to update bill.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireOwner();
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  }
  try {
    await deleteBill(body.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/bills DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete bill.' }, { status: 500 });
  }
}
