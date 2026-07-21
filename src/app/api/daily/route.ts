import { NextRequest } from 'next/server'
import { cacheDailyAsync } from '@/lib/cache'
import { query, dateFilter } from '@/lib/db'
import type { Store, DailyRow } from '@/lib/types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }

function sfDb(store: Store) {
  if (store === 'all') return '1=1'
  return `store = '${DB_STORE[store]}'`
}

interface DaySales { net: number; gross: number; voids: number; orders: number; voidOrders: number; sm: number; ee: number }

// Per-day sales/orders/EE live from smoothieking.sales (validated defs) — replaces the
// bundled sigma-daily/ee-daily reads so custom date ranges are always current.
async function fetchSalesByDay(store: Store, start: string, end: string): Promise<Map<string, DaySales>> {
  const map = new Map<string, DaySales>()
  try {
    const rows = await query<{ d: string; net: number; gross: number; voids: number; orders: number; voidOrders: number; sm: number; ee: number }[]>(`
      SELECT CONVERT(char(10), closed_datetime, 23) AS d,
        SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales   ELSE 0 END) AS net,
        SUM(CASE WHEN voided=0 AND is_modifier=0 THEN gross_sales ELSE 0 END) AS gross,
        SUM(CASE WHEN voided=1 AND is_modifier=0 THEN price       ELSE 0 END) AS voids,
        COUNT(DISTINCT CASE WHEN voided=0 THEN order_id END)                              AS orders,
        COUNT(DISTINCT CASE WHEN voided=1 THEN order_id END)                              AS voidOrders,
        COUNT(DISTINCT CASE WHEN voided=0 AND is_modifier=0 THEN order_id END)            AS sm,
        COUNT(DISTINCT CASE WHEN voided=0 AND revenue_center='Modifiers' THEN order_id END) AS ee
      FROM smoothieking.sales WHERE ${sfDb(store)} AND ${dateFilter(start, end, 'closed_datetime')}
      GROUP BY CONVERT(char(10), closed_datetime, 23)
    `)
    for (const r of rows) {
      map.set(r.d, { net: Number(r.net) || 0, gross: Number(r.gross) || 0, voids: Number(r.voids) || 0,
        orders: Number(r.orders) || 0, voidOrders: Number(r.voidOrders) || 0, sm: Number(r.sm) || 0, ee: Number(r.ee) || 0 })
    }
  } catch { /* DB unavailable — daily sales blank for this range */ }
  return map
}

async function fetchLaborByDay(store: Store, start: string, end: string): Promise<Map<string, { labor: number; hours: number }>> {
  const map = new Map<string, { labor: number; hours: number }>()
  try {
    const rows = await query<{ d: string; total_pay: number; total_hrs: number }[]>(`
      SELECT CAST(shift_date AS DATE) AS d, SUM(total_pay) AS total_pay, SUM(total_hrs) AS total_hrs
      FROM smoothieking.labor
      WHERE ${sfDb(store)} AND ${dateFilter(start, end, 'shift_date')} AND employee_role NOT IN ('NON_EMP', 'Support')
      GROUP BY CAST(shift_date AS DATE)
    `)
    for (const r of rows) {
      map.set(new Date(r.d).toISOString().slice(0, 10), { labor: Number(r.total_pay) || 0, hours: Number(r.total_hrs) || 0 })
    }
  } catch { /* proxy not available — labor will show blank for this range */ }
  return map
}

async function buildRange(store: Store, start: string, end: string): Promise<DailyRow[]> {
  const [sigMap, laborMap] = await Promise.all([
    fetchSalesByDay(store, start, end),
    fetchLaborByDay(store, start, end),
  ])
  const rows: DailyRow[] = []
  const endDate = new Date(end + 'T00:00:00')

  for (let d = new Date(start + 'T00:00:00'); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr    = d.toISOString().slice(0, 10)
    const sig        = sigMap.get(dateStr)
    const laborData  = laborMap.get(dateStr) ?? { labor: 0, hours: 0 }

    rows.push({
      date:        dateStr,
      day:         DAY_LABELS[d.getDay()],
      sales:       sig ? sig.net : null,
      orders:      sig ? sig.orders : null,
      eePct:       sig && sig.sm > 0 ? sig.ee / sig.sm : null,
      voidPct:     sig && sig.orders > 0 ? sig.voidOrders / sig.orders : null,
      atv:         sig && sig.orders > 0 ? sig.net / sig.orders : null,
      discountPct: sig && sig.gross > 0
        ? Math.max(0, sig.gross - sig.net - sig.voids) / sig.gross
        : null,
      laborPct:    sig && sig.net > 0 && laborData.labor > 0 ? laborData.labor / sig.net : null,
      laborCost:   laborData.labor > 0 ? laborData.labor : null,
      laborHours:  laborData.hours > 0 ? laborData.hours : null,
    })
  }
  return rows
}

export async function GET(req: NextRequest) {
  const p       = req.nextUrl.searchParams
  const store   = (p.get('store')   ?? 'all') as Store
  const start   = p.get('start')   ?? ''
  const end     = p.get('end')     ?? ''
  const pyStart = p.get('pyStart') ?? ''
  const pyEnd   = p.get('pyEnd')   ?? ''

  if (start && end) {
    const [current, py] = await Promise.all([
      buildRange(store, start, end),
      pyStart && pyEnd ? buildRange(store, pyStart, pyEnd) : Promise.resolve([] as DailyRow[]),
    ])
    return Response.json({ current, py })
  }

  // Fallback: cached weekly sparklines (no date params)
  const data = await cacheDailyAsync(store)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  return Response.json(data)
}
