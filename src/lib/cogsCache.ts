/**
 * Recipe COGS % from NetChef — weekly-count-grained. This is the LIVE source for the
 * Overview's COGS %; Sigma is gone.
 *
 * NetChef `netchef_usage_api` is per store, per inventory count week:
 *   theoretical $ = SUM(qty_issue * price)                              (recipe usage)
 *   actual      $ = SUM((qty_beginning + qty_received - qty_physical) * price)
 * COGS % = that $ / net sales over the same count week(s).
 *
 * `qty_issue * price` here is the same expression /api/ops-week uses for its trailing
 * 8-week COGS, so the Overview and Weekly Ops cannot disagree about the method — only
 * about the window each one asks for.
 *
 * (Superseded warning: an earlier header said "NOT WIRED IN YET / only ONE week".
 * Both are false — `sqlCogsPct` is imported by api/kpis and cache-builder, and the
 * table holds ~30 weeks. Don't reintroduce a Sigma fallback on that basis.)
 */
import 'server-only'
import { query } from './db'
import type { Store } from './types'
import { sqlSales } from './salesCache'

type CogsWeek = { store: string; start: string; end: string; theo: number; actual: number }

let _weeks: CogsWeek[] | null = null
let _loading: Promise<void> | null = null
const n = (v: unknown) => Number(v) || 0

export async function loadCogsCache(): Promise<void> {
  if (_weeks) return
  if (_loading) return _loading
  _loading = (async () => {
    const rows = await query<{ store: string; start: string; end: string; theo: number; actual: number }[]>(
      `SELECT LOWER(store) AS store,
              CONVERT(char(10), period_start, 23) AS start,
              CONVERT(char(10), period_end, 23)   AS [end],
              SUM(qty_issue * price) AS theo,
              SUM((qty_beginning + qty_received - qty_physical) * price) AS actual
         FROM smoothieking.netchef_usage_api
        GROUP BY LOWER(store), CONVERT(char(10), period_start, 23), CONVERT(char(10), period_end, 23)`,
    )
    _weeks = rows.map(r => ({ store: r.store, start: r.start, end: r.end, theo: n(r.theo), actual: n(r.actual) }))
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

  return {
    actualPct: actual > 0 && sales > 0 ? actual / sales : null,
    theoreticalPct: theo > 0 && sales > 0 ? theo / sales : null,
    asOf: a,
  }
}
