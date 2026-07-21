import { NextRequest } from 'next/server'
import { cacheKpisAsync } from '@/lib/cache'
import { sigmaCogsPct } from '@/lib/sigma'
import { query, dateFilter } from '@/lib/db'
import { TARGETS } from '@/lib/config'
import type { Store, Period, KpiData } from '@/lib/types'

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }

function sfDb(store: Store) {
  return store === 'all' ? '1=1' : `store = '${DB_STORE[store]}'`
}

// Net sales / gross / voids / orders / EE (sm,ee) for a date range, live from
// smoothieking.sales. Definitions validated against Sigma: net = non-void non-modifier;
// orders = distinct non-void order_id; sm = distinct order_id w/ a non-modifier item;
// ee = distinct order_id w/ a 'Modifiers' revenue-center item.
async function salesAgg(store: Store, s: string, e: string) {
  const zero = { net: 0, gross: 0, voids: 0, orders: 0, voidOrders: 0, sm: 0, ee: 0 }
  if (!s || !e) return zero
  try {
    const r = await query<{ net: number; gross: number; voids: number; orders: number; voidOrders: number; sm: number; ee: number }[]>(
      `SELECT
         SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales   ELSE 0 END) AS net,
         SUM(CASE WHEN voided=0 AND is_modifier=0 THEN gross_sales ELSE 0 END) AS gross,
         SUM(CASE WHEN voided=1 AND is_modifier=0 THEN price       ELSE 0 END) AS voids,
         COUNT(DISTINCT CASE WHEN voided=0 THEN order_id END)                              AS orders,
         COUNT(DISTINCT CASE WHEN voided=1 THEN order_id END)                              AS voidOrders,
         COUNT(DISTINCT CASE WHEN voided=0 AND is_modifier=0 THEN order_id END)            AS sm,
         COUNT(DISTINCT CASE WHEN voided=0 AND revenue_center='Modifiers' THEN order_id END) AS ee
       FROM smoothieking.sales WHERE ${sfDb(store)} AND ${dateFilter(s, e, 'closed_datetime')}`)
    const x = r[0] ?? {}
    return {
      net: Number(x.net) || 0, gross: Number(x.gross) || 0, voids: Number(x.voids) || 0,
      orders: Number(x.orders) || 0, voidOrders: Number(x.voidOrders) || 0,
      sm: Number(x.sm) || 0, ee: Number(x.ee) || 0,
    }
  } catch { return zero }
}
function sfPfs(store: Store) {
  if (store === 'all') return '1=1'
  const storeNum: Record<string, string> = { Pines: '1392', Miramar: '1892', Margate: '2384' }
  return `store_number = '${storeNum[DB_STORE[store]]}'`
}
function sfWm(store: Store) {
  if (store === 'all') return '1=1'
  const n = DB_STORE[store]
  return `(CASE WHEN account_user_email LIKE '%miramar%' THEN 'Miramar' WHEN account_user_email LIKE '%pines%' THEN 'Pines' WHEN account_user_email LIKE '%margate%' THEN 'Margate' END) = '${n}'`
}

