import {
  UNITS_PER_PERSON_HALF_HOUR, TRUCK_WINDOWS, DELIVERY_DOWS, SEND_HOME_MIN_HOURS, BUSY_RANK,
  PACE_CLAMP, LATE_MINUTES,
} from './targets'
import { dowOf, hmToMin } from './dates'
import { buildForecaster } from './forecast'
import { isSalaried } from './labor'

/**
 * THE NOW SCREEN — a store's day while it is still running, and the send-home calls.
 *
 * Pure: the route fetches, this decides. Everything is computed AS OF the moment the data
 * was pulled (`asOf`, the last brink-intraday run), never the wall clock: between pulls the
 * clock runs ahead of the data, and comparing sales through 9:27 against a "normal" through
 * 9:50 would read every store as behind.
 *
 * SEND-HOME RULE (Sam, 2026-10-01; September backtest ~$2,250/mo, one overloaded crew):
 *   forecast  each remaining half-hour's made units = the BUSY_RANK-th busiest of the last
 *             HIST_WEEKS same weekdays × today's pace (units so far ÷ usual by now, clamped)
 *   need      max(1, ⌈forecast ÷ UNITS_PER_PERSON_HALF_HOUR⌉), +1 inside the truck window on
 *             a delivery day. One person is enough when the units say so — no fixed two.
 *   who       the crew member with the most shift left, if every remaining half-hour of
 *             that shift stays covered by the people still there or scheduled to arrive.
 *             Never: the closer, a salaried manager (no saving), anyone with under
 *             SEND_HOME_MIN_HOURS left, or the last shift lead on the floor.
 */

export type SlotRow = { store: string; d: string; slot: number; net: number; units: number; orders: number }
/** A clocked shift today (vw_labor_floor_shifts, basis 'clock'). end null = still on the clock. */
export type ClockRow = { employee: string; role: string; start: string; end: string | null }
/** A scheduled shift today (labor_schedule). */
export type PlanRow = { employee: string; role: string; start: string; end: string }

export type Person = {
  employee: string
  role: string
  salaried: boolean
  lead: boolean
  inAt: number | null           // clock-in, minutes after midnight ET
  outAt: number | null          // clock-out, when the shift is over
  schedStart: number | null
  schedEnd: number | null
  /** on = on the clock · coming = scheduled later · late = scheduled, past due, not in ·
   *  noshow = scheduled shift is over and never clocked in · done = clocked out */
  status: 'on' | 'coming' | 'late' | 'noshow' | 'done'
  /** minutes late at clock-in, or minutes overdue while still not in (> LATE_MINUTES only) */
  lateBy: number | null
}

export type Call = {
  employee: string
  role: string
  plannedEnd: number            // when they are scheduled to leave
  hours: number                 // shift hours saved by leaving at asOf
  dollars: number
  /** busiest forecast half-hour left in their shift, and who would still be there */
  peakUnits: number
  peakAt: number
  headsLeft: number
  capacity: number              // headsLeft × UNITS_PER_PERSON_HALF_HOUR
  truck: boolean                // their shift overlaps today's truck window
}

export type HourRow = {
  hour: number                  // 0–23
  actual: number | null         // net sales, hours already (partly) run
  normal: number                // usual net for this hour
  projected: number | null      // usual × today's pace, hours still to come
  units: number | null          // made units actually sold
}

export type AheadRow = {
  from: number; to: number      // minutes
  units: number                 // expected made units (usual × pace)
  busyUnits: number             // the staffing forecast (busy version × pace)
  need: number                  // people the BUSY forecast needs — the send-home test
  needUsual: number             // people the USUAL forecast needs — fewer on than this is short
  heads: number                 // fewest people on in the stretch, as scheduled
}

export type StoreNow = {
  store: string
  asOf: number
  open: { from: number; to: number } | null
  truck: { from: number; to: number } | null
  pace: { units: number; net: number }
  sales: {
    soFar: number; normalByNow: number; normalDay: number; onPace: number
    orders: number; units: number; byHour: HourRow[]
  }
  labor: {
    paySoFar: number
    pctSoFar: number | null
    finishPct: number | null
    remainingHours: number
    remainingCost: number
  }
  people: Person[]
  ahead: AheadRow[]
  calls: Call[]
}

const LEAD = /manager|captain|lead/i
const SLOT = 30

function sumBy<T>(xs: T[], f: (x: T) => number) { return xs.reduce((s, x) => s + f(x), 0) }
function clamp(x: number, [lo, hi]: readonly [number, number]) { return Math.min(hi, Math.max(lo, x)) }
/** End-of-shift minutes; a shift that ends "earlier" than it starts crosses midnight. */
function endMin(start: number, end: string | null): number | null {
  if (end == null) return null
  const e = hmToMin(end)
  return e <= start ? e + 1440 : e
}

