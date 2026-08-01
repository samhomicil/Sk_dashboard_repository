import { query } from '@/lib/db'
import { getPrisma } from '@/lib/prisma'
import { STORES, LABOR_TARGET, HIST_WEEKS } from '@/lib/core/targets'
import { etToday, isoAdd, dowOf } from '@/lib/core/dates'
import { buildRateFor, type EmpRateRow } from '@/lib/core/labor'
import { buildForecaster, type SalesRow } from '@/lib/core/forecast'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Owner-only weekly BUDGET engine (accrual / cost-control view). The TypeScript
 * successor to the local cost_plan.py — every cost bucketed with actual /
 * committed / forecast, computed from live data through the SHARED CORE RULES so
 * the budget can never diverge from the ops-week report or the daily recap.
 *
 *   labor   = actual pay (worked) + scheduled cost (core rateFor) + forecast
 *   food    = PFG invoices + Walmart spend (purchases, partial-week top-up)
 *   sales   = actual + core same-weekday forecast (buildForecaster)
 *   fixed   = sk_bills.Bill, bucketed by category, monthly -> weekly accrual
 *
 * Gated to owners in proxy.ts (financial route). Managers get 403.
 */

const HORIZON_FWD = 5          // weeks ahead (+ current)
const HORIZON_HIST = 3         // completed weeks for context + 4-wk run-rate
const BURDEN = 1.111           // employer payroll taxes/WC (labor bucket only)
const GM_WK = 693              // salaried GM, per store per week (fixed bucket)
const MERCHANT = 0.03          // card processing, est % of net sales
const CORP_PCT = 0.12          // royalty + marketing, % of sales (accrued)

const STORE_NAMES = STORES.map(s => s.name)
const PFG_TO_NAME: Record<string, string> = { '3784': 'Pines', '3783': 'Miramar', '3167': 'Margate' }

// Bill category -> budget bucket. Categories modeled elsewhere (food/wages/12%/tax)
// are skipped here and computed from live data.
const CAT_BUCKET: Record<string, string> = {
  'Rent / Lease': 'Occupancy',
  'Loan / Debt': 'Debt',
  'Utilities': 'Utilities',
  'Insurance': 'Insurance',
  'Internet / Phone': 'Operating',
  'Maintenance': 'Operating',
  'Subscriptions': 'Operating',
  'Professional Services': 'Operating',
  'Bank / Finance': 'Operating',
  'Storage': 'Operating',
  'Payroll': 'Labor',            // ADP processing fee only (fixed); wages are live
  'Franchise Fees': 'Franchise', // tech fee (fixed); the 12% is computed from sales
}
const BUCKET_ORDER = ['Food', 'Labor', 'Franchise', 'Occupancy', 'Debt', 'Utilities', 'Insurance', 'Operating', 'Sales tax']
const VARIABLE = ['Food', 'Labor']
const WK = 7 / 30.4             // monthly -> weekly accrual

type Layer = { a: number; c: number; f: number }
const L = (a = 0, c = 0, f = 0): Layer => ({ a, c, f })
const scale = (x: Layer, k: number): Layer => L(x.a * k, x.c * k, x.f * k)
const totOf = (x: Layer) => x.a + x.c + x.f
const num = (v: unknown) => Number(v) || 0

function mondayOf(iso: string): string {
  const dw = dowOf(iso)                       // Sun=0..Sat=6
  return isoAdd(iso, dw === 0 ? -6 : 1 - dw)
}

/** Split a weekly total into (actual, forecast) with partial-week top-up. */
function weekSplit(daily: Map<string, number>, days: string[], maxIso: string, wkAvg: number, k = 1): [number, number] {
  const actual = days.filter(d => d <= maxIso).reduce((t, d) => t + (daily.get(d) ?? 0), 0) * k
  if (days[days.length - 1] <= maxIso) return [actual, 0]          // fully past
  if (days[0] > maxIso) return [0, wkAvg * k]                       // fully future
  return [actual, Math.max(0, wkAvg * k - actual)]                 // in-progress top-up
}

