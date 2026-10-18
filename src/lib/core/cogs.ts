// Recipe COGS — the one place that turns theoretical usage into dollars.
//
// WHY THIS EXISTS. Every surface used to compute food cost as
// `SUM(qty_issue * price)` straight off netchef_usage_api. That was fine while the
// table held only weekly inventory periods. Since nightly HOT LIST counts started
// landing it also holds 1-day periods, and on those rows the price column is almost
// always empty:
//
//   grain     rows   qty_issue > 0 but price = 0
//   weekly     355                            19   (5%)
//   nightly   1921                          1510   (81%)
//
// The QUANTITIES on nightly rows are sound — checked per product against the weekly
// figure ÷ 7 and the median ratio is 1.00, and Cup-32OZ (used on every single order)
// tracks 0.11-0.57/day against a weekly 0.16-0.24/day. It is only the price that is
// missing. So a dollar figure built from nightly rows is roughly 35% low:
// $840/day against the weekly grain's $1,297/day.
//
// That produced two live errors at once:
//   * Weekly Ops showed a COGS% of 15-16% when the real rate is 24-27%, until it was
//     filtered to weekly-only periods — at which point it showed a rate from a period
//     that had ended 14 days earlier, with nothing on the page saying so.
//   * Budget summed both grains over eight weeks, so the nightly days contributed
//     their full sales to the denominator but a fraction of their cost to the
//     numerator, understating food cost %.
//
// There is a second, independent reason nightly rows cannot carry a cost rate: a skipped
// count line stores physical = 0, so `beginning + received - physical` reads as
// "everything on the shelf was consumed". That put actual COGS at 75.8% for Margate and
// 61.3% for Miramar against a theoretical 26.9% and 26.0%.
//
// So COGS is computed from FULL inventory periods only — those close on a real count, and
// their price column is populated on 95% of rows. Usage is still valued at the last known
// netchef_onhand.inventory_price (the price recipe costing already uses) rather than
// usage_api.price, which covers the remaining 5%.
//
// The consequence is accepted deliberately: the rate can be up to two weeks old — as of
// 2026-08-10 the newest full period ended Jul 27. A stale rate resting on a real count
// beats a fresh one resting on missing prices and blank count lines. That is only safe
// because every rate carries the window it was measured over; a COGS number without its
// date range is exactly how a fortnight-old figure gets read as today's.

import { query } from '../db'
import { NET_SALES } from './sources'
import { COST_OUTLIER_X, COST_HISTORY_DAYS } from './targets'

export interface CogsWindow {
  store: string
  /** inclusive window the rate was measured over */
  start: string
  end: string
  days: number
  cogs: number
  netSales: number
  rate: number
  /** products with usage we could not price — the rate is understated by their cost */
  unpriced: number
  /** always 'weekly' -- nightly periods cannot support a cost rate (see the header) */
  grain: 'weekly'
}

/**
 * Last known unit price per store+product. netchef_onhand is a daily snapshot carrying
 * inventory_price, so this is both fresher and far more complete than usage_api.price.
 *
 * NOTE that this makes a historical COGS rate re-value as prices move: Pines' Jul 21-27
 * rate read 24.22% against the Aug 9 price vintage and 24.78% against Aug 13, because
 * netchef-daily kept refreshing inventory_price in between. That is intended — the rate
 * answers "what does that week's usage cost at today's prices" — but it does mean a
 * figure quoted last week will not reproduce exactly this week.
 *
 * It also means ONE bad price rewrites every past period, so a price that is an entry
 * error is skipped in favour of that store's last price that wasn't (see targets.ts
 * COST_OUTLIER_X for the Oct 13 Miramar case). The test is a majority of independent
 * readings of the same product: each other store's latest price, and the store's own
 * price four weeks before its latest. A price more than COST_OUTLIER_X from MOST of
 * those readings is refused. Majority, not "every other store", because with only one
 * other store carrying a product there is no telling which of the two is wrong — the
 * store's own history breaks the tie — and once a bad price has stood for four weeks
 * the two other stores still outvote it. Fewer than two readings: taken as is.
 *
 * Use as `WITH ${PRICE_CTE}` and join `px ... AND px.rn = 1`. Every reader of
 * inventory_price goes through this so the Overview, Weekly Ops, Budget and the order
 * guide cannot price the same product differently.
 */