/**
 * Pair each employee's scheduled shift(s) with their clock-in(s), nearest start first, and
 * give every person a status as of `asOf`. Salaried managers come from the schedule only —
 * their clock is unusable (Brink auto-closes it ~1:15am), the same rule LABOR_SHIFTS uses.
 */
export function buildPeople(clock: ClockRow[], plan: PlanRow[], asOf: number): Person[] {
  const out: Person[] = []
  const crewPlan = plan.filter(p => !isSalaried(p.role))
  const used = new Set<number>()
  for (const c of clock) {
    if (isSalaried(c.role)) continue
    const inAt = hmToMin(c.start)
    const outAt = endMin(inAt, c.end)
    // nearest unused scheduled shift for the same person, within 3 hours of the clock-in
    let best = -1, gap = 181
    crewPlan.forEach((p, i) => {
      if (used.has(i) || p.employee !== c.employee) return
      const g = Math.abs(hmToMin(p.start) - inAt)
      if (g < gap) { gap = g; best = i }
    })
    const p = best >= 0 ? crewPlan[best] : null
    if (best >= 0) used.add(best)
    const schedStart = p ? hmToMin(p.start) : null
    const schedEnd = p ? endMin(hmToMin(p.start), p.end) : null
    const late = schedStart != null && inAt - schedStart > LATE_MINUTES ? inAt - schedStart : null
    out.push({
      employee: c.employee, role: c.role || (p?.role ?? ''), salaried: false, lead: LEAD.test(c.role || ''),
      inAt, outAt, schedStart, schedEnd,
      status: outAt != null && outAt <= asOf ? 'done' : 'on',
      lateBy: late,
    })
  }
  crewPlan.forEach((p, i) => {
    if (used.has(i)) return
    const s = hmToMin(p.start), e = endMin(s, p.end)!
    const overdue = asOf - s
    const status: Person['status'] = e <= asOf ? 'noshow' : overdue > LATE_MINUTES ? 'late' : 'coming'
    out.push({
      employee: p.employee, role: p.role, salaried: false, lead: LEAD.test(p.role),
      inAt: null, outAt: null, schedStart: s, schedEnd: e, status,
      lateBy: status === 'late' || status === 'noshow' ? Math.min(overdue, e - s) : null,
    })
  })
  for (const p of plan.filter(x => isSalaried(x.role))) {
    const s = hmToMin(p.start), e = endMin(s, p.end)!
    out.push({
      employee: p.employee, role: p.role, salaried: true, lead: true,
      inAt: s <= asOf ? s : null, outAt: e <= asOf ? e : null, schedStart: s, schedEnd: e,
      status: e <= asOf ? 'done' : s <= asOf ? 'on' : 'coming', lateBy: null,
    })
  }
  return out
}

/** When a person is expected to be on the floor, from asOf on: [from, to) or null. */
function presence(p: Person, asOf: number, closeAt: number): [number, number] | null {
  if (p.status === 'on') {
    const to = p.salaried ? p.schedEnd! : (p.schedEnd ?? closeAt)   // unscheduled: assume they stay
    return [p.inAt ?? asOf, to]
  }
  if (p.status === 'coming') return [p.schedStart!, p.schedEnd!]
  return null                                                       // late / no-show / done: not counted
}

