/**
 * ORDER LIST — one store's next order, built from what is on file.
 *
 * Items    = the curated ORDER_ITEMS (tuned names, Walmart offers, banana cap, Gladiator by
 *            flavour) plus every other food / packaging product NetChef has received from PFG
 *            (netchef_vendor_items: PFG number → product → units per case, NetChef's own
 *            conversion), so a product is never missing because nobody listed it.
 *
 * On hand  = the item's latest count (weekly or nightly, every storage spot, entered lines
 *            only — a blank is "not counted", never zero) + everything received since
 *            (PFG invoices + Walmart orders) − usage since. When the store's latest count
 *            left the item blank, the item's last entered count is used and the figure is
 *            marked as an estimate.
 * Usage    = the median count-to-count usage over the last USAGE_COUNT_WEEKS weekly counts
 *            (opening + received − closing), so waste is in it and one bad count cannot
 *            swing it; capped at COUNT_RATE_CAP × recipe; recipe usage when there are too few
 *            counts. Scaled by the last 28 days' sales against the window's.
 * Order    = enough to cover ORDER_COVER_DAYS from the truck × ORDER_SAFETY, in whole packs;
 *            a pack is skipped when under MIN_CASE_FRACTION of it is short and the item still
 *            lasts to the next truck.
 * Transfer = dry goods and juices only: another store lends what it holds beyond its own
 *            next truck + TRANSFER_BUFFER_DAYS, at the higher of its recipe and count usage.
 *
 * Prices come from the PFG snapshot (pfg_snapshot_*, Sunday–Wednesday) and Walmart's last
 * paid price. Nothing here writes anywhere.
 */
import { query } from '@/lib/db'
import { allKeyed } from '@/lib/core/keyed'
import { NET_SALES } from '@/lib/core/sources'
import { ORDER_SAFETY, MIN_CASE_FRACTION, MAX_IDLE_CASE_VALUE, transferEligible } from '@/lib/core/sourcing'
import { COUNT_RATE_CAP } from '@/lib/core/usage'
import {
  COGS_TARGET, ORDER_COVER_DAYS, ORDER_MAX_DAYS, TRANSFER_BUFFER_DAYS, PFG_MIN_ORDER, PFG_SMALL_ORDER_FEE,
  REGULAR_MIN_BUYS, REGULAR_STALE_MULTIPLE, REGULAR_STALE_MIN_DAYS, USAGE_COUNT_WEEKS, USAGE_MIN_INTERVALS,
  COUNT_STALE_DAYS,
} from '@/lib/core/targets'
import {
  ORDER_ITEMS, autoItems, pfgReceipts, type Keep, type OrderItem, type OrderVendor, type VendorItemRow,
} from '@/lib/core/orderItems'

export const ORDER_STORES = ['Margate', 'Miramar', 'Pines'] as const
export type OrderStore = typeof ORDER_STORES[number]
const PFG_STORE: Record<OrderStore, number> = { Pines: 3784, Miramar: 3783, Margate: 3167 }
const storeOfEmail = (e: string | null): OrderStore | null => {
  const s = (e || '').toLowerCase()
  return s.includes('margate') ? 'Margate' : s.includes('miramar') ? 'Miramar' : s.includes('pines') ? 'Pines' : null
}

export interface OfferOut {
  vendor: OrderVendor
  pack: string
  code: string | null
  price: number | null
  perPack: number
  /** packs to order from this offer */
  suggested: number
  outOfStock: boolean
}
export interface TransferOut { from: OrderStore; qty: number; has: number; keeps: number }
export interface ItemOut {
  id: string
  name: string
  category: string
  unit: string
  onHand: number | null
  estimate: boolean
  countedOn: string | null
  daily: number | null
  usageBasis: 'counts' | 'recipe' | 'none'
  /** projected on hand the morning the truck arrives */
  atTruck: number | null
  runsOut: string | null
  runsOutBeforeNext: boolean
  maxDays: number
  maxPacks: number | null
  perRunItem: boolean
  offers: OfferOut[]
  defaultOffer: number
  lastOrder: { date: string; qty: number; amount: number; vendor: OrderVendor } | null
  transfer: TransferOut | null
  /** a whole pack would leave over MAX_IDLE_CASE_VALUE idle: 'transfer' when a sister store can
   *  lend it, else 'decide' (still on the order — the store is short — with the idle $ shown) */
  route: 'order' | 'transfer' | 'decide'
  /** $ of stock the default offer's packs would leave beyond the need */
  idle: number
}
export interface RegularOut {
  code: string; name: string; pack: string; price: number | null; typicalQty: number
  everyDays: number; lastBought: string; lateDays: number
}
export interface StoppedOut { code: string; name: string; everyDays: number; lastBought: string }
export interface OrderListPayload {
  store: OrderStore
  today: string
  truck: { date: string; cutoffUtc: string | null; nextDate: string }
  asOf: { count: string | null; countStale: boolean; pfgPrices: string | null; invoices: string | null; walmart: string | null }
  items: ItemOut[]
  regulars: RegularOut[]
  stopped: StoppedOut[]
  budget: { weekly: number; basis: string }
  pfgMinimum: { amount: number; fee: number }
}

