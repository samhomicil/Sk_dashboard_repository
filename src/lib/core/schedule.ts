import {
  UNITS_PER_PERSON_HALF_HOUR, BUSY_RANK, HIST_WEEKS, TRUCK_WINDOWS, DELIVERY_DOWS, LABOR_TARGET, WEEKLY_OT_HOURS,
  CREW_HOURS, CLOSE_MIN_PEOPLE, SHIFT_MIN_HOURS, SHIFT_MAX_HOURS, RUSH_UNITS,
} from './targets'
import { dowOf, hmToMin, isoAdd } from './dates'
import { checkMinorSchedule, ageOn, MINOR_RULE_LABEL, type ScheduledShift } from '../minorLabor'

/**
 * THE SCHEDULE BUILDER — a week's draft schedule, and everything said about any schedule.
 *
 * Pure: the route fetches, this decides, and the page calls the same functions live as the
 * manager edits, so the server's draft and the screen's checks can never disagree.
 *
 * NEED, per half-hour   max(1, ⌈busy units ÷ UNITS_PER_PERSON_HALF_HOUR⌉) — the Now page's
 *                       send-home rule, planned for a BUSY version of the day (the BUSY_RANK-th
 *                       busiest of the last HIST_WEEKS same weekdays). Not a setting: on days
 *                       that run slower, the Now page's send-home calls recover the cushion.
 *                       +1 inside TRUCK_WINDOWS on DELIVERY_DOWS; CLOSE_MIN_PEOPLE in the last
 *                       half-hour so nobody closes alone.
 * SHIFTS                the fewest person-hours that meet every half-hour's need, each shift
 *                       SHIFT_MIN_HOURS–SHIFT_MAX_HOURS — exact (dynamic programming), not
 *                       greedy: greedy and layered builders wasted 25–50 h a week at Margate.
 * PEOPLE                most-below-their-usual-hours first; never into "not available"
 *                       (NetChef) or approved time off (Teamworx), never two shifts a day,
 *                       never over WEEKLY_OT_HOURS, minors within core minorLabor's rules.
 * COST                  hours × each person's rate; salaried shifts cost 0 here (their pay is
 *                       a fixed line), exactly as core/labor schedRate prices a plan.
 */

export const SLOT = 30

export type Block = { st: 'N' | 'P' | 'A'; a: number; z: number }           // minutes, z exclusive
export type Off = { a: number; z: number; status: 'approved' | 'pending' }

export type SchedPerson = {
  key: string                      // canonical identity (core/employee)
  name: string                     // "First Last"
  short: string                    // "First L."
  role: string
  rate: number                     // per hour; 0 for salaried
  salaried: boolean
  dob: string | null
  entered: boolean                 // has a standing availability grid on file in NetChef
  usual: number | null             // average weekly scheduled hours here (USUAL_HOURS_WEEKS)
  avail: Record<string, Block[]>   // by date: N and P blocks only
  off: Record<string, Off[]>       // by date, clipped to that day
}

export type SchedShift = { id: number; date: string; s: number; e: number; key: string | null }

/** A shift the same person has at ANOTHER store this week (posted in Brink). Not editable
 *  here, but it counts toward their overtime and minor-labor hours: three people work at
 *  both Pines and Miramar, and a per-store count would let either store push them over. */
export type ElsewhereShift = { date: string; s: number; e: number; key: string; store: string }

/** How a holiday changes a day (lib/holidayPlan): a forecast factor, closed last year, or
 *  last year's first/last sale for short-hour days. */
export type DayHoliday = { name: string; factor: number | null; closed: boolean; hours: [number, number] | null }

export type SchedDay = {
  date: string
  dow: number                      // JS getDay
  a: number                        // crew on, minutes
  z: number                        // crew off
  sales: number                    // forecast net sales
  units: number[]                  // busy-day made units per slot from `a`
  need: number[]                   // people needed per slot from `a`
  holiday: DayHoliday | null       // closed last year → a = z, no slots, sales 0
}

/** One half-hour of history: the shape core/sources.ts salesBySlot returns. */
export type HistSlot = { d: string; slot: number; units: number; net: number }

// ── need ──────────────────────────────────────────────────────────────────────────

/**
 * The days of a business week with their forecast and need. `hist` must hold, for each
 * weekday of the week, the HIST_WEEKS same weekdays before the planning date — the same
 * history the Now page and Weekly Ops read.
 */
