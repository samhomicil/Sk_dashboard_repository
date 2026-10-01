import { query, queryLive } from '@/lib/db'
import { requireStore } from '@/lib/store-guard'
import { holidayName } from '@/lib/holiday'
import {
  STORES, DOW, HIST_WEEKS, LABOR_TARGET, LABOR_AMBER, UNITS_PER_PERSON_HALF_HOUR, LATE_MINUTES,
  REFRESH_WINDOWS, INTRADAY_STALE_MINUTES, LATE_LOOKBACK_DAYS, EE_TARGET, VOID_PCT_TARGET,
  DISCOUNT_PCT_TARGET, WEEKLY_OT_HOURS,
} from '@/lib/core/targets'
import { etToday, etNowMinutes, isoAdd, dowOf, hmToMin } from '@/lib/core/dates'
import { salesBySlot, LATEST_RATES, LABOR_SHIFTS, INTRADAY_RUNS } from '@/lib/core/sources'
import { resolvedKeySql } from '@/lib/core/employee'
import { buildRateFor, isSalaried, type EmpRateRow } from '@/lib/core/labor'
import { allKeyed } from '@/lib/core/keyed'
import {
  buildStoreNow, buildPeople, personKey, type SlotRow, type ClockRow, type PlanRow, type StoreNow,
  type LateEvent,
} from '@/lib/core/intraday'

// THE NOW SCREEN's data: each store's day so far, as of the last 30-minute Brink pull.
// All the deciding happens in core/intraday.ts; this route only fetches. Every query reads
// all three stores and is filtered here, so one cached copy serves every viewer.

export const dynamic = 'force-dynamic'
export const revalidate = 0

type RunRow = { ok_at: string | null; last_at: string | null; last_ok: boolean | number | null; last_id: number | null }
type Store = (typeof STORES)[number]

export type NowPayload = {
  today: string
  day: string
  holiday: string | null
  now: number
  refresh: {
    window: { from: number; to: number }
    inWindow: boolean
    asOf: number | null         // last successful pull today, minutes ET
    lastFailed: boolean         // the most recent pull did not complete
    ageMin: number | null
    stale: boolean
    next: number | null         // next scheduled pull today
  }
  targets: {
    labor: number; laborAmber: number; unitsPerPerson: number; lateMinutes: number
    ee: number; voidPct: number; discountPct: number; weeklyHours: number; lateLookback: number
  }
  stores: (StoreNow & {
    key: Store['key']
    lastSale: number | null
    /** who rang today's voided orders, most first (unattributed voids — mostly online — left out) */
    voidsBy: { employee: string; orders: number }[]
  })[]
}

type DayShift = { store: string; d: string; employee: string; role: string; start: string; end: string | null; key: string | null }
/** Minutes a shift spans; an end "before" its start crossed midnight. */
const spanMin = (start: string, end: string | null) => {
  if (!end) return 0
  const a = hmToMin(start), b = hmToMin(end)
  return b <= a ? b + 1440 - a : b - a
}

const minOf = (dt: string | null) => (dt ? hmToMin(dt.slice(11, 16)) : null)