export const PRICE_CTE = `
  px_all AS (
    SELECT store, product_number, inventory_price, as_of,
           ROW_NUMBER() OVER (PARTITION BY store, product_number ORDER BY as_of DESC) rn
    FROM smoothieking.netchef_onhand
    WHERE inventory_price > 0),
  px_read AS (
    SELECT a.store, a.product_number, b.inventory_price v
      FROM px_all a
      JOIN px_all b ON b.product_number = a.product_number AND b.store <> a.store AND b.rn = 1
     WHERE a.rn = 1
    UNION ALL
    SELECT a.store, a.product_number, h.inventory_price
      FROM px_all a
     CROSS APPLY (SELECT TOP 1 inventory_price FROM px_all x
                   WHERE x.store = a.store AND x.product_number = a.product_number
                     AND x.as_of <= DATEADD(day, -${COST_HISTORY_DAYS}, a.as_of)
                   ORDER BY x.as_of DESC) h
     WHERE a.rn = 1),
  px_chk AS (
    SELECT p.store, p.product_number, p.as_of, p.inventory_price, COUNT(r.v) n,
           SUM(CASE WHEN p.inventory_price > r.v * ${COST_OUTLIER_X}
                      OR p.inventory_price * ${COST_OUTLIER_X} < r.v THEN 1 ELSE 0 END) n_off
      FROM px_all p
      LEFT JOIN px_read r ON r.store = p.store AND r.product_number = p.product_number
     GROUP BY p.store, p.product_number, p.as_of, p.inventory_price),
  px AS (
    SELECT store, product_number, inventory_price,
           ROW_NUMBER() OVER (PARTITION BY store, product_number ORDER BY as_of DESC) rn
      FROM px_chk
     WHERE n < 2 OR 2 * n_off <= n)`

/**
 * CrunchTime's own theoretical cost per menu item per day (netchef_recipe_daily), with
 * the same majority test applied to the item's unit cost. The readings are each other
 * store's pooled cost for the item from four weeks before `start` through `end`, and the
 * store's own over the four weeks before `start`; a day more than COST_OUTLIER_X from
 * most of them is re-costed at their median. The four-week lead matters for slow sellers:
 * the Cocoa Pitaya bowl sells about once a fortnight per store, so a 7-day window alone
 * often has no other store to compare it with. From Oct 12 2026 CrunchTime costed Miramar's bowls at ~$98 against $3.60,
 * because its strawberry price had jumped to $634.88/LB; Go Coconuts, sold only at
 * Miramar and Margate, is why the own-history reading exists — against Miramar alone,
 * Margate's correct $3.54 looked 28× too low.
 *
 * A $0 cost is left alone: that is a recipe CrunchTime had not costed yet (bananas and
 * chia through January), not a wrong one, and filling it in would move numbers that
 * match CrunchTime's own report. Rows without a PLU (retail matched on name) have no
 * counterpart to compare with and pass through.
 *
 * Returns CTE text: use as `WITH ${recipeCostCtes(start, end)} SELECT ... FROM rc`.
 * rc has one row per store, business_date, plu and product_number, with `cost` already
 * guarded and `raw_cost` as CrunchTime reported it.
 */
export function recipeCostCtes(start: string, end: string): string {
  const X = COST_OUTLIER_X
  const pooled = (where: string) => `
    SELECT store, plu, product_number, SUM(cost) cost, SUM(qty) qty
      FROM smoothieking.netchef_recipe_daily
     WHERE ${where} AND plu IS NOT NULL
     GROUP BY store, plu, product_number`
  const key = (a: string, b: string) =>
    `${b}.store = ${a}.store AND ${b}.plu = ${a}.plu AND ${b}.product_number = ${a}.product_number`
  return `
  rw AS (${pooled(`business_date BETWEEN DATEADD(day, -${COST_HISTORY_DAYS}, '${start}') AND '${end}'`)}),
  rprior AS (${pooled(`business_date >= DATEADD(day, -${COST_HISTORY_DAYS}, '${start}') AND business_date < '${start}'`)}),
  rread AS (
    SELECT a.store, a.plu, a.product_number, b.cost / b.qty v
      FROM rw a
      JOIN rw b ON b.plu = a.plu AND b.product_number = a.product_number AND b.store <> a.store
     WHERE b.cost <> 0
    UNION ALL
    SELECT store, plu, product_number, cost / qty FROM rprior WHERE cost <> 0),
  rstat AS (
    SELECT store, plu, product_number, COUNT(*) n,
           CASE COUNT(*) WHEN 1 THEN SUM(v) WHEN 2 THEN SUM(v) / 2
                ELSE SUM(v) - MIN(v) - MAX(v) END mid
      FROM rread GROUP BY store, plu, product_number),
  rflag AS (
    SELECT d.store, d.business_date, d.plu, d.product_number,
           SUM(CASE WHEN ABS(d.cost) / d.qty > ${X} * ABS(r.v)
                      OR ABS(d.cost) / d.qty * ${X} < ABS(r.v) THEN 1 ELSE 0 END) n_off
      FROM smoothieking.netchef_recipe_daily d
      JOIN rread r ON ${key('d', 'r')}
     WHERE d.business_date BETWEEN '${start}' AND '${end}' AND d.cost <> 0
     GROUP BY d.store, d.business_date, d.plu, d.product_number),
  rc AS (
    SELECT d.store, d.business_date, d.plu, d.product_number, d.recipe_name, d.qty, d.sales,
           d.cost AS raw_cost,
           CASE WHEN s.n >= 2 AND 2 * f.n_off > s.n THEN d.qty * s.mid ELSE d.cost END AS cost
      FROM smoothieking.netchef_recipe_daily d
      LEFT JOIN rstat s ON ${key('d', 's')}
      LEFT JOIN rflag f ON ${key('d', 'f')} AND f.business_date = d.business_date
     WHERE d.business_date BETWEEN '${start}' AND '${end}')`
}

