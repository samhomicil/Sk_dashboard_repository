// Sourcing — where a shortage gets filled from, and in what units you can actually buy.
//
// WHY THIS EXISTS. Three separate surfaces had grown their own copy of the delivery
// calendar and their own idea of what "transferable" means, and none of them knew what
// a case actually contains. A guide that says "order 2.1 LB of Gladiator" is not
// actionable: PFG's smallest Gladiator Vanilla unit is a 25 LB case at $401.47.
//
// Everything here is derived from what actually happened, never assumed:
//   * delivery weekdays  <- observed pfs_invoices weekdays (Pines/Miramar Tue+Fri,
//                           Margate Tue only, confirmed since 2026-06-01)
//   * case pack + price  <- pfs_invoices.pack_size / unit_price, loaded live
//   * Walmart substitute <- only items genuinely bought on the Walmart Business
//                           account (walmart_spend), never a guess about availability
//
// LEAD TIME. Two different numbers were in play and they are not the same thing:
//   ALERT_LEAD_DAYS  how much notice a manager needs to act at all. Nothing should be
//                    surfaced for the first time inside this window — that is the
//                    same-day scramble the guide exists to prevent.
//   PFG_ORDER_CUTOFF how long before a truck an order must be placed.
// The old orderGuide LEAD_DAYS = 4 conflated them and drove the urgent flag off a
// fixed number rather than off whether a truck can actually arrive in time.

import { query } from '../db'
import { DELIVERY_DOWS } from './targets'

export const ALERT_LEAD_DAYS = 2
export const PFG_ORDER_CUTOFF_DAYS = 1
/** Safety on the order-up-to level. */
export const ORDER_SAFETY = 1.10
/** Don't trigger a case for a gap smaller than this share of one. */
export const MIN_CASE_FRACTION = 0.25
/** Above this much idle stock, a case is a decision rather than an order. */
export const MAX_IDLE_CASE_VALUE = 150

export type Route = 'pfg' | 'walmart' | 'transfer' | 'next-order' | 'decide' | 'ok'

// ---------------------------------------------------------------- transferable

// Cold chain is the constraint, not price. Dry micro-categories move freely; fruit,
// frozen, dairy and prepared food ride the truck or come from Walmart. Bottled juice
// is shelf-stable despite sitting in Fruits/Juices.
const DRY_MICROS = new Set(['Powders', 'Cups/Lids/Straws', 'Enhancers', 'Sweeteners'])

export function transferEligible(micro: string | null, unit: string | null): boolean {
  if (!micro) return false
  if (DRY_MICROS.has(micro)) return true
  if (micro === 'Fruits/Juices' && /bottle|floz/i.test(unit || '')) return true
  return false
}

// ---------------------------------------------------------------- delivery calendar

