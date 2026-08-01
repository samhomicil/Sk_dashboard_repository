import { query } from '@/lib/db'
import { holidayName, priorYearHoliday } from '@/lib/holiday'
import {
  LABOR_TARGET, LABOR_AMBER, COGS_TARGET, HIST_WEEKS, STORES, DOW,
} from '@/lib/core/targets'
import { etToday, isoAdd, dowOf, monthDay } from '@/lib/core/dates'
import { buildRateFor } from '@/lib/core/labor'
import { buildForecaster, orderSplit, deriveCogsTarget } from '@/lib/core/forecast'

// Mid-week ops report data layer.
// Emits the {week, stores, ...} contract the /ops-report page renders. All numbers
// are computed server-side from Azure SQL + Open-Meteo.
//
// METHODOLOGY IS SHARED WITH THE DAILY RECAP EMAIL (daily-recap/recap.py) so the
// two surfaces never disagree on a given store/day:
//   • rate = each employee's most-recent rate from labor (store-avg fallback, then
//     DEFAULT_RATE) — NOT a trailing blend.
//   • scheduled cost = Σ(sched_hours × that employee's rate).
//   • forecast = mean of the 4 prior same-weekday net-sales (sales days only),
//     × the store's last-year holiday factor when the day is a holiday.
//   • est. labor % = scheduled cost ÷ forecast; the 22% target, 25% amber band.
// Sales plan is derived, not budgeted: scheduled labor cost ÷ 22% target — the
// sales level the staffing was built for. COGS target (25%) feeds only the OTB.

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Targets, store config, date helpers, and the rate / forecast / order-split rules
// now live in src/lib/core/* — the single source of truth shared with the daily
// recap and the owner budget view, so these numbers can never diverge.

// Both store ZIPs (33027 Pines/Miramar, 33065 Margate) sit in the same South
// Florida weather system ~20mi apart — one regional pull covers all three.
const WX_LAT = 26.05
const WX_LON = -80.28