export function buildStoreNow(input: {
  store: string
  today: string
  asOf: number
  todaySlots: SlotRow[]
  /** the HIST_WEEKS same weekdays before today, this store */
  histSlots: SlotRow[]
  clock: ClockRow[]
  plan: PlanRow[]
  rateFor: (store: string, emp: string) => number
}): StoreNow {
  const { store, today, asOf, todaySlots, histSlots, clock, plan, rateFor } = input

  // ── history: sales days only, as buildForecaster counts them ────────────────
  const dayNet = new Map<string, number>()
  for (const r of histSlots) dayNet.set(r.d, (dayNet.get(r.d) ?? 0) + Number(r.net || 0))
  const days = [...dayNet].filter(([, v]) => v > 0).map(([d]) => d)
  const n = days.length
  const grid = (key: 'net' | 'units', rows: SlotRow[]) => {
    const by = new Map<string, number>()
    for (const r of rows) by.set(`${r.d}|${r.slot}`, Number(r[key] || 0))
    return (d: string, s: number) => by.get(`${d}|${s}`) ?? 0
  }
  const hNet = grid('net', histSlots), hUnits = grid('units', histSlots)
  const meanNet = Array.from({ length: 48 }, (_, s) => n ? sumBy(days, d => hNet(d, s)) / n : 0)
  const meanUnits = Array.from({ length: 48 }, (_, s) => n ? sumBy(days, d => hUnits(d, s)) / n : 0)
  const busyUnits = Array.from({ length: 48 }, (_, s) => {
    const v = days.map(d => hUnits(d, s)).sort((a, b) => b - a)
    return v.length ? v[Math.min(BUSY_RANK, v.length) - 1] : 0
  })
  const normalDay = buildForecaster(
    days.map(d => ({ store, d, net: dayNet.get(d)! })))(store, today)

  // ── today, as of the pull ────────────────────────────────────────────────────
  const tNet = new Array<number>(48).fill(0), tUnits = new Array<number>(48).fill(0)
  let orders = 0
  for (const r of todaySlots) {
    tNet[r.slot] += Number(r.net || 0); tUnits[r.slot] += Number(r.units || 0); orders += Number(r.orders || 0)
  }
  const done = Math.floor(asOf / SLOT)                      // slots fully behind the pull
  const frac = (asOf % SLOT) / SLOT                         // share of the current slot elapsed
  const soFarNet = sumBy(tNet, x => x), soFarUnits = sumBy(tUnits, x => x)
  const upTo = (a: number[]) => sumBy(a.slice(0, done), x => x) + (a[done] ?? 0) * frac
  const normalByNow = upTo(meanNet)
  // Pace from completed half-hours only, the way the backtest measured it.
  const doneU = sumBy(tUnits.slice(0, done), x => x), usualU = sumBy(meanUnits.slice(0, done), x => x)
  const doneN = sumBy(tNet.slice(0, done), x => x), usualN = sumBy(meanNet.slice(0, done), x => x)
  const pace = {
    units: usualU > 0 ? clamp(doneU / usualU, PACE_CLAMP) : 1,
    net: usualN > 0 ? clamp(doneN / usualN, PACE_CLAMP) : 1,
  }
  const restNet = sumBy(meanNet.slice(done + 1), x => x) * pace.net
    + Math.max(0, meanNet[done] * pace.net - tNet[done])
  const onPace = soFarNet + restNet

  // ── opening hours: the span the usual day actually trades ──────────────────
  const tradingSlots = meanUnits.map((u, s) => (u > 0 || tUnits[s] > 0 ? s : -1)).filter(s => s >= 0)
  const open = tradingSlots.length
    ? { from: tradingSlots[0] * SLOT, to: (tradingSlots[tradingSlots.length - 1] + 1) * SLOT } : null

  // ── truck ───────────────────────────────────────────────────────────────────
  const w = TRUCK_WINDOWS[store]
  const truck = w && (DELIVERY_DOWS[store] ?? []).includes(dowOf(today))
    ? { from: hmToMin(w[0]), to: hmToMin(w[1]) } : null

  // ── people and the staffing timeline ────────────────────────────────────────
  const people = buildPeople(clock, plan, asOf)
  const closeAt = Math.max(open?.to ?? 0, ...people.map(p => p.schedEnd ?? 0))
  const spans = new Map<Person, [number, number]>()
  for (const p of people) { const sp = presence(p, asOf, closeAt); if (sp) spans.set(p, sp) }
  const headsAt = (m: number, without: Set<Person>) =>
    [...spans].filter(([p, [a, b]]) => !without.has(p) && a <= m && m < b).length
  // Cover a send-home call can rely on: only people with a known end. Someone clocked in
  // without a scheduled shift (14% of Pines' September shifts, usually a swap) shows as on
  // the floor, but nobody knows when they will leave, so they never cover someone else's.
  const firm = (p: Person) => p.salaried || p.schedEnd != null
  const coverAt = (m: number, without: Set<Person>) =>
    [...spans].filter(([p, [a, b]]) => firm(p) && !without.has(p) && a <= m && m < b).length
  const leadsAt = (m: number, without: Set<Person>) =>
    [...spans].filter(([p, [a, b]]) => p.lead && firm(p) && !without.has(p) && a <= m && m < b).length
  const fc = (s: number) => busyUnits[s] * pace.units
  const needFor = (units: number, s: number) => {
    const mid = s * SLOT + SLOT / 2
    return Math.max(1, Math.ceil(units / UNITS_PER_PERSON_HALF_HOUR))
      + (truck && truck.from <= mid && mid < truck.to ? 1 : 0)
  }
  const need = (s: number) => needFor(fc(s), s)
  /** the half-hours from asOf to `until`, each with the minute it is judged at */
  const stretch = (until: number) => {
    const out: { s: number; m: number }[] = []
    for (let s = Math.floor(asOf / SLOT); s * SLOT < until && s < 48; s++) {
      out.push({ s, m: Math.max(asOf, s * SLOT + SLOT / 2) })
    }
    return out
  }

  // ── send-home calls ─────────────────────────────────────────────────────────
  const calls: Call[] = []
  const gone = new Set<Person>()
  // The closer = whoever is expected to be there last (a no-show cannot be the closer).
  const lastOut = Math.max(0, ...[...spans.values()].map(([, b]) => b))
  for (;;) {
    const cands = people
      .filter(p => p.status === 'on' && !p.salaried && !gone.has(p) && p.schedEnd != null
        && p.schedEnd - asOf >= SEND_HOME_MIN_HOURS * 60 && p.schedEnd < lastOut)
      .sort((a, b) => (b.schedEnd! - asOf) - (a.schedEnd! - asOf))
    let pick: Person | null = null
    for (const c of cands) {
      const without = new Set([...gone, c])
      const span = stretch(c.schedEnd!)
      if (c.lead && span.some(({ m }) => leadsAt(m, without) === 0)) continue
      if (span.every(({ s, m }) => coverAt(m, without) >= need(s))) { pick = c; break }
    }
    if (!pick) break
    const without = new Set([...gone, pick])
    const span = stretch(pick.schedEnd!)
    const peak = span.reduce((a, b) => (fc(b.s) > fc(a.s) ? b : a), span[0])
    const hours = (pick.schedEnd! - asOf) / 60
    calls.push({
      employee: pick.employee, role: pick.role, plannedEnd: pick.schedEnd!,
      hours: Math.round(hours * 10) / 10,
      dollars: Math.round(hours * rateFor(store, pick.employee)),
      peakUnits: Math.round(fc(peak.s)), peakAt: peak.s * SLOT,
      headsLeft: coverAt(peak.m, without),
      capacity: coverAt(peak.m, without) * UNITS_PER_PERSON_HALF_HOUR,
      truck: !!truck && span.some(({ m }) => truck.from <= m && m < truck.to),
    })
    gone.add(pick)
  }

  // ── labor: paid so far, and the finish if nothing changes ──────────────────
  let paySoFar = 0, remainingHours = 0, remainingCost = 0
  for (const p of people) {
    if (p.salaried) continue                                  // salary is never hourly labor
    const rate = rateFor(store, p.employee)
    if (p.inAt != null) paySoFar += Math.max(0, Math.min(p.outAt ?? asOf, asOf) - p.inAt) / 60 * rate
    const left = p.status === 'on' ? Math.max(0, (p.schedEnd ?? asOf) - asOf)
      : p.status === 'coming' || p.status === 'late' ? Math.max(0, p.schedEnd! - Math.max(asOf, p.schedStart!))
      : 0
    remainingHours += left / 60
    remainingCost += left / 60 * rate
  }
  const labor = {
    paySoFar: Math.round(paySoFar),
    pctSoFar: soFarNet > 0 ? paySoFar / soFarNet : null,
    finishPct: onPace > 0 ? (paySoFar + remainingCost) / onPace : null,
    remainingHours: Math.round(remainingHours * 10) / 10,
    remainingCost: Math.round(remainingCost),
  }

  // ── by hour, and the next three hours ───────────────────────────────────────
  const byHour: HourRow[] = []
  if (open) {
    for (let h = Math.floor(open.from / 60); h * 60 < open.to; h++) {
      const s0 = h * 2, s1 = s0 + 1
      const started = h * 60 < asOf
      const normal = meanNet[s0] + meanNet[s1]
      byHour.push({
        hour: h,
        actual: started ? Math.round(tNet[s0] + tNet[s1]) : null,
        normal: Math.round(normal),
        projected: started ? null : Math.round(normal * pace.net),
        units: started ? tUnits[s0] + tUnits[s1] : null,
      })
    }
  }
  const ahead: AheadRow[] = []
  const firstHour = Math.floor(asOf / 60)
  for (let h = firstHour; h < firstHour + 3 && open && h * 60 < open.to; h++) {
    const span = stretch((h + 1) * 60).filter(({ s }) => s >= h * 2)
    if (!span.length) continue
    ahead.push({
      from: Math.max(asOf, h * 60), to: (h + 1) * 60,
      units: Math.round(sumBy(span, ({ s }) => meanUnits[s] * pace.units)),
      busyUnits: Math.round(sumBy(span, ({ s }) => fc(s))),
      need: Math.max(...span.map(({ s }) => need(s))),
      needUsual: Math.max(...span.map(({ s }) => needFor(meanUnits[s] * pace.units, s))),
      heads: Math.min(...span.map(({ m }) => headsAt(m, new Set()))),   // as scheduled, before any call
    })
  }

  return {
    store, asOf, open, truck, pace,
    sales: {
      soFar: Math.round(soFarNet), normalByNow: Math.round(normalByNow), normalDay,
      onPace: Math.round(onPace), orders, units: soFarUnits, byHour,
    },
    labor, people, ahead, calls,
  }
}