/* ── small date helpers (ISO yyyy-mm-dd, UTC noon to dodge DST) ─────────────────────── */
const toDate = (iso: string) => new Date(iso + 'T12:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const days = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const etToday = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)

type CountRow = { store: string; d: string; kind: string; product_number: string; qty: number }
type PfgRow = { store_number: number; d: string; product_num: string; qty: number; amt: number; descr: string; pack: string; price: number; cat: string }
type WmtRow = { email: string; d: string; item_id: string; qty: number; amt: number; ppu: number; name: string }
type SnapRow = { store: string; product_num: string; price: number | null; in_catalog: boolean; out_of_stock: boolean; temp_unavailable: boolean; discontinued: boolean; as_of_date: string }
type CalRow = { store: string; delivery_date: string; cutoff_utc: string | null }
type RecipeRow = { store: string; product_number: string; w: number }
type SalesRow = { store: string; d: string; net: number }
type KeepRow = { product_number: string; freezer: number; fridge: number }

async function loadAll(today: string) {
  const since = addDays(today, -7 * (USAGE_COUNT_WEEKS + 2))
  return allKeyed({
    counts: query<CountRow[]>(`
      SELECT store, CONVERT(char(10), count_date, 23) d, count_kind kind, product_number, SUM(total_qty) qty
      FROM smoothieking.netchef_counts WHERE count_date >= '${since}'
      GROUP BY store, count_date, count_kind, product_number`),
    pfg: query<PfgRow[]>(`
      SELECT store_number, CONVERT(char(10), invoice_date, 23) d, product_num, SUM(qty_shipped) qty, SUM(ext_price) amt,
             MAX(product_description) descr, MAX(pack_size) pack, MAX(unit_price) price, MAX(category) cat
      FROM smoothieking.pfs_invoices
      WHERE invoice_date >= '2026-03-01' AND invoice_type = 'Invoice' AND category <> 'ZZZ_Non-Items'
      GROUP BY store_number, invoice_date, product_num`),
    wmt: query<WmtRow[]>(`
      SELECT account_user_email email, CONVERT(char(10), order_date, 23) d, CAST(item_id AS varchar(20)) item_id,
             SUM(item_received_qty) qty, SUM(item_subtotal) amt, MAX(purchase_ppu) ppu, MAX(item_name) name
      FROM smoothieking.walmart_spend
      WHERE order_date >= '${since}' AND item_received_qty > 0
        AND (order_fulfillment_status IS NULL OR order_fulfillment_status <> 'CANCELED')
      GROUP BY account_user_email, order_date, item_id`),
    snap: query<SnapRow[]>(`
      SELECT store, product_num, price, in_catalog, out_of_stock, temp_unavailable, discontinued,
             CONVERT(char(10), as_of_date, 23) as_of_date
      FROM smoothieking.pfg_snapshot_items
      WHERE as_of_date = (SELECT MAX(as_of_date) FROM smoothieking.pfg_snapshot_items)`),
    cal: query<CalRow[]>(`
      SELECT store, CONVERT(char(10), delivery_date, 23) delivery_date, CONVERT(varchar(19), cutoff_utc, 126) cutoff_utc
      FROM smoothieking.pfg_snapshot_calendar
      WHERE as_of_date = (SELECT MAX(as_of_date) FROM smoothieking.pfg_snapshot_calendar)`),
    recipe: query<RecipeRow[]>(`
      SELECT store, product_number, AVG(qty_issue) w FROM smoothieking.netchef_usage_api
      WHERE DATEDIFF(day, period_start, period_end) = 6 AND period_end >= '${since}'
      GROUP BY store, product_number`),
    // NetChef's PFG number → product mapping, for everything the curated list does not cover
    vend: query<VendorItemRow[]>(`
      SELECT vendor_product, product_number, conv, vendor_package, product_name, subcategory, microcategory,
             inventory_unit, CONVERT(char(10), last_received, 23) last_received, stores
      FROM smoothieking.netchef_vendor_items
      WHERE vendor_code LIKE 'PFG%' AND category = 'COGS' AND active = 1`),
    // where each product is kept: any count line in a freezer / fridge spot
    keep: query<KeepRow[]>(`
      SELECT product_number,
             MAX(CASE WHEN storage_name LIKE '%Freezer%' THEN 1 ELSE 0 END) freezer,
             MAX(CASE WHEN storage_name LIKE '%Fridge%' OR storage_name LIKE '%Cooler%' THEN 1 ELSE 0 END) fridge
      FROM smoothieking.netchef_counts WHERE count_date >= '${since}' AND total_qty > 0
      GROUP BY product_number`),
    sales: query<SalesRow[]>(`
      SELECT store, CONVERT(char(10), closed_datetime, 23) d, ${NET_SALES} net FROM smoothieking.sales
      WHERE closed_datetime >= '${since}' GROUP BY store, CONVERT(char(10), closed_datetime, 23)`),
  })
}

type Data = Awaited<ReturnType<typeof loadAll>>

/** Everything one store needs to price, project and judge an item. */
function storeView(data: Data, store: OrderStore, today: string) {
  const counts = data.counts.filter(r => r.store === store)
  const countsOf = new Map<string, CountRow[]>()
  for (const r of counts) { const l = countsOf.get(r.product_number) ?? []; l.push(r); countsOf.set(r.product_number, l) }
  const weeklyDates = [...new Set(counts.filter(r => r.kind === 'weekly').map(r => r.d))].sort()
  const latestWeekly = weeklyDates[weeklyDates.length - 1] ?? null
  const pfg = data.pfg.filter(r => r.store_number === PFG_STORE[store])
  const pfgOf = new Map<string, PfgRow[]>()
  for (const r of pfg) { const l = pfgOf.get(r.product_num) ?? []; l.push(r); pfgOf.set(r.product_num, l) }
  const wmt = data.wmt.filter(r => storeOfEmail(r.email) === store)
  const salesByDay = new Map(data.sales.filter(r => r.store === store).map(r => [r.d, Number(r.net) || 0]))

  /** NetChef-unit quantity counted for an item on a date (per kind), or null when not counted */
  const countOn = (item: OrderItem, d: string, kind: string) => {
    let q = 0, hit = false
    for (const [pn, mult] of Object.entries(item.members)) for (const r of countsOf.get(pn) ?? []) if (r.d === d && r.kind === kind) { q += Number(r.qty) * mult; hit = true }
    return hit ? q : null
  }
  /** received into this store in (a, b], NetChef units */
  const received = (item: OrderItem, a: string, b: string) => {
    let q = 0
    for (const o of pfgReceipts(item)) for (const c of o.codes) for (const r of pfgOf.get(c) ?? []) if (r.d > a && r.d <= b) q += Number(r.qty) * o.perPack
    for (const o of item.offers) if (o.vendor === 'Walmart') { for (const r of wmt) if (r.d > a && r.d <= b && o.codes.includes(r.item_id)) q += Number(r.qty) * o.perPack }
    return q
  }
  const recipe = new Map(data.recipe.filter(r => r.store === store).map(r => [r.product_number, Number(r.w)]))
  const recipeDaily = (item: OrderItem) => {
    let w = 0, hit = false
    for (const [pn, mult] of Object.entries(item.members)) { const v = recipe.get(pn); if (v != null) { w += v * mult; hit = true } }
    return hit ? w / 7 : null
  }
  const countDaily = (item: OrderItem) => {
    const rates: number[] = []
    const dates = weeklyDates.slice(-(USAGE_COUNT_WEEKS + 1))
    for (let i = 0; i + 1 < dates.length; i++) {
      const a = countOn(item, dates[i], 'weekly'), b = countOn(item, dates[i + 1], 'weekly')
      if (a == null || b == null) continue
      const used = a + received(item, dates[i], dates[i + 1]) - b
      if (used >= 0) rates.push(used / days(dates[i], dates[i + 1]))
    }
    return rates.length >= USAGE_MIN_INTERVALS ? median(rates) : null
  }
  // sales pace: last 28 days against the count window
  const sum = (a: string, b: string) => {
    let s = 0, n = 0
    for (const [d, v] of salesByDay) if (d >= a && d <= b) { s += v; n++ }
    return n ? s / n : 0
  }
  const recent = sum(addDays(today, -28), addDays(today, -1))
  const windowAvg = weeklyDates.length > 1 ? sum(weeklyDates[Math.max(0, weeklyDates.length - 1 - USAGE_COUNT_WEEKS)], weeklyDates[weeklyDates.length - 1]) : recent
  const pace = windowAvg > 0 ? Math.min(1.3, Math.max(0.7, recent / windowAvg)) : 1

  /** usage and on-hand for an item at this store (memoised: transfers ask every store about every item) */
  const memo = new Map<string, ReturnType<typeof projectOnce>>()
  const project = (item: OrderItem) => {
    let v = memo.get(item.id)
    if (!v) { v = projectOnce(item); memo.set(item.id, v) }
    return v
  }
  function projectOnce(item: OrderItem) {
    const counted = countDaily(item), recipe = recipeDaily(item)
    let daily: number | null = null, basis: ItemOut['usageBasis'] = 'none'
    if (counted != null) { daily = recipe != null && recipe > 0 ? Math.min(counted, recipe * COUNT_RATE_CAP) : counted; basis = 'counts' }
    else if (recipe != null) { daily = recipe; basis = 'recipe' }
    if (daily != null) daily *= pace
    // latest date the item was actually entered (nightly beats weekly when newer)
    let anchor: string | null = null, kind = 'weekly'
    const entered = Object.keys(item.members).flatMap(pn => countsOf.get(pn) ?? []).map(r => ({ d: r.d, k: r.kind }))
    for (const e of entered) if (!anchor || e.d > anchor || (e.d === anchor && e.k === 'nightly')) { anchor = e.d; kind = e.k }
    if (!anchor) return { daily, basis, onHand: null, countedOn: null, estimate: true, keepDaily: Math.max(counted ?? 0, recipe ?? 0) }
    const base = countOn(item, anchor, kind) ?? 0
    const onHand = base + received(item, anchor, today) - (daily ?? 0) * Math.max(0, days(anchor, today))
    return {
      daily, basis, onHand, countedOn: anchor,
      estimate: (!!latestWeekly && anchor < latestWeekly) || days(anchor, today) > COUNT_STALE_DAYS,
      keepDaily: Math.max(counted ?? 0, recipe ?? 0),
    }
  }
  return { latestWeekly, pfg, wmt, project, salesRecent: recent }
}

export async function buildOrderList(store: OrderStore): Promise<OrderListPayload> {
  const today = etToday()
  const data = await loadAll(today)
  const views = Object.fromEntries(ORDER_STORES.map(s => [s, storeView(data, s, today)])) as Record<OrderStore, ReturnType<typeof storeView>>
  const me = views[store]

  // curated items, then every other food / packaging product PFG delivers (NetChef's mapping)
  const keeps = new Map(data.keep.map(r => [r.product_number, r]))
  const keepOf = (pn: string): Keep => { const k = keeps.get(pn); return k?.freezer ? 'freezer' : k?.fridge ? 'fridge' : 'shelf' }
  const catalog: OrderItem[] = [...ORDER_ITEMS, ...autoItems(data.vend, keepOf)]
  // shared rule (core/sourcing, same as the Order guide): dry goods and bottled juice move
  // between stores, anything on the cold chain rides the truck
  const nc = new Map(data.vend.map(r => [r.product_number, r]))
  const movable = (i: OrderItem) => !i.perRun && Object.keys(i.members)
    .some(pn => transferEligible(nc.get(pn)?.microcategory ?? null, nc.get(pn)?.inventory_unit ?? null, keepOf(pn)))
  // a product this store neither received nor counted is not on its list; nor is one it has
  // stopped using (no usage, nothing bought in REGULAR_STALE_MIN_DAYS) — search still finds the rest
  const boughtWithin = (i: OrderItem, n: number) =>
    pfgReceipts(i).some(o => o.codes.some(c => me.pfg.some(r => r.product_num === c && days(r.d, today) <= n)))
  const shown = (i: OrderItem) => {
    if (!i.auto) return true
    const p = me.project(i)
    if (!i.auto.stores.includes(store) && p.onHand == null) return false
    return (p.daily ?? 0) > 0.01 || boughtWithin(i, REGULAR_STALE_MIN_DAYS)
  }

  // trucks: the next PFG delivery from the snapshot calendar, else next Tuesday
  const nextTruck = (s: OrderStore) => {
    const c = data.cal.filter(r => r.store === s && r.delivery_date > today).sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))[0]
    if (c) return { date: c.delivery_date, cutoffUtc: c.cutoff_utc }
    let d = addDays(today, 1); while (toDate(d).getUTCDay() !== 2) d = addDays(d, 1)
    return { date: d, cutoffUtc: null }
  }
  const truck = nextTruck(store)
  const toTruck = Math.max(0, days(today, truck.date))

  // PFG's catalogue is one list: a number another store's snapshot found is live here too (this
  // store's price first, else the other store's — they differ by cents)
  const snap = [...data.snap.filter(r => r.store === store), ...data.snap.filter(r => r.store !== store)]
  const priceOf = (codes: string[]) => {
    for (const c of codes) { const s = snap.find(r => r.product_num === c && r.in_catalog); if (s) return { code: c, price: s.price == null ? null : Number(s.price), oos: !!(s.out_of_stock || s.temp_unavailable || s.discontinued) } }
    // not in this morning's catalogue: last invoice price
    const inv = me.pfg.filter(r => codes.includes(r.product_num)).sort((a, b) => b.d.localeCompare(a.d))[0]
    return { code: inv?.product_num ?? codes[0] ?? null, price: inv ? Number(inv.price) : null, oos: false }
  }
  const retired = (o: { vendor: OrderVendor; codes: string[] }) =>
    o.vendor === 'PFG' && snap.some(r => o.codes.includes(r.product_num)) && !snap.some(r => o.codes.includes(r.product_num) && r.in_catalog)
  const walmartPrice = (codes: string[]) => {
    const w = data.wmt.filter(r => codes.includes(r.item_id)).sort((a, b) => b.d.localeCompare(a.d))[0]
    return w ? Number(w.ppu) : null
  }

  /** What a store is short of by its next truck, in NetChef units, and how many days it lasts. */
  const shortAt = (s: OrderStore, item: OrderItem) => {
    const p = views[s].project(item)
    if (p.onHand == null || p.daily == null) return { ask: 0, lasts: Infinity }
    const atT = p.onHand - p.daily * Math.max(0, days(today, nextTruck(s).date))
    const short = Math.max(0, p.daily * ORDER_COVER_DAYS * ORDER_SAFETY - Math.max(atT, 0))
    return { ask: Math.ceil(short), lasts: p.daily > 0 ? Math.max(0, p.onHand) / p.daily : Infinity }
  }
  /**
   * A sister store with enough spare (shelf-stable goods only). Every store's request for the
   * item draws on one pool of spare, most urgent store first, so two stores are never both
   * told to ask Pines for the same bottles. Spare = on hand − what the donor uses until its
   * own next truck plus TRANSFER_BUFFER_DAYS.
   */
  const transferFor = (item: OrderItem): TransferOut | null => {
    if (!movable(item)) return null
    const pool = new Map(ORDER_STORES.map(s => {
      const q = views[s].project(item)
      const keeps = q.keepDaily * (Math.max(0, days(today, nextTruck(s).date)) + TRANSFER_BUFFER_DAYS)
      const ok = q.onHand != null && q.keepDaily > 0
      return [s, { spare: ok ? q.onHand! - keeps : 0, has: Math.floor(q.onHand ?? 0), keeps: Math.ceil(keeps) }]
    }))
    const asks = ORDER_STORES.map(s => ({ s, ...shortAt(s, item) })).filter(r => r.ask > 0)
      .sort((a, b) => a.lasts - b.lasts || a.s.localeCompare(b.s))
    let mine: TransferOut | null = null
    for (const r of asks) {
      let from: OrderStore | null = null
      for (const [d, v] of pool) if (d !== r.s && v.spare >= r.ask && (!from || v.spare > pool.get(from)!.spare)) from = d
      if (!from) continue
      const v = pool.get(from)!
      v.spare -= r.ask
      if (r.s === store) mine = { from, qty: r.ask, has: v.has, keeps: v.keeps }
    }
    return mine
  }

  const items: ItemOut[] = catalog.filter(i => shown(i)).map(item => {
    const p = me.project(item)
    const atTruck = p.onHand == null || p.daily == null ? null : p.onHand - p.daily * toTruck
    const cover = (p.daily ?? 0) * ORDER_COVER_DAYS
    const short = p.daily == null ? 0 : Math.max(0, cover * ORDER_SAFETY - Math.max(atTruck ?? 0, 0))
    const lastsPast = atTruck != null && atTruck >= cover
    // under MIN_CASE_FRACTION of a pack short while stock still reaches the truck: roll it to
    // the next order (core/sourcing tooSmallForCase)
    const truckInTime = atTruck != null && atTruck > 0
    // A PFG number this morning's catalogue no longer carries cannot be ordered: drop that offer
    // (mango RJ260 still priced cheapest per lb off its last invoice, but PFG retired it).
    const live = item.offers.filter(o => !retired(o))
    const sold = live.length ? live : item.offers
    const offers: OfferOut[] = sold.map((o, j) => {
      const pr = o.vendor === 'PFG' ? priceOf(o.codes) : { code: o.codes[0] ?? null, price: walmartPrice(o.codes), oos: false }
      let suggested = 0
      if (item.perRun) suggested = item.perRun[j] ?? 0
      else if (short > 0) {
        const frac = short / o.perPack
        suggested = !truckInTime || frac >= MIN_CASE_FRACTION ? Math.ceil(frac) : 0
        if (item.maxPacks) suggested = Math.min(suggested, item.maxPacks)
      }
      return { vendor: o.vendor, pack: o.pack, code: pr.code, price: pr.price, perPack: o.perPack, suggested, outOfStock: pr.oos }
    })
    // default offer: the cheapest per NetChef unit among those whose order stays within
    // ORDER_MAX_DAYS of stock (a 25 lb bag is not "cheaper" for a 3 lb shortfall); when only
    // big packs exist, the one that spends least now. PFG wins ties (listed first).
    const maxDays = ORDER_MAX_DAYS[item.category] ?? 21
    const fits = (o: OfferOut) => !p.daily || o.suggested === 0 || (Math.max(atTruck ?? 0, 0) + o.suggested * o.perPack) / p.daily <= maxDays + 0.5
    const unitCost = (x: OfferOut) => (x.price == null ? Infinity : x.price / x.perPack)
    const spend = (x: OfferOut) => (x.price == null ? Infinity : x.price * x.suggested)
    // an offer that rounds to nothing does not compete with one that orders
    const anyOrders = offers.some(o => o.suggested > 0 && o.price != null)
    const eligible = (o: OfferOut) => o.price != null && fits(o) && (!anyOrders || o.suggested > 0)
    let best = -1
    offers.forEach((o, j) => { if (eligible(o) && (best < 0 || unitCost(o) < unitCost(offers[best]) - 1e-9)) best = j })
    if (best < 0) offers.forEach((o, j) => { if (best < 0 || spend(o) < spend(offers[best]) - 1e-9) best = j })
    best = Math.max(best, 0)
    // last order from any vendor
    let last: ItemOut['lastOrder'] = null
    for (const o of pfgReceipts(item)) for (const r of me.pfg) if (o.codes.includes(r.product_num) && (!last || r.d > last.date)) last = { date: r.d, qty: Number(r.qty), amount: Number(r.amt), vendor: 'PFG' }
    for (const o of item.offers) {
      if (o.vendor === 'Walmart') for (const r of me.wmt) if (o.codes.includes(r.item_id) && (!last || r.d > last.date)) last = { date: r.d, qty: Number(r.qty), amount: Number(r.amt), vendor: 'Walmart' }
    }
    // A whole pack that would leave more than MAX_IDLE_CASE_VALUE sitting is not an order
    // (core/sourcing, same rule as the Order guide): a local buy when there is one, else a
    // transfer when the item can move; a dead end ('decide') still goes on the truck.
    const transfer = transferFor(item)
    const idle = (o: OfferOut) => (o.price == null || o.suggested === 0 ? 0 : Math.max(0, o.suggested * o.perPack - short) * (o.price / o.perPack))
    let route: ItemOut['route'] = 'order'
    if (!item.perRun && idle(offers[best]) > MAX_IDLE_CASE_VALUE) {
      const local = offers.findIndex(o => o.vendor !== 'PFG' && o.price != null && o.suggested > 0)
      if (local >= 0) best = local
      else if (transfer) route = 'transfer'
      else route = 'decide'
    }
    return {
      id: item.id, name: item.name, category: item.category, unit: item.unit,
      onHand: p.onHand == null ? null : Math.max(0, p.onHand), estimate: p.estimate, countedOn: p.countedOn,
      daily: p.daily, usageBasis: p.basis, atTruck,
      runsOut: p.onHand != null && p.daily && p.daily > 0 && p.onHand / p.daily < 365 ? addDays(today, Math.floor(Math.max(0, p.onHand) / p.daily)) : null,
      runsOutBeforeNext: !item.perRun && atTruck != null && !lastsPast,
      maxDays, maxPacks: item.maxPacks ?? null, perRunItem: !!item.perRun,
      offers, defaultOffer: best, lastOrder: last, transfer, route, idle: Math.round(idle(offers[best])),
    }
  })

  // "usually bought by now": PFG items outside the list, on a steady rhythm
  const listed = new Set(catalog.flatMap(i => pfgReceipts(i).flatMap(o => o.codes)))
  const byCode = new Map<string, PfgRow[]>()
  for (const r of me.pfg) if (!listed.has(r.product_num)) (byCode.get(r.product_num) ?? byCode.set(r.product_num, []).get(r.product_num)!).push(r)
  const regulars: RegularOut[] = [], stopped: StoppedOut[] = []
  for (const [code, rows] of byCode) {
    const dates = [...new Set(rows.map(r => r.d))].sort()
    if (dates.length < REGULAR_MIN_BUYS) continue
    const gaps = dates.slice(1).map((d, i) => days(dates[i], d))
    const every = median(gaps)
    const lastBought = dates[dates.length - 1]
    const since = days(lastBought, today)
    const r0 = rows.sort((a, b) => b.d.localeCompare(a.d))[0]
    if (since > Math.max(every * REGULAR_STALE_MULTIPLE, REGULAR_STALE_MIN_DAYS)) {
      stopped.push({ code, name: r0.descr, everyDays: every, lastBought }); continue
    }
    const due = addDays(lastBought, Math.round(every))
    if (due > truck.date) continue
    // a full cycle and more overdue: dropped on purpose or bought elsewhere, not forgotten
    if (days(due, truck.date) > Math.max(every, ORDER_COVER_DAYS)) { stopped.push({ code, name: r0.descr, everyDays: every, lastBought }); continue }
    const s = snap.find(x => x.product_num === code && x.in_catalog)
    regulars.push({
      code, name: r0.descr, pack: r0.pack, price: s?.price != null ? Number(s.price) : Number(r0.price),
      typicalQty: Math.max(1, Math.round(median(rows.map(r => Number(r.qty))))),
      everyDays: every, lastBought, lateDays: Math.max(0, days(due, truck.date)),
    })
  }
  regulars.sort((a, b) => b.lateDays - a.lateDays || a.name.localeCompare(b.name))
  // PFG sells some things under two numbers; a product still bought under one is not "stopped"
  const live = new Set(regulars.map(r => r.name.toLowerCase()))
  for (const rows of byCode.values()) if (rows.some(r => days(r.d, today) <= REGULAR_STALE_MIN_DAYS)) live.add(rows[0].descr.toLowerCase())
  const stoppedLive = stopped.filter(s => !live.has(s.name.toLowerCase()))
  stopped.length = 0; stopped.push(...stoppedLive)
  stopped.sort((a, b) => b.lastBought.localeCompare(a.lastBought))

  const maxOf = (xs: string[]) => xs.sort().slice(-1)[0] ?? null
  return {
    store, today,
    truck: { date: truck.date, cutoffUtc: truck.cutoffUtc, nextDate: addDays(truck.date, ORDER_COVER_DAYS) },
    asOf: {
      count: me.latestWeekly,
      countStale: !me.latestWeekly || days(me.latestWeekly, today) > COUNT_STALE_DAYS,
      pfgPrices: snap[0]?.as_of_date ?? null,
      invoices: maxOf(me.pfg.map(r => r.d)),
      walmart: maxOf(me.wmt.map(r => r.d)),
    },
    items, regulars, stopped: stopped.slice(0, 5),
    budget: { weekly: me.salesRecent * 7 * COGS_TARGET, basis: `last 28 days' sales × ${Math.round(COGS_TARGET * 100)}%` },
    pfgMinimum: { amount: PFG_MIN_ORDER, fee: PFG_SMALL_ORDER_FEE },
  }
}
