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
 */
const PRICE_CTE = `
  px AS (
    SELECT store, product_number, inventory_price,
           ROW_NUMBER() OVER (PARTITION BY store, product_number ORDER BY as_of DESC) rn
    FROM smoothieking.netchef_onhand
    WHERE inventory_price > 0)`

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
