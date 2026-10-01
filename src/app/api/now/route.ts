import { query, queryLive } from '@/lib/db'
import { requireStore } from '@/lib/store-guard'
import { holidayName } from '@/lib/holiday'
import {
  STORES, DOW, HIST_WEEKS, LABOR_TARGET, LABOR_AMBER, UNITS_PER_PERSON_HALF_HOUR, LATE_MINUTES,
  REFRESH_WINDOWS, INTRADAY_STALE_MINUTES,
} from '@/lib/core/targets'
import { etToday, etNowMinutes, isoAdd, dowOf, hmToMin } from '@/lib/core/dates'
import { salesBySlot, LATEST_RATES, LABOR_SHIFTS, INTRADAY_RUNS } from '@/lib/core/sources'
import { buildRateFor, type EmpRateRow } from '@/lib/core/labor'
import { allKeyed } from '@/lib/core/keyed'
import { buildStoreNow, type SlotRow, type ClockRow, type PlanRow, type StoreNow } from '@/lib/core/intraday'

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
  targets: { labor: number; laborAmber: number; unitsPerPerson: number; lateMinutes: number }
  stores: (StoreNow & { key: Store['key'] })[]
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

  const { todaySlots, histSlots, clock, plan, rates } = await allKeyed({
    todaySlots: query<SlotRow[]>(
      salesBySlot(`s.closed_datetime >= '${today}' AND s.closed_datetime < '${tomorrow}'`) + tag),
    histSlots: query<SlotRow[]>(salesBySlot(`(${histWhere})`)),
    clock: query<(ClockRow & { store: string })[]>(`
      SELECT store, employee, role, CONVERT(char(5), shift_start, 108) AS start,
             CONVERT(char(5), shift_end, 108) AS [end]
        FROM ${LABOR_SHIFTS} WHERE d = '${today}' AND basis = 'clock' ${tag}`),
    plan: query<(PlanRow & { store: string })[]>(`
      SELECT store, employee, role, CONVERT(char(5), start_time, 108) AS start,
             CONVERT(char(5), end_time, 108) AS [end]
        FROM smoothieking.labor_schedule WHERE work_date = '${today}'`),
    rates: query<EmpRateRow[]>(LATEST_RATES),
  })
  const rateFor = buildRateFor(rates)
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
      rateFor,
    })
    // Never send anyone home on old data, or once the doors are shut.
    if (stale || !inWindow || asOf == null) built.calls = []
    return { ...built, key: st.key }
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
    },
    stores,
  }
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
