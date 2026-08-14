import { query } from '@/lib/db'
import { getPrisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/owner-guard'
import { STORES, LABOR_TARGET, COGS_TARGET, HIST_WEEKS, PRIME_TARGET, MGR_WEEKLY } from '@/lib/core/targets'
import { etToday, isoAdd, dowOf } from '@/lib/core/dates'
import { buildRateFor, type EmpRateRow } from '@/lib/core/labor'
import { empBurden, uncappedRate, TIP_PAYOUT } from '@/lib/core/laborBurden'
import { buildForecaster, type SalesRow } from '@/lib/core/forecast'
import { pfgFood, wmtFood } from '@/lib/core/sources'
import { BASIS_FACTOR } from '@/lib/bills/periods'
import { cogsWeeklySeries, type CogsWindow } from '@/lib/core/cogs'

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
// Salaried manager (Dan Madaffari, "Manager - Salary") — $65,000/yr, paid 50/50
// through Miramar + Pines ADP; $0 at Margate (his Margate management is bundled
// through those two entities' payroll). He's $0-pay in Brink so this never
// double-counts hourly wages, and it's what closes the labor-vs-ADP gap: Brink
// hourly + this salary + 0.85×tips ties to actual Staff Wages within ~1%. (The
// $3,333 "consulting" on Miramar/Pines is NOT him — that's the Tome seller-
// financing note, already booked to Debt.) Owners don't draw W-2 wages yet.
// The figure itself lives in core/targets.ts, which also records its open
// disagreement with cash-forecast/forecast.py.
const MGR_WK = MGR_WEEKLY
// Card processing, % of all-channel net sales (the base `sales` below carries).
// Ground truth = the processor deposit statement (Margate SK2384, both MIDs,
// Jul'25-Jul'26): $257,597.82 card sales -> $7,952.78 fees = 3.09% of CARD volume
// (~2.8-3.0% recurring + occasional annual PCI spikes). NOTE: QB's booked "Merchant
// Fees" P&L line (~$188/mo) is NOT the true cost -- the monthly fee sweep lands in a
// different account, so don't trust that line. Converting the 3.09% card rate onto
// THIS model's base (all-channel Brink net, which adds cash + marketplace delivery
// and is net of tax): $7,952.78 / $387,803 trailing-12mo Brink net = 2.05%; at the
// current sales pace (~$663/mo fees / ~$37.7k/mo net) ~1.76%. Use ~1.8%.
const MERCHANT = 0.018
// Franchise %-fees (royalty/national/regional/local) are NOT hardcoded — they are
// read from the same sk_bills franchise bills the cash forecast uses, so the two
// can't diverge. They accrue at rate x week's net sales x per-store BASIS_FACTOR
// (SK's reportable net runs ~1-2% below POS net — see lib/bills/periods.ts).

// A legible label for a franchise %-fee line from its bill vendor + rate.
function franchiseLabel(vendor: string, rate: number): string {
  const v = vendor.toLowerCase()
  const base = /royalty/.test(v) ? 'Royalty'
    : /national/.test(v) ? 'National ad fund'
    : /regional/.test(v) ? 'Regional ad fund'
    : /local/.test(v) ? 'Local marketing'
    : vendor.replace(/^.*?—\s*/, '').trim()
  return `${base} (${rate}%)`
}

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
  const gate = await requireOwner()
  if (gate) return gate

  const today = etToday()
  const wk0 = mondayOf(today)                                       // current week Monday
  const weeks = Array.from({ length: HORIZON_HIST + HORIZON_FWD + 1 },
    (_, i) => isoAdd(wk0, (i - HORIZON_HIST) * 7))
  const end = isoAdd(weeks[weeks.length - 1], 7)                    // exclusive
  const trainStart = isoAdd(wk0, -7 * (HIST_WEEKS + 4))             // history for run-rates
  const janFirst = `${today.slice(0, 4)}-01-01`                     // calendar-year start (FUTA/SUTA cap)

  const [salesRows, laborRows, schedRows, empRates, pfgRows, wmRows, taxRow, empYtdBase, empActual, tipRows] = await Promise.all([
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
    query<{ store: string; d: string; total: number }[]>(pfgFood.byStoreDay(`invoice_date >= '${trainStart}'`)),
    query<{ d: string; spend: number }[]>(wmtFood.byDay(`order_date >= '${trainStart}'`)),
    query<{ store: string; rate: number }[]>(`SELECT store, SUM(taxes)/NULLIF(SUM(net_sales),0) rate FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= '${trainStart}' AND CAST(closed_datetime AS DATE) < '${wk0}'
        AND voided=0 AND is_modifier=0 GROUP BY store`),
    // Per-employee CALENDAR-year wages before the window start — the base for the
    // $7k FUTA/SUTA cap. And per-employee worked wages inside the window (for the
    // marginal cap each week). Together they drive the real employer burden.
    query<{ store: string; employee: string; ytd: number }[]>(`SELECT store, employee, SUM(total_pay) ytd
      FROM smoothieking.labor WHERE shift_date >= '${janFirst}' AND shift_date < '${weeks[0]}'
        AND employee IS NOT NULL AND employee_role NOT IN ('NON_EMP','Support') GROUP BY store, employee`),
    query<{ store: string; employee: string; d: string; pay: number }[]>(`SELECT store, employee, CONVERT(char(10),shift_date,23) d, SUM(total_pay) pay
      FROM smoothieking.labor WHERE shift_date >= '${weeks[0]}' AND shift_date < '${end}'
        AND employee IS NOT NULL AND employee_role NOT IN ('NON_EMP','Support') GROUP BY store, employee, CONVERT(char(10),shift_date,23)`),
    // CC tips per store/day (tillhistory.tips = card tips; sum all rows incl EOD Till).
    // 85% is paid out through payroll and taxed — only the burden on it is an
    // employer cost (the payout itself is customer money, offset by the card deposit).
    query<{ store: string; d: string; tips: number }[]>(`SELECT store, CONVERT(char(10),till_date,23) d, SUM(tips) tips
      FROM smoothieking.tillhistory WHERE till_date >= '${trainStart}' AND till_date < '${end}' GROUP BY store, CONVERT(char(10),till_date,23)`),
  ])

  // fixed bills (sk_bills) -> per store, per bucket, itemized monthly $
  const prisma = getPrisma()
  const bills = prisma ? await prisma.bill.findMany({ where: { active: true } }) : []

  // Recipe (theoretical) COGS rate per store — the cost-control food number, same
  // basis as Weekly Ops: SUM(qty_issue x price) usage over the trailing 8 NetChef
  // count weeks, divided by the net sales in those same weeks. Drives the food %
  // and the food budget variance (purchases stay as cash context only).
  // Food cost % comes from core/cogs, which values usage at the last known
  // netchef_onhand.inventory_price. netchef_usage_api.price is empty on 81% of the
  // nightly rows, so summing qty_issue*price across the window pulled a fraction of
  // the cost into the numerator while every day of sales landed in the denominator.
  // core/cogs also clamps its window to the days usage exists for, which is the other
  // half of the same error (usage ran to Aug 8 while sales ran to Aug 9).
  const cogsSeries = await cogsWeeklySeries(8).catch(() => [] as CogsWindow[])
  const cogsRows = Object.values(
    cogsSeries.reduce<Record<string, { store: string; theo: number; sales: number }>>((acc, w) => {
      const k = w.store.toLowerCase()
      acc[k] = acc[k] ?? { store: k, theo: 0, sales: 0 }
      acc[k].theo += w.cogs
      acc[k].sales += w.netSales
      return acc
    }, {}))

  const NAME_OF: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
  const cogsRate = new Map<string, number>()   // store name -> recipe COGS rate
  for (const r of cogsRows) { const nm = NAME_OF[r.store]; if (nm && num(r.sales) > 0) cogsRate.set(nm, num(r.theo) / num(r.sales)) }

  // ---- index live data per store ----
  const maxSales = salesRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxLabor = laborRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxPfg = pfgRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxWm = wmRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const maxTill = tipRows.reduce((m, r) => r.d > m ? r.d : m, '')
  const rateFor = buildRateFor(empRates)
  const forecastFor = buildForecaster(salesRows)
  const taxRate = new Map(taxRow.map(r => [r.store, num(r.rate)]))

  // ---- real employer payroll burden (FICA + FUTA/SUTA on first $7k + WC) ----
  // Effective rate per store per week. Wage per (store|emp|day) = actual once worked,
  // scheduled after; walk weeks in order carrying each employee's YTD so the $7k cap
  // applies marginally. Weeks with no employee data (fully-trailing forecast) inherit
  // the prior week's rate, floored at the store's uncapped rate.
  const empDayWage = new Map<string, number>()   // `${store}|${emp}|${d}` -> $
  for (const r of empActual) if (r.d <= maxLabor) empDayWage.set(`${r.store}|${r.employee}|${r.d}`, num(r.pay))
  for (const r of schedRows) if (r.d > maxLabor) {
    const k = `${r.store}|${r.employee}|${r.d}`
    empDayWage.set(k, (empDayWage.get(k) ?? 0) + num(r.h) * rateFor(r.store, r.employee))
  }
  const burdenRate = new Map<string, number>()   // `${store}|${weekMonday}` -> rate
  for (const name of STORE_NAMES) {
    const run = new Map<string, number>()        // employee -> calendar-year wages so far
    for (const r of empYtdBase) if (r.store === name) run.set(r.employee, num(r.ytd))
    let last = uncappedRate(name)
    for (const w of weeks) {
      const wkDays = new Set(Array.from({ length: 7 }, (_, i) => isoAdd(w, i)))
      const ew = new Map<string, number>()       // employee -> wage this week
      for (const [k, v] of empDayWage) {
        if (!k.startsWith(name + '|')) continue
        const rest = k.slice(name.length + 1)
        const lp = rest.lastIndexOf('|')
        if (!wkDays.has(rest.slice(lp + 1))) continue
        const emp = rest.slice(0, lp)
        ew.set(emp, (ew.get(emp) ?? 0) + v)
      }
      let totW = 0, totB = 0
      for (const [emp, wage] of ew) {
        const before = run.get(emp) ?? 0
        totB += empBurden(name, wage, before); totW += wage
        run.set(emp, before + wage)
      }
      const rate = totW > 0 ? totB / totW : last
      burdenRate.set(`${name}|${w}`, rate)
      if (totW > 0) last = rate
    }
  }

  const perStore = (name: string) => {
    const sales = new Map<string, number>(), labor = new Map<string, number>()
    for (const r of salesRows) if (r.store === name) sales.set(r.d, num(r.net))
    for (const r of laborRows) if (r.store === name) labor.set(r.d, num(r.pay))
    const sched = new Map<string, number>()   // d -> scheduled cost
    for (const r of schedRows) if (r.store === name) sched.set(r.d, (sched.get(r.d) ?? 0) + num(r.h) * rateFor(name, r.employee))
    const pfg = new Map<string, number>()
    for (const r of pfgRows) if (PFG_TO_NAME[r.store] === name) pfg.set(r.d, (pfg.get(r.d) ?? 0) + num(r.total))
    const tips = new Map<string, number>()
    for (const r of tipRows) if (r.store === name) tips.set(r.d, num(r.tips))
    return { sales, labor, sched, pfg, tips }
  }

  // trailing weekly averages (per store) for forecasting fully-future weeks
  const weeklyAvg = (daily: Map<string, number>, weeksBack = HIST_WEEKS) => {
    const lo = isoAdd(wk0, -7 * weeksBack)
    let t = 0
    for (const [d, v] of daily) if (d >= lo && d < wk0) t += v
    return t / weeksBack
  }
  const wmDaily = new Map(wmRows.map(r => [r.d, num(r.spend)]))
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
    const tipsWkAvg = weeklyAvg(D.tips)
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

    // Franchise %-fees for this store, read from the DB bills (the single source).
    const franchisePct = bills
      .filter(b => b.store === name && b.category === 'Franchise Fees' && b.amountType === 'percent')
      .map(b => ({ label: franchiseLabel(b.vendor, num(b.amountValue)), rate: num(b.amountValue) }))
      .sort((a, b) => b.rate - a.rate)
    const basis = BASIS_FACTOR[name] ?? 1

    const wkRows = weeks.map(w => {
      const days = Array.from({ length: 7 }, (_, i) => isoAdd(w, i))
      const bRate = burdenRate.get(`${name}|${w}`) ?? uncappedRate(name)   // employer payroll burden
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
      const tax = scale(sales, rate)
      const merchant = scale(sales, MERCHANT)
      // franchise %-fees: each corporate line, on SK-reportable net (basis factor)
      const franchiseItems = franchisePct.map(fp => ({ name: fp.label, ...scale(sales, (fp.rate / 100) * basis) }))

      // Labor ties to actual ADP payroll (validated vs June QB Staff Wages within ~1%):
      //  hourly wages (Brink) + 85% of CC tips paid to HOURLY staff (the manager doesn't
      //  share in tips) + the salaried manager, all W-2 and taxed. Employer burden
      //  applies to the whole taxable base.
      const [tipA, tipF] = weekSplit(D.tips, days, maxTill, tipsWkAvg)
      const tips = L(tipA * TIP_PAYOUT, 0, tipF * TIP_PAYOUT)      // 85% of CC tips, to hourly
      const mgr = L(0, MGR_WK[name] ?? 0, 0)                        // salaried manager, committed
      const burden = scale(L(wages.a + tips.a + mgr.a, wages.c + tips.c + mgr.c, wages.f + tips.f + mgr.f), bRate)

      const fixedRun = (bk: string) => (fixedItems[bk] ?? []).reduce((t, it) => t + it.mo * WK, 0)

      // Food cost = recipe (theoretical) usage at the trailing NetChef rate x sales —
      // the cost-control number (stable, comparable to 25%). Purchases (PFG/Walmart)
      // ride along as `context` lines: shown for cash reference, never summed into cost.
      const cRate = cogsRate.get(name) ?? COGS_TARGET
      const recipeCogs = scale(sales, cRate)

      const rawBuckets = [
        { key: 'Food', variable: true, items: [
          { name: 'Recipe COGS (usage)', ...recipeCogs },
          { name: 'PFG purchased (cash)', context: true, ...L(pfgA, 0, pfgF) },
          { name: 'Walmart purchased (cash)', context: true, ...L(wmA, 0, wmF) } ] },
        { key: 'Labor', variable: true, items: [
          { name: 'Hourly wages', ...wages },
          { name: 'CC tips (85%, to hourly)', ...tips },
          ...((MGR_WK[name] ?? 0) > 0 ? [{ name: 'Manager salary (D. Madaffari)', ...mgr }] : []),
          { name: `Payroll taxes & WC (${(bRate * 100).toFixed(1)}%)`, ...burden },
          ...(fixedItems['Labor'] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })) ] },
        { key: 'Franchise', variable: false, items: [
          ...franchiseItems,
          ...(fixedItems['Franchise'] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })) ] },
        ...['Occupancy', 'Debt', 'Utilities', 'Insurance'].map(bk => ({
          key: bk, variable: false,
          items: (fixedItems[bk] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })) })),
        { key: 'Operating', variable: false, items: [
          ...(fixedItems['Operating'] ?? []).map(it => ({ name: it.name, ...L(0, it.mo * WK, 0) })),
          { name: 'Merchant fees (est)', ...merchant } ] },
        { key: 'Sales tax', variable: false, passthrough: true, items: [
          { name: 'FL DOR remittance', ...tax } ] },
      ]
      const s = totOf(sales) || 1
      // FLEXIBLE BUDGET (plan) per bucket, using the SHARED core targets so it can't
      // drift from ops-week / daily recap: the two levers get a target % of *this
      // week's* sales; every fixed/contractual bucket's plan == its run-rate (so it
      // shows on-plan by construction and the variance isolates food + labor).
      //   Food  = 25% x sales (COGS_TARGET) · Labor = 22% x sales x burden + fixed
      // `context` items (cash purchases) are shown but never counted in cost totals.
      const itemsTot = (its: { a: number; c: number; f: number; context?: boolean }[]) =>
        its.filter(i => !i.context).reduce((t, i) => t + i.a + i.c + i.f, 0)
      const buckets = rawBuckets.map(b => {
        const actual = itemsTot(b.items)
        const plan = b.key === 'Food' ? COGS_TARGET * totOf(sales)
          : b.key === 'Labor' ? LABOR_TARGET * totOf(sales) * (1 + bRate) + fixedRun('Labor') + (totOf(tips) + totOf(mgr)) * (1 + bRate)
          : actual
        return { ...b, plan }
      })
      const foodPurch = totOf(L(pfgA, 0, pfgF)) + totOf(L(wmA, 0, wmF))   // cash restock, context only
      // Fully-loaded prime = recipe COGS + loaded labor (hourly + tips + manager + burden + fixed).
      const laborLoaded = itemsTot(rawBuckets.find(b => b.key === 'Labor')!.items)
      return {
        wk: w,
        phase: w < wk0 ? 'history' : w === wk0 ? 'current' : 'forecast',
        sales, buckets,
        foodPct: totOf(recipeCogs) / s,
        laborPct: totOf(wages) / s,
        primePct: (totOf(recipeCogs) + laborLoaded) / s,
        foodPurch,
      }
    })
    return { store: name, weeks: wkRows }
  })

  // Fully-loaded prime target: food 25% + loaded labor (22% wages x ~1.13 burden +
  // management allowance) ≈ 52%. A single owner-facing goal for the hero metric.

  return Response.json({
    asOf: today, current: wk0,
    target: { food: COGS_TARGET, labor: LABOR_TARGET, prime: COGS_TARGET + LABOR_TARGET, primeLoaded: PRIME_TARGET },
    bucketOrder: BUCKET_ORDER, variable: VARIABLE, stores,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
