import { query } from '@/lib/db'
import { holidayName, priorYearHoliday } from '@/lib/holiday'

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

const LABOR_TARGET = 0.22   // matches daily recap TARGET_LABOR_PCT default
const LABOR_AMBER = 0.03    // amber band = target .. target+3pts (daily recap)
const COGS_TARGET = 0.25
const DEFAULT_RATE = 13.50  // matches daily recap DEFAULT_RATE fallback

// Weeks of history used for the PROJ-day sales forecast and the OTB spend base.
const HIST_WEEKS = 4

const STORES = [
  { key: 'pines', name: 'Pines', num: '1392', wm: 'pines' },
  { key: 'miramar', name: 'Miramar', num: '1892', wm: 'miramar' },
  { key: 'margate', name: 'Margate', num: '2384', wm: 'margate' },
] as const

// Both store ZIPs (33027 Pines/Miramar, 33065 Margate) sit in the same South
// Florida weather system ~20mi apart — one regional pull covers all three.
const WX_LAT = 26.05
const WX_LON = -80.28

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* ---------- date helpers (ET-anchored) ---------- */
function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function isoAdd(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function dowOf(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay()
}
function monthDay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

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
      + `&timezone=America%2FNew_York&past_days=10&forecast_days=7`
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
type WmRow = { email: string; spend: number }
type HolBaseRow = { store: string; d: string; net: number }

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p } catch { return fallback }
}