export async function GET() {
  const today = etToday()
  const wk0 = mondayOf(today)                                       // current week Monday
  const weeks = Array.from({ length: HORIZON_HIST + HORIZON_FWD + 1 },
    (_, i) => isoAdd(wk0, (i - HORIZON_HIST) * 7))
  const end = isoAdd(weeks[weeks.length - 1], 7)                    // exclusive
  const trainStart = isoAdd(wk0, -7 * (HIST_WEEKS + 4))             // history for run-rates

  const [salesRows, laborRows, schedRows, empRates, pfgRows, wmRows, taxRow] = await Promise.all([
    query<SalesRow[]>(`SELECT store, CONVERT(char(10),CAST(closed_datetime AS DATE),23) d,
        SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales WHERE CAST(closed_datetime AS DATE) >= '${trainStart}' AND CAST(closed_datetime AS DATE) < '${end}'
      GROUP BY store, CONVERT(char(10),CAST(closed_datetime AS DATE),23)`),
    query<{ store: string; d: string; pay: number }[]>(`SELECT store, CONVERT(char(10),shift_date,23) d, SUM(total_pay) pay
      FROM smoothieking.labor WHERE shift_date >= '${trainStart}' AND shift_date < '${end}'
        AND employee_role NOT IN ('NON_EMP','Support') GROUP BY store, CONVERT(char(10),shift_date,23)`),
    query<{ store: string; d: string; employee: string; h: number }[]>(`SELECT store, CONVERT(char(10),work_date,23) d, employee, sched_hours h
      FROM smoothieking.labor_schedule WHERE work_date >= '${wk0}' AND work_date < '${end}'
        AND role NOT IN ('NON_EMP','Support')`),
    query<EmpRateRow[]>(`SELECT store, employee, rate FROM (
        SELECT store, employee, rate, ROW_NUMBER() OVER (PARTITION BY store, employee ORDER BY shift_date DESC) rn
        FROM smoothieking.labor WHERE rate > 0) t WHERE rn = 1`),
    query<{ store_number: string; d: string; total: number }[]>(`WITH inv AS (
        SELECT DISTINCT invoice_number, store_number, invoice_date, invoice_total
        FROM smoothieking.pfs_invoices WHERE invoice_type='Invoice' AND invoice_date >= '${trainStart}')
      SELECT RIGHT(store_number,4) store_number, CONVERT(char(10),invoice_date,23) d, SUM(invoice_total) total
      FROM inv GROUP BY RIGHT(store_number,4), invoice_date`),
    query<{ d: string; total: number }[]>(`WITH o AS (SELECT DISTINCT order_id, order_date, order_net_total FROM smoothieking.walmart_spend WHERE order_date >= '${trainStart}')
      SELECT CONVERT(char(10),order_date,23) d, SUM(order_net_total) total FROM o GROUP BY order_date`),
    query<{ store: string; rate: number }[]>(`SELECT store, SUM(taxes)/NULLIF(SUM(net_sales),0) rate FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= '${trainStart}' AND CAST(closed_datetime AS DATE) < '${wk0}'
        AND voided=0 AND is_modifier=0 GROUP BY store`),
  ])

  // fixed bills (sk_bills) -> per store, per bucket, itemized monthly $
  const prisma = getPrisma()
  const bills = prisma ? await prisma.bill.findMany({ where: { active: true } }) : []

  // ---- index live data per store ----
  const maxSales = salesRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxLabor = laborRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxPfg = pfgRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxWm = wmRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const rateFor = buildRateFor(empRates)
  const forecastFor = buildForecaster(salesRows)
  const taxRate = new Map(taxRow.map(r => [r.store, num(r.rate)]))

  const perStore = (name: string) => {
    const sales = new Map<string, number>(), labor = new Map<string, number>()
    for (const r of salesRows) if (r.store === name) sales.set(r.d, num(r.net))
    for (const r of laborRows) if (r.store === name) labor.set(r.d, num(r.pay))
    const sched = new Map<string, number>()   // d -> scheduled cost
    for (const r of schedRows) if (r.store === name) sched.set(r.d, (sched.get(r.d) ?? 0) + num(r.h) * rateFor(name, r.employee))
    const pfg = new Map<string, number>()
    for (const r of pfgRows) if (PFG_TO_NAME[r.store_number] === name) pfg.set(r.d, (pfg.get(r.d) ?? 0) + num(r.total))
    return { sales, labor, sched, pfg }
  }

  // trailing weekly averages (per store) for forecasting fully-future weeks
  const weeklyAvg = (daily: Map<string, number>, weeksBack = HIST_WEEKS) => {
    const lo = isoAdd(wk0, -7 * weeksBack)
    let t = 0
    for (const [d, v] of daily) if (d >= lo && d < wk0) t += v
    return t / weeksBack
  }
  const wmDaily = new Map(wmRows.map(r => [r.d, num(r.total)]))
  const wmWkAvg = weeklyAvg(wmDaily)
  // store sales share (trailing) to split all-store Walmart
  const shareDen = STORE_NAMES.reduce((t, n) => {
    const s = perStore(n).sales; let x = 0; const lo = isoAdd(wk0, -7 * HIST_WEEKS)
    for (const [d, v] of s) if (d >= lo && d < wk0) x += v; return t + x
  }, 0) || 1

  const stores = STORE_NAMES.map(name => {
    const D = perStore(name)
    const laborWkAvg = weeklyAvg(D.labor)
    const pfgWkAvg = weeklyAvg(D.pfg)
    let storeShare = 0
    { const lo = isoAdd(wk0, -7 * HIST_WEEKS); for (const [d, v] of D.sales) if (d >= lo && d < wk0) storeShare += v }
    storeShare /= shareDen
    const rate = taxRate.get(name) ?? 0.059

    // this store's fixed bills, itemized per bucket (monthly $)
    const fixedItems: Record<string, { name: string; mo: number }[]> = {}
    for (const b of bills) {
      if (b.store !== name) continue
      if (b.category === 'COGS' || b.category === 'Taxes') continue           // computed live
      if (b.category === 'Franchise Fees' && b.amountType === 'percent') continue // the 12%
      if (b.category === 'Payroll' && b.amountType !== 'fixed') continue      // wages, live
      let bucket = CAT_BUCKET[b.category] ?? 'Operating'
      if (/tome/i.test(b.vendor)) bucket = 'Debt'                             // Tome = debt, not utility
      const label = b.vendor.replace(/^.*?—\s*/, '').trim() || b.vendor
      ;(fixedItems[bucket] ??= []).push({ name: label, mo: b.amountValue })
    }

    const wkRows = weeks.map(w => {
      const days = Array.from({ length: 7 }, (_, i) => isoAdd(w, i))
      // sales
      let sA = 0, sF = 0
      for (const d of days) { if (d <= maxSales) sA += D.sales.get(d) ?? 0; else sF += forecastFor(name, d) }
      const sales = L(sA, 0, sF)
      // labor (unloaded wages): actual + scheduled + forecast
      const lA = days.filter(d => d <= maxLabor).reduce((t, d) => t + (D.labor.get(d) ?? 0), 0)
      const lC = days.filter(d => d > maxLabor).reduce((t, d) => t + (D.sched.get(d) ?? 0), 0)
      const unsched = days.filter(d => d > maxLabor && !(D.sched.get(d))).length
      const lF = unsched ? laborWkAvg * (unsched / 7) : 0
      const wages = L(lA, lC, lF)
      // food
      const [pfgA, pfgF] = weekSplit(D.pfg, days, maxPfg, pfgWkAvg)
      const [wmA, wmF] = weekSplit(wmDaily, days, maxWm, wmWkAvg, storeShare)
      // derived
      const corp = scale(sales, CORP_PCT)
      const tax = scale(sales, rate)
      const merchant = scale(sales, MERCHANT)

      const buckets = [
        { key: 'Food', variable: true, items: [
          { name: 'PFG deliveries', ...L(pfgA, 0, pfgF) },
          { name: 'Walmart runs', ...L(wmA, 0, wmF) } ] },
        { key: 'Labor', variable: true, items: [
          { name: 'Hourly wages', ...wages },
          { name: 'Payroll taxes (11%)', ...scale(wages, BURDEN - 1) },
          ...(fixedItems['Labor'] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })) ] },
        { key: 'Franchise', variable: false, items: [
          { name: 'Royalty & marketing (12%)', ...corp },
          ...(fixedItems['Franchise'] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })) ] },
        ...['Occupancy', 'Debt', 'Utilities', 'Insurance'].map(bk => ({
          key: bk, variable: false,
          items: (fixedItems[bk] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })) })),
        { key: 'Operating', variable: false, items: [
          ...(fixedItems['Operating'] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })),
          { name: 'GM salary', ...L(0, GM_WK, 0) },
          { name: 'Merchant fees (est)', ...merchant } ] },
        { key: 'Sales tax', variable: false, passthrough: true, items: [
          { name: 'FL DOR remittance', ...tax } ] },
      ]
      const foodT = totOf(L(pfgA, 0, pfgF)) + totOf(L(wmA, 0, wmF))
      const s = totOf(sales) || 1
      return {
        wk: w,
        phase: w < wk0 ? 'history' : w === wk0 ? 'current' : 'forecast',
        sales, buckets,
        foodPct: foodT / s,
        laborPct: totOf(wages) / s,
      }
    })
    return { store: name, weeks: wkRows }
  })

  return Response.json({
    asOf: today, current: wk0,
    target: { food: 0.25, labor: LABOR_TARGET, prime: 0.25 + LABOR_TARGET },
    bucketOrder: BUCKET_ORDER, variable: VARIABLE, stores,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