export function planDays(store: string, dates: string[], hist: HistSlot[], holidays: Map<string, DayHoliday> = new Map()): SchedDay[] {
  const byDay = new Map<string, Map<number, HistSlot>>()
  for (const h of hist) {
    if (!byDay.has(h.d)) byDay.set(h.d, new Map())
    byDay.get(h.d)!.set(Number(h.slot), h)
  }
  return dates.map(date => {
    const dow = dowOf(date)
    const [on, off] = CREW_HOURS[store][dow]
    let hol = holidays.get(date) ?? null
    if (hol?.closed) return { date, dow, a: hmToMin(on), z: hmToMin(on), sales: 0, units: [], need: [], holiday: hol }
    // A short-hour holiday keeps last year's trading window: crew in half an hour before the
    // first sale and out half an hour after the last, never outside the usual crew hours.
    // Only when that trims an hour or more — an ordinary day's first and last sale sit
    // inside the crew hours anyway.
    let a = hmToMin(on), z = hmToMin(off)
    if (hol?.hours) {
      const a2 = Math.max(a, Math.floor(hol.hours[0] / SLOT) * SLOT - SLOT)
      const z2 = Math.min(z, Math.ceil(hol.hours[1] / SLOT) * SLOT + SLOT)
      if ((a2 - a) + (z - z2) >= 60 && z2 - a2 >= 4 * 60) { a = a2; z = z2 } else hol = { ...hol, hours: null }
    }
    const f = hol?.factor ?? 1
    const same = [...byDay.keys()].filter(d => dowOf(d) === dow && d < date).sort().slice(-HIST_WEEKS)
    // forecast = mean daily net of those days, sales days only (core/forecast.ts rule)
    const nets = same.map(d => [...byDay.get(d)!.values()].reduce((t, s) => t + Number(s.net), 0)).filter(n => n > 0)
    const sales = nets.length ? Math.round((nets.reduce((t, n) => t + n, 0) / nets.length) * f) : 0
    const units: number[] = [], need: number[] = []
    const truck = TRUCK_WINDOWS[store] && (DELIVERY_DOWS[store] ?? []).includes(dow) ? TRUCK_WINDOWS[store] : null
    for (let m = a; m < z; m += SLOT) {
      const v = same.map(d => Number(byDay.get(d)!.get(m / SLOT)?.units ?? 0)).sort((x, y) => y - x)
      const busy = (v.length ? v[Math.min(BUSY_RANK, v.length) - 1] : 0) * f
      units.push(busy)
      const mid = m + SLOT / 2
      need.push(Math.max(1, Math.ceil(busy / UNITS_PER_PERSON_HALF_HOUR))
        + (truck && hmToMin(truck[0]) <= mid && mid < hmToMin(truck[1]) ? 1 : 0))
    }
    if (need.length) need[need.length - 1] = Math.max(need[need.length - 1], CLOSE_MIN_PEOPLE)
    return { date, dow, a, z, sales, units, need, holiday: hol }
  })
}

// ── shifts ────────────────────────────────────────────────────────────────────────

/**
 * The fewest person-hours that meet `need` (people per slot, already net of any fixed
 * shifts), each shift SHIFT_MIN_HOURS–SHIFT_MAX_HOURS. Exact: state at each slot boundary =
 * how long each shift still on has run; any past the minimum may end, one at the maximum
 * must, any number may start. Cost = person-slots + one per shift started (fewer, longer
 * shifts win ties). Returns [startSlot, endSlot) pairs.
 */
