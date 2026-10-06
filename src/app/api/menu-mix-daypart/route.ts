import { NextRequest } from 'next/server'
import { getMenuMixDaypart } from '@/lib/menuMixDaypart'
import { requireStore } from '@/lib/store-guard'
import { query } from '@/lib/db'
import { EE_CHECKS } from '@/lib/core/sources'
import { etToday, isoAdd } from '@/lib/core/dates'
import type { EeRow } from '@/lib/menuMixUtils'

// Weekday E&E is CrunchTime's (core/sources.ts EE_CHECKS), live over the 13 weeks to yesterday —
// the rest of this payload is the saved daypart file, which keeps its own window.
const EE_WEEKS = 13
const STORES = ['pines', 'miramar', 'margate'] as const

export async function GET(req: NextRequest) {
  const scoped = await requireStore(req.nextUrl.searchParams.get('store')); if (scoped instanceof Response) return scoped
  const store = scoped
  const data  = getMenuMixDaypart(store)
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })

  const end = isoAdd(etToday(), -1), start = isoAdd(end, -7 * EE_WEEKS + 1)
  // 1900-01-07 was a Sunday, so this is 0 = Sun … 6 = Sat whatever DATEFIRST is set to.
  const rows = await query<{ store: string; dow: number; sm: number; ee: number }[]>(`
    SELECT LOWER(store) AS store, DATEDIFF(day, '19000107', business_date) % 7 AS dow,
           SUM(smoothie_qty) AS sm, SUM(ee_qty) AS ee
      FROM ${EE_CHECKS}
     WHERE business_date BETWEEN '${start}' AND '${end}'
     GROUP BY LOWER(store), DATEDIFF(day, '19000107', business_date) % 7`).catch(() => null)
  if (rows) {
    const forStores = (keys: readonly string[]): EeRow[] => Array.from({ length: 7 }, (_, dow) => {
      const hit = rows.filter(r => keys.includes(r.store) && Number(r.dow) === dow)
      return { dow, sm: hit.reduce((s, r) => s + (Number(r.sm) || 0), 0), ee: hit.reduce((s, r) => s + (Number(r.ee) || 0), 0) }
    })
    data.ee = forStores(store === 'all' ? STORES : [store])
    if (store === 'all') {
      data.eeByStore = { pines: forStores(['pines']), miramar: forStores(['miramar']), margate: forStores(['margate']) }
    }
    data.eeWindowStart = start
    data.eeWindowEnd = end
  }
  return Response.json(data)
}
