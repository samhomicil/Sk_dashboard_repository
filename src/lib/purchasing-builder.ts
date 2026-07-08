/**
 * Purchasing data builder — computes PFG + Walmart spend analytics from Azure SQL.
 * Powers the Inventory tab's Tier 1 (category/store/vendor spend intelligence).
 * Kept separate from cache-builder.ts: this data has no Sigma dependency, so it
 * rides the same `npm run refresh` cadence but writes its own data/purchasing.json
 * rather than bloating cache.json with an unrelated domain.
 */

import { PROXY_URL } from './config'

// ── DB helper — same pattern as cache-builder.ts's dbQuery ─────────
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

// pfg_order_line_items.store_number is plain digits ('1392'), distinct from
// config.ts's STORE_CODES ('SK-1392') — same discrepancy cache-builder.ts
// already has with its own sfPfs helper. Mirrored here, not re-derived from config.
const STORE_NUM = { Pines: '1392', Miramar: '1892', Margate: '2384' } as const

export interface CategorySpend {
  category: string
  spend: number
  lines: number
  pct: number
}

export interface CategoryByStore {
  category: string
  pines: number
  miramar: number
  margate: number
}

export interface TopProduct {
  itemCode: string
  description: string
  brand: string
  category: string
  spend: number
  qty: number
  pines: number
  miramar: number
  margate: number
}

export interface VendorBrand {
  brand: string
  spend: number
  pct: number
}

export interface MonthlySpend {
  month: string
  pfgSpend: number
  walmartSpend: number
}

export interface PurchasingData {
  refreshedAt: string
  vendorSplit: { pfgTotal: number; walmartTotal: number }
  categorySpend: CategorySpend[]
  categoryByStore: CategoryByStore[]
  topProducts: TopProduct[]
  topProductsByCategory: Record<string, TopProduct[]>
  pfgBrands: VendorBrand[]
  walmartCategories: { category: string; spend: number }[]
  monthlyTrend: MonthlySpend[]
}

async function fetchVendorSplit() {
  const [pfgRows, wmRows] = await Promise.all([
    dbQuery<{ total: number }[]>(`SELECT SUM(line_total) AS total FROM smoothieking.pfg_order_line_items`),
    dbQuery<{ total: number }[]>(`SELECT SUM(item_net_total) AS total FROM smoothieking.walmart_spend`),
  ])
  return {
    pfgTotal:     Number(pfgRows[0]?.total) || 0,
    walmartTotal: Number(wmRows[0]?.total)  || 0,
  }
}

async function fetchCategorySpend(): Promise<CategorySpend[]> {
  const rows = await dbQuery<{ category: string; spend: number; lines: number }[]>(`
    SELECT category, SUM(line_total) AS spend, COUNT(*) AS lines
    FROM smoothieking.pfg_order_line_items
    WHERE category IS NOT NULL AND category <> ''
    GROUP BY category
    ORDER BY spend DESC
  `)
  const total = rows.reduce((s, r) => s + (Number(r.spend) || 0), 0)
  return rows.map(r => ({
    category: r.category,
    spend:    Number(r.spend) || 0,
    lines:    Number(r.lines) || 0,
    pct:      total > 0 ? (Number(r.spend) || 0) / total : 0,
  }))
}

export async function fetchDistinctItemCountByCategory(): Promise<Record<string, number>> {
  const rows = await dbQuery<{ category: string; distinct_items: number }[]>(`
    SELECT category, COUNT(DISTINCT item_code) AS distinct_items
    FROM smoothieking.pfg_order_line_items
    WHERE category IS NOT NULL AND category <> '' AND item_code IS NOT NULL AND item_code <> ''
    GROUP BY category
  `)
  const out: Record<string, number> = {}
  for (const r of rows) out[r.category] = Number(r.distinct_items) || 0
  return out
}