export function coverNeed(need: number[]): [number, number][] {
  const MIN = SHIFT_MIN_HOURS * 2, MAX = SHIFT_MAX_HOURS * 2, OVER = 2, PER_SHIFT = 1
  const T = need.length
  type Back = { prev: string; ended: number[]; t: number } | null
  let layer = new Map<string, { cost: number; back: Back }>([['', { cost: 0, back: null }]])
  const layers: Map<string, { cost: number; back: Back }>[] = [layer]
  const enc = (s: number[]) => s.join(',')
  const dec = (k: string) => (k ? k.split(',').map(Number) : [])
  for (let t = 0; t < T; t++) {
    const next = new Map<string, { cost: number; back: Back }>()
    const n = need[t]
    for (const [key, { cost }] of layer) {
      const state = dec(key)
      const endable = state.map((e, i) => (e >= MIN ? i : -1)).filter(i => i >= 0)
      const forced = state.map((e, i) => (e >= MAX ? i : -1)).filter(i => i >= 0)
      const seen = new Set<string>()
      for (let mask = 0; mask < 1 << endable.length; mask++) {
        const ends = endable.filter((_, j) => mask & (1 << j))
        if (!forced.every(i => ends.includes(i))) continue
        const keep = state.filter((_, i) => !ends.includes(i)).sort((x, y) => x - y)
        const ended = ends.map(i => state[i]).sort((x, y) => x - y)
        const sig = enc(keep) + '|' + enc(ended)
        if (seen.has(sig)) continue
        seen.add(sig)
        for (let k = 0; k <= Math.max(0, n) + OVER; k++) {
          const on = keep.length + k
          if (on < n || on > Math.max(n, 0) + OVER) continue
          const ns = enc([...keep.map(e => e + 1), ...Array(k).fill(1)].sort((x, y) => x - y))
          const c = cost + on + PER_SHIFT * k
          const cur = next.get(ns)
          if (!cur || c < cur.cost) next.set(ns, { cost: c, back: { prev: key, ended, t } })
        }
      }
    }
    layer = next
    layers.push(layer)
  }
  let best: { cost: number; key: string } | null = null
  for (const [key, { cost }] of layer) {
    if (dec(key).every(e => e >= MIN) && (!best || cost < best.cost)) best = { cost, key }
  }
  if (!best) return []
  const out: [number, number][] = dec(best.key).map(e => [T - e, T])
  let key = best.key
  for (let t = T; t > 0; t--) {
    const back = layers[t].get(key)!.back!
    for (const e of back.ended) out.push([back.t - e, back.t])
    key = back.prev
  }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1])
}

// ── checks ────────────────────────────────────────────────────────────────────────

export type Issue = { tone: 'bad' | 'warn'; text: string }

const clock = (m: number) => {
  if (m >= 1440) return 'midnight'
  const h = Math.floor(m / 60), mm = m % 60
  return `${((h + 11) % 12) + 1}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`
}
export { clock as schedClock }
const overlap = (a: number, z: number, b: { a: number; z: number }) => b.a < z && b.z > a

/** Minor-labor rules from core minorLabor — one rulebook for posted and drafted schedules. */
function minorIssues(store: string, shifts: SchedShift[], people: Map<string, SchedPerson>, elsewhere: ElsewhereShift[] = []): Map<number, Issue[]> {
  const dob = new Map<string, string>()
  people.forEach(p => { if (p.dob) dob.set(p.key, p.dob) })
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const other: (ScheduledShift & { id: number })[] = elsewhere.filter(s => people.has(s.key)).map(s => ({
    id: -1, employeeKey: s.key, employee: people.get(s.key)!.name, store: s.store, date: s.date,
    startTime: hhmm(s.s), endTime: hhmm(s.e), hours: (s.e - s.s) / 60,
  }))
  const posted: (ScheduledShift & { id: number })[] = shifts.filter(s => s.key).map(s => ({
    id: s.id, employeeKey: s.key!, employee: people.get(s.key!)?.name ?? s.key!, store, date: s.date,
    startTime: `${String(Math.floor(s.s / 60)).padStart(2, '0')}:${String(s.s % 60).padStart(2, '0')}`,
    endTime: `${String(Math.floor(s.e / 60)).padStart(2, '0')}:${String(s.e % 60).padStart(2, '0')}`,
    hours: (s.e - s.s) / 60,
  }))
  const out = new Map<number, Issue[]>()
  for (const v of checkMinorSchedule([...posted, ...other], dob)) {
    const hit = v.rule === 'over-30h-school-week'
      ? posted.filter(p => p.employeeKey === v.employeeKey)
      : posted.filter(p => p.employeeKey === v.employeeKey && p.date === v.date && p.store === v.store)
    for (const p of hit) {
      const list = out.get(p.id) ?? []
      const across = v.rule === 'over-30h-school-week' && other.some(o => o.employeeKey === v.employeeKey) ? ' (both stores)' : ''
      list.push({ tone: 'bad', text: `${people.get(v.employeeKey)?.short ?? v.employee} (${v.age}): ${MINOR_RULE_LABEL[v.rule]} — ${v.detail}${across}` })
      out.set(p.id, list)
    }
  }
  return out
}

