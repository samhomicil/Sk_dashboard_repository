import { query } from './db'
import { holidayName, priorYearHoliday } from './holiday'

// South Florida region (both store ZIPs) — one regional weather pull, same as ops report.
const WX_LAT = 26.05, WX_LON = -80.28

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function isoAdd(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

// Heat lifts smoothie/bowl demand. Forecast highs over the upcoming window → a modest
// window-mean multiplier (0 at ≤85°F, +15% at ≥95°F). Same >85°F cue the ops report uses.
// v1 heuristic — calibratable from sales-vs-temp history later.
async function weatherLift(days: number): Promise<number> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WX_LAT}&longitude=${WX_LON}`
      + `&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=${Math.min(16, Math.max(1, days))}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return 1
    const highs: number[] = (await res.json())?.daily?.temperature_2m_max ?? []
    if (!highs.length) return 1
    const b = highs.slice(0, days).map(t => Math.max(0, Math.min(1, (t - 85) / 10)) * 0.15)
    return 1 + b.reduce((a, x) => a + x, 0) / b.length
  } catch { return 1 }
}

// Per-store demand lift from any holiday in the window: last-year holiday sales vs its
// surrounding same-weekday baseline (same method as the daily recap/ops report), applied
// window-averaged (one holiday day is 1/window of the cover window). No holiday → empty.
async function computeHolidayLift(windowDates: string[], windowLen: number): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const hols = windowDates.filter(d => holidayName(d))
  if (!hols.length) return out
  for (const d of hols) {
    const { date: hly } = priorYearHoliday(d)
    if (!hly) continue
    const baseDates = [-4, -3, -2, -1, 1, 2].map(k => isoAdd(hly, 7 * k))
    const need = [hly, ...baseDates].map(x => `'${x}'`).join(',')
    let rows: { store: string; d: string; net: number }[] = []
    try {
      rows = await query<{ store: string; d: string; net: number }[]>(`
        SELECT store, CONVERT(char(10),closed_datetime,23) d,
               SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
        FROM smoothieking.sales WHERE CONVERT(date,closed_datetime) IN (${need})
        GROUP BY store, CONVERT(char(10),closed_datetime,23)`)
    } catch { continue }
    const got = new Map<string, Map<string, number>>()
    for (const r of rows) {
      if (!got.has(r.store)) got.set(r.store, new Map())
      got.get(r.store)!.set(r.d, Number(r.net) || 0)
    }
    for (const [store, g] of got) {
      const hv = g.get(hly) ?? 0
      const base = baseDates.map(x => g.get(x) ?? 0).filter(v => v > 0)
      if (hv > 0 && base.length >= 3) {
        const f = Math.max(0.4, Math.min(2.2, hv / (base.reduce((a, b) => a + b, 0) / base.length)))
        out.set(store, (out.get(store) ?? 1) * (1 + (f - 1) / windowLen))
      }
    }
  }
  return out
}

// Hybrid order guide (predictive-ordering "crawl").
// Trusted-source hybrid — NetChef for STRUCTURE, Brink for DEMAND (NetChef's own
// sales/theoretical proven unreliable). Per item per store:
//   • usage      = COUNT-BASED actual = beginning + received − ending physical
//                  (all physical/purchase, sales-independent) ← smoothieking.netchef_usage
//   • on-hand + pending + pack unit + cost                    ← smoothieking.netchef_onhand
//   • demand adjustment = trailing-4wk Brink driver sales ÷ usage-week driver sales
//     driver native to subcategory: "Smoothie Bowls" → bowl sales (fresh/acai),
//     else → smoothie sales (frozen/goods).
// Suggested order = order-up-to (forecast daily usage × store cover days) − on-hand − pending.
// Cadence: Pines/Miramar order 2×/wk, Margate 1×/wk (→ shorter cover for Pines/Miramar).
// NOTE: count-based usage counts transfers-out as usage, so a net-supplier store
// (Pines→Margate) reads slightly high; netting transfers is a future refinement.

