import { query, queryLive } from './db'
import { allKeyed } from './core/keyed'
import { HIST_WEEKS, USUAL_HOURS_WEEKS } from './core/targets'
import { salesBySlot, LATEST_RATES, NET_SALES, LABOR_DAILY, LABOR_SHIFTS, INTRADAY_RUNS } from './core/sources'
import { resolvedKeySql } from './core/employee'
import { buildRateFor, isSalaried } from './core/labor'
import { holidayPlans } from './holidayPlan'
import { holidayName } from './holiday'
import { isoAdd, dowOf } from './core/dates'
import {
  planDays, weekDates, type SchedDay, type SchedPerson, type SchedShift, type HistSlot, type Block, type Off,
  type ElsewhereShift, type DayHoliday,
} from './core/schedule'

/**
 * Everything the schedule builder needs for one store and one business week (Tue–Mon).
 * Server-only: this fetches; core/schedule.ts decides.
 *
 *   history       core/sources salesBySlot for the HIST_WEEKS same weekdays before `today`,
 *                 or before the week itself once it has started — the forecast a week was
 *                 planned on stays put while it runs, as in Weekly Ops
 *   holidays      lib/holidayPlan: last year's factor, closed, or short hours
 *   people        the store's active NetChef roster (netchef_availability_roster) — the same
 *                 list availability is loaded for — with Brink role and most-recent rate
 *                 (core/labor buildRateFor), date of birth (employee_hr_netchef), and usual
 *                 hours (average weekly scheduled hours here, USUAL_HOURS_WEEKS)
 *   availability  netchef_availability_day (NetChef; the unedited-week trap is already
 *                 resolved at load) — "not available" and "preferred" blocks only
 *   time off      teamworx_time_off, approved and pending, clipped to each day
 *   posted        the Brink schedule for this week (if Teamworx has published it) and last week
 *   elsewhere     the same people's posted shifts at the other stores this week — they count
 *                 toward overtime and the minors' weekly limit
 *   actual        once the week has started: each day's net sales and labor pay (LABOR_DAILY)
 *                 and who was on the floor when (LABOR_SHIFTS) — Brink, never NetChef
 * Owners are never planned (core/labor rules). The salaried manager is: his shifts count as
 * people on the floor and cost 0 in the plan, as Weekly Ops prices them.
 */

type Store = { key: string; name: string }

/** ahead = not started (build it); current = in progress (rest of it editable); past = read-only. */
export type WeekMode = 'ahead' | 'current' | 'past'

/** What actually happened, for a week that has started. Today's figures are as of the last
 *  30-minute Brink pull. */
export type WeekActual = {
  days: { date: string; sales: number; hours: number | null; pay: number | null }[]
  /** One row per stretch on the floor; e = null while still clocked in. basis 'schedule' is
   *  the salaried manager, counted at his scheduled times (LABOR_SHIFTS). */
  worked: { date: string; key: string; name: string; basis: string; s: number; e: number | null }[]
  /** today's figures are as of this pull (minutes ET); null = no pull yet today, or a finished week */
  pulledAt: number | null
}

export type ScheduleInputs = {
  store: string
  tuesday: string
  mode: WeekMode
  days: SchedDay[]
  /** Closed-last-year holidays planned as a normal day, for a store that decides to open. */
  ifOpen: Record<string, SchedDay>
  people: SchedPerson[]
  posted: { thisWeek: SchedShift[]; lastWeek: SchedShift[] }
  elsewhere: ElsewhereShift[]
  actual: WeekActual | null
  /** The salaried manager's shifts: this week's if posted, else last week's moved forward. */
  fixed: SchedShift[]
  asOf: { availability: string | null; timeOff: string | null }
  /** The forecast's comparables: the last 4 complete business weeks' actual net sales, and
   *  this same week last year (364 days back, so weekdays line up). null = not in the data. */
  compare: { last4: { tuesday: string; net: number }[]; lastYear: number | null }
}

const OWNER = /owner|franchise/i
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** The Tuesday that starts the business week containing `date`. */
export const weekStart = (date: string) => isoAdd(date, -((dowOf(date) + 5) % 7))

