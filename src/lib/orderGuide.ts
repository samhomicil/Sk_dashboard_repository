import { query } from './db'

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

  const factorFor = (store: string, driver: 'bowls' | 'smoothies') => {
    const wk = weekNet.get(`${store}|${driver}`) ?? 0
    const tr = trailWeekly.get(`${store}|${driver}`) ?? 0
    if (wk <= 0 || tr <= 0) return 1
    return Math.max(0.5, Math.min(2, tr / wk))
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
    usageWeekStart: usageStart, usageWeekEnd: usageEnd, rows,
  }
}
