/**
 * Live sales access from smoothieking.sales — the SQL replacement for the Sigma
 * sales/orders/channels helpers (Phase 1 of removing Sigma). Field definitions
 * were reconciled to the dollar against Sigma's Sales Mix v2 for settled periods:
 *   net_sales    = SUM(net_sales)   WHERE voided=0 AND is_modifier=0
 *   gross_sales  = SUM(gross_sales) WHERE voided=0 AND is_modifier=0
 *   voids_amount = SUM(price)       WHERE voided=1 AND is_modifier=0
 *   orders       = COUNT(DISTINCT order_id) WHERE voided=0
 *   void_orders  = COUNT(DISTINCT order_id) WHERE voided=1
 *   channels     = destination -> SUM(net_sales) WHERE voided=0 AND is_modifier=0
 *
 * Same shape + sync API as sigma.ts, so cache-builder / kpis swap imports with no
 * logic change. The daily aggregates are loaded ONCE per process (tiny: 3 stores ×
 * days); call `await loadSalesCache()` before using the sync accessors.
 */
import 'server-only'
import { query } from './db'
import type { Store } from './types'
import type { SigmaSalesSummary, SigmaDailyRow } from './sigma'

type DayRow = {
  store: string; date: string
  net_sales: number; gross_sales: number; voids_amount: number
  orders: number; void_orders: number
}
type ChanRow = { store: string; date: string; destination: string; sales: number }

let _days: DayRow[] | null = null
let _chans: ChanRow[] | null = null
let _loading: Promise<void> | null = null

const n = (v: unknown) => Number(v) || 0

/** Load daily sales + channel aggregates from smoothieking.sales (once per process). */
export async function loadSalesCache(): Promise<void> {
  if (_days && _chans) return
  if (_loading) return _loading
  _loading = (async () => {
    const [days, chans] = await Promise.all([
      query<DayRow[]>(`
        SELECT LOWER(store) AS store, CONVERT(char(10), closed_datetime, 23) AS date,
               SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales   ELSE 0 END) AS net_sales,
               SUM(CASE WHEN voided=0 AND is_modifier=0 THEN gross_sales ELSE 0 END) AS gross_sales,
               SUM(CASE WHEN voided=1 AND is_modifier=0 THEN price        ELSE 0 END) AS voids_amount,
               COUNT(DISTINCT CASE WHEN voided=0 THEN order_id END) AS orders,
               COUNT(DISTINCT CASE WHEN voided=1 THEN order_id END) AS void_orders
          FROM smoothieking.sales
         GROUP BY LOWER(store), CONVERT(char(10), closed_datetime, 23)`),
      query<ChanRow[]>(`
        SELECT LOWER(store) AS store, CONVERT(char(10), closed_datetime, 23) AS date,
               destination, SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) AS sales
          FROM smoothieking.sales
         WHERE destination IS NOT NULL
         GROUP BY LOWER(store), CONVERT(char(10), closed_datetime, 23), destination`),
    ])
    _days = days.map(r => ({
      store: r.store, date: r.date,
      net_sales: n(r.net_sales), gross_sales: n(r.gross_sales), voids_amount: n(r.voids_amount),
      orders: n(r.orders), void_orders: n(r.void_orders),
    }))
    _chans = chans.map(r => ({ store: r.store, date: r.date, destination: r.destination, sales: n(r.sales) }))
  })()
  await _loading
  _loading = null
}

const days = () => _days ?? []
const chans = () => _chans ?? []
const matches = (rowStore: string, store: Store) => (store === 'all' ? true : rowStore === store)
const inRange = (d: string, start: string, end: string) => d >= start && d <= end

export function sqlThruDate(): string | null {
  let max = ''
  for (const r of days()) if (r.date > max) max = r.date
  return max || null
}

export function sqlSales(store: Store, start: string, end: string): SigmaSalesSummary {
  let net = 0, gross = 0, voids = 0, voidOrders = 0
  for (const r of days()) {
    if (!inRange(r.date, start, end) || !matches(r.store, store)) continue
    net += r.net_sales; gross += r.gross_sales; voids += r.voids_amount; voidOrders += r.void_orders
  }
  return {
    net_sales: Math.round(net * 100) / 100,
    gross_sales: Math.round(gross * 100) / 100,
    voids_amount: Math.round(voids * 100) / 100,
    void_orders: voidOrders,
  }
}

export function sqlOrders(store: Store, start: string, end: string): number {
  let total = 0
  for (const r of days()) if (inRange(r.date, start, end) && matches(r.store, store)) total += r.orders
  return total
}

export function sqlWeeklySales(store: Store, start: string, end: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of days()) {
    if (!inRange(r.date, start, end) || !matches(r.store, store)) continue
    const dt = new Date(r.date + 'T00:00:00')
    const dow = dt.getDay()
    dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow)) // Monday of the week
    const wk = dt.toISOString().slice(0, 10)
    out.set(wk, (out.get(wk) ?? 0) + r.net_sales)
  }
  return out
}

export function sqlMonthSales(store: Store, start: string, end: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of days()) {
    if (!inRange(r.date, start, end) || !matches(r.store, store)) continue
    const m = r.date.slice(0, 7)
    out.set(m, (out.get(m) ?? 0) + r.net_sales)
  }
  return out
}

export function sqlDailyFull(store: Store, start: string, end: string): Map<string, SigmaDailyRow> {
  const out = new Map<string, SigmaDailyRow>()
  for (const r of days()) {
    if (!inRange(r.date, start, end) || !matches(r.store, store)) continue
    const prev = out.get(r.date)
    if (prev) {
      prev.net_sales += r.net_sales; prev.gross_sales += r.gross_sales
      prev.voids_amount += r.voids_amount; prev.orders += r.orders
    } else {
      out.set(r.date, { net_sales: r.net_sales, gross_sales: r.gross_sales, voids_amount: r.voids_amount, orders: r.orders })
    }
  }
  return out
}

export function sqlDailySales(store: Store, start: string, end: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of days()) {
    if (inRange(r.date, start, end) && matches(r.store, store)) out.set(r.date, (out.get(r.date) ?? 0) + r.net_sales)
  }
  return out
}

export function sqlChannels(store: Store, start: string, end: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of chans()) {
    if (inRange(r.date, start, end) && matches(r.store, store)) out.set(r.destination, (out.get(r.destination) ?? 0) + r.sales)
  }
  return out
}