export async function loadScheduleInputs(store: Store, tuesday: string, today: string): Promise<ScheduleInputs> {
  const dates = weekDates(tuesday)
  const last = isoAdd(tuesday, -7)
  const thisTue = weekStart(today)
  const mode: WeekMode = tuesday > thisTue ? 'ahead' : tuesday === thisTue ? 'current' : 'past'
  const histEnd = tuesday < today ? tuesday : today
  const histStart = isoAdd(histEnd, -7 * HIST_WEEKS)
  const usualStart = isoAdd(thisTue, -7 * USUAL_HOURS_WEEKS)
  const schedFrom = usualStart < last ? usualStart : last
  const cmpTue = tuesday < thisTue ? tuesday : thisTue        // the 4 weeks before the week (or before this one)
  const actualTo = mode === 'ahead' ? null : (dates[6] < today ? dates[6] : today)
  // Today moves every 30 minutes; finished weeks never do.
  const read = mode === 'current' ? queryLive : query
  const esc = store.name.replace(/'/g, "''")

  const r = await allKeyed({
    hist: query<(HistSlot & { store: string })[]>(salesBySlot(
      `s.store = '${esc}' AND s.closed_datetime >= '${histStart}' AND s.closed_datetime < '${histEnd}'`)),
    roster: query<{ id: number; key: string; name: string; position: string | null; entered: boolean | number }[]>(`
      SELECT netchef_employee_id AS id, employee_key AS [key], employee_name AS name, position, entered
        FROM smoothieking.netchef_availability_roster WHERE store = '${esc}'`),
    dims: query<{ key: string; role: string | null }[]>(`
      SELECT employee_key AS [key], role FROM smoothieking.vw_employee_dim`),
    rates: query<{ store: string; employee: string; rate: number; key: string }[]>(`
      SELECT r.store, r.employee, r.rate, ${resolvedKeySql('r.employee')} AS [key] FROM (${LATEST_RATES}) r`),
    dob: query<{ key: string; dob: string | null }[]>(`
      SELECT employee_key AS [key], CONVERT(char(10), date_of_birth, 23) AS dob FROM smoothieking.employee_hr_netchef`),
    sched: query<{ d: string; key: string; role: string | null; st: string; et: string; h: number }[]>(`
      SELECT CONVERT(char(10), work_date, 23) AS d, ${resolvedKeySql('employee')} AS [key], role,
             CONVERT(char(5), start_time, 108) AS st, CONVERT(char(5), end_time, 108) AS et, sched_hours AS h
        FROM smoothieking.labor_schedule
       WHERE store = '${esc}' AND work_date >= '${schedFrom}' AND work_date <= '${dates[6]}'`),
    other: query<{ store: string; d: string; key: string; st: string; et: string }[]>(`
      SELECT store, CONVERT(char(10), work_date, 23) AS d, ${resolvedKeySql('employee')} AS [key],
             CONVERT(char(5), start_time, 108) AS st, CONVERT(char(5), end_time, 108) AS et
        FROM smoothieking.labor_schedule
       WHERE store <> '${esc}' AND work_date >= '${dates[0]}' AND work_date <= '${dates[6]}'`),
    holidays: holidayPlans([store.name], dates, dates[0]),
    pull: mode === 'current' ? queryLive<{ ok_at: string | null }[]>(`
      SELECT TOP 1 CONVERT(varchar(19), run_at, 120) AS ok_at FROM ${INTRADAY_RUNS}
       WHERE business_date = '${today}' AND ok = 1 ORDER BY id DESC`) : Promise.resolve([]),
    actSales: actualTo ? read<{ d: string; net: number }[]>(`
      SELECT CONVERT(char(10), closed_datetime, 23) AS d, ${NET_SALES} AS net
        FROM smoothieking.sales
       WHERE store = '${esc}' AND closed_datetime >= '${dates[0]}' AND closed_datetime < '${isoAdd(actualTo, 1)}'
       GROUP BY CONVERT(char(10), closed_datetime, 23)`) : Promise.resolve([]),
    actLabor: actualTo ? read<{ d: string; hours: number; pay: number }[]>(`
      SELECT CONVERT(char(10), d, 23) AS d, hours, pay FROM ${LABOR_DAILY}
       WHERE store = '${esc}' AND d >= '${dates[0]}' AND d <= '${actualTo}'`) : Promise.resolve([]),
    actShifts: actualTo ? read<{ d: string; key: string; employee: string; basis: string; st: string; et: string | null }[]>(`
      SELECT CONVERT(char(10), d, 23) AS d, ${resolvedKeySql('employee')} AS [key], employee, basis,
             CONVERT(char(5), shift_start, 108) AS st, CONVERT(char(5), shift_end, 108) AS et
        FROM ${LABOR_SHIFTS} WHERE store = '${esc}' AND d >= '${dates[0]}' AND d <= '${actualTo}'`) : Promise.resolve([]),
    avail: query<{ key: string; d: string; status: 'N' | 'P'; a: number; z: number; loaded: string }[]>(`
      SELECT employee_key AS [key], CONVERT(char(10), work_date, 23) AS d, status, start_min AS a, end_min AS z,
             CONVERT(varchar(16), loaded_at, 120) AS loaded
        FROM smoothieking.netchef_availability_day
       WHERE store = '${esc}' AND work_date BETWEEN '${dates[0]}' AND '${dates[6]}' AND status IN ('N','P')`),
    netByDay: query<{ d: string; net: number }[]>(`
      SELECT CONVERT(char(10), closed_datetime, 23) AS d, ${NET_SALES} AS net
        FROM smoothieking.sales
       WHERE store = '${esc}'
         AND ((closed_datetime >= '${isoAdd(cmpTue, -28)}' AND closed_datetime < '${cmpTue}')
           OR (closed_datetime >= '${isoAdd(tuesday, -364)}' AND closed_datetime < '${isoAdd(tuesday, -357)}'))
       GROUP BY CONVERT(char(10), closed_datetime, 23)`),
    off: query<{ key: string; a: string; z: string; status: 'approved' | 'pending'; loaded: string }[]>(`
      SELECT employee_key AS [key], CONVERT(varchar(16), start_at, 120) AS a, CONVERT(varchar(16), end_at, 120) AS z,
             status, CONVERT(varchar(16), loaded_at, 120) AS loaded
        FROM smoothieking.teamworx_time_off
       WHERE store = '${esc}' AND end_at > '${dates[0]}' AND start_at < '${isoAdd(dates[6], 1)}'`),
  })

  const hist = r.hist.map(h => ({ ...h, slot: Number(h.slot), units: Number(h.units), net: Number(h.net) }))
  const hol = new Map<string, DayHoliday>()
  for (const [k, v] of r.holidays) hol.set(k.split('|')[1], { name: v.name, factor: v.factor, closed: v.closed, hours: v.hours })
  const days = planDays(store.name, dates, hist, hol)
  const closed = days.filter(d => d.holiday?.closed).map(d => d.date)
  const ifOpen = closed.length
    ? Object.fromEntries(planDays(store.name, closed, hist).map(d => [d.date, { ...d, holiday: { ...days.find(x => x.date === d.date)!.holiday!, closed: false } }]))
    : {}

  const roleOf = new Map(r.dims.map(d => [d.key, d.role]))
  const rateFor = buildRateFor(r.rates.map(x => ({ store: x.store, employee: x.key, rate: Number(x.rate) })))
  const dobOf = new Map(r.dob.map(d => [d.key, d.dob]))

  // usual = average weekly scheduled hours here, from the week a person first appears
  const usualFrom = new Map<string, Map<string, number>>()
  for (const s of r.sched) if (s.d < weekStart(today)) {
    const wk = weekStart(s.d)
    if (!usualFrom.has(s.key)) usualFrom.set(s.key, new Map())
    usualFrom.get(s.key)!.set(wk, (usualFrom.get(s.key)!.get(wk) ?? 0) + Number(s.h))
  }
  const weeks = [...new Set(r.sched.filter(s => s.d < weekStart(today)).map(s => weekStart(s.d)))].sort()

  const people: SchedPerson[] = r.roster
    .map(p => ({ ...p, role: roleOf.get(p.key) ?? p.position ?? '' }))
    .filter(p => !OWNER.test(p.role))
    .map(p => {
      const [last, first] = p.name.split(',').map(x => x.trim())
      const salaried = isSalaried(p.role)
      const w = usualFrom.get(p.key)
      const span = w ? weeks.filter(x => x >= [...w.keys()].sort()[0]) : []
      const avail: Record<string, Block[]> = {}, off: Record<string, Off[]> = {}
      for (const a of r.avail) if (a.key === p.key) (avail[a.d] ??= []).push({ st: a.status, a: Number(a.a), z: Number(a.z) })
      for (const o of r.off) if (o.key === p.key) for (const d of dates) {
        const d0 = `${d} 00:00`, d1 = `${isoAdd(d, 1)} 00:00`
        if (o.z <= d0 || o.a >= d1) continue
        const a = o.a > d0 ? hm(o.a.slice(11)) : 0
        const z = o.z < d1 ? hm(o.z.slice(11)) : 1440
        ;(off[d] ??= []).push({ a, z, status: o.status })
      }
      return {
        key: p.key, name: `${first} ${last}`, short: `${first} ${last.charAt(0).toUpperCase()}.`,
        role: p.role, rate: salaried ? 0 : rateFor(store.name, p.key), salaried,
        dob: dobOf.get(p.key) ?? null, entered: !!p.entered,
        usual: w && span.length ? [...w.values()].reduce((t, h) => t + h, 0) / span.length : null,
        avail, off,
      }
    })

  let id = 0
  const toShift = (s: { d: string; key: string; st: string; et: string }, shift = 0): SchedShift =>
    ({ id: ++id, date: isoAdd(s.d, shift), s: hm(s.st), e: hm(s.et), key: s.key })
  const isOwner = (role: string | null) => OWNER.test(role ?? '')
  const thisWeek = r.sched.filter(s => s.d >= dates[0] && s.d <= dates[6] && !isOwner(s.role)).map(s => toShift(s))
  const lastWeek = r.sched.filter(s => s.d >= last && s.d < dates[0] && !isOwner(s.role)).map(s => toShift(s))
  const managerThis = r.sched.filter(s => s.d >= dates[0] && s.d <= dates[6] && isSalaried(s.role))
  const fixed = (managerThis.length ? managerThis.map(s => toShift(s))
    : r.sched.filter(s => s.d >= last && s.d < dates[0] && isSalaried(s.role)).map(s => toShift(s, 7)))

  const net = new Map(r.netByDay.map(x => [x.d, Number(x.net)]))
  // A whole week of sales, or null. A holiday with no sales is a day the store was closed
  // (Christmas, Thanksgiving), not missing data.
  const weekNet = (tue: string) => {
    const ds = weekDates(tue)
    if (ds.some(d => !net.has(d) && !holidayName(d))) return null
    return Math.round(ds.reduce((t, d) => t + (net.get(d) ?? 0), 0))
  }
  const last4 = [4, 3, 2, 1].map(k => isoAdd(cmpTue, -7 * k))
    .map(t => ({ tuesday: t, net: weekNet(t) })).filter((w): w is { tuesday: string; net: number } => w.net != null)
  const latest = (xs: { loaded: string }[]) => xs.reduce<string | null>((m, x) => (!m || x.loaded > m ? x.loaded : m), null)

  const onRoster = new Set(people.map(p => p.key))
  const elsewhere: ElsewhereShift[] = r.other.filter(o => onRoster.has(o.key))
    .map(o => ({ date: o.d, s: hm(o.st), e: hm(o.et), key: o.key, store: o.store }))
    .filter(o => o.e > o.s)

  let actual: WeekActual | null = null
  if (actualTo) {
    const salesOf = new Map(r.actSales.map(x => [x.d, Number(x.net)]))
    const laborOf = new Map(r.actLabor.map(x => [x.d, x]))
    actual = {
      days: dates.filter(d => d <= actualTo).map(d => ({
        date: d, sales: salesOf.get(d) ?? 0,
        hours: laborOf.has(d) ? Number(laborOf.get(d)!.hours) : null,
        pay: laborOf.has(d) ? Number(laborOf.get(d)!.pay) : null,
      })),
      worked: r.actShifts.map(w => {
        const s0 = hm(w.st), e0 = w.et ? hm(w.et) : null
        return { date: w.d, key: w.key, name: w.employee, basis: w.basis, s: s0, e: e0 == null ? null : e0 < s0 ? e0 + 1440 : e0 }  // past midnight
      }),
      pulledAt: r.pull[0]?.ok_at ? hm(r.pull[0].ok_at.slice(11, 16)) : null,
    }
  }
  return {
    store: store.name, tuesday, mode, days, ifOpen, people, posted: { thisWeek, lastWeek }, fixed, elsewhere, actual,
    asOf: { availability: latest(r.avail), timeOff: latest(r.off) },
    compare: { last4, lastYear: weekNet(isoAdd(tuesday, -364)) },
  }
}