export type DayResult = {
  date: string
  hours: number
  wages: number
  pct: number                       // wages ÷ forecast sales × 100
  on: number[]                      // people on per slot
  short: number                     // slots below need
  alone: boolean                    // fewer than CLOSE_MIN_PEOPLE at close
  bad: string[]                     // what must be fixed, plain words
  warn: string[]
  words: string[]                   // the short status chip(s)
}

export type Evaluation = {
  days: DayResult[]
  issues: Map<number, Issue[]>      // by shift id
  weekHours: Map<string, number>    // by person key — this store
  elsewhereHours: Map<string, { store: string; hours: number }[]>  // by person key — other stores
  crew: string[]                    // person-level problems (overtime, minor weekly hours)
  hours: number
  wages: number
  sales: number
  pct: number
  short: number
  alone: number
}

/** Everything said about a schedule, derived from its shifts alone. */
/** `from` judges a day only from that minute on (today, mid-shift): a half-hour that has
 *  already passed short, or a rule broken by a shift already under way, can't be fixed. */
export function evaluate(store: string, days: SchedDay[], shifts: SchedShift[], peopleList: SchedPerson[], elsewhere: ElsewhereShift[] = [], from: Record<string, number> = {}): Evaluation {
  const people = new Map(peopleList.map(p => [p.key, p]))
  const minors = minorIssues(store, shifts, people, elsewhere)
  const elsewhereHours = new Map<string, { store: string; hours: number }[]>()
  for (const o of elsewhere) if (people.has(o.key)) {
    const list = elsewhereHours.get(o.key) ?? []
    const at = list.find(x => x.store === o.store)
    if (at) at.hours += (o.e - o.s) / 60; else list.push({ store: o.store, hours: (o.e - o.s) / 60 })
    elsewhereHours.set(o.key, list)
  }
  const otherHours = (k: string) => (elsewhereHours.get(k) ?? []).reduce((t, x) => t + x.hours, 0)
  const issues = new Map<number, Issue[]>()
  const weekHours = new Map<string, number>()
  const perDayCount = new Map<string, number>()
  for (const s of shifts) if (s.key) {
    weekHours.set(s.key, (weekHours.get(s.key) ?? 0) + (s.e - s.s) / 60)
    perDayCount.set(`${s.key}|${s.date}`, (perDayCount.get(`${s.key}|${s.date}`) ?? 0) + 1)
  }
  for (const s of shifts) {
    const list: Issue[] = []
    const p = s.key ? people.get(s.key) : undefined
    if (!s.key) list.push({ tone: 'warn', text: `Open shift ${clock(s.s)}–${clock(s.e)} — nobody assigned` })
    else if (!p) list.push({ tone: 'warn', text: `${s.key} is not on this store's active roster` })
    else {
      for (const b of p.avail[s.date] ?? []) if (b.st === 'N' && overlap(s.s, s.e, b)) {
        list.push({ tone: 'bad', text: `${p.short} is not available ${b.a <= 390 && b.z >= 1440 ? 'all day' : `${clock(b.a)}–${clock(b.z)}`}` })
      }
      for (const b of p.off[s.date] ?? []) if (overlap(s.s, s.e, b)) {
        list.push(b.status === 'approved'
          ? { tone: 'bad', text: `${p.short} has approved time off` }
          : { tone: 'warn', text: `${p.short} has a time-off request pending` })
      }
      if ((perDayCount.get(`${s.key}|${s.date}`) ?? 0) > 1) list.push({ tone: 'bad', text: `${p.short} has two shifts this day` })
      list.push(...(minors.get(s.id) ?? []))
    }
    issues.set(s.id, list)
  }
  const crew: string[] = []
  weekHours.forEach((h, k) => {
    const p = people.get(k), o = otherHours(k)
    if (p && !p.salaried && h + o > WEEKLY_OT_HOURS) {
      crew.push(`${p.name}: ${(h + o).toFixed(1)} h${o ? ` (${h.toFixed(1)} here + ${o.toFixed(1)} at ${(elsewhereHours.get(k) ?? []).map(x => x.store).join(', ')})` : ''} — overtime past ${WEEKLY_OT_HOURS} h`)
    }
  })
  const result = days.map(day => {
    const list = shifts.filter(s => s.date === day.date)
    const on = day.need.map((_, i) => {
      const c = day.a + i * SLOT
      return list.filter(s => s.s <= c && s.e >= c + SLOT).length
    })
    let hours = 0, wages = 0
    for (const s of list) {
      const h = (s.e - s.s) / 60, p = s.key ? people.get(s.key) : undefined
      hours += h
      wages += h * (p ? p.rate : 0)
    }
    const cut = from[day.date] ?? -Infinity
    const shortSlots = on.map((o, i) => (o < day.need[i] && day.a + i * SLOT >= cut ? i : -1)).filter(i => i >= 0)
    const alone = on.length > 0 && on[on.length - 1] < CLOSE_MIN_PEOPLE
    const bad: string[] = [], warn: string[] = []
    if (shortSlots.length) bad.push(`Short ${shortSlots.length === 1 ? 'for half an hour' : `for ${(shortSlots.length / 2).toFixed(1)} h`} (${shortSlots.slice(0, 3).map(i => clock(day.a + i * SLOT)).join(', ')}${shortSlots.length > 3 ? '…' : ''})`)
    if (alone) bad.push(on[on.length - 1] ? 'One person closes alone' : 'Nobody is on at close')
    let rules = 0
    for (const s of list) if (s.s >= cut) for (const it of issues.get(s.id) ?? []) {
      if (it.tone === 'bad') { bad.push(it.text); rules++ } else warn.push(it.text)
    }
    const words: string[] = []
    if (shortSlots.length) words.push(`Short ${(shortSlots.length / 2).toFixed(1)} h`)
    if (alone) words.push('Closes alone')
    if (rules) words.push(rules === 1 ? 'Rule broken' : `${rules} rules broken`)
    return { date: day.date, hours, wages, pct: day.sales ? (wages / day.sales) * 100 : 0, on, short: shortSlots.length, alone, bad, warn, words }
  })
  const hours = result.reduce((t, d) => t + d.hours, 0)
  const wages = result.reduce((t, d) => t + d.wages, 0)
  const sales = days.reduce((t, d) => t + d.sales, 0)
  return {
    days: result, issues, weekHours, elsewhereHours, crew, hours, wages, sales, pct: sales ? (wages / sales) * 100 : 0,
    short: result.reduce((t, d) => t + d.short, 0), alone: result.filter(d => d.alone).length,
  }
}

