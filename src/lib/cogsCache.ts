/**
 * Recipe COGS % from NetChef — WEEKLY-count-grained only. This is the LIVE source for
 * the Overview's COGS %; Sigma is gone.
 *
 * NIGHTLY periods are excluded on purpose. netchef_usage_api began carrying 1-day rows
 * when the HOT LIST counts started, and they cannot support a cost rate:
 *   * price is empty on 81% of them (1510 of 1921 rows with real usage), so
 *     qty_issue * price read 15-16% against a true 24-27%;
 *   * a skipped count line stores physical = 0, so beginning + received - physical reads
 *     as "everything was consumed" -- Margate came out at 75.8%, Miramar 61.3%.
 * COGS is therefore only computed from full inventory periods, which close on a real
 * count. That makes the rate up to two weeks old, so the window it was measured over is
 * returned and MUST be displayed with it.
 *
 * NetChef `netchef_usage_api`, per store per inventory count week:
 *   theoretical $ = Σ(qty_issue × unit price)                           (recipe usage)
 *   actual      $ = Σ((beginning + received − ending physical) × unit price)
 * COGS % = that $ ÷ net sales over the same count week(s).
 *
 * The unit price is the last known netchef_onhand.inventory_price, NOT the row's own
 * price column — the same rule as src/lib/core/cogs.ts, which /api/ops-week and
 * /api/budget both use. So the Overview, Weekly Ops and Budget cannot disagree about the
 * method, only about the window each asks for. Verified 2026-08-10: all three report
 * 24.2% / 25.4% / 26.6% for Jul 21-27.
 *
 * REACHING THE OVERVIEW. /api/kpis serves standard periods (weekly/monthly/quarterly/ytd)
 * from smoothieking.dashboard_cache, NOT from this function — only a `custom` range calls
 * it live. So changing anything here does nothing to the Overview until the cache is
 * rebuilt by /api/refresh, the 6am dash-refresh job, or `npm run refresh:proxy`. That gap
 * is why the Overview still showed a 4.9% actual / 15.8% theoretical COGS after the
 * weekly-only fix shipped: the 06:31 job had baked the pre-fix numbers in.
 *
 * (Superseded warning: an earlier header said "NOT WIRED IN YET / only ONE week".
 * Both are false — `sqlCogsPct` is imported by api/kpis and cache-builder, and the
 * table holds ~30 weeks. Don't reintroduce a Sigma fallback on that basis.)
 */
import 'server-only'
import { query } from './db'
import type { Store } from './types'
import { sqlSales } from './salesCache'
import { INVENTORY_PERIOD_MIN_DAYS } from './core/targets'

type CogsWeek = {
  store: string; start: string; end: string; theo: number; actual: number
  /** true when period_start = period_end, i.e. a nightly count rather than a full inventory */
  nightly: boolean
  /** span in days, inclusive. Short periods cannot carry an actual COGS — see below. */
  days: number
}

let _weeks: CogsWeek[] | null = null
let _loading: Promise<void> | null = null
const n = (v: unknown) => Number(v) || 0