export function deliveryDows(store: string): number[] {
  return DELIVERY_DOWS[store] ?? [2, 5]
}
export function isoAdd(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function dowOf(iso: string): number { return new Date(iso + 'T12:00:00Z').getUTCDay() }

/** Next n delivery dates for a store, from tomorrow on. */
export function upcomingDeliveries(store: string, today: string, n = 4): string[] {
  const dows = deliveryDows(store)
  const out: string[] = []
  for (let i = 1; i <= 28 && out.length < n; i++) {
    const d = isoAdd(today, i)
    if (dows.includes(dowOf(d))) out.push(d)
  }
  return out
}

/**
 * The first truck this store can still be added to, honouring the order cutoff.
 * Returns null if nothing is reachable inside the horizon.
 */
export function reachableTruck(store: string, today: string): string | null {
  const earliest = isoAdd(today, PFG_ORDER_CUTOFF_DAYS)
  return upcomingDeliveries(store, today, 6).find(d => d >= earliest) ?? null
}

/**
 * Protection interval for the next order: [today, following delivery). The order
 * placed now arrives at the next delivery and must last until the one after it.
 * Margate is Tuesday-only, so its window is ~7 days where the others are 3-4 —
 * which is why Margate must carry roughly double the cover on the same item.
 */
export function coverageHorizon(store: string, today: string): string[] {
  const dels = upcomingDeliveries(store, today, 2)
  const following = dels[1] ?? isoAdd(today, 8)
  const out: string[] = []
  for (let d = today; d < following; d = isoAdd(d, 1)) out.push(d)
  return out
}

// ---------------------------------------------------------------- purchase units

export interface CasePack {
  code: string          // PFG product_num
  descr: string
  pack: string          // e.g. '1/25 Lb'
  unitsPerCase: number  // NetChef inventory units in one case
  price: number         // $ per case, trailing average off real invoices
}

// NetChef product number -> PFG catalogue item. `unitsPerCase` converts a PFG case
// into NetChef INVENTORY units (not pounds) so the two systems can be compared:
// Strawberries-NSA is stocked as Container (6 LB) and ships 6/6 Lb, so a case is 6
// inventory units; Butter Pecan is stocked as Container (3 GAL) and ships 1/3 Gal,
// so a case is 1. Getting this wrong silently multiplies or divides every order.
const PFG_MAP: Record<string, { code: string; unitsPerCase: number }> = {
  P1052: { code: 'RA182', unitsPerCase: 25 },  // Gladiator Bulk Vanilla
  P1050: { code: 'RA284', unitsPerCase: 25 },  // Gladiator Bulk Chocolate
  P1051: { code: 'RA270', unitsPerCase: 25 },  // Gladiator Bulk Strawberry
  P1057: { code: 'RA198', unitsPerCase: 25 },  // Powder Hulk Vanilla
  P1103: { code: 'RF278', unitsPerCase: 25 },  // Protein Blend Vanilla 2.0
  P1092: { code: 'RG906', unitsPerCase: 30 },  // Peanut Butter Natural, 6/5 Lb
  P1058: { code: 'PT688', unitsPerCase: 1 },   // Ice Cream Butter Pecan, 1/3 Gal
  P1003: { code: 'BBN62', unitsPerCase: 1 },   // Scoopable Acai Base, 1/3 Gal
  P1010: { code: 'RT068', unitsPerCase: 1 },   // Banana Ripe #2, 1/40 Lb = 1 case
  P1011: { code: 'AVD90', unitsPerCase: 30 },  // Blueberries Lg Cultivated, 1/30 Lb
  P1119: { code: 'ARN08', unitsPerCase: 6 },   // Strawberry No Sugar Frozen, 6/6 Lb
  P1120: { code: 'TR420', unitsPerCase: 6 },   // Strawberry With Sugar, 6/6.5 Lb
  P6542: { code: 'BAE34', unitsPerCase: 24 },  // Flatbread Chicken, 24/1 Cnt
}

/** Live pack size and price per PFG code, from invoices. */
export async function loadCasePacks(sinceIso: string): Promise<Map<string, CasePack>> {
  const codes = [...new Set(Object.values(PFG_MAP).map(m => m.code))].map(c => `'${c}'`).join(',')
  const rows = await query<{ code: string; descr: string; pack: string; px: number }[]>(`
    SELECT product_num code, MAX(product_description) descr, MAX(pack_size) pack,
           AVG(CAST(unit_price AS float)) px
    FROM smoothieking.pfs_invoices
    WHERE product_num IN (${codes}) AND invoice_date >= '${sinceIso}' AND unit_price > 0
    GROUP BY product_num`).catch(() => [])
  const byCode = new Map<string, { descr: string; pack: string; px: number }>()
  for (const r of rows) byCode.set(r.code, { descr: r.descr, pack: r.pack, px: Number(r.px) })

  const out = new Map<string, CasePack>()
  for (const [pn, m] of Object.entries(PFG_MAP)) {
    const c = byCode.get(m.code)
    if (!c) continue                       // no recent invoice → no price we can stand behind
    out.set(pn, { code: m.code, descr: c.descr, pack: c.pack, unitsPerCase: m.unitsPerCase, price: c.px })
  }
  return out
}

export interface WalmartSub {
  item: string
  /** retail units per one NetChef inventory unit */
  perInventoryUnit: number
  price: number
  buys: number
}

// Only items with a real purchase history on the Walmart Business account. This is a
// substitution list, not an availability guess — if it isn't bought there, we don't
// offer it there.
const WALMART_MAP: Record<string, { match: string; perInventoryUnit: number }> = {
  P1058: { match: 'Butter Pecan Ice Cream', perInventoryUnit: 8.0 },   // 48 fl oz per 3 GAL
  P1011: { match: 'Fresh Blueberries, 18 oz', perInventoryUnit: 0.89 },
  P1480: { match: 'Fresh Strawberries, 1 lb', perInventoryUnit: 1.0 },
  P1092: { match: 'Creamy Peanut Butter, 64 oz', perInventoryUnit: 4.0 },
}

export async function loadWalmartSubs(sinceIso: string): Promise<Map<string, WalmartSub>> {
  const out = new Map<string, WalmartSub>()
  for (const [pn, m] of Object.entries(WALMART_MAP)) {
    const rows = await query<{ item: string; px: number; n: number }[]>(`
      SELECT TOP 1 item_name item, AVG(CAST(purchase_ppu AS float)) px, COUNT(*) n
      FROM smoothieking.walmart_spend
      WHERE order_date >= '${sinceIso}' AND item_name LIKE '%${m.match.replace(/'/g, "''")}%'
        AND purchase_ppu > 0
      GROUP BY item_name ORDER BY COUNT(*) DESC`).catch(() => [])
    const r = rows[0]
    if (r) out.set(pn, { item: r.item, perInventoryUnit: m.perInventoryUnit, price: Number(r.px), buys: Number(r.n) })
  }
  return out
}

// ---------------------------------------------------------------- collapsing

export type Bucket = 'act' | 'soon' | 'watch' | 'ok'

/**
 * Which bucket a line belongs to. The guide lists ~130 products per store; only the
 * first two buckets are worth a manager's attention on any given morning, so the UI
 * shows those expanded and collapses the rest behind a category summary.
 *
 *   act    out now, or runs out before a truck can reach it
 *   soon   short against the coverage window, truck arrives in time
 *   watch  covered, but the gap is inside one order cycle
 *   ok     nothing to do
 */
export function bucketOf(opts: {
  onHand: number; daily: number; suggested: number
  runOutDate: string | null; truck: string | null; today: string
}): Bucket {
  const { onHand, daily, suggested, runOutDate, truck, today } = opts
  if (daily <= 0) return 'ok'
  if (onHand <= 0) return 'act'
  if (runOutDate && truck && runOutDate < truck) return 'act'
  if (runOutDate && daysBetween(today, runOutDate) < ALERT_LEAD_DAYS) return 'act'
  if (suggested > 0) return 'soon'
  if (runOutDate && daysBetween(today, runOutDate) <= 14) return 'watch'
  return 'ok'
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
}

// ---------------------------------------------------------------- pooling

export interface PooledOrder {
  productNumber: string
  name: string
  code: string
  pack: string
  cases: number
  cost: number
  need: number
  allocation: { store: string; need: number; share: number }[]
}

/**
 * Pool per-store need into whole cases for the system, then charge each store its
 * pro-rata share. Ordering store by store bought two 25 LB Hulk cases for a 3.8 LB
 * and a 4.05 LB gap; pooled it is one case, and the saving across the board was
 * $308.75 on a single day's order.
 */
export function poolOrders(
  lines: { store: string; productNumber: string; productName: string; need: number }[],
  packs: Map<string, CasePack>,
): PooledOrder[] {
  const byProduct = new Map<string, typeof lines>()
  for (const l of lines) {
    if (l.need <= 0) continue
    if (!byProduct.has(l.productNumber)) byProduct.set(l.productNumber, [])
    byProduct.get(l.productNumber)!.push(l)
  }
  const out: PooledOrder[] = []
  for (const [pn, group] of byProduct) {
    const pack = packs.get(pn)
    if (!pack) continue
    const need = group.reduce((s, g) => s + g.need, 0)
    const cases = Math.ceil(need / pack.unitsPerCase)
    const cost = Math.round(cases * pack.price * 100) / 100
    out.push({
      productNumber: pn, name: group[0].productName, code: pack.code, pack: pack.pack,
      cases, cost, need: Math.round(need * 100) / 100,
      allocation: group
        .sort((a, b) => b.need - a.need)
        .map(g => ({ store: g.store, need: Math.round(g.need * 100) / 100, share: Math.round(cost * g.need / need * 100) / 100 })),
    })
  }
  return out.sort((a, b) => b.cost - a.cost)
}

// ---------------------------------------------------------------- transfers

export interface TransferLeg { from: string; qty: number; trust: string; donorLeft: number }
export interface TransferMove {
  to: string; productNumber: string; name: string; unit: string | null
  need: number; filled: number; short: number; legs: TransferLeg[]
  caseAvoided: { pack: string; cost: number } | null
}

const TRUST_ORDER: Record<string, number> = { counted: 0, estimated: 1, disputed: 2 }

/**
 * Match dry-goods shortages to sister-store surplus.
 *
 * A donor may only give what it does not itself need to reach ITS OWN next truck —
 * which is why Margate (Tuesday-only) can rarely donate and Miramar usually can.
 * Donors are preferred by how much we trust their count, so a disputed line is used
 * only after the trustworthy ones are exhausted, and the leg is marked so nobody
 * drives across town on a number the books don't support.
 */
export function matchTransfers(
  lines: {
    store: string; productNumber: string; productName: string; unit: string | null
    need: number; spare: number; basis: string; transferable: boolean
  }[],
  packs: Map<string, CasePack>,
): TransferMove[] {
  const spare = new Map<string, number>()
  for (const l of lines) spare.set(`${l.store}|${l.productNumber}`, l.spare)

  const requesters = lines
    .filter(l => l.need > 0 && l.transferable)
    .sort((a, b) => b.need / Math.max(a.need, 0.01) - 1 || b.need - a.need)

  const moves: TransferMove[] = []
  for (const r of requesters) {
    let want = r.need
    const donors = lines
      .filter(d => d.productNumber === r.productNumber && d.store !== r.store
                   && (spare.get(`${d.store}|${d.productNumber}`) ?? 0) > 0.05)
      .sort((a, b) => (TRUST_ORDER[a.basis] ?? 3) - (TRUST_ORDER[b.basis] ?? 3)
                   || (spare.get(`${b.store}|${b.productNumber}`)! - spare.get(`${a.store}|${a.productNumber}`)!))
    const legs: TransferLeg[] = []
    for (const d of donors) {
      if (want <= 0.05) break
      const k = `${d.store}|${d.productNumber}`
      const take = Math.min(want, spare.get(k)!)
      if (take <= 0.05) continue
      spare.set(k, spare.get(k)! - take)
      want -= take
      legs.push({ from: d.store, qty: round2(take), trust: d.basis, donorLeft: round2(spare.get(k)!) })
    }
    if (!legs.length) continue
    const pack = packs.get(r.productNumber)
    moves.push({
      to: r.store, productNumber: r.productNumber, name: r.productName, unit: r.unit,
      need: round2(r.need), filled: round2(r.need - Math.max(want, 0)), short: round2(Math.max(want, 0)),
      legs, caseAvoided: pack ? { pack: pack.pack, cost: Math.round(pack.price * 100) / 100 } : null,
    })
  }
  return moves.sort((a, b) => (b.caseAvoided?.cost ?? 0) - (a.caseAvoided?.cost ?? 0))
}

const round2 = (n: number) => Math.round(n * 100) / 100