async function fetchCategoryByStore(): Promise<CategoryByStore[]> {
  const rows = await dbQuery<{ category: string; store_number: string; spend: number }[]>(`
    SELECT category, store_number, SUM(line_total) AS spend
    FROM smoothieking.pfg_order_line_items
    WHERE category IS NOT NULL AND category <> ''
    GROUP BY category, store_number
  `)
  const byCategory = new Map<string, CategoryByStore>()
  for (const r of rows) {
    if (!byCategory.has(r.category)) {
      byCategory.set(r.category, { category: r.category, pines: 0, miramar: 0, margate: 0 })
    }
    const c = byCategory.get(r.category)!
    const spend = Number(r.spend) || 0
    if (r.store_number === STORE_NUM.Pines) c.pines = spend
    else if (r.store_number === STORE_NUM.Miramar) c.miramar = spend
    else if (r.store_number === STORE_NUM.Margate) c.margate = spend
  }
  return [...byCategory.values()].sort(
    (a, b) => (b.pines + b.miramar + b.margate) - (a.pines + a.miramar + a.margate)
  )
}

async function fetchTopProducts(limit = 15): Promise<TopProduct[]> {
  // Combine by true item_code, not description — the distributor renames/recodes
  // descriptions mid-period for the same physical product (e.g. "Gladiator Bulk
  // Vanilla" vs "Gladiator Vanilla" under the same code). Description shown is
  // whichever was attached to that code's most recent order.
  const rows = await dbQuery<{
    item_code: string; description: string; brand: string; category: string
    store_number: string; spend: number; qty: number
  }[]>(`
    WITH ranked AS (
      SELECT item_code, product_description, brand_manufacturer, category, store_number,
             qty_confirmed, line_total, order_date,
             ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY order_date DESC) AS rn
      FROM smoothieking.pfg_order_line_items
      WHERE item_code IS NOT NULL AND item_code <> ''
    ),
    latest_desc AS (
      SELECT item_code, product_description AS description, brand_manufacturer AS brand, category
      FROM ranked WHERE rn = 1
    )
    SELECT r.item_code, d.description, d.brand, d.category, r.store_number,
           SUM(r.line_total) AS spend, SUM(r.qty_confirmed) AS qty
    FROM ranked r
    JOIN latest_desc d ON d.item_code = r.item_code
    GROUP BY r.item_code, d.description, d.brand, d.category, r.store_number
  `)

  const byItem = new Map<string, TopProduct>()
  for (const r of rows) {
    if (!byItem.has(r.item_code)) {
      byItem.set(r.item_code, {
        itemCode: r.item_code, description: r.description, brand: r.brand, category: r.category,
        spend: 0, qty: 0, pines: 0, miramar: 0, margate: 0,
      })
    }
    const p     = byItem.get(r.item_code)!
    const spend = Number(r.spend) || 0
    p.spend += spend
    p.qty   += Number(r.qty) || 0
    if (r.store_number === STORE_NUM.Pines) p.pines += spend
    else if (r.store_number === STORE_NUM.Miramar) p.miramar += spend
    else if (r.store_number === STORE_NUM.Margate) p.margate += spend
  }

  return [...byItem.values()].sort((a, b) => b.spend - a.spend).slice(0, limit)
}

async function fetchTopProductsByCategory(perCategory = 8): Promise<Record<string, TopProduct[]>> {
  // Same item-code combination logic as fetchTopProducts, but bucketed per category
  // and capped per bucket rather than globally — powers the category drill-down.
  const rows = await dbQuery<{
    item_code: string; description: string; brand: string; category: string
    store_number: string; spend: number; qty: number
  }[]>(`
    WITH ranked AS (
      SELECT item_code, product_description, brand_manufacturer, category, store_number,
             qty_confirmed, line_total, order_date,
             ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY order_date DESC) AS rn
      FROM smoothieking.pfg_order_line_items
      WHERE item_code IS NOT NULL AND item_code <> '' AND category IS NOT NULL AND category <> ''
    ),
    latest_desc AS (
      SELECT item_code, product_description AS description, brand_manufacturer AS brand, category
      FROM ranked WHERE rn = 1
    )
    SELECT r.item_code, d.description, d.brand, d.category, r.store_number,
           SUM(r.line_total) AS spend, SUM(r.qty_confirmed) AS qty
    FROM ranked r
    JOIN latest_desc d ON d.item_code = r.item_code
    GROUP BY r.item_code, d.description, d.brand, d.category, r.store_number
  `)

  const byItem = new Map<string, TopProduct>()
  for (const r of rows) {
    if (!byItem.has(r.item_code)) {
      byItem.set(r.item_code, {
        itemCode: r.item_code, description: r.description, brand: r.brand, category: r.category,
        spend: 0, qty: 0, pines: 0, miramar: 0, margate: 0,
      })
    }
    const p     = byItem.get(r.item_code)!
    const spend = Number(r.spend) || 0
    p.spend += spend
    p.qty   += Number(r.qty) || 0
    if (r.store_number === STORE_NUM.Pines) p.pines += spend
    else if (r.store_number === STORE_NUM.Miramar) p.miramar += spend
    else if (r.store_number === STORE_NUM.Margate) p.margate += spend
  }

  const byCategory = new Map<string, TopProduct[]>()
  for (const p of byItem.values()) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, [])
    byCategory.get(p.category)!.push(p)
  }
  const result: Record<string, TopProduct[]> = {}
  for (const [cat, prods] of byCategory) {
    result[cat] = prods.sort((a, b) => b.spend - a.spend).slice(0, perCategory)
  }
  return result
}

