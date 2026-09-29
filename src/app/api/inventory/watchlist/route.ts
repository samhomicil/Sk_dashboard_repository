import { buildOrderGuide } from '@/lib/orderGuide'
import { requireScope } from '@/lib/store-guard'
import { isStore } from '@/lib/storeAccess'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const scope = await requireScope(); if (scope instanceof Response) return scope
  try {
    const data = await buildOrderGuide()
    if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
    if (scope === 'all') return Response.json(data)
    const mine = (s: string) => isStore(s, scope)
    const pick = <T,>(rec: Record<string, T>) =>
      Object.fromEntries(Object.entries(rec).filter(([k]) => mine(k))) as Record<string, T>
    return Response.json({
      ...data,
      rows: data.rows.filter(r => mine(r.store)),
      collapsed: data.collapsed.filter(c => mine(c.store)),
      // The pooled case order is the whole system's need — owners only.
      pooled: [],
      // Sister-store moves this store gives to or receives from.
      transfers: data.transfers.filter(t => mine(t.to) || t.legs.some(l => mine(l.from))),
      coverage: pick(data.coverage),
      nextTruck: pick(data.nextTruck),
    })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 503 })
  }
}
