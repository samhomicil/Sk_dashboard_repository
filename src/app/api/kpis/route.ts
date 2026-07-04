import { NextRequest } from 'next/server'
import { cacheKpisAsync } from '@/lib/cache'
import { sigmaSales, sigmaOrders, sigmaCogs, sigmaCogsActualThruDate, sigmaEERange, sigmaLaborData } from '@/lib/sigma'
import { query, dateFilter } from '@/lib/db'
import { TARGETS } from '@/lib/config'
import type { Store, Period, KpiData } from '@/lib/types'

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }

function sfDb(store: Store) {
  return store === 'all' ? '1=1' : `store = '${DB_STORE[store]}'`
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

  const sig     = sigmaSales(store, start, end)
  const sigPY   = pyStart && pyEnd ? sigmaSales(store, pyStart, pyEnd) : { net_sales: 0, gross_sales: 0, voids_amount: 0 }
  const sigCogs = sigmaCogs(store, start, end)
  const orders  = sigmaOrders(store, start, end)
  const ordersPY = pyStart && pyEnd ? sigmaOrders(store, pyStart, pyEnd) : 0

  const sales   = sig.net_sales
  const salesPY = sigPY.net_sales

  const voidPct     = sig.gross_sales > 0 ? sig.voids_amount / sig.gross_sales : 0
  const discountPct = sig.gross_sales > 0
    ? Math.max(0, sig.gross_sales - sig.net_sales - sig.voids_amount) / sig.gross_sales : 0

  const { labor: laborCost, hours: laborHours } = sigmaLaborData(store, start, end)
  let pfsTot = 0, wmTot = 0, tillVar = 0
  try {
    const [pfsR, wmR, tillR] = await Promise.allSettled([
      query<{ v: number }[]>(`SELECT SUM(line_total) AS v FROM smoothieking.pfg_order_line_items WHERE ${sfPfs(store)} AND ${dateFilter(start, end, 'order_date')}`),
      query<{ v: number }[]>(`SELECT SUM(item_subtotal) AS v FROM smoothieking.walmart_spend WHERE ${sfWm(store)}  AND ${dateFilter(start, end, 'order_date')}`),
      query<{ v: number }[]>(`SELECT ABS(SUM(over_short)) AS v FROM smoothieking.tillhistory WHERE ${sfDb(store)}  AND ${dateFilter(start, end, 'till_date')}`),
    ])
    if (pfsR.status  === 'fulfilled') pfsTot  = Number(pfsR.value[0]?.v)  || 0
    if (wmR.status   === 'fulfilled') wmTot   = Number(wmR.value[0]?.v)   || 0
    if (tillR.status === 'fulfilled') tillVar = Number(tillR.value[0]?.v) || 0
  } catch { /* proxy not available — DB metrics will show 0 */ }

  let cogsActualPct: number | null = null
  const cogsActualAsOf = sigmaCogsActualThruDate(store)
  if (sigCogs.actual_cogs > 0 && sales > 0) cogsActualPct = sigCogs.actual_cogs / sales

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
    cogsTheoreticalPct: sigCogs.theoretical_cogs > 0 && sales > 0 ? sigCogs.theoretical_cogs / sales : null,
    cogsActualAsOf,
    eePct:              (() => { const r = sigmaEERange(store, start, end); return r.sm > 0 ? r.ee / r.sm : 0 })(),
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
