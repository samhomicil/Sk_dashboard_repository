import { query } from './db'
import { tierOf, type Tier } from './netchefTiers'
import { holidayName, priorYearHoliday } from './holiday'

// Hybrid, delivery-cycle-aware order guide (predictive-ordering "crawl").
// Trusted-source hybrid — NetChef for STRUCTURE (physical counts, pack, cost), Brink
// for DEMAND (NetChef's own sales proven unreliable). Per item per store:
//   • usage = COUNT-BASED actual = beginning + received (+ Walmart receipts NetChef is
//             missing) − ending physical  ← smoothieking.netchef_usage_api + walmart_spend
//   NOTE: usage now comes from the API-derived table, not the Playwright scrape.
//   The columns this uses (beginning/received/physical) reproduce the scrape
//   exactly (353/353, 353/353, 336/353). qty_issue is only a fallback here and
//   IS our computed estimate — see netchef-extractor/theoretical.py TIERS.
//   • on-hand + pending + pack unit + cost ← smoothieking.netchef_onhand
//   • demand run-rate = trailing-4wk Brink driver sales ÷ usage-week driver sales
// Each order is sized to the SPECIFIC days it covers, delivery-to-delivery (order-up-to
// over [today, following delivery)), spreading weekly usage across the day-of-week demand
// curve with PER-DAY weather + holiday lifts. So the Friday-delivery order (covers the
// Friday peak + weekend) comes out bigger than the Tuesday order, and slow Sun isn't
// over-bought. Delivery cadence per store below (Pines/Miramar Tue+Fri, Margate Tue).

const WX_LAT = 26.05, WX_LON = -80.28
const LEAD_DAYS = 4        // PFS confirmed lead time (used for the urgent flag)
const SAFETY = 1.10        // 10% safety on the order-up-to level
const STORE_NAMES = ['Pines', 'Miramar', 'Margate'] as const

// PFG delivery weekdays per store (JS getUTCDay: Sun=0..Sat=6). Tue=2, Fri=5.
const DELIVERY_DAYS: Record<string, number[]> = { Pines: [2, 5], Miramar: [2, 5], Margate: [2] }

// Margate orders PFG once/wk, so a direct buy must hold ~12 days. But Pines/Miramar order
// 2×/wk, so for SHELF-STABLE goods Margate can order lean and top up via inter-store
// TRANSFER on their cadence (no cold chain, no spoilage). Transfer-eligible = dry micros +
// bottled juices (NOT frozen fruit / fresh / food / ice cream, which need cold chain).
const DRY_MICROS = new Set(['Powders', 'Cups/Lids/Straws', 'Enhancers', 'Sweeteners'])
function transferEligible(micro: string | null, unit: string | null): boolean {
  if (!micro) return false
  if (DRY_MICROS.has(micro)) return true
  if (micro === 'Fruits/Juices' && /bottle|floz/i.test(unit || '')) return true   // bottled juices
  return false
}

