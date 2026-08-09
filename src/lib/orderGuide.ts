import { query } from './db'
import { tierOf, type Tier } from './netchefTiers'
import { holidayName, priorYearHoliday } from './holiday'
import { buildOnHand, type OnHandBasis, type NightSample } from './core/onHand'
import { buildUsage, USAGE_WINDOW_DAYS } from './core/usage'
import {
  ALERT_LEAD_DAYS, ORDER_SAFETY, MIN_CASE_FRACTION, MAX_IDLE_CASE_VALUE,
  transferEligible, upcomingDeliveries, coverageHorizon, isoAdd, dowOf,
  loadCasePacks, loadWalmartSubs, bucketOf, poolOrders, matchTransfers, daysBetween,
  type Bucket, type CasePack, type WalmartSub, type PooledOrder, type TransferMove, type Route,
} from './core/sourcing'

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
const STORE_NAMES = ['Pines', 'Miramar', 'Margate'] as const

// Delivery cadence, transfer eligibility, lead time, case packs and the order-safety
// factor now live in core/sourcing so the daily alert and this guide cannot disagree.
// LEAD_DAYS = 4 used to live here and drove the urgent flag off a fixed number; urgency
// is now "does a truck actually arrive before this runs out", which is what it meant.

// Walmart receipts are folded into count-based usage inside core/usage.

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
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
  // --- purchasable form. A guide that says "2.1 LB of Gladiator" is not actionable:
  // the smallest thing PFG ships is a 25 LB case at $401.47.
  route: Route
  casePack: string | null      // e.g. '1/25 Lb'
  caseUnits: number | null     // inventory units in one case
  idleValue: number | null     // $ of stock a whole case would leave sitting
  walmartItem: string | null   // right-sized local substitute, when one is genuinely bought
  walmartUnits: number | null
  walmartCost: number | null
  // --- how much to believe the on-hand behind all of this
  onHandBasis: OnHandBasis | 'unknown'
  nights: NightSample[]
  lastCountDate: string | null
  lastCountKind: 'nightly' | 'weekly' | null
  staleNights: number | null
  bucket: Bucket
  varianceQty: number
  unitCost: number | null
  flag: 'urgent' | 'reorder' | 'ok' | 'data'
}

export interface CategoryRollup {
  store: string
  category: string
  items: number
  needing: number
  /** items with no usable on-hand signal — they need counting, not ordering */
  needCount: number
  estCost: number
}

export interface OrderGuidePayload {
  onHandAsOf: string | null
  usageWindowDays: number
  /** pooled, whole-case PFG order for the system */
  pooled: PooledOrder[]
  /** dry-goods moves that avoid a case entirely */
  transfers: TransferMove[]
  /** everything not in 'act'/'soon', summarised so the list stays short */
  collapsed: CategoryRollup[]
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
  const today = etToday()
  // Usage is a RATE over a real window now, not whatever MAX(period_end) happens to be.
  // Once nightly counts started landing, MAX(period_end) resolved to a single night and
  // every "weekly" figure was one day of demand. See core/usage for the full write-up.
  const usageStart = isoAdd(today, -USAGE_WINDOW_DAYS)
  const usageEnd = isoAdd(today, -1)

  const [meta, blended, usageRates] = await Promise.all([
    query<OnHandRow[]>(`
      SELECT store, product_number, product_name, sub_category_name, micro_category_name, inventory_unit,
             on_hand_qty, in_transit_qty, inventory_price, CONVERT(char(10), as_of, 23) as_of
      FROM smoothieking.netchef_onhand
      WHERE as_of = (SELECT MAX(as_of) FROM smoothieking.netchef_onhand)`),
    buildOnHand(usageStart, usageEnd),
    buildUsage(usageStart, usageEnd),
  ])
  if (!meta.length) return null

  // netchef_onhand still supplies category / unit / cost metadata, but NOT the quantity:
  // it carries blank counts through as negatives (-11 Pines, -19 Miramar flatbread on
  // 2026-08-09) which then inflate `orderUpTo - onHand`. Quantity comes from the blend.
  const ohByKey = new Map(blended.map(b => [`${b.store}|${b.productNumber}`, b]))
  const rateByKey = new Map(usageRates.map(u => [`${u.store}|${u.productNumber}`, u]))
  const catOf = new Map(meta.map(m => [`${m.store}|${m.product_number}`, m.micro_category_name]))