export async function GET(req: Request) {
  const s = await requireStore(new URL(req.url).searchParams.get('store'))
  if (s instanceof Response) return s
  const wanted = s === 'all' ? [...STORES] : STORES.filter(x => x.key === s)

  const today = etToday()
  const now = etNowMinutes()
  const win = REFRESH_WINDOWS[dowOf(today)]
  const window = { from: hmToMin(win[0]), to: hmToMin(win[1]) }
  const inWindow = now >= window.from && now <= window.to

  // Has a new pull landed? Asked uncached; its id then keys the cache of every today-query.
  const dow = dowOf(today)
  const monday = isoAdd(today, dow === 0 ? -6 : 1 - dow)   // payroll weeks run Mon–Sun
  const sunday = isoAdd(monday, 6)
  const lookStart = isoAdd(today, -LATE_LOOKBACK_DAYS)     // ≥ 7, so it also covers Mon..yesterday

  const [run] = await queryLive<RunRow[]>(`
    SELECT (SELECT TOP 1 CONVERT(varchar(19), run_at, 120) FROM ${INTRADAY_RUNS}
             WHERE business_date = '${today}' AND ok = 1 ORDER BY id DESC) AS ok_at,
           (SELECT TOP 1 CONVERT(varchar(19), run_at, 120) FROM ${INTRADAY_RUNS}
             WHERE business_date = '${today}' ORDER BY id DESC) AS last_at,
           (SELECT TOP 1 ok FROM ${INTRADAY_RUNS}
             WHERE business_date = '${today}' ORDER BY id DESC) AS last_ok,
           (SELECT TOP 1 id FROM ${INTRADAY_RUNS} ORDER BY id DESC) AS last_id`)
  const asOf = minOf(run?.ok_at ?? null)
  const tag = `/* intraday run ${run?.last_id ?? 0} */`
  const ageMin = asOf == null ? null : now - asOf
  const stale = inWindow && (asOf == null
    ? now > window.from + INTRADAY_STALE_MINUTES
    : ageMin! > INTRADAY_STALE_MINUTES)
  const nextSlot = Math.floor(now / 30) * 30 + 30
  const next = now < window.from ? Math.ceil(window.from / 30) * 30
    : nextSlot <= window.to ? nextSlot : null

  const tomorrow = isoAdd(today, 1)
  const histDates = Array.from({ length: HIST_WEEKS }, (_, i) => isoAdd(today, -7 * (i + 1)))
  const histWhere = histDates
    .map(d => `(s.closed_datetime >= '${d}' AND s.closed_datetime < '${isoAdd(d, 1)}')`).join(' OR ')

  const { todaySlots, histSlots, clock, plan, rates, pastClock, pastPlan, aheadPlan, lastSale, voidsBy } = await allKeyed({
    todaySlots: query<SlotRow[]>(
      salesBySlot(`s.closed_datetime >= '${today}' AND s.closed_datetime < '${tomorrow}'`) + tag),
    histSlots: query<SlotRow[]>(salesBySlot(`(${histWhere})`)),
    clock: query<(ClockRow & { store: string })[]>(`
      SELECT store, employee, role, CONVERT(char(5), shift_start, 108) AS start,
             CONVERT(char(5), shift_end, 108) AS [end], ${resolvedKeySql('employee')} AS [key]
        FROM ${LABOR_SHIFTS} WHERE d = '${today}' AND basis = 'clock' ${tag}`),
    plan: query<(PlanRow & { store: string })[]>(`
      SELECT store, employee, role, CONVERT(char(5), start_time, 108) AS start,
             CONVERT(char(5), end_time, 108) AS [end], ${resolvedKeySql('employee')} AS [key]
        FROM smoothieking.labor_schedule WHERE work_date = '${today}'`),
    rates: query<EmpRateRow[]>(LATEST_RATES),
    // The lookback: who was late before today, and the hours already worked this week.
    pastClock: query<DayShift[]>(`
      SELECT store, CONVERT(char(10), d, 23) AS d, employee, role,
             CONVERT(char(5), shift_start, 108) AS start, CONVERT(char(5), shift_end, 108) AS [end],
             ${resolvedKeySql('employee')} AS [key]
        FROM ${LABOR_SHIFTS} WHERE basis = 'clock' AND d >= '${lookStart}' AND d < '${today}'`),
    pastPlan: query<DayShift[]>(`
      SELECT store, CONVERT(char(10), work_date, 23) AS d, employee, role,
             CONVERT(char(5), start_time, 108) AS start, CONVERT(char(5), end_time, 108) AS [end],
             ${resolvedKeySql('employee')} AS [key]
        FROM smoothieking.labor_schedule WHERE work_date >= '${lookStart}' AND work_date < '${today}'`),
    // The rest of this week, for whoever is heading past WEEKLY_OT_HOURS.
    aheadPlan: query<DayShift[]>(`
      SELECT store, CONVERT(char(10), work_date, 23) AS d, employee, role,
             CONVERT(char(5), start_time, 108) AS start, CONVERT(char(5), end_time, 108) AS [end],
             ${resolvedKeySql('employee')} AS [key]
        FROM smoothieking.labor_schedule WHERE work_date > '${today}' AND work_date <= '${sunday}'`),
    lastSale: query<{ store: string; t: string }[]>(`
      SELECT store, CONVERT(char(5), MAX(closed_datetime), 108) AS t FROM smoothieking.sales
       WHERE closed_datetime >= '${today}' AND closed_datetime < '${tomorrow}' GROUP BY store ${tag}`),
    voidsBy: query<{ store: string; employee: string; orders: number }[]>(`
      SELECT store, employee, COUNT(DISTINCT order_id) AS orders FROM smoothieking.sales
       WHERE voided = 1 AND employee IS NOT NULL AND employee NOT IN ('None', '')
         AND closed_datetime >= '${today}' AND closed_datetime < '${tomorrow}'
       GROUP BY store, employee ${tag}`),
  })
  const rateFor = buildRateFor(rates)

  // Late starts before today, per person, by the same pairing the screen uses for today —
  // each one kept (day, clock-in, due) so the screen can say when, not just how often.
  const lateHistory = new Map<string, LateEvent[]>()
  const byDay = new Map<string, { clock: DayShift[]; plan: DayShift[] }>()
  const day = (r: DayShift) => {
    const k = `${r.store}|${r.d}`
    if (!byDay.has(k)) byDay.set(k, { clock: [], plan: [] })
    return byDay.get(k)!
  }
  for (const r of pastClock) day(r).clock.push(r)
  for (const r of pastPlan) day(r).plan.push(r)
  for (const [k, { clock: c, plan: pl }] of byDay) {
    const d = k.split('|')[1]
    const ppl = buildPeople(c, pl.filter((x): x is DayShift & { end: string } => x.end != null), 1440)
    for (const x of ppl) {
      if (x.inAt == null || !x.lateBy || x.schedStart == null) continue
      const list = lateHistory.get(x.key) ?? []
      list.push({ d, inAt: x.inAt, sched: x.schedStart, minutes: x.lateBy })
      lateHistory.set(x.key, list)
    }
  }
  for (const list of lateHistory.values()) list.sort((a, b) => a.d.localeCompare(b.d))
  // This week, every store: hours clocked Mon..yesterday, and hours scheduled after today.
  const week = new Map<string, { worked: number; ahead: number }>()
  const wk = (e: string) => week.get(e) ?? week.set(e, { worked: 0, ahead: 0 }).get(e)!
  for (const r of pastClock) if (r.d >= monday) wk(personKey(r)).worked += spanMin(r.start, r.end) / 60
  for (const r of aheadPlan) if (!isSalaried(r.role)) wk(personKey(r)).ahead += spanMin(r.start, r.end) / 60
  const num = (r: SlotRow) => ({ ...r, slot: Number(r.slot) })

  const stores = wanted.map(st => {
    const built = buildStoreNow({
      store: st.name, today,
      // Before the first pull of the day there is nothing for today yet: judge as of now.
      asOf: asOf ?? Math.min(now, window.from),
      todaySlots: todaySlots.filter(r => r.store === st.name).map(num),
      histSlots: histSlots.filter(r => r.store === st.name).map(num),
      clock: clock.filter(r => r.store === st.name),
      plan: plan.filter(r => r.store === st.name),
      rateFor, lateHistory, week,
    })
    // Never send anyone home on old data, or once the doors are shut.
    if (stale || !inWindow || asOf == null) built.calls = []
    const ls = lastSale.find(r => r.store === st.name)?.t
    const vb = voidsBy.filter(r => r.store === st.name)
      .map(r => ({ employee: r.employee, orders: Number(r.orders) || 0 }))
      .sort((a, b) => b.orders - a.orders)
    return { ...built, key: st.key, lastSale: ls ? hmToMin(ls) : null, voidsBy: vb }
  })

  const body: NowPayload = {
    today, day: DOW[dowOf(today)], holiday: holidayName(today), now,
    refresh: {
      window, inWindow, asOf,
      lastFailed: run?.last_at != null && !Number(run.last_ok),
      ageMin, stale, next,
    },
    targets: {
      labor: LABOR_TARGET, laborAmber: LABOR_AMBER,
      unitsPerPerson: UNITS_PER_PERSON_HALF_HOUR, lateMinutes: LATE_MINUTES,
      ee: EE_TARGET, voidPct: VOID_PCT_TARGET, discountPct: DISCOUNT_PCT_TARGET,
      weeklyHours: WEEKLY_OT_HOURS, lateLookback: LATE_LOOKBACK_DAYS,
    },
    stores,
  }
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