// ── the draft ─────────────────────────────────────────────────────────────────────

/**
 * Build a draft: fixed shifts (e.g. the salaried manager's) stay as given and count toward
 * coverage; hourly shifts are built for what is left, then filled — most constrained shift
 * first, each to the eligible person furthest below their usual hours (preferred time and
 * availability on file break ties). A shift nobody can legally take stays open.
 */
export function draftWeek(store: string, days: SchedDay[], people: SchedPerson[], fixed: SchedShift[] = [], elsewhere: ElsewhereShift[] = []): SchedShift[] {
  let id = fixed.reduce((m, s) => Math.max(m, s.id), 0)
  const shifts: SchedShift[] = fixed.map(s => ({ ...s }))
  const open: SchedShift[] = []
  for (const day of days) {
    const fixedHere = fixed.filter(s => s.date === day.date)
    const rest = day.need.map((n, i) => {
      const c = day.a + i * SLOT
      return Math.max(0, n - fixedHere.filter(s => s.s <= c && s.e >= c + SLOT).length)
    })
    for (const [s0, s1] of coverNeed(rest)) open.push({ id: ++id, date: day.date, s: day.a + s0 * SLOT, e: day.a + s1 * SLOT, key: null })
  }
  const hourly = people.filter(p => !p.salaried)
  const hours = new Map<string, number>()
  for (const s of shifts) if (s.key) hours.set(s.key, (hours.get(s.key) ?? 0) + (s.e - s.s) / 60)
  for (const o of elsewhere) hours.set(o.key, (hours.get(o.key) ?? 0) + (o.e - o.s) / 60)
  const fits = (p: SchedPerson, s: SchedShift): number | null => {
    if (shifts.some(x => x.key === p.key && x.date === s.date)) return null
    if (elsewhere.some(x => x.key === p.key && x.date === s.date && overlap(s.s, s.e, { a: x.s, z: x.e }))) return null
    if ((p.off[s.date] ?? []).some(b => b.status === 'approved' && overlap(s.s, s.e, b))) return null
    if ((p.avail[s.date] ?? []).some(b => b.st === 'N' && overlap(s.s, s.e, b))) return null
    const h = (s.e - s.s) / 60, have = hours.get(p.key) ?? 0
    if (have + h > WEEKLY_OT_HOURS) return null
    if (p.dob && ageOn(p.dob, s.date) < 18) {
      const trial = [...shifts.filter(x => x.key === p.key), { ...s, key: p.key }]
      if (minorIssues(store, trial, new Map([[p.key, p]]), elsewhere).size) return null
    }
    const pref = (p.avail[s.date] ?? []).filter(b => b.st === 'P' && overlap(s.s, s.e, b))
      .reduce((t, b) => t + Math.min(s.e, b.z) - Math.max(s.s, b.a), 0)
    const hereHave = shifts.filter(x => x.key === p.key).reduce((t, x) => t + (x.e - x.s) / 60, 0)
    return ((p.usual ?? 20) - hereHave) + (pref >= (s.e - s.s) / 2 ? 4 : 0) - (p.entered ? 0 : 2)
  }
  while (open.length) {
    let pick = -1, cands: [number, SchedPerson][] = []
    open.forEach((s, i) => {
      const c = hourly.map(p => [fits(p, s), p] as [number | null, SchedPerson]).filter(x => x[0] != null) as [number, SchedPerson][]
      if (pick < 0 || c.length < cands.length || (c.length === cands.length && s.e - s.s > open[pick].e - open[pick].s)) { pick = i; cands = c }
    })
    const s = open.splice(pick, 1)[0]
    if (cands.length) {
      const [, p] = cands.sort((x, y) => y[0] - x[0] || x[1].rate - y[1].rate)[0]
      s.key = p.key
      hours.set(p.key, (hours.get(p.key) ?? 0) + (s.e - s.s) / 60)
    }
    shifts.push(s)
  }
  return shifts.sort((x, y) => x.date.localeCompare(y.date) || x.s - y.s || x.e - y.e)
}