const LEAD_DAYS = 4        // PFS confirmed lead time
const SAFETY = 1.10        // 10% safety on the order-up-to level
const ORDERS_PER_WEEK: Record<string, number> = { Pines: 2, Miramar: 2, Margate: 1 }
const coverDaysFor = (store: string) =>
  (7 / (ORDERS_PER_WEEK[store] ?? 1) + LEAD_DAYS) * SAFETY

export type OGStore = 'Pines' | 'Miramar' | 'Margate'

export interface OrderGuideRow {
  store: OGStore
  productNumber: string
  productName: string
  subCategory: string | null
  driver: 'bowls' | 'smoothies'
  unit: string | null
  onHand: number
  inTransit: number
  weeklyUsage: number          // count-based actual (begin+received−physical)
  usageBasis: 'count' | 'theoretical'
  forecastFactor: number       // Brink demand adjustment vs usage week
  forecastWeeklyUsage: number
  daysOfSupply: number | null
  coverDays: number
  suggestedOrder: number       // in stocking unit
  varianceQty: number          // physical − book (waste / count signal)
  unitCost: number | null
  flag: 'urgent' | 'reorder' | 'ok' | 'data'
}

export interface OrderGuidePayload {
  onHandAsOf: string | null
  usageWeekStart: string | null
  usageWeekEnd: string | null
  weatherLift: number
  holidays: string[]
  rows: OrderGuideRow[]
}

interface OnHandRow { store: string; product_number: string; product_name: string; sub_category_name: string | null; inventory_unit: string | null; on_hand_qty: number; in_transit_qty: number; inventory_price: number | null; as_of: string }
interface UsageRow { store: string; product_number: string; qty_beginning: number; qty_received: number; qty_physical: number; qty_issue: number; qty_variance: number; period_start: string; period_end: string }
interface DriverRow { store: string; rc: string; net: number }

const driverOf = (sub: string | null): 'bowls' | 'smoothies' =>
  (sub || '').toLowerCase().includes('bowl') ? 'bowls' : 'smoothies'