  // Brink driver sales: usage-week vs trailing-4wk run rate + day-of-week demand shape.
  const [weekDrv, trailDrv, dowRows] = await Promise.all([
    query<DriverRow[]>(`
      SELECT store, revenue_center rc, SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) BETWEEN '${usageStart}' AND '${usageEnd}'
        AND revenue_center IN ('Smoothies','Smoothie Bowls')
      GROUP BY store, revenue_center`),
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
  // weekNet spans USAGE_WINDOW_DAYS; normalise it to a week so the ratio is dimensionless.
  for (const [k, v] of weekNet) weekNet.set(k, v * 7 / USAGE_WINDOW_DAYS)

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
    // Tightened from [0.5, 2] now that both sides span a week. The old clamp existed to
    // contain a one-day window and silently pinned at 2.00 for every store while the true
    // ratio ran 4.5-7.7 — capping demand at ~2/7ths of real.
    return wk > 0 && tr > 0 ? Math.max(0.7, Math.min(1.5, tr / wk)) : 1
  }

  // Coverage windows + per-day weather/holiday over the union of all store windows.
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

  const packs = await loadCasePacks(isoAdd(today, -100))
  const wmSubs = await loadWalmartSubs(isoAdd(today, -120))

  const rows: OrderGuideRow[] = []
  for (const oh of meta) {
    const key = `${oh.store}|${oh.product_number}`
    const blend = ohByKey.get(key)
    const rate = rateByKey.get(key)
    const tier = tierOf(oh.product_number)

    // Usage is now a per-day RATE from core/usage, which excludes blank nights from the
    // count-based delta. Including them is what read a skipped flatbread line as "72 units
    // consumed today" and produced a 169-unit order against a negative on-hand.
    const dailyUsage = rate?.daily ?? 0
    const weeklyUsage = dailyUsage * 7
    const theoretical = (rate?.theoreticalDaily ?? 0) * 7
    const countUsage = (rate?.countDaily ?? 0) * 7
    let usageBasis: 'count' | 'theoretical' | 'theoretical-guard' =
      rate?.basis === 'count' ? 'count' : 'theoretical'
    // A count several times above what the recipes can account for is still guarded, but
    // only for products whose recipe model we actually trust (tier A).
    if (usageBasis === 'count' && tier === 'A' && theoretical > 0 && countUsage > theoretical * MISCOUNT_MULTIPLE) {
      usageBasis = 'theoretical-guard'
    }
    const effectiveWeekly = usageBasis === 'theoretical-guard' ? theoretical : weeklyUsage
    const usageGapPct = theoretical > 0 ? ((countUsage - theoretical) / theoretical) * 100 : null

    const driver = driverOf(oh.sub_category_name)
    const factor = factorFor(oh.store, driver)
    const fcastWeekly = effectiveWeekly * factor       // demand-adjusted weekly usage
    const avgDaily = fcastWeekly / 7
    // The blend is authoritative ONLY for items on the nightly count template. For the
    // ~290 products that are never nightly-counted, every night is a template zero and
    // the carried book decays to nothing — reading that as "out of stock" put 160 items
    // into the urgent bucket. Those fall back to CrunchTime's own perpetual book.
    const bookQty = Number(oh.on_hand_qty) || 0
    const onHandQty = blend?.nightlyTracked
      ? blend.onHand
      : Math.max(0, bookQty)
    // CrunchTime's perpetual book runs negative on roughly half the catalogue, so a
    // non-counted item sitting at <= 0 does not mean the shelf is empty — it means we
    // have no signal at all. Flooring that to 0 and calling it urgent put 135 items in
    // the act bucket and would train managers to ignore the list. An unknown is a
    // request for a COUNT, not an order.
    const onHandUnknown = !blend?.nightlyTracked && bookQty <= 0
    const inTransit = Math.max(0, Number(oh.in_transit_qty) || 0)

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
      s + fcastWeekly * (w[dowOf(date)] ?? 1 / 7) * (wxByDate.get(date) ?? 1) * (holByDate.get(`${oh.store}|${date}`) ?? 1), 0) * ORDER_SAFETY
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

    // ---- what you can actually buy, and therefore where this should come from.
    const pack = packs.get(oh.product_number) ?? null
    const wm = wmSubs.get(oh.product_number) ?? null
    const cases = pack && suggested > 0 ? Math.ceil(suggested / pack.unitsPerCase) : 0
    const idleValue = pack && cases > 0
      ? round2((cases * pack.unitsPerCase - suggested) * (pack.price / pack.unitsPerCase)) : null
    const truckInTime = !!(dels[0] && runOutDate && dels[0] <= runOutDate)
    const tooSmallForCase = !!(pack && suggested > 0 && suggested < pack.unitsPerCase * MIN_CASE_FRACTION && truckInTime)
    const caseTooBig = !!(idleValue != null && idleValue > MAX_IDLE_CASE_VALUE)
    const movable = transferEligible(oh.micro_category_name, oh.inventory_unit)
    const wmUnits = wm && suggested > 0 ? Math.ceil(suggested * wm.perInventoryUnit) : 0
    const wmCost = wm && wmUnits > 0 ? round2(wmUnits * wm.price) : null

    let route: Route = 'ok'
    if (onHandUnknown) route = 'ok'                         // needs a count before it can be sized
    else if (suggested <= 0) route = 'ok'
    else if (tooSmallForCase) route = 'next-order'          // safety-margin noise; roll it forward
    else if (wm && (!truckInTime || caseTooBig)) route = 'walmart'
    else if (movable && caseTooBig) route = 'transfer'      // a $401 case for 2 LB is not an order
    // No case mapping just means we don't know PFG's pack for this SKU yet — it still
    // goes on the truck, ordered in the stocking unit, exactly as before. 'decide' is
    // reserved for a real dead end: nothing small enough, no local buy, nothing movable.
    else if (!caseTooBig) route = 'pfg'
    else if (movable) route = 'transfer'
    else route = 'decide'

    // Urgency is whether a truck can actually reach it, not a fixed day count.
    const bucket: Bucket = onHandUnknown
      ? 'watch'
      : bucketOf({ onHand: onHandQty, daily: avgDaily, suggested, runOutDate, truck: dels[0] ?? null, today })
    let flag: OrderGuideRow['flag'] = 'ok'
    if (onHandUnknown && avgDaily > 0) flag = 'data'
    else if (blend?.nightlyTracked && blend.basis === 'disputed') flag = 'data'
    else if (bucket === 'act') flag = 'urgent'
    else if (bucket === 'soon') flag = 'reorder'

    rows.push({
      store: oh.store as OGStore, productNumber: oh.product_number, productName: oh.product_name,
      subCategory: oh.sub_category_name, driver, unit: oh.inventory_unit,
      onHand: onHandQty, inTransit, weeklyUsage, usageBasis,
      forecastFactor: factor, forecastWeeklyUsage: fcastWeekly, daysOfSupply: dos,
      runOutDate, orderTruck,
      coverDays: horizon.length, suggestedOrder: suggested, estOrderCost, sourcing,
      route,
      casePack: pack?.pack ?? null,
      caseUnits: pack?.unitsPerCase ?? null,
      idleValue,
      walmartItem: wm?.item ?? null,
      walmartUnits: wmUnits || null,
      walmartCost: wmCost,
      onHandBasis: onHandUnknown ? 'unknown' : (blend?.nightlyTracked ? blend.basis : 'estimated'),
      nights: blend?.nightlyTracked ? blend.nights : [],
      lastCountDate: blend?.lastCountDate ?? null,
      lastCountKind: blend?.lastCountKind ?? null,
      staleNights: blend?.staleNights ?? null,
      bucket,
      countUsage,
      theoreticalUsage: theoretical,
      usageGapPct,
      usageTier: tier,
      varianceQty: blend ? round2(blend.onHand - (blend.nights.at(-1)?.book ?? blend.onHand)) : 0,
      unitCost, flag,
    })
  }