// ── the day in words ──────────────────────────────────────────────────────────────

/** "Busiest day of the week. Rushes around 8a–4p, 5:30–8:30p." — and a short form for lists. */
export function expectation(days: SchedDay[], i: number): { tag: string; text: string; short: string } {
  const day = days[i]
  if (day.holiday?.closed) {
    return { tag: day.holiday.name, text: `${day.holiday.name}. The store was closed on it last year, so nothing is planned — add shifts if you're opening.`, short: 'Closed last year' }
  }
  const hol = day.holiday ? `${day.holiday.name}${day.holiday.factor != null ? ` — forecast at ${Math.round(day.holiday.factor * 100)}% of a normal ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day.dow]}, from last year` : ''}${day.holiday.hours ? `. Short hours last year (sales ${clock(day.holiday.hours[0])}–${clock(day.holiday.hours[1])}), so the crew is planned ${clock(day.a)}–${clock(day.z)}` : ''}. ` : ''
  const sales = days.filter(d => !d.holiday?.closed).map(d => d.sales)
  const rank = day.sales === Math.max(...sales) ? 'Busiest day of the week.'
    : day.sales === Math.min(...sales) ? 'Quietest day of the week.' : ''
  const runs: { a: number; z: number; n: number }[] = []
  let cur: { a: number; z: number; n: number } | null = null
  day.units.forEach((u, k) => {
    if (u < RUSH_UNITS) return
    if (cur && k - cur.z <= 2) { cur.z = k + 1; cur.n++ }      // a lull of up to an hour is still the same rush
    else { cur = { a: k, z: k + 1, n: 1 }; runs.push(cur) }
  })
  const when = runs.filter(r => r.n >= 2).map(r => {
    const a = day.a + r.a * SLOT, z = day.a + r.z * SLOT
    const sa = clock(a), sz = clock(z)
    return (sa.slice(-1) === sz.slice(-1) ? sa.slice(0, -1) : sa) + '–' + sz
  })
  const rush = when.length ? `Rush${when.length > 1 ? 'es' : ''} around ${when.join(', ')}.` : 'No real rush expected — steady and light.'
  return { tag: day.holiday?.name ?? rank.replace(' of the week.', ''), text: hol + (rank ? rank + ' ' : '') + rush, short: when.length ? 'Rush ' + when.join(', ') : 'No rush expected' }
}

/** The business week (Tue–Mon) that starts on `tuesday`. */
export const weekDates = (tuesday: string) => Array.from({ length: 7 }, (_, i) => isoAdd(tuesday, i))

export const LABOR_GOAL = LABOR_TARGET * 100
