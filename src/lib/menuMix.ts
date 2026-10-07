import 'server-only'
import { query } from './db'
import { etToday, isoAdd } from './core/dates'
import { EE_CHECKS } from './core/sources'
import type { ProductSummary, CategorySummary, MenuMixPayload } from './menuMixUtils'
export type { ProductSummary, CategorySummary, MenuMixPayload }
export { parseSize, parseFlavor } from './menuMixUtils'

/**
 * Menu Mix, live from Brink.
 *
 * Was: data/menu-mix.json, a CrunchTime menu-mix export pulled through Sigma by hand —
 * last on 2026-07-04, by month. The page picks months relative to today, so from August
 * on every period matched nothing and the tab rendered mostly empty. Same fix the
 * Overview's product and category panels got: units, sales and prices come from
 * smoothieking.sales (Brink, the official record) joined to Brink's own item groups in
 * smoothieking.menu_item_category, over exact days through yesterday.
 *
 * Two figures are CrunchTime's, as everywhere else in the app:
 *   - COGS % = NetChef's theoretical recipe cost ÷ its sales for the same item
 *     (smoothieking.netchef_recipe_daily). Menu items share Brink's PLU; an add-on's NetChef
 *     PLU is Brink's with "14" appended (Banana 3030 -> "Add On - Banana" 303014); retail
 *     has no Brink PLU, so it matches on name ("GH PB 5.5oz Salt" = "RETAIL - GH PB 5.5oz Salt").
 *   - the add-ons card's E&E = core/sources.ts EE_CHECKS.
 * Add-on units are PAID add-on lines: Brink's export can't tell a free add from a "NO"
 * line, so $0 modifier lines are left out rather than counted as add-ons.
 */

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
/** Brink's 'Retail' bucket shows as the page's existing 'Retail Products'. */
const PAGE_CATEGORY: Record<string, string> = {
  Smoothies: 'Smoothies', 'Smoothie Bowls': 'Smoothie Bowls', Food: 'Food', Retail: 'Retail Products',
}

/** Item groups, one row per Brink item name (kids' cups flagged for the size column). */
const ITEM_GROUPS = `
  SELECT item_name, MAX(category) AS category,
         MAX(CASE WHEN item_groups LIKE '%Kids'' Cups%' THEN 1 ELSE 0 END) AS kids
    FROM smoothieking.menu_item_category GROUP BY item_name`

/** [start, end] through yesterday (ET) for the page's periods; days = calendar days. */
export function periodWindow(period: string): { start: string; end: string; days: number } {
  const end = isoAdd(etToday(), -1)
  const [y, m] = end.split('-').map(Number)
  const span = (start: string, e = end) =>
    ({ start, end: e, days: Math.round((Date.parse(e) - Date.parse(start)) / 86400000) + 1 })
  if (period === 'l7d') return span(isoAdd(end, -6))
  if (period === 'mtd') return span(`${y}-${String(m).padStart(2, '0')}-01`)
  if (period === 'lastmonth') {
    const first = new Date(Date.UTC(y, m - 2, 1)), last = new Date(Date.UTC(y, m - 1, 0))
    return span(first.toISOString().slice(0, 10), last.toISOString().slice(0, 10))
  }
  return span(isoAdd(end, -89))                     // l90d (default)
}

/**
 * Brink names into the page's naming: "Angel Food 20" -> "20OZ - Angel Food",
 * "Hulk_Straw** 32 FUF" -> "32OZ - Hulk Straw", "Lil'_Angel" (a kids' cup) -> "KIDS - Lil' Angel".
 * Free Upsize Friday (FUF) cups and the asterisk variants Brink keeps are the same drink and
 * size, so they merge. parseSize / parseFlavor then read the size and flavor as designed.
 */
