import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/owner-guard'
import { getLiveBalances } from '@/lib/bills/balances'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Owner-only. Serves the per-store cash forecast rendered by /cashflow.
 * Reads sk_bills.Forecast (the daily ledger written by the local forecast.py job —
 * OpenBudget-anchored, DOW+T+2 income, dated payroll/food/corporate/bills).
 */
type Row = {
  store: string; d: Date; inflow: number; outflow: number;
  balance: number; as_of: Date; bal_src: string; stale: boolean | number;
  detail: string | null;
}

/** A named line behind a day's totals, with the past event that produced it. */
type Line = { label: string; amt: number; kind: 'in' | 'out'; note: string }

export async function GET() {
  const gate = await requireOwner()
  if (gate) return gate

  const db = getPrisma()
  if (!db) return NextResponse.json({ error: 'db not configured' }, { status: 503 })

  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT store, d, inflow, outflow, balance, as_of, bal_src, stale, detail
       FROM sk_bills.Forecast ORDER BY store, d`,
  )
  if (!rows.length) return NextResponse.json({ ok: true, asOf: null, stores: [] })

  // The Forecast table only carries one combined anchor number (`start`, below,
  // is even reconstructed backward from day-0's balance). The checking/savings
  // split behind "in the bank now" lives only in sk_bills.QbBalance — fetched
  // separately here (via the same getLiveBalances() Bills and /api/balances
  // use) rather than persisted per-day, since it's a snapshot of TODAY, not
  // part of the projection. Genuinely optional: a store can be mid-forecast
  // with no QbBalance row (feed never synced, wrong store name, whatever) —
  // callers must not assume this is present.
  const balByStore = new Map((await getLiveBalances()).map((b) => [b.store, b]))

  const iso = (x: Date) => new Date(x).toISOString().slice(0, 10)
  const byStore = new Map<string, {
    store: string; balSrc: string; stale: boolean;
    days: { d: string; inflow: number; outflow: number; balance: number; lines: Line[] }[];
  }>()

  for (const r of rows) {
    let s = byStore.get(r.store)
    if (!s) {
      s = { store: r.store, balSrc: r.bal_src, stale: Boolean(r.stale), days: [] }
      byStore.set(r.store, s)
    }
    let lines: Line[] = []
    try { if (r.detail) lines = JSON.parse(r.detail) as Line[] } catch { lines = [] }
    s.days.push({ d: iso(r.d), inflow: r.inflow, outflow: r.outflow, balance: r.balance, lines })
  }

  const stores = [...byStore.values()].map((s) => {
    const d0 = s.days[0]
    const start = d0 ? d0.balance - d0.inflow + d0.outflow : 0 // pre-day-0 anchor
    let low = Infinity, lowDate = ''
    for (const day of s.days) if (day.balance < low) { low = day.balance; lowDate = day.d }
    const end = s.days.length ? s.days[s.days.length - 1].balance : 0
    const bal = balByStore.get(s.store)
    return {
      store: s.store, balSrc: s.balSrc, stale: s.stale,
      start, low, lowDate, end,
      need: Math.max(0, -low), needBy: low < 0 ? lowDate : null,
      // Optional — see balByStore comment above. undefined (not 0) when missing,
      // so the UI can tell "no data" apart from "genuinely $0 in checking".
      checking: bal?.checking, savings: bal?.savings,
      days: s.days,
    }
  })

  return NextResponse.json({ ok: true, asOf: iso(rows[0].as_of), stores })
}
