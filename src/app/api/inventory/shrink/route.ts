import { NextRequest } from 'next/server'
import { buildShrink } from '@/lib/shrink'
import { requireScope } from '@/lib/store-guard'
import { isStore } from '@/lib/storeAccess'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const scope = await requireScope(); if (scope instanceof Response) return scope
  const periodEnd = req.nextUrl.searchParams.get('periodEnd') ?? undefined
  try {
    const data = await buildShrink(periodEnd)
    if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
    if (scope === 'all') return Response.json(data)
    // A store-locked login sees its own lines, and its own summary stands in for the total.
    const stores = data.stores.filter(s => isStore(s.store, scope))
    return Response.json({
      ...data,
      rows: data.rows.filter(r => isStore(r.store, scope)),
      stores,
      totals: stores[0] ?? { ...data.totals, shrinkDollars: 0, overageDollars: 0, netDollars: 0,
        usageDollars: 0, shrinkPctOfUsage: null, netPctOfUsage: null, reliableShrinkDollars: 0,
        reliableNetDollars: 0, rowCount: 0, shortLines: 0 },
    })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