export function displayName(raw: string, kids: boolean): string {
  const s = raw.replace(/\*/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  const m = s.match(/^(.*?)\s*-?\s*\b(12|20|32|44)(\s*FUF)?$/i)
  const base = m && m[1] ? m[1].trim() : s
  if (kids) return `KIDS - ${base}`
  return m && m[1] ? `${m[2]}OZ - ${base}` : s
}

/** "RETAIL - CORE - SK Snk Chc Almonds 5oz" and "SK Snk Chc Almonds 5oz" -> one key. */
function retailKey(name: string): string {
  return name.replace(/^RETAIL\s*-\s*/i, '').replace(/^CORE\s*-\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export async function getMenuMix(period: string, store: string): Promise<MenuMixPayload | null> {
  const { start, end, days } = periodWindow(period)
  const sf = store === 'all' ? '' : `AND s.store = '${DB_STORE[store]}'`
  const rf = store === 'all' ? '' : `AND r.store = '${DB_STORE[store]}'`
  const ef = store === 'all' ? '' : `AND store = '${DB_STORE[store]}'`
  const inWindow = (col: string) => `CAST(${col} AS DATE) BETWEEN '${start}' AND '${end}'`

  const [items, mods, costs, ee] = await Promise.all([
    query<{ name: string; category: string; kids: number; qty: number; sales: number; plu: number | null }[]>(`
      WITH c AS (${ITEM_GROUPS})
      SELECT s.item_name AS name, MAX(c.category) AS category, MAX(c.kids) AS kids,
             COUNT(*) AS qty, SUM(s.net_sales) AS sales, MAX(s.item_plu) AS plu
        FROM smoothieking.sales s JOIN c ON c.item_name = s.item_name
       WHERE s.voided = 0 AND s.is_modifier = 0 ${sf}
         AND c.category IN ('Smoothies', 'Smoothie Bowls', 'Food', 'Retail')
         AND ${inWindow('s.closed_datetime')}
       GROUP BY s.item_name`),
    // Every modifier line is an add-on, whatever item group its name also sits in
    // (Frozen Yogurt is filed under Smoothies, Granola under nothing).
    query<{ name: string; qty: number; sales: number; plu: number | null }[]>(`
      SELECT s.item_name AS name, SUM(CASE WHEN s.price > 0 THEN 1 ELSE 0 END) AS qty,
             SUM(s.net_sales) AS sales, MAX(s.item_plu) AS plu
        FROM smoothieking.sales s
       WHERE s.voided = 0 AND s.is_modifier = 1 ${sf}
         AND ${inWindow('s.closed_datetime')}
       GROUP BY s.item_name
      HAVING SUM(CASE WHEN s.price > 0 THEN 1 ELSE 0 END) > 0`),
    query<{ plu: number | null; name: string; cost: number; sales: number }[]>(`
      SELECT r.plu, MAX(r.recipe_name) AS name, SUM(r.cost) AS cost, SUM(r.sales) AS sales
        FROM smoothieking.netchef_recipe_daily r
       WHERE r.business_date BETWEEN '${start}' AND '${end}' ${rf}
       GROUP BY r.plu, r.product_number`).catch(() => []),
    query<{ ee: number; sm: number }[]>(`
      SELECT SUM(ee_qty) AS ee, SUM(smoothie_qty) AS sm FROM ${EE_CHECKS}
       WHERE business_date BETWEEN '${start}' AND '${end}' ${ef}`).catch(() => []),
  ])
  if (!items.length) return null

  // NetChef cost and sales, keyed by PLU and by retail name.
  type Cost = { cost: number; sales: number }
  const costByPlu = new Map<number, Cost>(), costByRetail = new Map<string, Cost>()
  const bump = <K,>(m: Map<K, Cost>, k: K, c: Cost) => {
    const a = m.get(k) ?? { cost: 0, sales: 0 }
    a.cost += c.cost; a.sales += c.sales; m.set(k, a)
  }
  for (const r of costs) {
    const c = { cost: Number(r.cost) || 0, sales: Number(r.sales) || 0 }
    if (r.plu != null) bump(costByPlu, Number(r.plu), c)
    if (/^RETAIL - /i.test(r.name)) bump(costByRetail, retailKey(r.name), c)
  }

  // Merged display rows; a cost source (one PLU or retail name) counts once per row,
  // so "Angel Food 32" and "Angel Food 32 FUF" (both PLU 14005) don't double it.
  type Acc = { qty: number; sales: number; subcategory: string; costKeys: Map<string, Cost> }
  const agg = new Map<string, Acc>()
  const add = (subcategory: string, product: string, qty: number, sales: number, costKey: string | null, cost?: Cost) => {
    const key = `${subcategory}||${product}`
    const a = agg.get(key) ?? { qty: 0, sales: 0, subcategory, costKeys: new Map() }
    a.qty += qty; a.sales += sales
    if (costKey && cost && cost.sales > 0) a.costKeys.set(costKey, cost)
    agg.set(key, a)
  }
  for (const r of items) {
    const subcategory = PAGE_CATEGORY[r.category]
    if (!subcategory) continue
    const retail = r.category === 'Retail'
    const costKey = retail ? `r:${retailKey(r.name)}` : r.plu != null ? `p:${Number(r.plu)}` : null
    const cost = retail ? costByRetail.get(retailKey(r.name)) : r.plu != null ? costByPlu.get(Number(r.plu)) : undefined
    add(subcategory, displayName(r.name, Number(r.kids) === 1), Number(r.qty) || 0, Number(r.sales) || 0, costKey, cost)
  }
  for (const r of mods) {
    const nc = r.plu != null ? Number(r.plu) * 100 + 14 : null
    add('Modifiers', displayName(r.name, false), Number(r.qty) || 0, Number(r.sales) || 0,
        nc != null ? `p:${nc}` : null, nc != null ? costByPlu.get(nc) : undefined)
  }

  const summarize = (a: Acc, product: string): ProductSummary => {
    let cost = 0, costSales = 0
    for (const c of a.costKeys.values()) { cost += c.cost; costSales += c.sales }
    return {
      product, subcategory: a.subcategory, qty: a.qty, sales: Math.round(a.sales * 100) / 100,
      cogsPct: costSales > 0 ? cost / costSales : null,
      avgPrice: a.qty > 0 ? Math.round(a.sales / a.qty * 100) / 100 : null,
    }
  }

  const products: Record<string, ProductSummary[]> = {}
  const modifiers: ProductSummary[] = []
  for (const [key, a] of agg) {
    const row = summarize(a, key.split('||')[1])
    if (a.subcategory === 'Modifiers') modifiers.push(row)
    else (products[a.subcategory] ??= []).push(row)
  }
  for (const list of Object.values(products)) list.sort((x, y) => y.sales - x.sales)
  modifiers.sort((x, y) => y.qty - x.qty)

  const totals = Object.entries(products).map(([subcategory, list]) => ({
    subcategory,
    qty: list.reduce((t, p) => t + p.qty, 0),
    sales: list.reduce((t, p) => t + p.sales, 0),
  }))
  const coreTotal = totals.reduce((t, c) => t + c.sales, 0)
  const categories: CategorySummary[] = totals
    .map(c => ({ ...c, pctOfTotal: coreTotal > 0 ? c.sales / coreTotal : 0 }))
    .sort((x, y) => y.sales - x.sales)

  const eeRow = ee[0]
  return {
    refreshedAt: new Date().toISOString(),
    thruDate: end,
    startDate: start,
    days, period, store, categories, products, modifiers,
    eePct: eeRow && Number(eeRow.sm) > 0 ? Number(eeRow.ee) / Number(eeRow.sm) : null,
  }
}
