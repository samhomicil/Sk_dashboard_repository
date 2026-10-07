import 'server-only'
import { query } from './db'
import { etToday, isoAdd } from './core/dates'
import { EE_CHECKS } from './core/sources'
import { displayName } from './menuMix'
import type { DaypartPayload, DaypartRow, WeekdayRow, DaypartCategoryRow, DaypartProductRow, EeRow } from './menuMixUtils'
export type { DaypartPayload }

/**
 * Day-part and weekday trends, live from Brink over the 13 weeks through yesterday.
 *
 * Was: data/menu-mix-daypart.json, a hand-refreshed Sigma export frozen at
 * 2026-04-11..07-10. Now the same lines and item groups as lib/menuMix.ts, bucketed by
 * the hour the check closed, using NetChef's day parts (Breakfast before 11:00, Lunch
 * 11–14, Snack 14–17, Dinner from 17:00). Weekday E&E is CrunchTime's (EE_CHECKS) over
 * the same 13 weeks, so every chart on the panel covers the same days.
 */

const WEEKS = 13
const STORES = ['pines', 'miramar', 'margate'] as const
type StoreKey = typeof STORES[number]
const DB_STORE: Record<StoreKey, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
const PAGE_CATEGORY: Record<string, string> = {
  Smoothies: 'Smoothies', 'Smoothie Bowls': 'Smoothie Bowls', Food: 'Food', Retail: 'Retail Products',
}
const DAYPARTS = ['Breakfast', 'Lunch', 'Snack', 'Dinner']
const TOP_PRODUCTS = 12

// 1900-01-07 was a Sunday, so this is 0 = Sun … 6 = Sat whatever DATEFIRST is set to.
const DOW = (col: string) => `DATEDIFF(day, '19000107', ${col}) % 7`