async function fetchPfgBrands(limit = 10): Promise<VendorBrand[]> {
  const rows = await dbQuery<{ brand: string; spend: number }[]>(`
    SELECT brand_manufacturer AS brand, SUM(line_total) AS spend
    FROM smoothieking.pfg_order_line_items
    WHERE brand_manufacturer IS NOT NULL AND brand_manufacturer <> ''
    GROUP BY brand_manufacturer
    ORDER BY spend DESC
  `)
  const total = rows.reduce((s, r) => s + (Number(r.spend) || 0), 0)
  return rows.slice(0, limit).map(r => ({
    brand: r.brand,
    spend: Number(r.spend) || 0,
    pct:   total > 0 ? (Number(r.spend) || 0) / total : 0,
  }))
}

async function fetchWalmartCategories(): Promise<{ category: string; spend: number }[]> {
  const rows = await dbQuery<{ category: string; spend: number }[]>(`
    SELECT walmart_category AS category, SUM(item_net_total) AS spend
    FROM smoothieking.walmart_spend
    WHERE walmart_category IS NOT NULL AND walmart_category <> ''
    GROUP BY walmart_category
    ORDER BY spend DESC
  `)
  return rows.map(r => ({ category: r.category, spend: Number(r.spend) || 0 }))
}

async function fetchMonthlyTrend(): Promise<MonthlySpend[]> {
  const [pfgRows, wmRows] = await Promise.all([
    dbQuery<{ month: string; spend: number }[]>(`
      SELECT FORMAT(order_date, 'yyyy-MM') AS month, SUM(line_total) AS spend
      FROM smoothieking.pfg_order_line_items
      GROUP BY FORMAT(order_date, 'yyyy-MM')
    `),
    dbQuery<{ month: string; spend: number }[]>(`
      SELECT FORMAT(order_date, 'yyyy-MM') AS month, SUM(item_net_total) AS spend
      FROM smoothieking.walmart_spend
      GROUP BY FORMAT(order_date, 'yyyy-MM')
    `),
  ])
  const months = new Set([...pfgRows.map(r => r.month), ...wmRows.map(r => r.month)])
  const pfgMap  = new Map(pfgRows.map(r => [r.month, Number(r.spend) || 0]))
  const wmMap   = new Map(wmRows.map(r => [r.month, Number(r.spend) || 0]))
  return [...months].sort().map(month => ({
    month, pfgSpend: pfgMap.get(month) ?? 0, walmartSpend: wmMap.get(month) ?? 0,
  }))
}

export async function buildPurchasingData(): Promise<PurchasingData> {
  const [
    vendorSplit, categorySpend, categoryByStore, topProducts, topProductsByCategory,
    pfgBrands, walmartCategories, monthlyTrend,
  ] = await Promise.all([
    fetchVendorSplit(),
    fetchCategorySpend(),
    fetchCategoryByStore(),
    fetchTopProducts(15),
    fetchTopProductsByCategory(8),
    fetchPfgBrands(10),
    fetchWalmartCategories(),
    fetchMonthlyTrend(),
  ])

  return {
    refreshedAt: new Date().toISOString(),
    vendorSplit, categorySpend, categoryByStore, topProducts, topProductsByCategory,
    pfgBrands, walmartCategories, monthlyTrend,
  }
}
