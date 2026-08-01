/**
 * Live heatmap from smoothieking.sales — the SQL replacement for sigma.ts's
 * sigmaHeatmap / sigmaHeatmapWeekly / *Window (Phase 2 of removing Sigma). Ports
 * the exact logic of src/scripts/sql_ee_heatmap.py (which already generates the
 * heatmap JSON from SQL), so numbers are identical:
 *   units = non-modifier item rows (excl '%add note%' / '%substitut%'), voided=0
 *   dow   = Sunday=0 .. Saturday=6, computed DATEFIRST-independently
 *   daily = ~90-day (yesterday-89 .. yesterday) average per (dow,hour) over the
 *           number of dates that had that slot; weekly = last full Mon-Sun actual.
 * Same sync API + HeatCell shape as sigma.ts. Call `await loadHeatmapCache()` first.
 */
import 'server-only'
import { query } from './db'
import type { Store } from './types'
// Type formerly in sigma.ts (kept the name to avoid churn; sigma.ts is being removed).
export interface HeatCell { hourNum: number; day: number; uplh: number; rawUnits: number; staff: number }

type DailyCell = { store: string; dow: number; hour: number; days: number; avg_units: number }
type WeeklyCell = { store: string; dow: number; hour: number; units: number }

let _daily: DailyCell[] | null = null
let _weekly: WeeklyCell[] | null = null
let _win: { start: string; end: string } | null = null
let _wwin: { start: string; end: string } | null = null
let _loading: Promise<void> | null = null

const n = (v: unknown) => Number(v) || 0
const iso = (d: Date) => d.toISOString().slice(0, 10)
const STAFF = 2
// Sunday=0 .. Saturday=6, independent of session DATEFIRST (1900-01-07 was a Sunday).
const DOW = `(DATEDIFF(day,'19000107',closed_datetime)%7)`
const UNITS = `SUM(CASE WHEN is_modifier=0 AND item_name NOT LIKE '%add note%' AND item_name NOT LIKE '%substitut%' THEN 1 ELSE 0 END)`

function windows(today = new Date()) {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const end = new Date(t); end.setUTCDate(end.getUTCDate() - 1)          // yesterday
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 89) // ~90-day window
  const mondayOffset = (t.getUTCDay() + 6) % 7                            // Mon=0
  const monday = new Date(t); monday.setUTCDate(monday.getUTCDate() - mondayOffset)
  const ws = new Date(monday); ws.setUTCDate(ws.getUTCDate() - 7)         // last full week
  const we = new Date(ws); we.setUTCDate(we.getUTCDate() + 6)
  return { start: iso(start), end: iso(end), ws: iso(ws), we: iso(we) }
}

export async function loadHeatmapCache(): Promise<void> {
  if (_daily && _weekly) return
  if (_loading) return _loading
  _loading = (async () => {
    const w = windows()
    _win = { start: w.start, end: w.end }
    _wwin = { start: w.ws, end: w.we }
    const [daily, weekly] = await Promise.all([
      query<{ store: string; dow: number; hour: number; units: number }[]>(`
        SELECT LOWER(store) AS store, ${DOW} AS dow, DATEPART(hour, closed_datetime) AS hour,
               CONVERT(char(10), closed_datetime, 23) AS d, ${UNITS} AS units
          FROM smoothieking.sales
         WHERE voided=0 AND CONVERT(date, closed_datetime) BETWEEN '${w.start}' AND '${w.end}'
         GROUP BY LOWER(store), ${DOW}, DATEPART(hour, closed_datetime), CONVERT(char(10), closed_datetime, 23)`),
      query<{ store: string; dow: number; hour: number; units: number }[]>(`
        SELECT LOWER(store) AS store, ${DOW} AS dow, DATEPART(hour, closed_datetime) AS hour, ${UNITS} AS units
          FROM smoothieking.sales
         WHERE voided=0 AND CONVERT(date, closed_datetime) BETWEEN '${w.ws}' AND '${w.we}'
         GROUP BY LOWER(store), ${DOW}, DATEPART(hour, closed_datetime)`),
    ])
    // aggregate the per-date daily rows into a per-(store,dow,hour) average over the
    // number of dates that had the slot (mirrors sql_ee_heatmap.gen_heatmap_daily).
    const agg = new Map<string, { units: number; days: number }>()
    for (const r of daily) {
      const k = `${r.store}|${r.dow}|${r.hour}`
      const a = agg.get(k) ?? { units: 0, days: 0 }
      a.units += n(r.units); a.days += 1
      agg.set(k, a)
    }
    _daily = [...agg.entries()].map(([k, v]) => {
      const [store, dow, hour] = k.split('|')
      return { store, dow: +dow, hour: +hour, days: v.days, avg_units: v.days ? v.units / v.days : 0 }
    })
    _weekly = weekly.map(r => ({ store: r.store, dow: n(r.dow), hour: n(r.hour), units: n(r.units) }))
  })()
  await _loading
  _loading = null
}

const daily = () => _daily ?? []
const weekly = () => _weekly ?? []

export function sqlHeatmapWindow(): { start: string; end: string } | null { return _win }
export function sqlHeatmapWeeklyWindow(): { start: string; end: string } | null { return _wwin }

export function sqlHeatmap(store: Store): HeatCell[] {
  const cell = (dow: number, hour: number, avgUnits: number): HeatCell => ({
    hourNum: hour, day: dow,
    uplh: Math.round((avgUnits / STAFF) * 10) / 10,
    rawUnits: Math.round(avgUnits * 10) / 10,
    staff: STAFF,
  })
  if (store === 'all') {
    // sigma.ts averages pines + miramar only (margate excluded) per (dow,hour).
    const agg = new Map<string, { sum: number; nn: number }>()
    for (const r of daily()) {
      if (r.store !== 'pines' && r.store !== 'miramar') continue
      const k = `${r.dow}|${r.hour}`
      const e = agg.get(k) ?? { sum: 0, nn: 0 }
      e.sum += r.avg_units; e.nn += 1
      agg.set(k, e)
    }
    return [...agg.entries()]
      .map(([k, v]) => { const [dow, hour] = k.split('|').map(Number); return cell(dow, hour, v.sum / v.nn) })
      .filter(c => c.hourNum >= 7 && c.hourNum <= 21)
  }
  return daily()
    .filter(r => r.store === store && r.hour >= 7 && r.hour <= 21)
    .map(r => cell(r.dow, r.hour, r.avg_units))
}

export function sqlHeatmapWeekly(store: Store): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of weekly()) {
    if (store !== 'all' && r.store !== store) continue
    if (r.hour < 7 || r.hour > 21) continue
    const key = `${r.dow}|${r.hour}`
    map.set(key, (map.get(key) ?? 0) + r.units)
  }
  return map
}
