import { query } from './db'
import { holidayName, priorYearHoliday } from './holiday'
import { HOLIDAY_FACTOR_CLAMP } from './core/targets'
import { isoAdd } from './core/dates'
import { NET_SALES } from './core/sources'

/**
 * How each store traded on last year's version of a holiday — the one place Weekly Ops and
 * the schedule builder read it from.
 *
 *   factor   last-year holiday net ÷ the same weekday's surrounding baseline (4 weeks
 *            before, 2 after), clamped to HOLIDAY_FACTOR_CLAMP — identical to the daily
 *            recap. null when last year has no usable comparison.
 *   closed   last year's holiday had NO sales: the store was shut (Thanksgiving and
 *            Christmas Day 2025, all three stores). Weekly Ops ignores this field and keeps
 *            its existing forecast; the schedule builder plans no shifts on such a day.
 *   hours    last year's first and last sale (minutes), for short-hour holidays
 *            (Christmas Eve, New Year's Eve/Day).
 * Only days on or after `from` are looked up: finished days use real sales, no factor.
 */
export type HolidayPlan = { date: string; name: string; factor: number | null; closed: boolean; hours: [number, number] | null }

type Row = { store: string; d: string; net: number; f: string | null; l: string | null }
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export async function holidayPlans(storeNames: string[], dates: string[], from: string): Promise<Map<string, HolidayPlan>> {
  const out = new Map<string, HolidayPlan>()            // `${store}|${date}`
  for (const d of dates) {
    if (d < from) continue
    const name = holidayName(d)
    if (!name) continue
    const { date: hly } = priorYearHoliday(d)
    if (!hly) { for (const s of storeNames) out.set(`${s}|${d}`, { date: d, name, factor: null, closed: false, hours: null }); continue }
    const baseDates = [-4, -3, -2, -1, 1, 2].map(k => isoAdd(hly, 7 * k))
    const need = [hly, ...baseDates].map(x => `'${x}'`).join(', ')
    let rows: Row[] = []
    try {
      rows = await query<Row[]>(`
        SELECT store, CONVERT(char(10), closed_datetime, 23) d, ${NET_SALES} net,
               MIN(CONVERT(char(5), closed_datetime, 108)) f, MAX(CONVERT(char(5), closed_datetime, 108)) l
          FROM smoothieking.sales WHERE CONVERT(date, closed_datetime) IN (${need})
         GROUP BY store, CONVERT(char(10), closed_datetime, 23)`)
    } catch { rows = [] }
    for (const s of storeNames) {
      const g = new Map(rows.filter(r => r.store === s).map(r => [r.d, r]))
      const hv = Number(g.get(hly)?.net ?? 0)
      const base = baseDates.map(x => Number(g.get(x)?.net ?? 0)).filter(v => v > 0)
      const factor = hv > 0 && base.length >= 3
        ? Math.max(HOLIDAY_FACTOR_CLAMP[0], Math.min(HOLIDAY_FACTOR_CLAMP[1], hv / (base.reduce((a, b) => a + b, 0) / base.length)))
        : null
      // closed = the store traded the weeks around it but not the holiday itself
      const closed = hv <= 0 && base.length >= 3
      const r = g.get(hly)
      out.set(`${s}|${d}`, { date: d, name, factor, closed, hours: r?.f && r?.l && hv > 0 ? [hm(r.f), hm(r.l)] : null })
    }
  }
  return out
}