/* ---------- weather ---------- */
function wxMap(code: number): { icon: string; condition: string } {
  if (code === 0) return { icon: '☀️', condition: 'Clear' }
  if (code === 1) return { icon: '🌤️', condition: 'Mostly clear' }
  if (code === 2) return { icon: '⛅', condition: 'Partly cloudy' }
  if (code === 3) return { icon: '☁️', condition: 'Overcast' }
  if (code === 45 || code === 48) return { icon: '🌫️', condition: 'Fog' }
  if (code >= 51 && code <= 57) return { icon: '🌦️', condition: 'Drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: '🌧️', condition: 'Rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '🌨️', condition: 'Snow' }
  if (code >= 95) return { icon: '⛈️', condition: 'Rain (storms)' }
  return { icon: '☁️', condition: 'Cloudy' }
}
async function getWeather(dates: string[]): Promise<Record<string, { icon: string; temp: string; condition: string }>> {
  const out: Record<string, { icon: string; temp: string; condition: string }> = {}
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WX_LAT}&longitude=${WX_LON}`
      + `&daily=weather_code,temperature_2m_max&temperature_unit=fahrenheit`
      + `&timezone=America%2FNew_York&past_days=10&forecast_days=16`
    const res = await fetch(url, { cache: 'no-store' })
    if (res.ok) {
      const j = await res.json()
      const t: string[] = j?.daily?.time ?? []
      const code: number[] = j?.daily?.weather_code ?? []
      const tmax: number[] = j?.daily?.temperature_2m_max ?? []
      t.forEach((d, i) => {
        const m = wxMap(code[i] ?? 3)
        out[d] = { ...m, temp: `${Math.round(tmax[i] ?? 0)}°F` }
      })
    }
  } catch { /* weather optional — fall through to neutral */ }
  for (const d of dates) {
    if (!out[d]) out[d] = { icon: '☁️', temp: '—', condition: 'n/a' }
  }
  return out
}

/* ---------- typed row shapes ---------- */
type SalesRow = { store: string; d: string; net: number }
type SchedRow = { store: string; d: string; employee: string; h: number }
type LaborRow = { store: string; d: string; h: number; pay: number }
type EmpRateRow = { store: string; employee: string; rate: number }
type PfgRow = { store_number: string; spend: number }
type HolBaseRow = { store: string; d: string; net: number }

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p } catch { return fallback }
}

export async function GET(req: Request) {
  const weekMode = new URL(req.url).searchParams.get('week') === 'next' ? 'next' : 'this'
  const today = etToday()
  const dow = dowOf(today)
  const mondayOffset = dow === 0 ? -6 : -(dow - 1)
  // 'next' shifts the whole window forward a week (a pure planning view — every day is a
  // forecast). `today` stays real, so the same-weekday history and weather anchor correctly.
  const monday = isoAdd(today, mondayOffset + (weekMode === 'next' ? 7 : 0))
  const sunday = isoAdd(monday, 6)
  const nextMonday = isoAdd(monday, 7)
  const weekDates = Array.from({ length: 7 }, (_, i) => isoAdd(monday, i))
  const histStart = isoAdd(monday, -7 * HIST_WEEKS)   // trailing whole weeks before this week
  // Prior year = 364 days back (same weekday), matching the daily recap's YoY.
  const pyMonday = isoAdd(monday, -364)
  const pySunday = isoAdd(sunday, -364)

  const [
    salesWeek, salesHist, salesPY, schedWeek, laborWeek, empRates, pfg, cogsData, weather,
  ] = await Promise.all([
    // Sales actual this week (store name = 'Pines'|'Miramar'|'Margate')
    safe(query<SalesRow[]>(`
      SELECT store, CONVERT(char(10), closed_datetime, 23) AS d,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) AS net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= '${monday}' AND CAST(closed_datetime AS DATE) <= '${sunday}'
      GROUP BY store, CONVERT(char(10), closed_datetime, 23)`), []),
    // Prior-year net by store/day (same weekday, 364d back)
    safe(query<SalesRow[]>(`
      SELECT store, CONVERT(char(10), closed_datetime, 23) AS d,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) AS net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= '${pyMonday}' AND CAST(closed_datetime AS DATE) <= '${pySunday}'
      GROUP BY store, CONVERT(char(10), closed_datetime, 23)`), []),
    // Sales history for the same-weekday forecast
    safe(query<SalesRow[]>(`
      SELECT store, CONVERT(char(10), closed_datetime, 23) AS d,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) AS net
      FROM smoothieking.sales
      WHERE CAST(closed_datetime AS DATE) >= '${histStart}' AND CAST(closed_datetime AS DATE) < '${monday}'
      GROUP BY store, CONVERT(char(10), closed_datetime, 23)`), []),
    // Published schedule at employee grain (this week + next week are pulled by the
    // extractor) — kept per-employee so cost uses each person's own rate.
    safe(query<SchedRow[]>(`
      SELECT store, CONVERT(char(10), work_date, 23) AS d, employee, sched_hours AS h
      FROM smoothieking.labor_schedule
      WHERE work_date >= '${monday}' AND work_date < '${nextMonday}'`), []),
    // Actual worked hours + pay this week (labor cost = actual total_pay)
    safe(query<LaborRow[]>(`
      SELECT store, CONVERT(char(10), shift_date, 23) AS d, SUM(total_hrs) AS h, SUM(total_pay) AS pay
      FROM smoothieking.labor
      WHERE shift_date >= '${monday}' AND shift_date < '${nextMonday}'
        AND employee_role NOT IN ('NON_EMP', 'Support')
      GROUP BY store, CONVERT(char(10), shift_date, 23)`), []),
    // Rate = each employee's most-recent rate (daily recap rate_lookup)
    safe(query<EmpRateRow[]>(`
      SELECT store, employee, rate FROM (
        SELECT store, employee, rate,
               ROW_NUMBER() OVER (PARTITION BY store, employee ORDER BY shift_date DESC) rn
        FROM smoothieking.labor WHERE rate > 0) t WHERE rn = 1`), []),
    // OTB base — typical single PFG ORDER per store = spend ÷ distinct order (invoice) dates,
    // from pfs_invoices over the trailing window. One delivery, NOT the weekly total.
    safe(query<PfgRow[]>(`
      SELECT RIGHT(store_name, 4) AS store_number,
             SUM(ext_price) / NULLIF(COUNT(DISTINCT invoice_date), 0) AS spend
      FROM smoothieking.pfs_invoices
      WHERE invoice_date >= '${histStart}' AND invoice_date < '${monday}'
      GROUP BY RIGHT(store_name, 4)`), []),
    // COGS actual + baseline = recipe (theoretical) usage $ ÷ sales, per store PER WEEK over the
    // trailing NetChef inventory weeks (currently 1; deepens as netchef_usage accumulates). Latest
    // week = the "actual" rate; the average of the weeks is the run-rate the derived target uses.
    safe(query<{ store: string; wk: string; cogs: number; sales: number }[]>(`
      WITH o AS (SELECT store, product_number, inventory_price FROM smoothieking.netchef_onhand WHERE as_of = (SELECT MAX(as_of) FROM smoothieking.netchef_onhand))
      SELECT u.store, CONVERT(char(10), u.period_end, 23) AS wk,
             SUM(u.qty_issue * o.inventory_price) AS cogs,
             (SELECT SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) FROM smoothieking.sales s
                WHERE s.store = u.store AND CAST(s.closed_datetime AS DATE) BETWEEN u.period_start AND u.period_end) AS sales
      FROM smoothieking.netchef_usage u
      JOIN o ON o.store = u.store AND o.product_number = u.product_number
      WHERE u.period_end >= (SELECT DATEADD(week, -8, MAX(period_end)) FROM smoothieking.netchef_usage)
      GROUP BY u.store, u.period_start, u.period_end`), []),
    getWeather(weekDates),
  ])

  // index helpers
  const salesWeekMap = new Map<string, number>()   // `${store}|${date}` -> net
  for (const r of salesWeek) salesWeekMap.set(`${r.store}|${r.d}`, Number(r.net) || 0)
  const salesPYMap = new Map<string, number>()     // `${store}|${pyDate}` -> net
  for (const r of salesPY) salesPYMap.set(`${r.store}|${r.d}`, Number(r.net) || 0)

  // Rates: each employee's most-recent rate; store average as fallback (shared core).
  const rateFor = buildRateFor(empRates)

  // Scheduled hours + cost per store/day (cost weights each shift by its own rate).
  const schedHours = new Map<string, number>()     // `${store}|${date}` -> hours
  const schedCost = new Map<string, number>()      // `${store}|${date}` -> $
  for (const r of schedWeek) {
    const k = `${r.store}|${r.d}`, h = Number(r.h) || 0
    schedHours.set(k, (schedHours.get(k) ?? 0) + h)
    schedCost.set(k, (schedCost.get(k) ?? 0) + h * rateFor(r.store, r.employee))
  }

  // Actual worked hours + pay per store/day.
  const laborHours = new Map<string, number>()
  const laborPay = new Map<string, number>()
  for (const r of laborWeek) {
    laborHours.set(`${r.store}|${r.d}`, Number(r.h) || 0)
    laborPay.set(`${r.store}|${r.d}`, Number(r.pay) || 0)
  }

  // Holiday factors: only if a PROJ day in the week is a holiday (rare). Per store,
  // factor = last-year holiday net / its surrounding same-weekday baseline, clamped
  // [0.4, 2.2] — identical to the daily recap. holidayFactor: `${store}|${date}` -> f.
  const holidayFactor = new Map<string, number>()
  const holidays: { date: string; day: string; name: string }[] = []
  for (const d of weekDates) {
    if (d < today) continue                        // actuals use real sales, no factor
    const name = holidayName(d)
    if (!name) continue
    holidays.push({ date: d, day: DOW[dowOf(d)], name })
    const { date: hly } = priorYearHoliday(d)
    if (!hly) continue
    const baseDates = [-4, -3, -2, -1, 1, 2].map(k => isoAdd(hly, 7 * k))
    const need = [hly, ...baseDates].map(x => `'${x}'`).join(', ')
    const rows = await safe(query<HolBaseRow[]>(`
      SELECT store, CONVERT(char(10), closed_datetime, 23) d,
             SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) net
      FROM smoothieking.sales WHERE CONVERT(date, closed_datetime) IN (${need})
      GROUP BY store, CONVERT(char(10), closed_datetime, 23)`), [])
    const got = new Map<string, Map<string, number>>()
    for (const r of rows) {
      if (!got.has(r.store)) got.set(r.store, new Map())
      got.get(r.store)!.set(r.d, Number(r.net) || 0)
    }
    for (const s of STORES) {
      const g = got.get(s.name)
      const hv = g?.get(hly) ?? 0
      const base = baseDates.map(x => g?.get(x) ?? 0).filter(v => v > 0)
      if (hv > 0 && base.length >= 3) {
        holidayFactor.set(`${s.name}|${d}`, Math.max(0.4, Math.min(2.2, hv / (base.reduce((a, b) => a + b, 0) / base.length))))
      }
    }
  }

  // Same-weekday forecaster (shared core), holiday-factor aware.
  const forecastFor = buildForecaster(salesHist, holidayFactor)

  // OTB base = typical single PFG order per store (avg per order date). With pfs_invoices
  // each store orders directly, so the old sales-share/transfer workaround is obsolete.
  const otbByNum = new Map<string, number>()
  for (const r of pfg) otbByNum.set(String(r.store_number), Number(r.spend) || 0)

  // Per store: latest-week recipe COGS rate (the "actual") + a derived target = the average
  // of the available weeks' rates minus the improvement goal, clamped. cogsWeeks tracks how
  // many weeks back the run-rate the target is built from (shown in the UI for transparency).
  const cogsRates = new Map<string, { wk: string; rate: number }[]>()
  for (const r of cogsData) {
    const sales = Number(r.sales) || 0
    if (sales <= 0) continue
    const arr = cogsRates.get(r.store) ?? []
    arr.push({ wk: r.wk, rate: (Number(r.cogs) || 0) / sales })
    cogsRates.set(r.store, arr)
  }
  const cogsByStore = new Map<string, number>()        // actual (latest week)
  const cogsTargetByStore = new Map<string, number>()  // derived target
  let cogsWeeks = 0
  for (const [store, arr] of cogsRates) {
    arr.sort((a, b) => a.wk < b.wk ? -1 : 1)
    cogsWeeks = Math.max(cogsWeeks, arr.length)
    cogsByStore.set(store, arr[arr.length - 1].rate)
    cogsTargetByStore.set(store, deriveCogsTarget(arr.map(x => x.rate)))
  }

  const week = weekDates.map(d => ({
    day: DOW[dowOf(d)],
    date: d,
    type: d < today ? 'ACTUAL' : 'PROJ',
    weather: weather[d],
  }))

  const warnings: string[] = []
  const totalSched = schedWeek.reduce((s, r) => s + (Number(r.h) || 0), 0)
  if (totalSched === 0) warnings.push(weekMode === 'next'
    ? 'Next week’s schedule isn’t posted yet — labor $ and % show as a target only. Post it in Brink to compare against this forecast.'
    : 'No published schedule found for this week — run the Brink schedule extractor (labor_schedule is empty).')

  const round1 = (n: number) => Math.round(n * 10) / 10

  const stores = STORES.map(s => {
    const sp: number[] = [], sa: number[] = [], py: number[] = [], hp: number[] = [], ha: number[] = []
    const lc: number[] = [], lcp: number[] = []
    weekDates.forEach(d => {
      const isActual = d < today
      const sHours = schedHours.get(`${s.name}|${d}`) ?? 0
      const sCost = schedCost.get(`${s.name}|${d}`) ?? 0
      const wHours = laborHours.get(`${s.name}|${d}`) ?? 0
      const wPay = laborPay.get(`${s.name}|${d}`) ?? 0
      // Sales plan = scheduled labor cost at the 22% labor target.
      sp.push(sCost > 0 ? Math.round(sCost / LABOR_TARGET) : 0)
      sa.push(isActual ? Math.round(salesWeekMap.get(`${s.name}|${d}`) ?? 0) : forecastFor(s.name, d))
      py.push(Math.round(salesPYMap.get(`${s.name}|${isoAdd(d, -364)}`) ?? 0))
      hp.push(round1(sHours))
      ha.push(isActual ? round1(wHours) : round1(sHours))
      // Labor cost: plan = scheduled cost; actual = real pay (closed days) or scheduled (proj).
      lcp.push(Math.round(sCost))
      lc.push(isActual ? Math.round(wPay) : Math.round(sCost))
    })
    const otbBase = Math.round(otbByNum.get(s.num) ?? 0)
    const otbDirect = otbBase   // pfs = direct orders; no transfer distortion
    const cogsRate = cogsByStore.get(s.name) ?? 0
    const cogsTarget = cogsTargetByStore.get(s.name) ?? COGS_TARGET
    const orders = orderSplit(s.name, weekDates, sa, cogsTarget)
    return { key: s.key, name: s.name, otbBase, otbDirect, cogsRate: Math.round(cogsRate * 1000) / 1000, cogsTarget, orders, sp, sa, py, hp, ha, lc, lcp }
  })

  // Blended (sales-weighted) derived target for the All view / generic reference.
  const blendW = stores.reduce((a, s) => a + s.sa.reduce((x, y) => x + y, 0), 0)
  const cogsTargetBlend = blendW > 0
    ? stores.reduce((a, s) => a + s.cogsTarget * s.sa.reduce((x, y) => x + y, 0), 0) / blendW
    : COGS_TARGET

  return Response.json({
    weekMode,
    weekLabel: `Week of ${monthDay(monday)} – ${monthDay(sunday)}`,
    today,
    cogsTarget: Math.round(cogsTargetBlend * 1000) / 1000,
    cogsWeeks,
    laborTarget: LABOR_TARGET,
    laborAmber: LABOR_AMBER,
    holidays,
    week,
    stores,
    warnings,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
