/**
 * Cache builder — computes all dashboard data from Azure SQL + bundled Sigma files.
 * Used by both the CLI refresh script and the production /api/refresh endpoint.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subWeeks, addWeeks, subYears, format, differenceInDays,
} from 'date-fns'
import { PROXY_URL, TARGETS } from './config'
import {
  sigmaSales, sigmaCogs, sigmaMonthSales, sigmaWeeklySales, sigmaDailySales,
  sigmaOrders, sigmaChannels, sigmaThruDate, sigmaCogsActualThruDate,
  sigmaEmployees, sigmaAllEmpKeys, sigmaEEByDate, sigmaEEDailyPct, sigmaHeatmap, sigmaHeatmapWeekly,
} from './sigma'
import type {
  Store, KpiData, StoreRow, EmployeeRow, ProductRow, CategoryRow, ChannelRow,
  QuarterRow, TrendPoint, DailyRow, DailyData, StaffingData, StaffingCell, StaffingEmployee, Promotion,
} from './types'

// ── DB helper ────────────────────────────────────────────────────
async function dbQuery<T = Record<string, unknown>[]>(sql: string): Promise<T> {
  if (process.env.AZURE_SQL_SERVER) {
    const { azureSqlQuery } = await import('./azure-cache')
    return azureSqlQuery<T>(sql)
  }
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return (data.rows ?? data.results ?? data) as T
}

const DB_STORE_NAME: Record<Store, string> = {
  all: '', pines: 'Pines', miramar: 'Miramar', margate: 'Margate',
}

function sf(store: Store): string {
  if (store === 'all') return '1=1'
  return `store = '${DB_STORE_NAME[store]}'`
}
function sfPfs(store: Store): string {
  if (store === 'all') return '1=1'
  const storeNum: Record<string, string> = { Pines: '1392', Miramar: '1892', Margate: '2384' }
  return `store_number = '${storeNum[DB_STORE_NAME[store]]}'`
}
function sfWalmart(store: Store): string {
  if (store === 'all') return '1=1'
  const n = DB_STORE_NAME[store]
  return `(CASE WHEN account_user_email LIKE '%miramar%' THEN 'Miramar' WHEN account_user_email LIKE '%pines%' THEN 'Pines' WHEN account_user_email LIKE '%margate%' THEN 'Margate' END) = '${n}'`
}
function df(start: string, end: string, col = 'closed_datetime'): string {
  return `CAST(${col} AS DATE) BETWEEN '${start}' AND '${end}'`
}

// ── Date ranges ────────────────────────────────────────────────────
function ranges() {
  const today     = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const sigmaThru = sigmaThruDate()
  const dataThru  = sigmaThru
    ? new Date(Math.min(yesterday.getTime(), new Date(sigmaThru + 'T00:00:00').getTime()))
    : yesterday

  const wStart = startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 })
  const wEnd   = endOfWeek(subWeeks(today, 1),   { weekStartsOn: 1 })

  const mStart = today.getDate() <= 7
    ? startOfMonth(new Date(today.getFullYear(), today.getMonth() - 1))
    : startOfMonth(today)
  const mEnd   = today.getDate() <= 7
    ? endOfMonth(new Date(today.getFullYear(), today.getMonth() - 1))
    : dataThru

  const qStart = startOfQuarter(today)
  const qEnd   = dataThru
  const yStart = startOfYear(today)
  const yEnd   = dataThru

  function fmt(d: Date) { return format(d, 'yyyy-MM-dd') }

  const mNatural = today.getDate() <= 7
    ? endOfMonth(new Date(today.getFullYear(), today.getMonth() - 1))
    : endOfMonth(today)

  return {
    weekly:    { start: fmt(wStart), end: fmt(wEnd),   pyStart: fmt(subYears(wStart,1)), pyEnd: fmt(subYears(wEnd,1)),   naturalEnd: fmt(wEnd),              pyNaturalEnd: fmt(subYears(wEnd,1))              },
    monthly:   { start: fmt(mStart), end: fmt(mEnd),   pyStart: fmt(subYears(mStart,1)), pyEnd: fmt(subYears(mEnd,1)),   naturalEnd: fmt(mNatural),          pyNaturalEnd: fmt(subYears(mNatural,1))          },
    quarterly: { start: fmt(qStart), end: fmt(qEnd),   pyStart: fmt(subYears(qStart,1)), pyEnd: fmt(subYears(qEnd,1)),   naturalEnd: fmt(endOfQuarter(today)),pyNaturalEnd: fmt(subYears(endOfQuarter(today),1)) },
    ytd:       { start: fmt(yStart), end: fmt(yEnd),   pyStart: fmt(subYears(yStart,1)), pyEnd: fmt(subYears(yEnd,1)),   naturalEnd: fmt(endOfYear(today)),  pyNaturalEnd: fmt(subYears(endOfYear(today),1))  },
  }
}

// ── KPIs ─────────────────────────────────────────────────────────
async function fetchKpis(store: Store, start: string, end: string, pyStart: string, pyEnd: string, naturalEnd: string, pyNaturalEnd: string): Promise<KpiData> {
  const filter        = sf(store)
  const pfsFilter     = sfPfs(store)
  const walmartFilter = sfWalmart(store)

  const l4wEnd   = new Date(start); l4wEnd.setDate(l4wEnd.getDate() - 1)
  const l4wStart = new Date(l4wEnd); l4wStart.setDate(l4wStart.getDate() - 27)
  const l4wS = format(l4wStart, 'yyyy-MM-dd')
  const l4wE = format(l4wEnd,   'yyyy-MM-dd')

  const sigSales   = sigmaSales(store, start, end)
  const sigSalesPY = sigmaSales(store, pyStart, pyNaturalEnd)
  const sigCogs    = sigmaCogs(store, start, end)
  const sigL4w     = sigmaSales(store, l4wS, l4wE)
  const orders     = sigmaOrders(store, start, end)
  const l4wOrders  = sigmaOrders(store, l4wS, l4wE)

  const [laborRes, tillRes, pfsRes, walmartRes] = await Promise.allSettled([
    dbQuery<{total_pay:number;total_hrs:number}[]>(`
      SELECT SUM(total_pay) AS total_pay, SUM(total_hrs) AS total_hrs FROM smoothieking.labor
      WHERE ${filter} AND ${df(start, end, 'shift_date')}
    `),
    dbQuery<{till_variance:number}[]>(`
      SELECT ABS(SUM(over_short)) AS till_variance FROM smoothieking.tillhistory
      WHERE ${filter} AND ${df(start, end, 'till_date')}
    `),
    dbQuery<{pfs_total:number}[]>(`
      SELECT SUM(line_total) AS pfs_total FROM smoothieking.pfg_order_line_items
      WHERE ${pfsFilter} AND ${df(start, end, 'order_date')}
    `),
    dbQuery<{walmart_total:number}[]>(`
      SELECT SUM(item_subtotal) AS walmart_total FROM smoothieking.walmart_spend
      WHERE ${walmartFilter} AND ${df(start, end, 'order_date')}
    `),
  ])

  const [l4wLaborRes, l4wPfsRes, l4wWalmartRes, l4wTillRes] = await Promise.allSettled([
    dbQuery<{total_pay:number}[]>(`
      SELECT SUM(total_pay) AS total_pay FROM smoothieking.labor
      WHERE ${filter} AND ${df(l4wS, l4wE, 'shift_date')}
    `),
    dbQuery<{pfs_total:number}[]>(`
      SELECT SUM(line_total) AS pfs_total FROM smoothieking.pfg_order_line_items
      WHERE ${pfsFilter} AND ${df(l4wS, l4wE, 'order_date')}
    `),
    dbQuery<{walmart_total:number}[]>(`
      SELECT SUM(item_subtotal) AS walmart_total FROM smoothieking.walmart_spend
      WHERE ${walmartFilter} AND ${df(l4wS, l4wE, 'order_date')}
    `),
    dbQuery<{till_variance:number}[]>(`
      SELECT ABS(SUM(over_short)) AS till_variance FROM smoothieking.tillhistory
      WHERE ${filter} AND ${df(l4wS, l4wE, 'till_date')}
    `),
  ])

  const val = <T>(r: PromiseSettledResult<T[]>, fallback: T): T =>
    r.status === 'fulfilled' ? (r.value[0] ?? fallback) : fallback

  const lab    = val(laborRes,      { total_pay:0, total_hrs:0 })
  const til    = val(tillRes,       { till_variance:0 })
  const pfs    = val(pfsRes,        { pfs_total:0 })
  const wm     = val(walmartRes,    { walmart_total:0 })
  const l4wLab  = val(l4wLaborRes,  { total_pay:0 })
  const l4wPfs  = val(l4wPfsRes,    { pfs_total:0 })
  const l4wWm   = val(l4wWalmartRes,{ walmart_total:0 })
  const l4wTill = val(l4wTillRes,   { till_variance:0 })

  const sales      = sigSales.net_sales
  const salesPY    = sigSalesPY.net_sales
  const laborCost  = Number(lab.total_pay) || 0
  const laborHours = Number(lab.total_hrs) || 0
  const pfsTot    = Number(pfs.pfs_total)    || 0
  const wmTot     = Number(wm.walmart_total) || 0
  const l4wSales  = sigL4w.net_sales

  const voidPct        = sigSales.gross_sales > 0 ? sigSales.voids_amount / sigSales.gross_sales : 0
  const voidPctL4W     = sigL4w.gross_sales   > 0 ? sigL4w.voids_amount   / sigL4w.gross_sales   : 0
  const discountPct    = sigSales.gross_sales > 0
    ? Math.max(0, sigSales.gross_sales - sigSales.net_sales - sigSales.voids_amount) / sigSales.gross_sales : 0
  const discountPctL4W = sigL4w.gross_sales > 0
    ? Math.max(0, sigL4w.gross_sales - sigL4w.net_sales - sigL4w.voids_amount) / sigL4w.gross_sales : 0

  const lastCountDate = sigmaCogsActualThruDate(store)
  let cogsActualPct:  number | null = null
  const cogsActualAsOf: string | null = lastCountDate
  if (sigCogs.actual_cogs > 0 && sales > 0) {
    cogsActualPct = sigCogs.actual_cogs / sales
  } else if (lastCountDate) {
    const countDt = new Date(lastCountDate + 'T00:00:00')
    countDt.setDate(countDt.getDate() - 6)
    const fallbackStart = format(countDt, 'yyyy-MM-dd')
    const fallbackCogs  = sigmaCogs(store, fallbackStart, lastCountDate)
    const fallbackSales = sigmaSales(store, fallbackStart, lastCountDate)
    if (fallbackCogs.actual_cogs > 0 && fallbackSales.net_sales > 0) {
      cogsActualPct = fallbackCogs.actual_cogs / fallbackSales.net_sales
    }
  }

  const today       = format(new Date(), 'yyyy-MM-dd')
  const daysElapsed = Math.max(1, differenceInDays(new Date(end + 'T00:00:00'), new Date(start + 'T00:00:00')) + 1)
  const daysTotal   = Math.max(1, differenceInDays(new Date(naturalEnd + 'T00:00:00'), new Date(start + 'T00:00:00')) + 1)

  return {
    sales, salesPY,
    salesTarget:        Math.round(salesPY * (1 + TARGETS.salesGrowthYoY)),
    salesForecast:      end >= today && sales > 0 ? Math.round(sales / daysElapsed * daysTotal) : null,
    orders,
    ordersPY:           0,
    laborPct:           sales > 0 ? laborCost / sales : 0,
    laborPctL4W:        l4wSales > 0 ? (Number(l4wLab.total_pay) || 0) / l4wSales : 0,
    laborCost,
    laborHours,
    cogsActualPct,
    cogsTheoreticalPct: sigCogs.theoretical_cogs > 0 && sales > 0 ? sigCogs.theoretical_cogs / sales : null,
    cogsActualAsOf,
    eePct:              (() => { const ee = sigmaEEByDate(start); const st = store === 'all' ? Object.values(ee.storeTotals).reduce((a, v) => ({ee: a.ee+v.ee, sm: a.sm+v.sm}), {ee:0,sm:0}) : (ee.storeTotals[store] ?? {ee:0,sm:0}); return st.sm > 0 ? st.ee / st.sm : 0 })(),
    eePctL4W:           0,
    eeInStorePct:       (() => { const ee = sigmaEEByDate(start); const ch = ee.channelEE; const agg = store === 'all' ? Object.values(ch).reduce((a, v) => ({inStore:{ee:a.inStore.ee+v.inStore.ee, sm:a.inStore.sm+v.inStore.sm}, digital:{ee:a.digital.ee+v.digital.ee, sm:a.digital.sm+v.digital.sm}}), {inStore:{ee:0,sm:0},digital:{ee:0,sm:0}}) : (ch[store] ?? {inStore:{ee:0,sm:0},digital:{ee:0,sm:0}}); return agg.inStore.sm > 0 ? agg.inStore.ee / agg.inStore.sm : 0 })(),
    eeDigitalPct:       (() => { const ee = sigmaEEByDate(start); const ch = ee.channelEE; const agg = store === 'all' ? Object.values(ch).reduce((a, v) => ({inStore:{ee:a.inStore.ee+v.inStore.ee, sm:a.inStore.sm+v.inStore.sm}, digital:{ee:a.digital.ee+v.digital.ee, sm:a.digital.sm+v.digital.sm}}), {inStore:{ee:0,sm:0},digital:{ee:0,sm:0}}) : (ch[store] ?? {inStore:{ee:0,sm:0},digital:{ee:0,sm:0}}); return agg.digital.sm > 0 ? agg.digital.ee / agg.digital.sm : 0 })(),
    walmartPct:         sales > 0 ? wmTot / sales : 0,
    walmartPctL4W:      l4wSales > 0 ? (Number(l4wWm.walmart_total) || 0) / l4wSales : 0,
    atv:                orders > 0 ? sales / orders : 0,
    atvL4W:             l4wOrders > 0 ? l4wSales / l4wOrders : 0,
    pfsPct:             sales > 0 ? pfsTot / sales : 0,
    pfsPctL4W:          l4wSales > 0 ? (Number(l4wPfs.pfs_total) || 0) / l4wSales : 0,
    voidPct,
    voidPctL4W,
    discountPct,
    discountPctL4W,
    tillVariance:       Number(til.till_variance) || 0,
    tillVarianceL4W:    (Number(l4wTill.till_variance) || 0) / 4,
    periodComplete:     end < today,
    daysElapsed,
    daysTotal,
  }
}

// ── Store breakdown ───────────────────────────────────────────────
const STORE_KEYS: Store[] = ['pines', 'miramar', 'margate']
const STORE_DB_NAMES: Record<Store, string> = { all:'', pines:'Pines', miramar:'Miramar', margate:'Margate' }

async function fetchStores(start: string, end: string, pyStart: string, pyEnd: string): Promise<StoreRow[]> {
  const codes = STORE_KEYS.map(s => `'${STORE_DB_NAMES[s]}'`).join(',')
  const laborRows = await dbQuery<{store:string;total_pay:number;total_hrs:number}[]>(`
    SELECT store, SUM(total_pay) AS total_pay, SUM(total_hrs) AS total_hrs
    FROM smoothieking.labor WHERE store IN (${codes}) AND ${df(start, end, 'shift_date')} GROUP BY store
  `).catch(() => [])
  const laborMap      = new Map(laborRows.map(r => [r.store, Number(r.total_pay)]))
  const laborHoursMap = new Map(laborRows.map(r => [r.store, Number(r.total_hrs)]))
  const eeData = sigmaEEByDate(start)
  return STORE_KEYS.map(storeKey => {
    const dbName = STORE_DB_NAMES[storeKey]
    const sig    = sigmaSales(storeKey, start, end)
    const sigPY  = sigmaSales(storeKey, pyStart, pyEnd)
    const sales  = sig.net_sales
    const eeSt   = eeData.storeTotals[storeKey] ?? { ee: 0, sm: 0 }
    return {
      store:      dbName,
      sales,
      salesPY:    sigPY.net_sales,
      orders:     sigmaOrders(storeKey, start, end),
      laborPct:   sales > 0 ? (laborMap.get(dbName) ?? 0) / sales : 0,
      laborCost:  laborMap.get(dbName) ?? 0,
      laborHours: laborHoursMap.get(dbName) ?? 0,
      eePct:      eeSt.sm > 0 ? eeSt.ee / eeSt.sm : 0,
    }
  }).filter(r => r.sales > 0 || r.orders > 0)
}

// ── Employees ────────────────────────────────────────────────────
const LOC_CODE_SHORT: Record<string, string> = {
  '1392': 'Pines', '1892': 'Miramar', '2384': 'Margate',
}
const LOC_CODE_TO_STORE_KEY: Record<string, Store> = {
  '1392': 'pines', '1892': 'miramar', '2384': 'margate',
}

function fetchEmployees(store: Store, start: string, end: string): EmployeeRow[] {
  const shifts = sigmaEmployees(store, start, end)

  type EmpAgg = {
    firstName: string; lastName: string; name: string; role: string
    rate: number; hours: number; pay: number
    hoursByLoc: Map<string, number>
  }
  const map = new Map<string, EmpAgg>()
  for (const s of shifts) {
    const key = `${s.last_name.toLowerCase()}|${s.first_name.toLowerCase()}`
    const existing = map.get(key)
    if (existing) {
      existing.hours += s.hours
      existing.pay   += s.pay
      if (s.rate > existing.rate) existing.rate = s.rate
      existing.hoursByLoc.set(s.location_code, (existing.hoursByLoc.get(s.location_code) ?? 0) + s.hours)
    } else {
      const hoursByLoc = new Map<string, number>()
      hoursByLoc.set(s.location_code, s.hours)
      map.set(key, {
        firstName: s.first_name,
        lastName:  s.last_name,
        name:      `${s.first_name} ${s.last_name}`.trim(),
        role:      s.position ?? '',
        rate:      s.rate,
        hours:     s.hours,
        pay:       s.pay,
        hoursByLoc,
      })
    }
  }

  const storeSigma = new Map<string, { net: number; voids: number }>()
  for (const [locCode, storeKey] of Object.entries(LOC_CODE_TO_STORE_KEY)) {
    const s = sigmaSales(storeKey, start, end)
    storeSigma.set(locCode, { net: s.net_sales, voids: s.voids_amount })
  }
  const storeHours = new Map<string, number>()
  for (const e of map.values()) {
    for (const [loc, h] of e.hoursByLoc) {
      storeHours.set(loc, (storeHours.get(loc) ?? 0) + h)
    }
  }

  const { byEmpKey } = sigmaEEByDate(start)

  return Array.from(map.values())
    .filter(e => (e.hours > 0 || e.pay > 0) && !/(franchisee|owner)/i.test(e.role))
    .sort((a, b) => {
      const aStore = LOC_CODE_SHORT[[...a.hoursByLoc.entries()].sort((x,y)=>y[1]-x[1])[0]?.[0] ?? ''] ?? ''
      const bStore = LOC_CODE_SHORT[[...b.hoursByLoc.entries()].sort((x,y)=>y[1]-x[1])[0]?.[0] ?? ''] ?? ''
      return aStore.localeCompare(bStore) || b.hours - a.hours
    })
    .map(e => {
      const primaryLoc   = [...e.hoursByLoc.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? ''
      const primaryStore = LOC_CODE_SHORT[primaryLoc] ?? primaryLoc
      const sigma        = storeSigma.get(primaryLoc) ?? { net: 0, voids: 0 }
      const hrs          = storeHours.get(primaryLoc) ?? 0
      const storeSalesPerHour = hrs > 0 ? Math.round(sigma.net / hrs * 100) / 100 : 0
      const storeVoidPct      = sigma.net > 0 ? Math.round(sigma.voids / sigma.net * 1000) / 10 : 0

      const allKeys = sigmaAllEmpKeys(e.firstName, e.lastName)
      const eeAgg   = allKeys.reduce((acc, k) => {
        const d = byEmpKey.get(k)
        if (d) { acc.ee += d.ee; acc.sm += d.sm; acc.sales += d.sales ?? 0 }
        return acc
      }, { ee: 0, sm: 0, sales: 0 })
      const eePct = eeAgg.sm >= 5 ? Math.round(eeAgg.ee / eeAgg.sm * 1000) / 10 : null

      const empSalesPerHour = eeAgg.sales > 0 && e.hours >= 4
        ? Math.round(eeAgg.sales / e.hours * 100) / 100
        : null

      return {
        name:         e.name,
        store:        primaryStore,
        role:         e.role,
        hours:        Math.round(e.hours * 10) / 10,
        rate:         e.rate,
        totalPay:     Math.round(e.pay * 100) / 100,
        salesPerHour: empSalesPerHour ?? storeSalesPerHour,
        totalSales:   eeAgg.sales > 0 ? Math.round(eeAgg.sales * 100) / 100 : null,
        eePct,
        voidPct:      storeVoidPct,
        discountPct:  0,
        atv:          0,
      }
    })
}

// ── Staffing grid ─────────────────────────────────────────────────
function parseHour24(t: string): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? parseInt(m[1]) : null
}
function fmtShiftEnd(t: string): string {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return t
  let h = parseInt(m[1]); const min = m[2]
  const ap = h >= 12 ? 'pm' : 'am'
  h = h > 12 ? h - 12 : h === 0 ? 12 : h
  return min === '00' ? `${h}${ap}` : `${h}:${min}${ap}`
}
function reverseEmpName(n: string): string {
  const p = n.split(',')
  return p.length === 2 ? `${p[1].trim()} ${p[0].trim()}` : n
}

async function fetchStaffing(start: string, end: string, useRealUnits: boolean): Promise<StaffingData> {
  const rows = await dbQuery<{
    store: string; employee: string; shift_date: string
    shift_start: string; shift_end: string
  }[]>(`
    SELECT store, employee,
           CAST(CAST(shift_date AS DATE) AS VARCHAR(10)) AS shift_date,
           CAST(shift_start AS VARCHAR(8)) AS shift_start,
           CAST(shift_end AS VARCHAR(8)) AS shift_end
    FROM smoothieking.labor
    WHERE store IN ('Pines','Miramar','Margate')
      AND CAST(shift_date AS DATE) BETWEEN '${start}' AND '${end}'
      AND shift_start IS NOT NULL AND shift_end IS NOT NULL
    ORDER BY shift_date, shift_start
  `).catch(() => [])

  const DB_TO_KEY: Record<string, keyof StaffingData> = {
    Pines: 'pines', Miramar: 'miramar', Margate: 'margate',
  }

  type SlotData = { employees: Map<string, string>; totalCount: number }
  const storeSlots    = new Map<keyof StaffingData, Map<string, SlotData>>()
  const storeDowDates = new Map<string, Set<string>>()

  for (const sk of ['pines', 'miramar', 'margate'] as (keyof StaffingData)[]) {
    storeSlots.set(sk, new Map())
  }

  for (const row of rows) {
    const sk = DB_TO_KEY[row.store]
    if (!sk) continue
    const dt  = new Date(row.shift_date + 'T00:00:00')
    const dow = dt.getDay()
    const sH  = parseHour24(row.shift_start)
    let   eH  = parseHour24(row.shift_end)
    if (sH === null || eH === null) continue
    if (eH < sH) eH += 24   // shift closes after midnight — count it through to closing, not off the grid
    if (eH <= sH) continue  // still invalid: same-minute clock-in/out, bad data

    const dowKey = `${sk}|${dow}`
    if (!storeDowDates.has(dowKey)) storeDowDates.set(dowKey, new Set())
    storeDowDates.get(dowKey)!.add(row.shift_date)

    const slots = storeSlots.get(sk)!
    for (let h = sH; h < eH && h <= 21; h++) {
      const key = `${dow}|${h}`
      if (!slots.has(key)) slots.set(key, { employees: new Map(), totalCount: 0 })
      const slot = slots.get(key)!
      slot.employees.set(row.employee, row.shift_end)
      slot.totalCount++
    }
  }

  const unitMaps: Record<keyof StaffingData, Map<string, number>> = {
    pines: new Map(), miramar: new Map(), margate: new Map(),
  }
  for (const sk of ['pines', 'miramar', 'margate'] as (keyof StaffingData)[]) {
    if (useRealUnits) {
      unitMaps[sk] = sigmaHeatmapWeekly(sk as Store)
    } else {
      for (const c of sigmaHeatmap(sk as Store)) {
        unitMaps[sk].set(`${c.day}|${c.hourNum}`, c.rawUnits)
      }
    }
  }

  const result: StaffingData = { pines: [], miramar: [], margate: [] }

  for (const [sk, slots] of storeSlots.entries()) {
    const cells: StaffingCell[] = []
    for (const [key, slot] of slots.entries()) {
      const [dowStr, hourStr] = key.split('|')
      const dow  = parseInt(dowStr)
      const hourNum = parseInt(hourStr)
      const numOccurrences = storeDowDates.get(`${sk}|${dow}`)?.size ?? 1
      const avgCount = Math.round((slot.totalCount / numOccurrences) * 10) / 10
      const avgUnits = unitMaps[sk].get(key) ?? 0
      const employees: StaffingEmployee[] = [...slot.employees.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, shiftEnd]) => ({ name: reverseEmpName(name), shiftEnd: fmtShiftEnd(shiftEnd) }))
      cells.push({ hourNum, day: dow, count: avgCount, avgUnits, employees })
    }
    result[sk] = cells
  }
  return result
}

// ── Promotions ────────────────────────────────────────────────────
async function fetchPromotions(store: Store, start: string, end: string): Promise<Promotion[]> {
  const rows = await dbQuery<{
    offer_name: string; start_date: string; end_date: string
    offer_type: string; offer_value: number | null; offer_value_unit: string | null
    product_focus: string | null; offer_description: string; stores: string
  }[]>(`
    SELECT offer_name, CAST(start_date AS VARCHAR(10)) AS start_date, CAST(end_date AS VARCHAR(10)) AS end_date,
           offer_type, offer_value, offer_value_unit, product_focus, offer_description, stores
    FROM smoothieking.vw_marketing_promotions
    WHERE start_date <= '${end}' AND end_date >= '${start}'
    ORDER BY start_date
  `).catch(() => [])

  const storeName = DB_STORE_NAME[store]
  return rows
    .filter(r => store === 'all' || r.stores.split(',').map(s => s.trim()).includes(storeName))
    .map(r => ({
      offerName:      r.offer_name,
      startDate:      r.start_date,
      endDate:        r.end_date,
      offerType:      r.offer_type,
      offerValue:     r.offer_value,
      offerValueUnit: r.offer_value_unit,
      productFocus:   r.product_focus,
      description:    r.offer_description,
    }))
}

// ── Heatmap ───────────────────────────────────────────────────────
function parseShiftHour(t: string): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i)
  if (!m) return null
  let h = parseInt(m[1])
  const ampm = m[3]?.toUpperCase()
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return h
}

async function fetchHeatmap(store: Store): Promise<unknown[]> {
  const baseCells = sigmaHeatmap(store)
  const today     = new Date()
  const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd   = format(today, 'yyyy-MM-dd')
  const filter    = sf(store)

  const shiftRows = await dbQuery<{ employee: string; shift_date: string; shift_start: string; shift_end: string }[]>(`
    SELECT employee,
           CAST(CAST(shift_date AS DATE) AS VARCHAR(10)) AS shift_date,
           CAST(shift_start AS VARCHAR(8)) AS shift_start,
           CAST(shift_end   AS VARCHAR(8)) AS shift_end
    FROM smoothieking.labor
    WHERE ${filter}
      AND CAST(shift_date AS DATE) BETWEEN '${weekStart}' AND '${weekEnd}'
      AND shift_start IS NOT NULL AND shift_end IS NOT NULL AND shift_start <> '' AND shift_end <> ''
    ORDER BY shift_date, shift_start
  `).catch(() => [])

  type ShiftEmp = { name: string; shiftEnd: string }
  const roster = new Map<string, ShiftEmp[]>()

  for (const row of shiftRows) {
    const dt = new Date(row.shift_date + 'T00:00:00')
    const dow = dt.getDay()
    const startH = parseShiftHour(row.shift_start)
    const endH   = parseShiftHour(row.shift_end)
    if (startH === null || endH === null) continue
    const displayEnd = row.shift_end.replace(/:00$/, '').trim()
    for (let h = startH; h < endH && h <= 21; h++) {
      const key = `${dow}|${h}`
      if (!roster.has(key)) roster.set(key, [])
      roster.get(key)!.push({ name: row.employee, shiftEnd: displayEnd })
    }
  }

  return baseCells.map(cell => {
    const c = cell as { day: number; hourNum: number }
    const employees = roster.get(`${c.day}|${c.hourNum}`) ?? []
    return employees.length > 0 ? { ...cell, employees } : cell
  })
}

// ── Products ──────────────────────────────────────────────────────
const MENU_MIX_PATH = join(process.cwd(), 'data', 'menu-mix.json')
const MM_LOC_STORE: Record<string, Store> = {
  '1392 - Pembroke Pines, FL': 'pines',
  '1892 - Miramar, FL':        'miramar',
  '2384 - Margate, FL':        'margate',
}

interface MixRow  { month: string; location: string; subcategory: string; product: string; qty: number; sales: number }
interface MixFile { thruDate: string; mix: MixRow[] }

function mmMatchesStore(location: string, store: Store): boolean {
  if (store === 'all') return location in MM_LOC_STORE
  return MM_LOC_STORE[location] === store
}
function mmMonthDays(month: string, thruDate: string): number {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  if (thruDate.slice(0, 7) === month) return parseInt(thruDate.slice(8, 10))
  return lastDay
}

async function fetchProducts(store: Store, start: string, end: string): Promise<ProductRow[]> {
  if (!existsSync(MENU_MIX_PATH)) return []
  const mm = JSON.parse(readFileSync(MENU_MIX_PATH, 'utf-8')) as MixFile

  const startMonth = start.slice(0, 7)
  const endMonth   = end.slice(0, 7)
  const priorMonthDate = new Date(startMonth + '-01')
  priorMonthDate.setMonth(priorMonthDate.getMonth() - 1)
  const priorMonth = format(priorMonthDate, 'yyyy-MM')
  const priorDays  = mmMonthDays(priorMonth, mm.thruDate)

  const qtyMap = new Map<string, number>()
  const l4wMap = new Map<string, number>()
  const monthsInPeriod = new Set<string>()

  for (const r of mm.mix) {
    const goodCat = r.subcategory === 'Smoothies' || r.subcategory === 'Smoothie Bowls' || r.subcategory === 'Food'
    if (!r.product || !goodCat || r.qty <= 0) continue
    if (!mmMatchesStore(r.location, store)) continue
    if (r.month >= startMonth && r.month <= endMonth) {
      qtyMap.set(r.product, (qtyMap.get(r.product) ?? 0) + r.qty)
      monthsInPeriod.add(r.month)
    }
    if (r.month === priorMonth) {
      l4wMap.set(r.product, (l4wMap.get(r.product) ?? 0) + r.qty)
    }
  }

  const effectiveDays = Math.max(1, [...monthsInPeriod].reduce((sum, m) => sum + mmMonthDays(m, mm.thruDate), 0))

  return [...qtyMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, qty]) => {
      const qpd    = qty / effectiveDays
      const l4wQty = l4wMap.get(name) ?? 0
      const qL4W   = l4wQty > 0 ? l4wQty / priorDays : qpd
      return {
        name,
        qtyPerDay:    Math.round(qpd  * 10) / 10,
        qtyPerDayL4W: Math.round(qL4W * 10) / 10,
        changePct: qL4W > 0 ? (qpd - qL4W) / qL4W : 0,
      }
    })
}

// ── Categories ────────────────────────────────────────────────────
const SUBCAT_LABEL: Record<string, string> = {
  'Smoothies': 'Smoothies', 'Smoothie Bowls': 'Smoothie Bowls',
  'Modifiers': 'Modifiers', 'Food': 'Food',
  'Retail Products': 'Retail', 'Retail Goods': 'Retail',
}

function fetchCategories(store: Store, start: string, end: string): CategoryRow[] {
  if (!existsSync(MENU_MIX_PATH)) return []
  const mm = JSON.parse(readFileSync(MENU_MIX_PATH, 'utf-8')) as MixFile
  const startMonth = start.slice(0, 7)
  const endMonth   = end.slice(0, 7)

  const salesByLabel = new Map<string, number>()
  for (const r of mm.mix) {
    if (r.month < startMonth || r.month > endMonth) continue
    if (!mmMatchesStore(r.location, store)) continue
    const label = SUBCAT_LABEL[r.subcategory]
    if (!label || r.sales <= 0) continue
    salesByLabel.set(label, (salesByLabel.get(label) ?? 0) + r.sales)
  }

  const total = [...salesByLabel.values()].reduce((s, v) => s + v, 0)
  if (total === 0) return []

  return [...salesByLabel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, sales]) => ({
      name,
      sales: Math.round(sales * 100) / 100,
      pct:   Math.round(sales / total * 1000) / 1000,
    }))
}

// ── Channels ──────────────────────────────────────────────────────
const CHANNEL_BUCKET: Record<string, string> = {
  'To Go': 'In-Store', 'Online Ordering': 'Online', 'Online - Google': 'Online',
  'Rails - Delivery': 'Delivery', 'Uber Eats - Delivery': 'Delivery',
  'Postmates - Delivery': 'Delivery', 'GrubHub - Delivery': 'Delivery', 'Dispatch': 'Delivery',
}

async function fetchChannels(store: Store, start: string, end: string, pyStart: string, pyEnd: string): Promise<ChannelRow[]> {
  const cur = sigmaChannels(store, start, end)
  const py  = sigmaChannels(store, pyStart, pyEnd)
  if (cur.size === 0) return []

  const total   = [...cur.values()].reduce((s, v) => s + v, 0)
  const pyTotal = [...py.values()].reduce((s, v) => s + v, 0)

  const buckets = new Map<string, { sales: number; pySales: number; children: Map<string, { sales: number; pySales: number }> }>()
  for (const [dest, sales] of cur.entries()) {
    const bucket = CHANNEL_BUCKET[dest] ?? 'Other'
    if (!buckets.has(bucket)) buckets.set(bucket, { sales: 0, pySales: 0, children: new Map() })
    const b = buckets.get(bucket)!
    b.sales += sales
    b.children.set(dest, { sales, pySales: py.get(dest) ?? 0 })
  }
  for (const [dest, pySales] of py.entries()) {
    const bucket = CHANNEL_BUCKET[dest] ?? 'Other'
    if (!buckets.has(bucket)) buckets.set(bucket, { sales: 0, pySales: 0, children: new Map() })
    buckets.get(bucket)!.pySales += pySales
  }

  const ORDER = ['In-Store', 'Online', 'Delivery', 'Other']
  return ORDER
    .filter(b => buckets.has(b))
    .map(bucketName => {
      const b       = buckets.get(bucketName)!
      const pySales = pyTotal > 0 ? b.pySales : 0
      const children: ChannelRow[] = [...b.children.entries()]
        .sort((a, b) => b[1].sales - a[1].sales)
        .map(([name, c]) => ({
          name,
          pct:       b.sales > 0 ? c.sales / b.sales : 0,
          pctPY:     b.pySales > 0 ? c.pySales / b.pySales : 0,
          changePct: c.pySales > 0 ? (c.sales - c.pySales) / c.pySales : 0,
        }))
      return {
        name:      bucketName,
        pct:       total > 0 ? b.sales / total : 0,
        pctPY:     pyTotal > 0 ? b.pySales / pyTotal : 0,
        changePct: pySales > 0 ? (b.sales - pySales) / pySales : 0,
        children:  children.length > 1 ? children : [],
      }
    })
}

// ── Quarters ──────────────────────────────────────────────────────
async function fetchQuarters(store: Store): Promise<QuarterRow[]> {
  const year   = new Date().getFullYear()
  const today  = format(new Date(), 'yyyy-MM-dd')
  const filter = sf(store)
  return Promise.all([1,2,3,4].map(async q => {
    const ref     = new Date(year, (q-1)*3, 1)
    const qStart  = format(startOfQuarter(ref), 'yyyy-MM-dd')
    const qEnd    = format(endOfQuarter(ref),   'yyyy-MM-dd')
    const pyStart = format(startOfQuarter(subYears(ref,1)), 'yyyy-MM-dd')
    const pyEnd   = format(endOfQuarter(subYears(ref,1)),   'yyyy-MM-dd')
    const isFuture  = qStart > today
    const isCurrent = qStart <= today && qEnd >= today
    if (isFuture) return { quarter: `Q${q}`, sales:null, salesPY:null, orders:null, laborPct:null, laborCost:null, laborHours:null, eePct:null, cogsPct:null, atv:null, isCurrent:false, isFuture:true }
    const eff    = qEnd > today ? today : qEnd
    const sales   = sigmaSales(store, qStart, eff).net_sales
    const salesPY = sigmaSales(store, pyStart, pyEnd).net_sales
    const orders  = sigmaOrders(store, qStart, eff)
    const cogs    = sigmaCogs(store, qStart, eff)
    const labRows = await dbQuery<{labor_cost:number;labor_hrs:number}[]>(`
      SELECT SUM(total_pay) AS labor_cost, SUM(total_hrs) AS labor_hrs FROM smoothieking.labor
      WHERE ${filter} AND ${df(qStart, eff, 'shift_date')}
    `).catch(() => [])
    const labor     = Number(labRows[0]?.labor_cost) || 0
    const laborHrsQ = Number(labRows[0]?.labor_hrs)  || 0
    const eeData = sigmaEEByDate(qStart)
    const eeSt   = store === 'all'
      ? Object.values(eeData.storeTotals).reduce((a, v) => ({ ee: a.ee + v.ee, sm: a.sm + v.sm }), { ee: 0, sm: 0 })
      : (eeData.storeTotals[store] ?? { ee: 0, sm: 0 })
    const eePct = eeSt.sm > 0 ? eeSt.ee / eeSt.sm : null
    const cogsPct = cogs.actual_cogs > 0 && sales > 0 ? cogs.actual_cogs / sales
      : cogs.theoretical_cogs > 0 && sales > 0 ? cogs.theoretical_cogs / sales
      : null
    return {
      quarter: `Q${q}`, sales, salesPY, orders,
      laborPct:   sales > 0 ? labor / sales : null,
      laborCost:  labor,
      laborHours: laborHrsQ,
      eePct, cogsPct,
      atv:        orders > 0 ? sales / orders : null,
      isCurrent, isFuture: false,
    }
  }))
}

// ── Daily KPIs ────────────────────────────────────────────────────
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

async function fetchDailyKpis(store: Store, start: string, end: string): Promise<DailyRow[]> {
  const filter = sf(store)
  const laborRows = await dbQuery<{shift_date:string;total_pay:number;total_hrs:number}[]>(`
    SELECT CAST(CAST(shift_date AS DATE) AS VARCHAR(10)) AS shift_date,
           SUM(total_pay) AS total_pay, SUM(total_hrs) AS total_hrs
    FROM smoothieking.labor
    WHERE ${filter} AND ${df(start, end, 'shift_date')}
    GROUP BY CAST(shift_date AS DATE)
  `).catch(() => [])

  const laborMap       = new Map(laborRows.map(r => [String(r.shift_date), Number(r.total_pay)]))
  const laborHoursMap2 = new Map(laborRows.map(r => [String(r.shift_date), Number(r.total_hrs)]))

  const sigmaShifts   = sigmaEmployees(store, start, end)
  const sigmaLaborMap = new Map<string, number>()
  for (const s of sigmaShifts) {
    sigmaLaborMap.set(s.date, (sigmaLaborMap.get(s.date) ?? 0) + s.pay)
  }

  const sigSalesMap = sigmaDailySales(store, start, end)
  const startDate   = new Date(start + 'T00:00:00')

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    const dateStr  = format(d, 'yyyy-MM-dd')
    const sales    = sigSalesMap.get(dateStr) ?? 0
    const hasSigma = sigSalesMap.has(dateStr)
    const orders   = sigmaOrders(store, dateStr, dateStr)
    const labor    = laborMap.get(dateStr) ?? sigmaLaborMap.get(dateStr) ?? 0
    const hours    = laborHoursMap2.get(dateStr) ?? 0
    return {
      date:        dateStr,
      day:         DAY_LABELS[d.getDay()],
      sales:       hasSigma ? sales : null,
      orders:      hasSigma ? orders : null,
      eePct:       sigmaEEDailyPct(store, dateStr),
      voidPct:     null,
      atv:         hasSigma && orders > 0 ? sales / orders : null,
      discountPct: null,
      laborPct:    hasSigma && sales > 0 && labor > 0 ? labor / sales : null,
      laborCost:   labor > 0 ? labor : null,
      laborHours:  hours > 0 ? hours : null,
    }
  })
}

// ── Trend ─────────────────────────────────────────────────────────
function trendPoint(label: string, sales: number | null, pyS: number | null, forecast: number | null, isCurrent: boolean, isForecast: boolean): TrendPoint {
  return {
    weekStart:     label,
    sales:         sales !== null ? Math.round(sales) : null,
    salesPY:       pyS   !== null ? Math.round(pyS)   : null,
    salesTarget:   pyS   !== null ? Math.round(pyS * (1 + TARGETS.salesGrowthYoY)) : (forecast ? Math.round(forecast) : 0),
    salesForecast: forecast !== null ? Math.round(forecast) : null,
    isCurrent,
    isForecast,
  }
}

function buildMonthlyTrend(store: Store, today: Date, yesterday: Date): TrendPoint[] {
  const year     = today.getFullYear()
  const dataEnd  = format(yesterday, 'yyyy-MM-dd')
  const actMap   = sigmaMonthSales(store, '2025-01-01', dataEnd)
  const curMonth = format(today, 'yyyy-MM')

  const points: TrendPoint[] = []
  const cursor = new Date(year, 0, 1)

  let l3mAvg = 0
  const recentMonths: number[] = []
  for (let m = today.getMonth() - 3; m < today.getMonth(); m++) {
    const k = format(new Date(year, m, 1), 'yyyy-MM')
    const v = actMap.get(k)
    if (v) recentMonths.push(v)
  }
  if (recentMonths.length) l3mAvg = recentMonths.reduce((s, v) => s + v, 0) / recentMonths.length

  for (let m = 0; m < 12; m++) {
    cursor.setMonth(m)
    const mKey  = format(cursor, 'yyyy-MM')
    const pyKey = `${year - 1}-${String(m + 1).padStart(2, '0')}`
    const label = format(cursor, 'MMM')
    const sales = actMap.get(mKey) ?? null
    const pyS   = actMap.get(pyKey) ?? null
    const isCurrent  = mKey === curMonth
    const isForecast = mKey > curMonth
    const forecastVal = isForecast ? (pyS !== null ? pyS * (1 + TARGETS.salesGrowthYoY) : l3mAvg) : null
    points.push(trendPoint(label, isForecast ? null : sales, pyS, forecastVal, isCurrent, isForecast))
  }
  return points
}

function buildWeeklyTrend(store: Store, today: Date, yesterday: Date): TrendPoint[] {
  const currentWeekMon = startOfWeek(today, { weekStartsOn: 1 })
  const dataStartDate  = subWeeks(currentWeekMon, 4)
  const dataEnd  = format(yesterday, 'yyyy-MM-dd')
  const dataStart = format(dataStartDate, 'yyyy-MM-dd')
  const pyStart  = format(subWeeks(dataStartDate, 52), 'yyyy-MM-dd')
  const pyEnd    = format(subWeeks(addWeeks(currentWeekMon, 5), 52), 'yyyy-MM-dd')

  const actMap = sigmaWeeklySales(store, dataStart, dataEnd)
  const pyMap  = sigmaWeeklySales(store, pyStart, pyEnd)

  const daysElapsed = Math.max(1, ((yesterday.getDay() + 6) % 7) + 1)
  const l4wVals = Array.from(actMap.values()).filter(v => v > 0)
  const l4wAvg  = l4wVals.length ? l4wVals.reduce((s, v) => s + v, 0) / l4wVals.length : 0

  const points: TrendPoint[] = []
  for (let i = -4; i <= 4; i++) {
    const weekMon   = addWeeks(currentWeekMon, i)
    const wKey      = format(weekMon, 'yyyy-MM-dd')
    const pyWKey    = format(subWeeks(weekMon, 52), 'yyyy-MM-dd')
    const label     = format(weekMon, 'MM/dd')
    const isCurrent  = i === 0
    const isForecast = i > 0
    const sales = isForecast ? null : (actMap.get(wKey) ?? null)
    const pyS   = pyMap.get(pyWKey) ?? null
    let forecast: number | null = null
    if (isForecast) {
      forecast = pyS !== null ? pyS * (1 + TARGETS.salesGrowthYoY) : l4wAvg
    } else if (isCurrent && sales !== null && sales > 0) {
      forecast = Math.round(sales / daysElapsed * 7)
    }
    points.push(trendPoint(label, sales, pyS, forecast, isCurrent, isForecast))
  }
  return points
}

async function fetchTrend(store: Store): Promise<{ weekly: TrendPoint[]; monthly: TrendPoint[] }> {
  const today     = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  return {
    monthly: buildMonthlyTrend(store, today, yesterday),
    weekly:  buildWeeklyTrend(store, today, yesterday),
  }
}

// ── Main export ───────────────────────────────────────────────────
type CachePeriod = 'weekly' | 'monthly' | 'quarterly' | 'ytd'
const STORES: Store[] = ['all', 'pines', 'miramar', 'margate']
const PERIODS: CachePeriod[] = ['weekly', 'monthly', 'quarterly', 'ytd']

export async function buildCacheData() {
  const dr = ranges()

  const kpisEntries = await Promise.all(
    STORES.flatMap(store =>
      PERIODS.map(async period => {
        const r = dr[period]
        const data = await fetchKpis(store, r.start, r.end, r.pyStart, r.pyEnd, r.naturalEnd, r.pyNaturalEnd)
        return { store, period, data }
      })
    )
  )
  const kpis: Record<string, Record<string, KpiData>> = {}
  for (const { store, period, data } of kpisEntries) {
    if (!kpis[store]) kpis[store] = {}
    kpis[store][period] = data
  }

  const storesData: Record<string, StoreRow[]> = {}
  for (const period of PERIODS) {
    const r = dr[period]
    storesData[period] = await fetchStores(r.start, r.end, r.pyStart, r.pyEnd)
  }

  const empData: Record<string, Record<string, EmployeeRow[]>> = {}
  for (const store of STORES) {
    empData[store] = {}
    for (const period of PERIODS) {
      const r = dr[period]
      empData[store][period] = fetchEmployees(store, r.start, r.end)
    }
  }

  const heatData: Record<string, unknown[]> = {}
  for (const store of STORES) heatData[store] = await fetchHeatmap(store)

  const staffingData: Record<string, StaffingData> = {}
  for (const period of PERIODS) {
    const r = dr[period]
    staffingData[period] = await fetchStaffing(r.start, r.end, period === 'weekly')
  }

  // Weekly-only for now — promotions running during the last full Mon-Sun week.
  const promoData: Record<string, Promotion[]> = {}
  for (const store of STORES) {
    promoData[store] = await fetchPromotions(store, dr.weekly.start, dr.weekly.end)
  }

  const prodData: Record<string, Record<string, ProductRow[]>> = {}
  for (const store of STORES) {
    prodData[store] = {}
    for (const period of PERIODS) {
      prodData[store][period] = await fetchProducts(store, dr[period].start, dr[period].end)
    }
  }

  const catData: Record<string, Record<string, CategoryRow[]>> = {}
  for (const store of STORES) {
    catData[store] = {}
    for (const period of PERIODS) {
      catData[store][period] = fetchCategories(store, dr[period].start, dr[period].end)
    }
  }

  const chanData: Record<string, Record<string, ChannelRow[]>> = {}
  for (const store of STORES) {
    chanData[store] = {}
    for (const period of PERIODS) {
      const r = dr[period]
      chanData[store][period] = await fetchChannels(store, r.start, r.end, r.pyStart, r.pyEnd)
    }
  }

  const quarterData: Record<string, QuarterRow[]> = {}
  for (const store of STORES) quarterData[store] = await fetchQuarters(store)

  const trendData: Record<string, { weekly: TrendPoint[]; monthly: TrendPoint[] }> = {}
  for (const store of STORES) trendData[store] = await fetchTrend(store)

  const dailyData: Record<string, DailyData> = {}
  const wr   = dr.weekly
  const pyWr = { start: wr.pyStart, end: wr.pyEnd }
  for (const store of STORES) {
    dailyData[store] = {
      thisWeek: await fetchDailyKpis(store, wr.start, wr.end),
      lastYear: await fetchDailyKpis(store, pyWr.start, pyWr.end),
    }
  }

  return {
    refreshedAt: new Date().toISOString(),
    kpis,
    trend:      trendData,
    stores:     storesData,
    employees:  empData,
    heatmap:    heatData,
    staffing:   staffingData,
    promotions: promoData,
    products:   prodData,
    categories: catData,
    channels:   chanData,
    quarters:   quarterData,
    daily:      dailyData,
  }
}