export async function buildOrderGuide(): Promise<OrderGuidePayload | null> {
  const [onHand, usage] = await Promise.all([
    query<OnHandRow[]>(`
      SELECT store, product_number, product_name, sub_category_name, inventory_unit,
             on_hand_qty, in_transit_qty, inventory_price, CONVERT(char(10), as_of, 23) as_of
      FROM smoothieking.netchef_onhand
      WHERE as_of = (SELECT MAX(as_of) FROM smoothieking.netchef_onhand)`),
    query<UsageRow[]>(`
      SELECT store, product_number, qty_beginning, qty_received, qty_physical,
             qty_issue, qty_variance, period_start, period_end
      FROM smoothieking.netchef_usage
      WHERE period_end = (SELECT MAX(period_end) FROM smoothieking.netchef_usage)`),
  ])
  if (!onHand.length) return null

  const usageEnd = usage[0]?.period_end ? String(usage[0].period_end).slice(0, 10) : null
  const usageStart = usage[0]?.period_start ? String(usage[0].period_start).slice(0, 10) : null

  // Brink driver sales: usage-week vs trailing-4-week run rate (Smoothies vs Bowls).
  const [weekDrv, trailDrv] = await Promise.all([
    usageStart && usageEnd ? query<DriverRow[]>(`
      SELECT store, revenue_center rc,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) BETWEEN '${usageStart}' AND '${usageEnd}'
        AND revenue_center IN ('Smoothies','Smoothie Bowls')
      GROUP BY store, revenue_center`) : Promise.resolve([] as DriverRow[]),
    query<DriverRow[]>(`
      SELECT store, revenue_center rc,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= DATEADD(day,-28,CAST(GETDATE() AS DATE))
        AND CAST(closed_datetime AS DATE) < CAST(GETDATE() AS DATE)
        AND revenue_center IN ('Smoothies','Smoothie Bowls')
      GROUP BY store, revenue_center`),
  ])

  const dkey = (s: string, rc: string) => `${s}|${rc === 'Smoothie Bowls' ? 'bowls' : 'smoothies'}`
  const weekNet = new Map<string, number>()
  for (const r of weekDrv) weekNet.set(dkey(r.store, r.rc), Number(r.net) || 0)
  const trailWeekly = new Map<string, number>()
  for (const r of trailDrv) trailWeekly.set(dkey(r.store, r.rc), (Number(r.net) || 0) / 4)

  // Forward-looking lift for the upcoming order window: heat + holidays (same
  // engine/consistency as the ops report). Weather is regional; holiday is per-store.
  const today = etToday()
  const window = Math.ceil((7 / 1 + LEAD_DAYS) * SAFETY)   // longest cover (Margate 1×/wk)
  const windowDates = Array.from({ length: window }, (_, i) => isoAdd(today, i))
  const [wxLift, holByStore] = await Promise.all([
    weatherLift(window),
    computeHolidayLift(windowDates, window),
  ])
  const holidays = [...new Set(windowDates.map(d => holidayName(d)).filter(Boolean))] as string[]

  const factorFor = (store: string, driver: 'bowls' | 'smoothies') => {
    const wk = weekNet.get(`${store}|${driver}`) ?? 0
    const tr = trailWeekly.get(`${store}|${driver}`) ?? 0
    const base = wk > 0 && tr > 0 ? tr / wk : 1
    const combined = base * wxLift * (holByStore.get(store) ?? 1)
    return Math.max(0.5, Math.min(2.5, combined))
  }

  const usageMap = new Map<string, UsageRow>()
  for (const u of usage) usageMap.set(`${u.store}|${u.product_number}`, u)

  const rows: OrderGuideRow[] = []
  for (const oh of onHand) {
    const u = usageMap.get(`${oh.store}|${oh.product_number}`)
    const countUsage = u ? (Number(u.qty_beginning) || 0) + (Number(u.qty_received) || 0) - (Number(u.qty_physical) || 0) : 0
    // Prefer count-based (sales-independent); fall back to theoretical when count is unusable.
    let weeklyUsage = countUsage
    let usageBasis: 'count' | 'theoretical' = 'count'
    if (weeklyUsage <= 0) { weeklyUsage = Math.max(0, Number(u?.qty_issue) || 0); usageBasis = 'theoretical' }

    const driver = driverOf(oh.sub_category_name)
    const factor = factorFor(oh.store, driver)
    const fcastWeekly = weeklyUsage * factor
    const dailyUsage = fcastWeekly / 7
    const onHandQty = Number(oh.on_hand_qty) || 0
    const inTransit = Number(oh.in_transit_qty) || 0
    const cover = coverDaysFor(oh.store)
    const dos = dailyUsage > 0 ? onHandQty / dailyUsage : null
    const suggested = Math.max(0, dailyUsage * cover - onHandQty - inTransit)

    let flag: OrderGuideRow['flag'] = 'ok'
    if (onHandQty < 0) flag = 'data'
    else if (dailyUsage > 0 && dos !== null && dos < LEAD_DAYS) flag = 'urgent'
    else if (suggested > 0) flag = 'reorder'

    rows.push({
      store: oh.store as OGStore, productNumber: oh.product_number, productName: oh.product_name,
      subCategory: oh.sub_category_name, driver, unit: oh.inventory_unit,
      onHand: onHandQty, inTransit, weeklyUsage, usageBasis,
      forecastFactor: factor, forecastWeeklyUsage: fcastWeekly, daysOfSupply: dos,
      coverDays: Math.round(cover * 10) / 10, suggestedOrder: suggested,
      varianceQty: Number(u?.qty_variance) || 0,
      unitCost: oh.inventory_price != null ? Number(oh.inventory_price) : null, flag,
    })
  }

  return {
    onHandAsOf: onHand[0]?.as_of ?? null,
    usageWeekStart: usageStart, usageWeekEnd: usageEnd,
    weatherLift: Math.round(wxLift * 100) / 100, holidays, rows,
  }
}