export async function loadCogsCache(): Promise<void> {
  if (_weeks) return
  if (_loading) return _loading
  _loading = (async () => {
    // Usage is valued at the last known netchef_onhand.inventory_price, falling back to
    // the row's own price. netchef_usage_api.price is empty on 81% of the nightly rows
    // (1510 of 1921 that carry real usage), and since nightly periods are now the most
    // recent ones, `qty_issue * price` made the Overview's COGS % read far too low —
    // 15-16% against a true 24-27%. Quantities on those rows are sound; only the price
    // is missing. Same rule as src/lib/core/cogs.ts, so the Overview, Weekly Ops and
    // Budget cannot disagree about how a dollar of food cost is derived.
    const rows = await query<{ store: string; start: string; end: string; theo: number; actual: number; nightly: number; days: number }[]>(
      `WITH px AS (
         SELECT store, product_number, inventory_price,
                ROW_NUMBER() OVER (PARTITION BY store, product_number ORDER BY as_of DESC) rn
         FROM smoothieking.netchef_onhand
         WHERE inventory_price > 0)
       SELECT LOWER(u.store) AS store,
              CONVERT(char(10), u.period_start, 23) AS start,
              CONVERT(char(10), u.period_end, 23)   AS [end],
              SUM(u.qty_issue * COALESCE(px.inventory_price, u.price, 0)) AS theo,
              SUM((u.qty_beginning + u.qty_received - u.qty_physical)
                  * COALESCE(px.inventory_price, u.price, 0)) AS actual,
              MAX(CASE WHEN u.period_start = u.period_end THEN 1 ELSE 0 END) AS nightly,
              DATEDIFF(day, MIN(u.period_start), MIN(u.period_end)) + 1 AS days
         FROM smoothieking.netchef_usage_api u
         LEFT JOIN px ON px.store = u.store AND px.product_number = u.product_number AND px.rn = 1
        WHERE u.period_start <> u.period_end
        GROUP BY LOWER(u.store), CONVERT(char(10), u.period_start, 23), CONVERT(char(10), u.period_end, 23)`,
    )
    _weeks = rows.map(r => ({
      store: r.store, start: r.start, end: r.end,
      theo: n(r.theo), actual: n(r.actual), nightly: n(r.nightly) === 1, days: n(r.days),
    }))
  })()
  await _loading
  _loading = null
}

const weeks = () => _weeks ?? []
const matchesStore = (rowStore: string, store: Store) => (store === 'all' ? true : rowStore === store)

function asOf(store: Store): string | null {
  let m = ''
  for (const w of weeks()) if (matchesStore(w.store, store) && w.end > m) m = w.end
  return m || null
}

/** Same contract as sigmaCogsPct: COGS % over the count week(s) in [start,end]. */
export function sqlCogsPct(store: Store, start: string, end: string): {
  actualPct: number | null; theoreticalPct: number | null; asOf: string | null
} {
  const a = asOf(store)
  if (!a) return { actualPct: null, theoreticalPct: null, asOf: null }
  const clampEnd = end > a ? a : end

  // count weeks whose period_end falls inside the period; else fall back to the
  // most recent complete count week on or before the period end (mirrors sigmaCogsPct).
  let matched = weeks().filter(w => matchesStore(w.store, store) && w.end >= start && w.end <= clampEnd)
  if (!matched.length) {
    const prior = weeks().filter(w => matchesStore(w.store, store) && w.end <= clampEnd)
    const lastEnd = prior.reduce((m, w) => (w.end > m ? w.end : m), '')
    if (lastEnd) matched = weeks().filter(w => matchesStore(w.store, store) && w.end === lastEnd)
  }
  if (!matched.length) return { actualPct: null, theoreticalPct: null, asOf: a }

  let theo = 0, actual = 0
  for (const w of matched) { theo += w.theo; actual += w.actual }
  // sales once per distinct week span (avoids double-counting when store='all').
  let sales = 0
  const seen = new Set<string>()
  for (const w of matched) {
    const k = `${w.start}|${w.end}`
    if (seen.has(k)) continue
    seen.add(k)
    sales += sqlSales(store, w.start, w.end).net_sales
  }

  // A short period cannot carry an ACTUAL cost of goods: a delivery landing inside a
  // 2-day window is counted as received but not yet used, so (beginning + received −
  // physical) comes out enormous against two days of sales. Theoretical is unaffected,
  // because recipe usage scales with sales over any window.
  const anyNightly = matched.some(w => w.nightly)
  const anyShort   = matched.some(w => w.days < INVENTORY_PERIOD_MIN_DAYS)
  return {
    actualPct: !anyNightly && !anyShort && actual > 0 && sales > 0 ? actual / sales : null,
    theoreticalPct: theo > 0 && sales > 0 ? theo / sales : null,
    asOf: a,
  }
}
