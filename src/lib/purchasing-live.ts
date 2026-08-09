/**
 * Live, timeframe-windowed purchasing analytics — the inventory module's data layer.
 * Same sources as purchasing-builder.ts (pfg_compat + walmart_spend) but every query is
 * scoped to a [start, end] window (matching the dashboard's Period/resolveDateRange), and
 * it adds last-known unit prices + weekly trend series (spend by vendor, cost % of sales,
 * category mix) for the "trends over time" insights. Queried live per request, not cached
 * to json, so the timeframe selector re-scopes instantly.
 */

import { query } from './db'
import { wmtFood } from './core/sources'
import { allKeyed } from './core/keyed'
import type {
  CategorySpend, CategoryByStore, TopProductPriced, VendorBrand, WeekPoint, CategoryWeekPoint, PurchasingLive,
} from './purchasingUtils'

export type { PurchasingLive, TopProductPriced, WeekPoint, CategoryWeekPoint }

const STORE_NUM = { Pines: '1392', Miramar: '1892', Margate: '2384' } as const

const q = (s: string) => s.replace(/'/g, "''")
function weekStart(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7          // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export async function buildPurchasingLive(start: string, end: string): Promise<PurchasingLive> {
  const s = q(start), e = q(end)
  const pfgWin = `order_date >= '${s}' AND order_date <= '${e}'`
  const wmWin = `order_date >= '${s}' AND order_date <= '${e}'`

  // Bound by NAME, not position — pfgDaily and wmDaily share a row type, which is
  // exactly how ops-week silently swapped prior-year with history. See core/keyed.
  const {
    vendorRows, catRows, catStoreRows, topRows, brandRows, wmCatRows,
    pfgDaily, wmDaily, salesDaily, catDaily,
  } = await allKeyed({
    vendorRows: query<{ pfg: number; walmart: number }[]>(`
      SELECT (SELECT SUM(line_total) FROM smoothieking.pfg_compat WHERE ${pfgWin}) AS pfg,
             (${wmtFood.total(wmWin)}) AS walmart`),
    catRows: query<{ category: string; spend: number; lines: number }[]>(`
      SELECT category, SUM(line_total) AS spend, COUNT(*) AS lines
      FROM smoothieking.pfg_compat
      WHERE ${pfgWin} AND category IS NOT NULL AND category <> ''
      GROUP BY category ORDER BY spend DESC`),
    catStoreRows: query<{ category: string; store_number: string; spend: number }[]>(`
      SELECT category, store_number, SUM(line_total) AS spend
      FROM smoothieking.pfg_compat
      WHERE ${pfgWin} AND category IS NOT NULL AND category <> ''
      GROUP BY category, store_number`),
    // Top products by item_code + last-known unit price (line_total ÷ qty on latest in-window order).
    topRows: query<{
      item_code: string; description: string; brand: string; category: string; store_number: string
      spend: number; qty: number; last_price: number | null; last_date: string | null
    }[]>(`
      WITH ranked AS (
        SELECT item_code, product_description, brand_manufacturer, category, store_number,
               qty_confirmed, line_total, order_date,
               ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY order_date DESC,
                 (CASE WHEN qty_confirmed > 0 THEN 0 ELSE 1 END)) AS rn
        FROM smoothieking.pfg_compat
        WHERE ${pfgWin} AND item_code IS NOT NULL AND item_code <> ''
      ),
      latest AS (
        SELECT item_code, product_description AS description, brand_manufacturer AS brand, category,
               CASE WHEN qty_confirmed > 0 THEN line_total / qty_confirmed END AS last_price,
               CONVERT(char(10), order_date, 23) AS last_date
        FROM ranked WHERE rn = 1
      )
      SELECT r.item_code, d.description, d.brand, d.category, d.last_price, d.last_date, r.store_number,
             SUM(r.line_total) AS spend, SUM(r.qty_confirmed) AS qty
      FROM ranked r JOIN latest d ON d.item_code = r.item_code
      GROUP BY r.item_code, d.description, d.brand, d.category, d.last_price, d.last_date, r.store_number`),
    brandRows: query<{ brand: string; spend: number }[]>(`
      SELECT brand_manufacturer AS brand, SUM(line_total) AS spend
      FROM smoothieking.pfg_compat
      WHERE ${pfgWin} AND brand_manufacturer IS NOT NULL AND brand_manufacturer <> ''
      GROUP BY brand_manufacturer ORDER BY spend DESC`),
    wmCatRows: query<{ category: string; spend: number }[]>(`
      SELECT walmart_category AS category, SUM(item_net_total) AS spend
      FROM smoothieking.walmart_spend
      WHERE ${wmWin} AND walmart_category IS NOT NULL AND walmart_category <> ''
      GROUP BY walmart_category ORDER BY spend DESC`),
    // Daily series (bucketed to weeks in TS to avoid DATEFIRST ambiguity).
    pfgDaily: query<{ d: string; spend: number }[]>(`
      SELECT CONVERT(char(10), order_date, 23) AS d, SUM(line_total) AS spend
      FROM smoothieking.pfg_compat WHERE ${pfgWin} GROUP BY CONVERT(char(10), order_date, 23)`),
    wmDaily: query<{ d: string; spend: number }[]>(wmtFood.byDay(wmWin)),
    salesDaily: query<{ d: string; net: number }[]>(`
      SELECT CONVERT(char(10), closed_datetime, 23) AS d,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) AS net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= '${s}' AND CAST(closed_datetime AS DATE) <= '${e}'
      GROUP BY CONVERT(char(10), closed_datetime, 23)`),
    catDaily: query<{ d: string; category: string; spend: number }[]>(`
      SELECT CONVERT(char(10), order_date, 23) AS d, category, SUM(line_total) AS spend
      FROM smoothieking.pfg_compat
      WHERE ${pfgWin} AND category IS NOT NULL AND category <> ''
      GROUP BY CONVERT(char(10), order_date, 23), category`),
  })

  // ── vendor split ──
  const pfgTotal = Number(vendorRows[0]?.pfg) || 0
  const walmartTotal = Number(vendorRows[0]?.walmart) || 0

  // ── category spend ──
  const catTotal = catRows.reduce((a, r) => a + (Number(r.spend) || 0), 0)
  const categorySpend: CategorySpend[] = catRows.map(r => ({
    category: r.category, spend: Number(r.spend) || 0, lines: Number(r.lines) || 0,
    pct: catTotal > 0 ? (Number(r.spend) || 0) / catTotal : 0,
  }))

  // ── category by store ──
  const byCat = new Map<string, CategoryByStore>()
  for (const r of catStoreRows) {
    if (!byCat.has(r.category)) byCat.set(r.category, { category: r.category, pines: 0, miramar: 0, margate: 0 })
    const c = byCat.get(r.category)!, spend = Number(r.spend) || 0
    if (r.store_number === STORE_NUM.Pines) c.pines = spend
    else if (r.store_number === STORE_NUM.Miramar) c.miramar = spend
    else if (r.store_number === STORE_NUM.Margate) c.margate = spend
  }
  const categoryByStore = [...byCat.values()].sort((a, b) => (b.pines + b.miramar + b.margate) - (a.pines + a.miramar + a.margate))

  // ── top products (+ last price) ──
  const byItem = new Map<string, TopProductPriced>()
  for (const r of topRows) {
    if (!byItem.has(r.item_code)) byItem.set(r.item_code, {
      itemCode: r.item_code, description: r.description, brand: r.brand, category: r.category,
      spend: 0, qty: 0, pines: 0, miramar: 0, margate: 0,
      lastPrice: r.last_price != null ? Math.round(Number(r.last_price) * 100) / 100 : null,
      lastPriceDate: r.last_date ?? null,
    })
    const p = byItem.get(r.item_code)!, spend = Number(r.spend) || 0
    p.spend += spend; p.qty += Number(r.qty) || 0
    if (r.store_number === STORE_NUM.Pines) p.pines += spend
    else if (r.store_number === STORE_NUM.Miramar) p.miramar += spend
    else if (r.store_number === STORE_NUM.Margate) p.margate += spend
  }
  const allItems = [...byItem.values()]
  const topProducts = [...allItems].sort((a, b) => b.spend - a.spend).slice(0, 15)
  const topProductsByCategory: Record<string, TopProductPriced[]> = {}
  for (const p of allItems) {
    if (!p.category) continue
    ;(topProductsByCategory[p.category] ??= []).push(p)
  }
  for (const cat of Object.keys(topProductsByCategory)) {
    topProductsByCategory[cat] = topProductsByCategory[cat].sort((a, b) => b.spend - a.spend).slice(0, 8)
  }

  // ── brands / walmart categories ──
  const brandTotal = brandRows.reduce((a, r) => a + (Number(r.spend) || 0), 0)
  const pfgBrands: VendorBrand[] = brandRows.slice(0, 10).map(r => ({
    brand: r.brand, spend: Number(r.spend) || 0, pct: brandTotal > 0 ? (Number(r.spend) || 0) / brandTotal : 0,
  }))
  const walmartCategories = wmCatRows.map(r => ({ category: r.category, spend: Number(r.spend) || 0 }))

  // ── weekly trend: spend by vendor + cost % of sales ──
  const wk = new Map<string, { pfg: number; walmart: number; sales: number }>()
  const bump = (d: string, k: 'pfg' | 'walmart' | 'sales', v: number) => {
    const w = weekStart(d)
    if (!wk.has(w)) wk.set(w, { pfg: 0, walmart: 0, sales: 0 })
    wk.get(w)![k] += v
  }
  for (const r of pfgDaily) bump(r.d, 'pfg', Number(r.spend) || 0)
  for (const r of wmDaily) bump(r.d, 'walmart', Number(r.spend) || 0)
  for (const r of salesDaily) bump(r.d, 'sales', Number(r.net) || 0)
  const weeklyTrend: WeekPoint[] = [...wk.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([week, v]) => ({
    week, pfg: Math.round(v.pfg), walmart: Math.round(v.walmart), sales: Math.round(v.sales),
    costPct: v.sales > 0 ? Math.round((v.pfg + v.walmart) / v.sales * 1000) / 10 : 0,
  }))

  // ── category mix over time: top 6 categories by spend, weekly ──
  const topCats = categorySpend.slice(0, 6).map(c => c.category)
  const catWk = new Map<string, number>()   // `${week}|${cat}`
  for (const r of catDaily) {
    const cat = topCats.includes(r.category) ? r.category : 'Other'
    const key = `${weekStart(r.d)}|${cat}`
    catWk.set(key, (catWk.get(key) ?? 0) + (Number(r.spend) || 0))
  }
  const categoryTrend: CategoryWeekPoint[] = [...catWk.entries()]
    .map(([k, spend]) => { const [week, category] = k.split('|'); return { week, category, spend: Math.round(spend) } })
    .sort((a, b) => a.week < b.week ? -1 : a.week > b.week ? 1 : 0)

  // ── unit price over time for the top-8 items (catch distributor price hikes) ──
  let priceTrend: { itemCode: string; week: string; price: number }[] = []
  const priceCodes = topProducts.slice(0, 8).map(p => p.itemCode)
  if (priceCodes.length) {
    const inList = priceCodes.map(c => `'${q(c)}'`).join(',')
    const rows = await query<{ item_code: string; d: string; tot: number; qty: number }[]>(`
      SELECT item_code, CONVERT(char(10), order_date, 23) AS d, SUM(line_total) AS tot, SUM(qty_confirmed) AS qty
      FROM smoothieking.pfg_compat
      WHERE ${pfgWin} AND item_code IN (${inList}) AND qty_confirmed > 0
      GROUP BY item_code, CONVERT(char(10), order_date, 23)`)
    const agg = new Map<string, { tot: number; qty: number }>()
    for (const r of rows) {
      const k = `${r.item_code}|${weekStart(r.d)}`
      const a = agg.get(k) ?? { tot: 0, qty: 0 }
      a.tot += Number(r.tot) || 0; a.qty += Number(r.qty) || 0; agg.set(k, a)
    }
    priceTrend = [...agg.entries()]
      .map(([k, v]) => { const [itemCode, week] = k.split('|'); return { itemCode, week, price: v.qty > 0 ? Math.round(v.tot / v.qty * 100) / 100 : 0 } })
      .filter(x => x.price > 0)
      .sort((a, b) => a.week < b.week ? -1 : 1)
  }

  return {
    window: { start, end },
    refreshedAt: new Date().toISOString(),
    vendorSplit: { pfgTotal, walmartTotal },
    categorySpend, categoryByStore, topProducts, topProductsByCategory,
    pfgBrands, walmartCategories,
    monthlyTrend: [], weeklyTrend, categoryTrend, priceTrend,
  }
}