export async function GET() {
  const today = etToday()
  const dow = dowOf(today)
  const mondayOffset = dow === 0 ? -6 : -(dow - 1)
  const monday = isoAdd(today, mondayOffset)
  const sunday = isoAdd(monday, 6)
  const nextMonday = isoAdd(monday, 7)
  const weekDates = Array.from({ length: 7 }, (_, i) => isoAdd(monday, i))
  const histStart = isoAdd(monday, -7 * HIST_WEEKS)   // trailing whole weeks before this week
  // Prior year = 364 days back (same weekday), matching the daily recap's YoY.
  const pyMonday = isoAdd(monday, -364)
  const pySunday = isoAdd(sunday, -364)

  const [
    salesWeek, salesHist, salesPY, schedWeek, laborWeek, empRates, pfg, walmart, weather,
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
    // OTB base — PFG spend (store_number = plain digits)
    safe(query<PfgRow[]>(`
      SELECT store_number, SUM(line_total) AS spend
      FROM smoothieking.pfg_order_line_items
      WHERE order_date >= '${histStart}' AND order_date < '${monday}'
      GROUP BY store_number`), []),
    // OTB base — Walmart spend (store derived from account_user_email)
    safe(query<WmRow[]>(`
      SELECT account_user_email AS email, SUM(item_net_total) AS spend
      FROM smoothieking.walmart_spend
      WHERE order_date >= '${histStart}' AND order_date < '${monday}'
      GROUP BY account_user_email`), []),
    getWeather(weekDates),
  ])

  // index helpers
  const salesWeekMap = new Map<string, number>()   // `${store}|${date}` -> net
  for (const r of salesWeek) salesWeekMap.set(`${r.store}|${r.d}`, Number(r.net) || 0)
  const salesPYMap = new Map<string, number>()     // `${store}|${pyDate}` -> net
  for (const r of salesPY) salesPYMap.set(`${r.store}|${r.d}`, Number(r.net) || 0)

  // Rates: each employee's most-recent rate; store average as fallback (daily recap).
  const empRate = new Map<string, number>()        // `${store}|${employee}` -> rate
  const storeRateList = new Map<string, number[]>()
  for (const r of empRates) {
    const rt = Number(r.rate) || 0
    empRate.set(`${r.store}|${r.employee}`, rt)
    if (!storeRateList.has(r.store)) storeRateList.set(r.store, [])
    storeRateList.get(r.store)!.push(rt)
  }
  const storeAvgRate = new Map<string, number>()
  for (const [st, list] of storeRateList) storeAvgRate.set(st, list.length ? list.reduce((a, b) => a + b, 0) / list.length : DEFAULT_RATE)
  const rateFor = (store: string, emp: string): number =>
    empRate.get(`${store}|${emp}`) ?? storeAvgRate.get(store) ?? DEFAULT_RATE

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

  // history: per store, per weekday -> [nets] (sales days only, matches daily recap)
  const histByStoreDow = new Map<string, number[]>()  // `${store}|${dow}` -> nets
  for (const r of salesHist) {
    const net = Number(r.net) || 0
    if (net <= 0) continue
    const k = `${r.store}|${dowOf(r.d)}`
    if (!histByStoreDow.has(k)) histByStoreDow.set(k, [])
    histByStoreDow.get(k)!.push(net)
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

  const forecastFor = (store: string, date: string): number => {
    const arr = histByStoreDow.get(`${store}|${dowOf(date)}`) ?? []
    if (!arr.length) return 0
    const base = arr.reduce((a, b) => a + b, 0) / arr.length
    const f = holidayFactor.get(`${store}|${date}`)
    return Math.round(f ? base * f : base)
  }

  // OTB base — allocate by SALES share, not purchase history.
  // Margate rarely orders PFG directly (it's supplied by transfers from Pines/
  // Miramar), so its purchase history understates its true produce need. Taking
  // the real system-wide combined PFG + Walmart weekly spend and splitting it by
  // each store's sales share gives every store a real OTB (Margate included) that
  // still sums to actual dollars at the All level — where the order/transfer call
  // is made. Also expose each store's DIRECT spend for context on the card.
  const systemSpend = pfg.reduce((a, r) => a + (Number(r.spend) || 0), 0)
    + walmart.reduce((a, r) => a + (Number(r.spend) || 0), 0)
  const systemWeekly = systemSpend / HIST_WEEKS

  const directByStore = new Map<string, number>()   // s.key -> trailing direct PFG+Walmart / week
  for (const r of pfg) {
    const st = STORES.find(s => s.num === String(r.store_number))
    if (st) directByStore.set(st.key, (directByStore.get(st.key) ?? 0) + (Number(r.spend) || 0) / HIST_WEEKS)
  }
  for (const r of walmart) {
    const email = (r.email || '').toLowerCase()
    const st = STORES.find(s => email.includes(s.wm))
    if (st) directByStore.set(st.key, (directByStore.get(st.key) ?? 0) + (Number(r.spend) || 0) / HIST_WEEKS)
  }

  const trailingSales = new Map<string, number>()   // store name -> trailing net sales
  for (const r of salesHist) trailingSales.set(r.store, (trailingSales.get(r.store) ?? 0) + (Number(r.net) || 0))
  const totalTrailingSales = [...trailingSales.values()].reduce((a, b) => a + b, 0)

  const week = weekDates.map(d => ({
    day: DOW[dowOf(d)],
    date: d,
    type: d < today ? 'ACTUAL' : 'PROJ',
    weather: weather[d],
  }))

  const warnings: string[] = []
  const totalSched = schedWeek.reduce((s, r) => s + (Number(r.h) || 0), 0)
  if (totalSched === 0) warnings.push('No published schedule found for this week — run the Brink schedule extractor (labor_schedule is empty).')

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
    const share = totalTrailingSales > 0 ? (trailingSales.get(s.name) ?? 0) / totalTrailingSales : 1 / STORES.length
    const otbBase = Math.round(systemWeekly * share)
    const otbDirect = Math.round(directByStore.get(s.key) ?? 0)
    return { key: s.key, name: s.name, otbBase, otbDirect, sp, sa, py, hp, ha, lc, lcp }
  })

  return Response.json({
    weekLabel: `Week of ${monthDay(monday)} – ${monthDay(sunday)}`,
    today,
    cogsTarget: COGS_TARGET,
    laborTarget: LABOR_TARGET,
    laborAmber: LABOR_AMBER,
    holidays,
    week,
    stores,
    warnings,
  })
}