  // Pool per-store need into whole cases for the SYSTEM. Ordering store by store bought
  // two 25 LB Hulk cases for a 3.8 and a 4.05 LB gap; pooled that is one case.
  const pooled = poolOrders(
    rows.filter(r => r.route === 'pfg')
        .map(r => ({ store: r.store, productNumber: r.productNumber, productName: r.productName, need: r.suggestedOrder })),
    packs)

  // Dry-goods moves. A donor may only give what it does not need to reach its own next
  // truck, which is why Margate (Tuesday-only) rarely donates and Miramar usually can.
  const transfers = matchTransfers(
    rows.map(r => ({
      store: r.store, productNumber: r.productNumber, productName: r.productName, unit: r.unit,
      need: r.route === 'transfer' || r.route === 'decide' ? r.suggestedOrder : 0,
      spare: Math.max(0, r.onHand - (r.forecastWeeklyUsage / 7) * r.coverDays),
      basis: r.onHandBasis,
      transferable: transferEligible(catOf.get(`${r.store}|${r.productNumber}`) ?? null, r.unit),
    })),
    packs)

  // Everything quiet is rolled up rather than listed. The guide covers ~130 products per
  // store; only 'act' and 'soon' are worth a manager's morning.
  const roll = new Map<string, CategoryRollup>()
  for (const r of rows) {
    if (r.bucket === 'act' || r.bucket === 'soon') continue
    const cat = r.subCategory || 'Other'
    const k = `${r.store}|${cat}`
    const cur = roll.get(k) ?? { store: r.store, category: cat, items: 0, needing: 0, needCount: 0, estCost: 0 }
    cur.items += 1
    if (r.onHandBasis === 'unknown') cur.needCount += 1
    if (r.suggestedOrder > 0) { cur.needing += 1; cur.estCost += r.estOrderCost ?? 0 }
    roll.set(k, cur)
  }
  const collapsed = [...roll.values()]
    .map(c => ({ ...c, estCost: Math.round(c.estCost * 100) / 100 }))
    .sort((a, b) => a.store.localeCompare(b.store) || b.needing - a.needing || a.category.localeCompare(b.category))

  return {
    onHandAsOf: blended[0]?.nights.at(-1)?.date ?? null,
    usageWeekStart: usageStart, usageWeekEnd: usageEnd,
    usageWindowDays: USAGE_WINDOW_DAYS,
    pooled, transfers, collapsed,
    weatherLift: Math.round(weatherLift * 100) / 100, holidays, coverage, nextTruck, rows,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