export async function getMenuMixDaypart(store: string): Promise<DaypartPayload | null> {
  const end = isoAdd(etToday(), -1), start = isoAdd(end, -7 * WEEKS + 1)
  const sf = store === 'all' ? '' : `AND s.store = '${DB_STORE[store as StoreKey]}'`
  const ef = store === 'all' ? '' : `AND store = '${DB_STORE[store as StoreKey]}'`
  const lines = `
    FROM smoothieking.sales s
    JOIN (SELECT item_name, MAX(category) AS category,
                 MAX(CASE WHEN item_groups LIKE '%Kids'' Cups%' THEN 1 ELSE 0 END) AS kids
            FROM smoothieking.menu_item_category GROUP BY item_name) c ON c.item_name = s.item_name
   WHERE s.voided = 0 AND s.is_modifier = 0 ${sf}
     AND c.category IN ('Smoothies', 'Smoothie Bowls', 'Food', 'Retail')
     AND CAST(s.closed_datetime AS DATE) BETWEEN '${start}' AND '${end}'`

  const [items, days, ee] = await Promise.all([
    query<{ dp: string; category: string; name: string; kids: number; qty: number; sales: number }[]>(`
      SELECT CASE WHEN DATEPART(hour, s.closed_datetime) < 11 THEN 'Breakfast'
                  WHEN DATEPART(hour, s.closed_datetime) < 14 THEN 'Lunch'
                  WHEN DATEPART(hour, s.closed_datetime) < 17 THEN 'Snack'
                  ELSE 'Dinner' END AS dp,
             c.category, s.item_name AS name, MAX(c.kids) AS kids, COUNT(*) AS qty, SUM(s.net_sales) AS sales
      ${lines}
      GROUP BY CASE WHEN DATEPART(hour, s.closed_datetime) < 11 THEN 'Breakfast'
                    WHEN DATEPART(hour, s.closed_datetime) < 14 THEN 'Lunch'
                    WHEN DATEPART(hour, s.closed_datetime) < 17 THEN 'Snack'
                    ELSE 'Dinner' END, c.category, s.item_name`),
    query<{ store: string; d: string; qty: number; sales: number }[]>(`
      SELECT LOWER(s.store) AS store, CONVERT(char(10), CAST(s.closed_datetime AS DATE), 23) AS d,
             COUNT(*) AS qty, SUM(s.net_sales) AS sales
      ${lines}
      GROUP BY LOWER(s.store), CAST(s.closed_datetime AS DATE)`),
    query<{ store: string; dow: number; sm: number; ee: number }[]>(`
      SELECT LOWER(store) AS store, ${DOW('business_date')} AS dow, SUM(smoothie_qty) AS sm, SUM(ee_qty) AS ee
        FROM ${EE_CHECKS}
       WHERE business_date BETWEEN '${start}' AND '${end}' ${ef}
       GROUP BY LOWER(store), ${DOW('business_date')}`).catch(() => []),
  ])
  if (!items.length) return null

  // Day parts, their category split and their top products.
  const daypart: DaypartRow[] = DAYPARTS.map(name => ({ name, sales: 0, qty: 0 }))
  const catMap = new Map<string, Map<string, DaypartCategoryRow>>()
  const prodMap = new Map<string, Map<string, DaypartProductRow>>()
  for (const r of items) {
    const subcategory = PAGE_CATEGORY[r.category]
    const dp = daypart.find(d => d.name === r.dp)
    if (!subcategory || !dp) continue
    const qty = Number(r.qty) || 0, sales = Number(r.sales) || 0
    dp.qty += qty; dp.sales += sales

    const cats = catMap.get(r.dp) ?? new Map<string, DaypartCategoryRow>()
    const c = cats.get(subcategory) ?? { subcategory, sales: 0, qty: 0 }
    c.qty += qty; c.sales += sales
    cats.set(subcategory, c); catMap.set(r.dp, cats)

    const product = displayName(r.name, Number(r.kids) === 1)
    const prods = prodMap.get(r.dp) ?? new Map<string, DaypartProductRow>()
    const p = prods.get(`${subcategory}||${product}`) ?? { subcategory, product, sales: 0, qty: 0 }
    p.qty += qty; p.sales += sales
    prods.set(`${subcategory}||${product}`, p); prodMap.set(r.dp, prods)
  }
  const bySales = <T extends { sales: number }>(a: T, b: T) => b.sales - a.sales
  const categories: Record<string, DaypartCategoryRow[]> = {}
  const products: Record<string, DaypartProductRow[]> = {}
  for (const name of DAYPARTS) {
    categories[name] = [...(catMap.get(name)?.values() ?? [])].sort(bySales)
    products[name] = [...(prodMap.get(name)?.values() ?? [])].sort(bySales).slice(0, TOP_PRODUCTS)
  }

  // Weekdays: totals and how many of each weekday had sales.
  const weekdayFor = (keys: readonly string[]): WeekdayRow[] => {
    const byDate = new Map<string, { qty: number; sales: number }>()
    for (const r of days) {
      if (!keys.includes(r.store)) continue
      const a = byDate.get(r.d) ?? { qty: 0, sales: 0 }
      a.qty += Number(r.qty) || 0; a.sales += Number(r.sales) || 0
      byDate.set(r.d, a)
    }
    const rows: WeekdayRow[] = Array.from({ length: 7 }, (_, dow) => ({ dow, sales: 0, qty: 0, days: 0 }))
    for (const [d, a] of byDate) {
      const w = rows[new Date(`${d}T12:00:00Z`).getUTCDay()]
      w.sales += a.sales; w.qty += a.qty; w.days += 1
    }
    return rows
  }
  const eeFor = (keys: readonly string[]): EeRow[] => Array.from({ length: 7 }, (_, dow) => {
    const hit = ee.filter(r => keys.includes(r.store) && Number(r.dow) === dow)
    return { dow, sm: hit.reduce((s, r) => s + (Number(r.sm) || 0), 0), ee: hit.reduce((s, r) => s + (Number(r.ee) || 0), 0) }
  })
  const keys = store === 'all' ? STORES : [store]

  const payload: DaypartPayload = {
    refreshedAt: new Date().toISOString(),
    windowStart: start,
    windowEnd: end,
    daypart, categories, products,
    weekday: weekdayFor(keys),
    ee: eeFor(keys),
  }
  if (store === 'all') {
    payload.weekdayByStore = { pines: weekdayFor(['pines']), miramar: weekdayFor(['miramar']), margate: weekdayFor(['margate']) }
    payload.eeByStore = { pines: eeFor(['pines']), miramar: eeFor(['miramar']), margate: eeFor(['margate']) }
  }
  return payload
}
