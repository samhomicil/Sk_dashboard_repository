// Usage window — how much of an item actually leaves the shelf per day.
//
// WHY THIS EXISTS. The order guide used to read:
//
//   WHERE period_end = (SELECT MAX(period_end) FROM smoothieking.netchef_usage_api)
//
// That was correct while netchef_usage_api held only 7-day inventory periods. Once
// nightly HOT LIST counts started landing, MAX(period_end) began resolving to a
// ONE-DAY period (2026-08-07, period_start = period_end) while the code kept calling
// the result `weeklyUsage`. Every forecast was then built from a single night.
//
// It did not self-correct. `factorFor` scales usage by trailing-4wk sales ÷ sales in
// the usage window, which for a one-day window is ~5-8x and would have rescued it —
// but the factor is clamped to [0.5, 2]. Measured 2026-08-09, every store pinned the
// clamp at 2.00 against true ratios of 4.47-7.70, so demand came out at roughly
// 2/7ths of real. Fixing the window is what makes that clamp meaningful again.
//
// The fix is NOT to look for the last weekly period either: the newest weekly row in
// netchef_usage_api was 13 days stale at the time of writing. Instead, sum whatever
// one-day periods exist in the trailing window and divide by how many were actually
// present, so the rate is per-day and honest about its sample size.

import { query } from '../db'

/** Days of nightly history to average over. */
export const USAGE_WINDOW_DAYS = 7
/**
 * Nights of usable count history required before a count-derived rate is trusted for
 * ORDERING. Four nights of nightly counts is far too noisy to size a 7-day Margate
 * order from: Margate banana came out at 2.24 cases/day against a recipe figure of
 * 0.98, which pooled into a 30-case, $653 banana order. Until there is a real week of
 * counts the recipe rate is the safer basis, and it is also what the daily alert uses,
 * so the two surfaces agree by construction rather than by luck.
 */
export const USAGE_MIN_NIGHTS = 5

/**
 * How far above the recipe rate a count-derived rate may run before we stop believing
 * it for ordering. Real usage legitimately exceeds recipe (waste, over-pour, unrecorded
 * transfers), so this is deliberately loose — but past 2x on an item we already know has
 * unreliable counts, over-ordering is the more expensive error. The uncapped figure is
 * still reported so the shrink surface can chase the gap.
 */
export const COUNT_RATE_CAP = 2.0

export interface UsageLine {
  store: string
  productNumber: string
  /** recipe-derived (BOM x menu mix) usage per day */
  theoreticalDaily: number
  /** count-derived usage per day: beginning + received - physical, blank nights EXCLUDED */
  countDaily: number | null
  /** the rate to forecast with */
  daily: number
  basis: 'count' | 'theoretical'
  /** nights that contributed to countDaily */
  countNights: number
  /** nights that contributed to theoreticalDaily */
  nights: number
  provisional: boolean
}

interface Row {
  store: string; product_number: string; period_end: string
  qty_beginning: number; qty_received: number; qty_physical: number; qty_issue: number
}

// Walmart local buys are never entered in NetChef (proven gap), so they are missing from
// qty_received. Left uncorrected, the stock shows up in the closing count with no matching
// receipt and `beginning + received - physical` understates what was actually consumed.
// Category -> NetChef product + inventory units per Walmart unit (size is in the name).
const WALMART_TO_NETCHEF: Record<string, { pn: string; unitsPerBuy: number }> = {
  'CORE STRAWBERRIES': { pn: 'P1480', unitsPerBuy: 1.0 },    // Fresh Strawberries, 1 lb
  'BLUEBERRIES':       { pn: 'P1011', unitsPerBuy: 1.125 },  // Fresh Blueberries, 18 oz
}
const STORE_NAMES = ['Pines', 'Miramar', 'Margate']

async function walmartReceipts(since: string, through: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const cats = Object.keys(WALMART_TO_NETCHEF).map(c => `'${c}'`).join(',')
  const rows = await query<{ email: string; cat: string; qty: number }[]>(`
    SELECT account_user_email email, walmart_category cat, SUM(item_received_qty) qty
    FROM smoothieking.walmart_spend
    WHERE order_date BETWEEN '${since}' AND '${through}'
      AND walmart_category IN (${cats}) AND item_received_qty > 0
    GROUP BY account_user_email, walmart_category`).catch(() => [])
  for (const r of rows) {
    const store = STORE_NAMES.find(s => (r.email || '').toLowerCase().includes(s.toLowerCase()))
    const m = WALMART_TO_NETCHEF[r.cat]
    if (store && m) {
      const k = `${store}|${m.pn}`
      out.set(k, (out.get(k) ?? 0) + (Number(r.qty) || 0) * m.unitsPerBuy)
    }
  }
  return out
}

/**
 * Per-day usage for every product with nightly rows in the trailing window.
 *
 * Count-derived usage is preferred where it exists, because it contains waste,
 * over-pouring and spillage that a recipe never will. But a night whose count was
 * left blank contributes NOTHING — including it is what turned a skipped flatbread
 * line into 72 units of phantom consumption. Nights where the count is present on
 * both ends of the delta are the only ones that can carry a count-based rate.
 */
export async function buildUsage(since: string, through: string): Promise<UsageLine[]> {
  const [rows, wmRecv] = await Promise.all([
    query<Row[]>(`
    SELECT store, product_number, CONVERT(char(10), period_end, 23) period_end,
           qty_beginning, qty_received, qty_physical, qty_issue
    FROM smoothieking.netchef_usage_api
    WHERE period_start = period_end
      AND period_end >= '${since}' AND period_end <= '${through}'`),
    walmartReceipts(since, through),
  ])

  const byKey = new Map<string, Row[]>()
  for (const r of rows) {
    const k = `${r.store}|${r.product_number}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(r)
  }

  const out: UsageLine[] = []
  for (const [key, listRaw] of byKey) {
    const list = [...listRaw].sort((a, b) => a.period_end.localeCompare(b.period_end))
    const [store, pn] = key.split('|')

    const theo: number[] = []
    const counted: number[] = []
    const wmTotal = wmRecv.get(key) ?? 0
    const usableNights = list.filter(r => (Number(r.qty_physical) || 0) > 0 && (Number(r.qty_beginning) || 0) > 0).length
    const wmPerNight = usableNights > 0 ? wmTotal / usableNights : 0
    for (const r of list) {
      const issue = Number(r.qty_issue) || 0
      if (issue > 0) theo.push(issue)
      const begin = Number(r.qty_beginning) || 0
      const recv = Number(r.qty_received) || 0
      const phys = Number(r.qty_physical) || 0
      // Only a night with a real closing count can produce a count-based delta.
      // A blank line stores 0, which would read as "consumed everything".
      if (phys > 0 && begin > 0) {
        const used = begin + recv + wmPerNight - phys
        if (used > 0) counted.push(used)
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    const theoreticalDaily = theo.length ? round2(mean(theo)) : 0
    const countDaily = counted.length >= USAGE_MIN_NIGHTS ? round2(mean(counted)) : null

    const useCount = countDaily != null && countDaily > 0
    const capped = useCount && theoreticalDaily > 0
      ? Math.min(countDaily!, theoreticalDaily * COUNT_RATE_CAP)
      : (useCount ? countDaily! : theoreticalDaily)
    out.push({
      store, productNumber: pn,
      theoreticalDaily,
      countDaily,
      daily: round2(capped),
      basis: useCount ? 'count' : 'theoretical',
      countNights: counted.length,
      nights: theo.length,
      provisional: (useCount ? counted.length : theo.length) < USAGE_MIN_NIGHTS,
    })
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100