// Walmart local buys aren't entered in NetChef (proven gap), so we fold the real Walmart
// receipts (walmart_spend) into "received". Map Walmart category → NetChef product + lb per
// received unit (size is in the item name). Needs walmart_spend kept fresh to take effect.
const WALMART_TO_NETCHEF: Record<string, { pn: string; lbPerUnit: number }> = {
  'CORE STRAWBERRIES': { pn: 'P1480', lbPerUnit: 1.0 },    // Fresh Strawberries, 1 lb
  'BLUEBERRIES':       { pn: 'P1011', lbPerUnit: 1.125 },  // Fresh Blueberries, 18 oz
}

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function isoAdd(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function dowOf(iso: string): number { return new Date(iso + 'T12:00:00Z').getUTCDay() }

// Upcoming delivery dates for a store (next n, from tomorrow on).
function upcomingDeliveries(store: string, today: string, n = 4): string[] {
  const days = DELIVERY_DAYS[store] ?? [dowOf(today)]
  const out: string[] = []
  for (let i = 1; i <= 28 && out.length < n; i++) {
    const d = isoAdd(today, i)
    if (days.includes(dowOf(d))) out.push(d)
  }
  return out
}

// Protection interval for the next order: [today, following delivery). The order placed
// now arrives at the next delivery and must last until the one after — so it covers every
// day from today up to (not including) the second upcoming delivery.
function coverageHorizon(store: string, today: string): string[] {
  const deliveries = upcomingDeliveries(store, today, 2)
  const following = deliveries[1] ?? isoAdd(today, 8)
  const horizon: string[] = []
  for (let d = today; d < following; d = isoAdd(d, 1)) horizon.push(d)
  return horizon
}

// Per-day heat multiplier over the forecast window: 0 at ≤85°F → +15% at ≥95°F.
async function weatherByDate(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WX_LAT}&longitude=${WX_LON}`
      + `&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=16`
    const res = await fetch(url, { cache: 'no-store' })
    if (res.ok) {
      const j = await res.json()
      const t: string[] = j?.daily?.time ?? []
      const highs: number[] = j?.daily?.temperature_2m_max ?? []
      t.forEach((d, i) => out.set(d, 1 + Math.max(0, Math.min(1, ((highs[i] ?? 85) - 85) / 10)) * 0.15))
    }
  } catch { /* weather optional */ }
  return out
}

// Per-store, per-date holiday multiplier for any holiday in the window: last-year holiday
// sales vs its surrounding same-weekday baseline (same method as the daily recap/ops report).
async function holidayByDate(windowDates: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()   // `${store}|${date}` -> factor
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
        out.set(`${store}|${d}`, Math.max(0.4, Math.min(2.2, hv / (base.reduce((a, b) => a + b, 0) / base.length))))
      }
    }
  }
  return out
}

export type OGStore = 'Pines' | 'Miramar' | 'Margate'

// How far above recipe-driven usage a physical count may run before we stop
// believing it. 3x is deliberately loose: real usage legitimately exceeds the
// recipe figure (waste, over-pour, unrecorded transfers), so this only catches
// counts that cannot be explained by any of that.
const MISCOUNT_MULTIPLE = 3

export interface OrderGuideRow {
  store: OGStore
  productNumber: string
  productName: string
  subCategory: string | null
  driver: 'bowls' | 'smoothies'
  unit: string | null
  onHand: number
  inTransit: number
  weeklyUsage: number          // the figure actually used to forecast
  usageBasis: 'count' | 'theoretical' | 'theoretical-guard'
  countUsage: number           // begin + received + walmart − physical, before any guard
  theoreticalUsage: number     // recipe BOM × menu mix, from netchef_usage_api.qty_issue
  usageGapPct: number | null   // count vs theoretical, null when theoretical is 0
  usageTier: Tier              // confidence in theoreticalUsage (netchefTiers)
  forecastFactor: number       // Brink demand run-rate vs usage week
  forecastWeeklyUsage: number
  daysOfSupply: number | null
  runOutDate: string | null    // demand-curve-aware date on-hand + in-transit hits zero
  orderTruck: string | null    // delivery date this item must ride to arrive before run-out
  coverDays: number            // length of this order's coverage window (delivery-to-delivery)
  suggestedOrder: number       // in stocking unit
  estOrderCost: number | null  // suggestedOrder × last-known unit cost (NetChef inventory_price)
  sourcing: 'order' | 'transfer'   // Margate shelf-stable → top up via transfer, not a direct PFG buy
  varianceQty: number
  unitCost: number | null
  flag: 'urgent' | 'reorder' | 'ok' | 'data'
}

export interface OrderGuidePayload {
  onHandAsOf: string | null
  usageWeekStart: string | null
  usageWeekEnd: string | null
  weatherLift: number
  holidays: string[]
  coverage: Record<string, { days: number; through: string }>   // per store: order window
  // Per store: the next PFG truck (delivery date), when to place it (day before), and the
  // one after — so the guide is actionable ("put these on the Tue Aug 4 truck").
  nextTruck: Record<string, { delivery: string; orderBy: string; following: string | null }>
  rows: OrderGuideRow[]
}

interface OnHandRow { store: string; product_number: string; product_name: string; sub_category_name: string | null; micro_category_name: string | null; inventory_unit: string | null; on_hand_qty: number; in_transit_qty: number; inventory_price: number | null; as_of: string }
interface UsageRow { store: string; product_number: string; qty_beginning: number; qty_received: number; qty_physical: number; qty_issue: number; qty_variance: number; period_start: string; period_end: string }
interface DriverRow { store: string; rc: string; net: number }
interface DowRow { store: string; wd: number; net: number }

const driverOf = (sub: string | null): 'bowls' | 'smoothies' =>
  (sub || '').toLowerCase().includes('bowl') ? 'bowls' : 'smoothies'

export async function buildOrderGuide(): Promise<OrderGuidePayload | null> {
  const [onHand, usage] = await Promise.all([
    query<OnHandRow[]>(`
      SELECT store, product_number, product_name, sub_category_name, micro_category_name, inventory_unit,
             on_hand_qty, in_transit_qty, inventory_price, CONVERT(char(10), as_of, 23) as_of
      FROM smoothieking.netchef_onhand
      WHERE as_of = (SELECT MAX(as_of) FROM smoothieking.netchef_onhand)`),
    query<UsageRow[]>(`
      SELECT store, product_number, qty_beginning, qty_received, qty_physical, qty_issue, qty_variance,
             CONVERT(char(10), period_start, 23) period_start, CONVERT(char(10), period_end, 23) period_end
      FROM smoothieking.netchef_usage_api
      WHERE period_end = (SELECT MAX(period_end) FROM smoothieking.netchef_usage_api)`),
  ])
  if (!onHand.length) return null

  const usageEnd = usage[0]?.period_end ? String(usage[0].period_end).slice(0, 10) : null
  const usageStart = usage[0]?.period_start ? String(usage[0].period_start).slice(0, 10) : null

  // Brink driver sales: usage-week vs trailing-4wk run rate + day-of-week demand shape.
  const [weekDrv, trailDrv, dowRows] = await Promise.all([
    usageStart && usageEnd ? query<DriverRow[]>(`
      SELECT store, revenue_center rc, SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) BETWEEN '${usageStart}' AND '${usageEnd}'
        AND revenue_center IN ('Smoothies','Smoothie Bowls')
      GROUP BY store, revenue_center`) : Promise.resolve([] as DriverRow[]),
    query<DriverRow[]>(`
      SELECT store, revenue_center rc, SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= DATEADD(day,-28,CAST(GETDATE() AS DATE))
        AND CAST(closed_datetime AS DATE) < CAST(GETDATE() AS DATE)
        AND revenue_center IN ('Smoothies','Smoothie Bowls')
      GROUP BY store, revenue_center`),
    query<DowRow[]>(`
      SELECT store, DATEPART(weekday, closed_datetime) wd,
             SUM(CASE WHEN voided=0 AND is_modifier=0 AND revenue_center IN ('Smoothies','Smoothie Bowls') THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales
      WHERE closed_datetime >= DATEADD(week,-8,CAST(GETDATE() AS DATE)) AND closed_datetime < CAST(GETDATE() AS DATE)
      GROUP BY store, DATEPART(weekday, closed_datetime)`),
  ])

  const dkey = (s: string, rc: string) => `${s}|${rc === 'Smoothie Bowls' ? 'bowls' : 'smoothies'}`
  const weekNet = new Map<string, number>()
  for (const r of weekDrv) weekNet.set(dkey(r.store, r.rc), Number(r.net) || 0)
  const trailWeekly = new Map<string, number>()
  for (const r of trailDrv) trailWeekly.set(dkey(r.store, r.rc), (Number(r.net) || 0) / 4)

  // Day-of-week weights per store (fraction of weekly demand by JS dow), from the day-of-week
  // sales shape. SQL DATEPART weekday: 1=Sun..7=Sat → JS dow = wd-1.
  const dowRaw = new Map<string, number[]>()
  for (const r of dowRows) {
    if (!dowRaw.has(r.store)) dowRaw.set(r.store, Array(7).fill(0))
    dowRaw.get(r.store)![(Number(r.wd) - 1 + 7) % 7] += Number(r.net) || 0
  }
  const dowWeight = new Map<string, number[]>()
  for (const s of STORE_NAMES) {
    const arr = dowRaw.get(s) ?? Array(7).fill(1)
    const sum = arr.reduce((a, b) => a + b, 0)
    dowWeight.set(s, sum > 0 ? arr.map(v => v / sum) : Array(7).fill(1 / 7))
  }

  const factorFor = (store: string, driver: 'bowls' | 'smoothies') => {
    const wk = weekNet.get(`${store}|${driver}`) ?? 0
    const tr = trailWeekly.get(`${store}|${driver}`) ?? 0
    return wk > 0 && tr > 0 ? Math.max(0.5, Math.min(2, tr / wk)) : 1
  }

  // Coverage windows + per-day weather/holiday over the union of all store windows.
  const today = etToday()
  const horizons = new Map<string, string[]>()
  for (const s of STORE_NAMES) horizons.set(s, coverageHorizon(s, today))
  const allDates = [...new Set([...horizons.values()].flat())].sort()
  const [wxByDate, holByDate] = await Promise.all([weatherByDate(), holidayByDate(allDates)])
  const weatherLift = allDates.slice(0, 7).reduce((a, d) => a + (wxByDate.get(d) ?? 1), 0) / Math.max(1, Math.min(7, allDates.length))
  const holidays = [...new Set(allDates.map(d => holidayName(d)).filter(Boolean))] as string[]
  const coverage: Record<string, { days: number; through: string }> = {}
  const deliveriesByStore: Record<string, string[]> = {}
  const nextTruck: OrderGuidePayload['nextTruck'] = {}
  for (const s of STORE_NAMES) {
    const h = horizons.get(s)!; coverage[s] = { days: h.length, through: h[h.length - 1] }
    const dels = upcomingDeliveries(s, today, 4)
    deliveriesByStore[s] = dels
    // PFG orders are placed the day before delivery; surface the cutoff so it's actionable.
    nextTruck[s] = { delivery: dels[0], orderBy: isoAdd(dels[0], -1), following: dels[1] ?? null }
  }

  const usageMap = new Map<string, UsageRow>()
  for (const u of usage) usageMap.set(`${u.store}|${u.product_number}`, u)

  // Fold Walmart receipts (missing from NetChef) into "received" so usage is correct.
  const walmartRecv = new Map<string, number>()
  if (usageStart && usageEnd) {
    const cats = Object.keys(WALMART_TO_NETCHEF).map(c => `'${c}'`).join(',')
    const wm = await query<{ email: string; cat: string; qty: number }[]>(`
      SELECT account_user_email email, walmart_category cat, SUM(item_received_qty) qty
      FROM smoothieking.walmart_spend
      WHERE order_date BETWEEN '${usageStart}' AND '${usageEnd}'
        AND walmart_category IN (${cats}) AND item_received_qty > 0
      GROUP BY account_user_email, walmart_category`).catch(() => [] as { email: string; cat: string; qty: number }[])
    for (const r of wm) {
      const store = STORE_NAMES.find(s => (r.email || '').toLowerCase().includes(s.toLowerCase()))
      const m = WALMART_TO_NETCHEF[r.cat]
      if (store && m) {
        const k = `${store}|${m.pn}`
        walmartRecv.set(k, (walmartRecv.get(k) ?? 0) + (Number(r.qty) || 0) * m.lbPerUnit)
      }
    }
  }

  const rows: OrderGuideRow[] = []
  for (const oh of onHand) {
    const u = usageMap.get(`${oh.store}|${oh.product_number}`)
    const wmR = walmartRecv.get(`${oh.store}|${oh.product_number}`) ?? 0
    const countUsage = u ? (Number(u.qty_beginning) || 0) + (Number(u.qty_received) || 0) + wmR - (Number(u.qty_physical) || 0) : 0
    const theoretical = Math.max(0, Number(u?.qty_issue) || 0)
    const tier = tierOf(oh.product_number)

    // Count-based usage stays PRIMARY: it is what physically left the shelf, so
    // it already contains waste, over-pouring and spillage that a recipe never
    // will. Recipe-driven usage is the cross-check, not the replacement.
    let weeklyUsage = countUsage
    let usageBasis: 'count' | 'theoretical' | 'theoretical-guard' = 'count'
    if (weeklyUsage <= 0) {
      // Nothing usable from the count (often a missed or partial count).
      weeklyUsage = theoretical
      usageBasis = 'theoretical'
    } else if (
      tier === 'A' && theoretical > 0 &&
      countUsage > theoretical * MISCOUNT_MULTIPLE
    ) {
      // A single fat-fingered count can multiply an order. When the count
      // claims several times what the recipes can account for — and the recipe
      // figure is one we trust for this product — treat the count as suspect
      // and order to the recipe instead. Deliberately one-directional: a count
      // BELOW theoretical is normal (product still on the shelf), only an
      // implausibly high one is guarded.
      weeklyUsage = theoretical
      usageBasis = 'theoretical-guard'
    }
    const usageGapPct = theoretical > 0 ? ((countUsage - theoretical) / theoretical) * 100 : null

    const driver = driverOf(oh.sub_category_name)
    const factor = factorFor(oh.store, driver)
    const fcastWeekly = weeklyUsage * factor           // demand-adjusted weekly usage
    const avgDaily = fcastWeekly / 7
    const onHandQty = Number(oh.on_hand_qty) || 0
    const inTransit = Number(oh.in_transit_qty) || 0

    // Margate leans on Pines/Miramar's 2×/wk cadence for shelf-stable goods (transfer top-up),
    // so those cover the shorter network window instead of Margate's 12-day PFG cycle.
    const sourcing: OrderGuideRow['sourcing'] =
      (oh.store === 'Margate' && transferEligible(oh.micro_category_name, oh.inventory_unit)) ? 'transfer' : 'order'
    // Order-up-to over the coverage window, day-specific (DOW × weather × holiday).
    const horizon = sourcing === 'transfer'
      ? (horizons.get('Pines') ?? coverageHorizon('Pines', today))
      : (horizons.get(oh.store) ?? coverageHorizon(oh.store, today))
    const w = dowWeight.get(oh.store) ?? Array(7).fill(1 / 7)
    const orderUpTo = horizon.reduce((s, date) =>
      s + fcastWeekly * (w[dowOf(date)] ?? 1 / 7) * (wxByDate.get(date) ?? 1) * (holByDate.get(`${oh.store}|${date}`) ?? 1), 0) * SAFETY
    const suggested = Math.max(0, orderUpTo - onHandQty - inTransit)
    const dos = avgDaily > 0 ? onHandQty / avgDaily : null

    // Demand-curve-aware run-out: walk days forward subtracting each day's forecast usage
    // (DOW × weather × holiday) from stock, so the run-out lands on real busy/slow days
    // rather than a flat average. Then pick the truck that arrives before that date.
    const stock = onHandQty + inTransit
    let runOutDate: string | null = null
    if (fcastWeekly > 0) {
      if (stock <= 0) runOutDate = today
      else {
        let cum = 0
        for (let i = 0; i <= 60; i++) {
          const date = isoAdd(today, i)
          cum += fcastWeekly * (w[dowOf(date)] ?? 1 / 7) * (wxByDate.get(date) ?? 1) * (holByDate.get(`${oh.store}|${date}`) ?? 1)
          if (cum >= stock) { runOutDate = date; break }
        }
      }
    }
    // Truck to ride: latest delivery arriving on/before run-out; if none arrives in time
    // (runs out before the next delivery), it must go on the very next truck now.
    const dels = deliveriesByStore[oh.store] ?? upcomingDeliveries(oh.store, today)
    let orderTruck: string | null = null
    if (sourcing === 'order' && suggested > 0) {
      const inTime = runOutDate ? dels.filter(d => d <= runOutDate) : []
      orderTruck = inTime.length ? inTime[inTime.length - 1] : dels[0]
    }
    const unitCost = oh.inventory_price != null ? Number(oh.inventory_price) : null
    const estOrderCost = unitCost != null && suggested > 0 ? Math.round(suggested * unitCost * 100) / 100 : null

    let flag: OrderGuideRow['flag'] = 'ok'
    if (onHandQty < 0) flag = 'data'
    else if (avgDaily > 0 && dos !== null && dos < LEAD_DAYS) flag = 'urgent'
    else if (suggested > 0) flag = 'reorder'

    rows.push({
      store: oh.store as OGStore, productNumber: oh.product_number, productName: oh.product_name,
      subCategory: oh.sub_category_name, driver, unit: oh.inventory_unit,
      onHand: onHandQty, inTransit, weeklyUsage, usageBasis,
      forecastFactor: factor, forecastWeeklyUsage: fcastWeekly, daysOfSupply: dos,
      runOutDate, orderTruck,
      coverDays: horizon.length, suggestedOrder: suggested, estOrderCost, sourcing,
      countUsage,
      theoreticalUsage: theoretical,
      usageGapPct,
      usageTier: tier,
      varianceQty: Number(u?.qty_variance) || 0,
      unitCost, flag,
    })
  }

  return {
    onHandAsOf: onHand[0]?.as_of ?? null,
    usageWeekStart: usageStart, usageWeekEnd: usageEnd,
    weatherLift: Math.round(weatherLift * 100) / 100, holidays, coverage, nextTruck, rows,
  }
}