export async function GET(req: NextRequest) {
  const p       = req.nextUrl.searchParams
  const store   = (p.get('store')  ?? 'all') as Store
  const period  = (p.get('period') ?? 'weekly') as Period
  const start   = p.get('start')   ?? ''
  const end     = p.get('end')     ?? ''
  const pyStart = p.get('pyStart') ?? ''
  const pyEnd   = p.get('pyEnd')   ?? ''

  if (period !== 'custom') {
    const data = await cacheKpisAsync(store, period)
    if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
    return Response.json(data)
  }

  if (!start || !end) return Response.json({ error: 'missing_dates' }, { status: 400 })

  // Sales / orders / EE for any custom range come straight from smoothieking.sales
  // (always live) — not the bundled Sigma JSON, which only updated on deploy. COGS stays
  // from Sigma (weekly). Definitions match the validated ones used to generate the cache.
  const cur = await salesAgg(store, start, end)
  const py  = await salesAgg(store, pyStart, pyEnd)
  const sig     = { net_sales: cur.net, gross_sales: cur.gross, voids_amount: cur.voids }
  const sigPY   = { net_sales: py.net,  gross_sales: py.gross,  voids_amount: py.voids }
  const cogsPctData = sigmaCogsPct(store, start, end)
  const orders  = cur.orders
  const ordersPY = py.orders

  const sales   = sig.net_sales
  const salesPY = sigPY.net_sales

  const voidPct     = cur.orders > 0 ? cur.voidOrders / cur.orders : 0
  const discountPct = sig.gross_sales > 0
    ? Math.max(0, sig.gross_sales - sig.net_sales - sig.voids_amount) / sig.gross_sales : 0

  let pfsTot = 0, wmTot = 0, tillVar = 0, laborCost = 0, laborHours = 0
  try {
    const [pfsR, wmR, tillR, laborR] = await Promise.allSettled([
      query<{ v: number }[]>(`SELECT SUM(line_total) AS v FROM smoothieking.pfg_order_line_items WHERE ${sfPfs(store)} AND ${dateFilter(start, end, 'order_date')}`),
      query<{ v: number }[]>(`SELECT SUM(item_subtotal) AS v FROM smoothieking.walmart_spend WHERE ${sfWm(store)}  AND ${dateFilter(start, end, 'order_date')}`),
      query<{ v: number }[]>(`SELECT ABS(SUM(over_short)) AS v FROM smoothieking.tillhistory WHERE ${sfDb(store)}  AND ${dateFilter(start, end, 'till_date')}`),
      query<{ total_pay: number; total_hrs: number }[]>(`SELECT SUM(total_pay) AS total_pay, SUM(total_hrs) AS total_hrs FROM smoothieking.labor WHERE ${sfDb(store)} AND ${dateFilter(start, end, 'shift_date')} AND employee_role NOT IN ('NON_EMP', 'Support')`),
    ])
    if (pfsR.status  === 'fulfilled') pfsTot  = Number(pfsR.value[0]?.v)  || 0
    if (wmR.status   === 'fulfilled') wmTot   = Number(wmR.value[0]?.v)   || 0
    if (tillR.status === 'fulfilled') tillVar = Number(tillR.value[0]?.v) || 0
    if (laborR.status === 'fulfilled') {
      laborCost  = Number(laborR.value[0]?.total_pay) || 0
      laborHours = Number(laborR.value[0]?.total_hrs) || 0
    }
  } catch { /* proxy not available — DB metrics will show 0 */ }

  const cogsActualPct: number | null = cogsPctData.actualPct
  const cogsActualAsOf = cogsPctData.asOf

  const today       = new Date().toISOString().slice(0, 10)
  const startMs     = new Date(start + 'T00:00:00').getTime()
  const endMs       = new Date(end   + 'T00:00:00').getTime()
  const daysElapsed = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1)

  const kpis: KpiData = {
    sales,
    salesPY,
    salesTarget:        salesPY > 0 ? Math.round(salesPY * (1 + TARGETS.salesGrowthYoY)) : 0,
    salesForecast:      null,
    orders,
    ordersPY,
    laborPct:           sales > 0 && laborCost > 0 ? laborCost / sales : 0,
    laborPctL4W:        0,
    laborCost,
    laborHours,
    cogsActualPct,
    cogsTheoreticalPct: cogsPctData.theoreticalPct,
    cogsActualAsOf,
    eePct:              cur.sm > 0 ? cur.ee / cur.sm : 0,
    eePctL4W:           0,
    eeInStorePct:       0,
    eeDigitalPct:       0,
    walmartPct:         sales > 0 && wmTot > 0 ? wmTot / sales : 0,
    walmartPctL4W:      0,
    atv:                orders > 0 ? sales / orders : 0,
    atvL4W:             0,
    pfsPct:             sales > 0 && pfsTot > 0 ? pfsTot / sales : 0,
    pfsPctL4W:          0,
    voidPct,
    voidPctL4W:         0,
    discountPct,
    discountPctL4W:     0,
    tillVariance:       tillVar,
    tillVarianceL4W:    0,
    periodComplete:     end < today,
    daysElapsed,
    daysTotal:          daysElapsed,
  }

  return Response.json(kpis)
}