/**
 * The trailing series of FULL inventory periods, for the multi-week average that
 * derives the target. Deliberately weekly-only: a single night averaged in as if it
 * were a week drags the target toward whatever that one night looked like.
 * Priced the same way, so a period whose usage_api.price is blank still costs out.
 */
export async function cogsWeeklySeries(sinceWeeks = 8): Promise<CogsWindow[]> {
  const rows = await query<{ store: string; ps: string; pe: string; cogs: number; unpriced: number }[]>(`
    WITH ${PRICE_CTE}
    SELECT u.store,
           CONVERT(char(10), u.period_start, 23) ps,
           CONVERT(char(10), u.period_end, 23) pe,
           SUM(u.qty_issue * COALESCE(px.inventory_price, u.price, 0)) cogs,
           SUM(CASE WHEN px.inventory_price IS NULL AND ISNULL(u.price,0) = 0 AND u.qty_issue > 0 THEN 1 ELSE 0 END) unpriced
    FROM smoothieking.netchef_usage_api u
    LEFT JOIN px ON px.store = u.store AND px.product_number = u.product_number AND px.rn = 1
    WHERE u.period_start <> u.period_end
      AND u.period_end >= DATEADD(week, -${sinceWeeks}, (SELECT MAX(period_end) FROM smoothieking.netchef_usage_api))
    GROUP BY u.store, u.period_start, u.period_end`)

  if (!rows.length) return []

  // Sales for every period in ONE round trip. This used to be a query per store-week
  // inside the loop — 21 of them in an 8-week window, sequential, and paid twice over
  // because /api/ops-week and /api/budget both call this. Pairing sales to each period
  // is still essential (netchef_usage_api has gaps, so a MIN..MAX span over-counts the
  // denominator), it just doesn't need a round trip each.
  const spans = [...new Set(rows.map(r => `${r.ps}|${r.pe}`))].map(s => s.split('|'))
  const salesRows = await query<{ store: string; ps: string; pe: string; net: number }[]>(
    spans.map(([ps, pe]) => `
      SELECT store, '${ps}' ps, '${pe}' pe, ${NET_SALES} net FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) BETWEEN '${ps}' AND '${pe}' GROUP BY store`
    ).join('\nUNION ALL\n'))
  const netBy = new Map(salesRows.map(s => [`${s.store}|${s.ps}|${s.pe}`, Number(s.net) || 0]))

  const out: CogsWindow[] = []
  for (const r of rows) {
    const n = netBy.get(`${r.store}|${r.ps}|${r.pe}`) ?? 0
    const cogs = Number(r.cogs) || 0
    const days = Math.round((Date.parse(r.pe + 'T12:00:00Z') - Date.parse(r.ps + 'T12:00:00Z')) / 86400000) + 1
    out.push({
      store: r.store, start: r.ps, end: r.pe, days,
      cogs: Math.round(cogs * 100) / 100,
      netSales: Math.round(n * 100) / 100,
      rate: n > 0 ? cogs / n : 0,
      unpriced: Number(r.unpriced) || 0,
      grain: 'weekly',
    })
  }
  return out.sort((a, b) => a.store.localeCompare(b.store) || a.end.localeCompare(b.end))
}
