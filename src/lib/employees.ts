// Employee module data layer.
//
// SOURCES OF TRUTH (Sam's directives, do not vary these per surface):
//   Brink  — everything labor: hours, rate, role, schedule, timecards, per-employee sales.
//   NetChef — date of birth ONLY (Brink has no DOB field). Never rates, never sales.
//   core/   — every rollup that also appears elsewhere in the app.
//
// THE ONE THING TO UNDERSTAND ABOUT PER-EMPLOYEE SALES:
// `smoothieking.employee_sales` (Brink 'Employee Sales Summary') carries IN-STORE,
// CASHIER-RUNG GROSS. It is NOT the dashboard's all-channel net sales. Measured against
// our own in-store gross it ties within 1-2% over a week; against all-channel net it is
// 24-34% lower, because online and delivery orders have no cashier at all.
//
// So: these numbers roll up to IN-STORE GROSS and must always be displayed against that
// denominator. Never sum them against a store total from the Overview KPI — that is a
// different question, not a contradiction, and the UI has to say which one it is answering.
//
// Why this table exists at all: the OC item-sales export drops the cashier stamp for every
// employee hired since ~2026-05-05 (ten people, 1,906 hours, zero rows in
// smoothieking.sales). Brink's report attributes all of them.

import { query } from './db'
import { LABOR_EXCLUDE_ROLES } from './core/targets'
import { resolvedKeySql } from './core/employee'

const EXCLUDED = LABOR_EXCLUDE_ROLES.map(r => `'${r}'`).join(', ')

export type EmployeeDim = {
  employeeKey: string
  employee: string
  homeStore: string
  role: string
  hourlyRate: number | null
  hiredDate: string | null
  /** 'brink' = real hire date. 'netchef-approx' = NetChef's record-creation date standing
   *  in for one; every NetChef hire date sampled equalled its dateCreate, so it is only
   *  ever an approximation and the UI must say so. */
  hiredSource: 'brink' | 'netchef-approx' | null
  /**
   * Birthday as MM-DD — deliberately NO year, so a full date of birth never leaves the
   * server. This is all the recognition card needs. The complete DOB stays in
   * smoothieking.employee_hr_netchef because age-on-a-future-date math needs it (someone
   * turns 18 mid-schedule), and it is read only by getDobMap() below, server-side.
   */
  birthdayMonthDay: string | null
  /** Populated ONLY for under-18s, who are the only people an age is operationally
   *  needed for (minor-hour rules). null for everyone else. */
  age: number | null
  isMinor: boolean | null
  /**
   * True for salaried managers and owners. Their Brink punches are administrative — open
   * to close, frequently 18-20h with no clock-out — and they barely ring, so any
   * per-hour productivity figure is meaningless for them. Measured over 2026-07-16..08-12:
   * Madaffari 477.0h / $0.50/hr, Homicil 198.1h / $1.60/hr, Aybar 5.1h / $1.93/hr.
   * Surfaces must suppress productivity for these rows rather than print the number.
   */
  productivityApplies: boolean
  firstShift: string
  lastShift: string
  totalHours: number
  shiftCount: number
  status: 'active' | 'inactive'
}

export type ProductivityRow = {
  employeeKey: string
  orders: number
  guests: number
  grossSales: number      // in-store cashier-rung gross — see header note
  asg: number | null      // average sale per guest
  ast: number | null      // average sale per transaction
  attSeconds: number | null
  tppSeconds: number | null
  days: number
}

export type AttendanceRow = {
  employeeKey: string
  scheduledShifts: number
  workedShifts: number
  scheduledHours: number
  workedHours: number
  /** Median-ish signed minutes vs the posted schedule. Positive = clocked in late. */
  avgClockInDeltaMin: number | null
  avgClockOutDeltaMin: number | null
  lateArrivals: number     // clocked in > 5 min after schedule
  noShows: number          // scheduled, never clocked in
  unscheduledShifts: number // worked without being on the schedule
  otHours: number
}

/** Everyone who has actually worked a shift, with hire date, DOB and rate attached. */
export async function getRoster(store?: string): Promise<EmployeeDim[]> {
  const where = store && store !== 'all' ? `WHERE home_store = '${store}'` : ''
  const rows = await query<{
    employee_key: string; employee: string; home_store: string; role: string
    hourly_rate: number | null; hired_date: string | null; hired_source: string | null
    birth_md: string | null; age: number | null; first_shift: string; last_shift: string
    total_hours: number; shift_count: number; status: string
  }[]>(`
    SELECT employee_key, employee, home_store, role, hourly_rate,
           CONVERT(char(10), hired_date, 23)    AS hired_date, hired_source,
           -- month/day only; the year never leaves the server
           CONVERT(char(5), date_of_birth, 110) AS birth_md,
           CASE WHEN date_of_birth IS NULL THEN NULL ELSE
             DATEDIFF(year, date_of_birth, GETDATE())
             - CASE WHEN DATEADD(year, DATEDIFF(year, date_of_birth, GETDATE()), date_of_birth)
                         > CAST(GETDATE() AS date) THEN 1 ELSE 0 END
           END AS age,
           CONVERT(char(10), first_shift, 23)   AS first_shift,
           CONVERT(char(10), last_shift, 23)    AS last_shift,
           total_hours, shift_count, status
    FROM smoothieking.vw_employee_dim ${where}
    ORDER BY home_store, employee
  `)
  return rows.map(r => ({
    employeeKey: r.employee_key,
    employee: r.employee,
    homeStore: r.home_store,
    role: r.role ?? '',
    hourlyRate: r.hourly_rate != null ? Number(r.hourly_rate) : null,
    hiredDate: r.hired_date,
    hiredSource: (r.hired_source as EmployeeDim['hiredSource']) ?? null,
    // MM-DD (SQL style 110 gives MM-DD-YYYY; take the first five chars).
    birthdayMonthDay: r.birth_md ? r.birth_md.slice(0, 5).replace(/\//g, '-') : null,
    age: r.age != null && Number(r.age) < 18 ? Number(r.age) : null,
    isMinor: r.age != null ? Number(r.age) < 18 : null,
    firstShift: r.first_shift,
    lastShift: r.last_shift,
    totalHours: Number(r.total_hours) || 0,
    shiftCount: Number(r.shift_count) || 0,
    status: r.status === 'active' ? 'active' : 'inactive',
    productivityApplies: !/salary|owner|franchisee/i.test(r.role ?? ''),
  }))
}

/** Per-employee sales for a window. In-store cashier-rung gross basis. */
export async function getProductivity(start: string, end: string, store?: string) {
  const sf = store && store !== 'all' ? `AND store = '${store}'` : ''
  const rows = await query<{
    employee_key: string; orders: number; guests: number; gross: number
    att: number | null; tpp: number | null; days: number
  }[]>(`
    SELECT COALESCE((SELECT TOP 1 a.employee_key FROM smoothieking.employee_alias a
                     WHERE a.alias = es.employee_key), es.employee_key) AS employee_key,
           SUM(orders)          AS orders,
           SUM(guests)          AS guests,
           SUM(gross_sales)     AS gross,
           AVG(CAST(att_seconds AS float)) AS att,
           AVG(CAST(tpp_seconds AS float)) AS tpp,
           COUNT(DISTINCT business_date)   AS days
    FROM smoothieking.employee_sales es
    WHERE business_date BETWEEN '${start}' AND '${end}' ${sf}
    GROUP BY COALESCE((SELECT TOP 1 a.employee_key FROM smoothieking.employee_alias a
                       WHERE a.alias = es.employee_key), es.employee_key)
  `).catch(() => [])

  const out = new Map<string, ProductivityRow>()
  for (const r of rows) {
    const orders = Number(r.orders) || 0
    const guests = Number(r.guests) || 0
    const gross = Number(r.gross) || 0
    out.set(r.employee_key, {
      employeeKey: r.employee_key,
      orders, guests, grossSales: gross,
      // Recompute ASG/AST for the window rather than averaging Brink's per-day figures —
      // averaging ratios across days of different volume would weight a 7-order day the
      // same as a 150-order day.
      asg: guests > 0 ? gross / guests : null,
      ast: orders > 0 ? gross / orders : null,
      attSeconds: r.att != null ? Number(r.att) : null,
      tppSeconds: r.tpp != null ? Number(r.tpp) : null,
      days: Number(r.days) || 0,
    })
  }
  return out
}

/**
 * The in-store gross the productivity numbers roll up to. This is the denominator the UI
 * must display alongside them — NOT the Overview KPI's all-channel net sales.
 */
export async function getInStoreGross(start: string, end: string, store?: string) {
  const sf = store && store !== 'all' ? `AND store = '${store}'` : ''
  const rows = await query<{ store: string; gross: number; orders: number }[]>(`
    SELECT store,
           SUM(CASE WHEN voided = 0 THEN gross_sales ELSE 0 END) AS gross,
           COUNT(DISTINCT order_id) AS orders
    FROM smoothieking.sales
    WHERE CAST(closed_datetime AS date) BETWEEN '${start}' AND '${end}' ${sf}
      AND destination NOT IN ('Online Ordering')
      AND destination NOT LIKE '%Delivery%'
    GROUP BY store
  `).catch(() => [])
  const out = new Map<string, { gross: number; orders: number }>()
  for (const r of rows) out.set(r.store, { gross: Number(r.gross) || 0, orders: Number(r.orders) || 0 })
  return out
}

/** Scheduled vs worked, punctuality, no-shows. labor and labor_schedule join directly. */
export async function getAttendance(start: string, end: string, store?: string) {
  const sfL = store && store !== 'all' ? `AND l.store = '${store}'` : ''
  const sfS = store && store !== 'all' ? `AND s.store = '${store}'` : ''
  // Alias-resolved: raw keys would turn known spelling drift into false no-shows.
  const K = resolvedKeySql

  const rows = await query<{
    employee_key: string
    sched_shifts: number; worked_shifts: number
    sched_hours: number; worked_hours: number
    in_delta: number | null; out_delta: number | null
    late: number; no_shows: number; unscheduled: number; ot_hours: number
  }[]>(`
    WITH sched AS (
      SELECT ${K('s.employee')} AS k, s.store, s.work_date AS d,
             s.start_time, s.end_time, s.sched_hours
      FROM smoothieking.labor_schedule s
      WHERE s.work_date BETWEEN '${start}' AND '${end}' ${sfS}
        -- Salaried staff and owners are excluded from punctuality: their Brink punches are
        -- administrative, not shifts. Madaffari shows 2h scheduled against 15.9h clocked
        -- with a -465 min clock-out delta; scoring that as lateness is meaningless.
        AND (s.role IS NULL OR (s.role NOT LIKE '%Salary%' AND s.role NOT LIKE '%Owner%'))
    ),
    act AS (
      SELECT ${K('l.employee')} AS k, l.store, l.shift_date AS d,
             l.shift_start, l.shift_end, l.total_hrs, l.ot_hrs
      FROM smoothieking.labor l
      WHERE l.shift_date BETWEEN '${start}' AND '${end}' ${sfL}
        AND l.employee_role NOT IN (${EXCLUDED})
        AND l.employee_role NOT LIKE '%Salary%' AND l.employee_role NOT LIKE '%Owner%'
        AND l.shift_start IS NOT NULL
    ),
    -- One row per scheduled shift, matched to its actual if there is one.
    j AS (
      SELECT sched.k, sched.d, sched.sched_hours,
             act.total_hrs, act.ot_hrs,
             DATEDIFF(MINUTE, sched.start_time, act.shift_start) AS in_delta,
             DATEDIFF(MINUTE, sched.end_time,   act.shift_end)   AS out_delta
      FROM sched
      LEFT JOIN act ON act.k = sched.k AND act.store = sched.store AND act.d = sched.d
    )
    SELECT j.k AS employee_key,
           COUNT(*)                                                    AS sched_shifts,
           SUM(CASE WHEN j.total_hrs IS NOT NULL THEN 1 ELSE 0 END)    AS worked_shifts,
           SUM(ISNULL(j.sched_hours, 0))                               AS sched_hours,
           SUM(ISNULL(j.total_hrs, 0))                                 AS worked_hours,
           AVG(CAST(j.in_delta  AS float))                             AS in_delta,
           AVG(CAST(j.out_delta AS float))                             AS out_delta,
           SUM(CASE WHEN j.in_delta > 5 THEN 1 ELSE 0 END)             AS late,
           SUM(CASE WHEN j.total_hrs IS NULL THEN 1 ELSE 0 END)        AS no_shows,
           0                                                           AS unscheduled,
           SUM(ISNULL(j.ot_hrs, 0))                                    AS ot_hours
    FROM j GROUP BY j.k
  `).catch(() => [])

  // Worked-but-not-scheduled is a separate pass: it has no row on the schedule side.
  const extra = await query<{ employee_key: string; n: number; hrs: number }[]>(`
    WITH sched AS (
      SELECT ${K('s.employee')} AS k, s.store, s.work_date AS d
      FROM smoothieking.labor_schedule s
      WHERE s.work_date BETWEEN '${start}' AND '${end}' ${sfS}
    ),
    act AS (
      SELECT ${K('l.employee')} AS k, l.store, l.shift_date AS d, l.total_hrs
      FROM smoothieking.labor l
      WHERE l.shift_date BETWEEN '${start}' AND '${end}' ${sfL}
        AND l.employee_role NOT IN (${EXCLUDED})
    )
    SELECT act.k AS employee_key, COUNT(*) AS n, SUM(ISNULL(act.total_hrs,0)) AS hrs
    FROM act
    LEFT JOIN sched ON sched.k = act.k AND sched.store = act.store AND sched.d = act.d
    WHERE sched.k IS NULL
    GROUP BY act.k
  `).catch(() => [])

  const out = new Map<string, AttendanceRow>()
  for (const r of rows) {
    out.set(r.employee_key, {
      employeeKey: r.employee_key,
      scheduledShifts: Number(r.sched_shifts) || 0,
      workedShifts: Number(r.worked_shifts) || 0,
      scheduledHours: Number(r.sched_hours) || 0,
      workedHours: Number(r.worked_hours) || 0,
      avgClockInDeltaMin: r.in_delta != null ? Number(r.in_delta) : null,
      avgClockOutDeltaMin: r.out_delta != null ? Number(r.out_delta) : null,
      lateArrivals: Number(r.late) || 0,
      noShows: Number(r.no_shows) || 0,
      unscheduledShifts: 0,
      otHours: Number(r.ot_hours) || 0,
    })
  }
  for (const e of extra) {
    const row = out.get(e.employee_key)
    const n = Number(e.n) || 0
    if (row) {
      row.unscheduledShifts = n
      row.workedShifts += n
      row.workedHours += Number(e.hrs) || 0
    } else {
      out.set(e.employee_key, {
        employeeKey: e.employee_key,
        scheduledShifts: 0, workedShifts: n,
        scheduledHours: 0, workedHours: Number(e.hrs) || 0,
        avgClockInDeltaMin: null, avgClockOutDeltaMin: null,
        lateArrivals: 0, noShows: 0, unscheduledShifts: n, otHours: 0,
      })
    }
  }
  return out
}

// ── Profile: one person, every signal, one query set ─────────────────────────

export type BreakRow = {
  date: string; start: string | null; end: string | null
  isPaid: boolean; paidHours: number; unpaidHours: number
}
export type TillRow = {
  date: string; drawer: string | null; overShort: number; tips: number
}
export type EditRow = {
  date: string; field: string | null; originalValue: string | null
  newValue: string | null; editedBy: string | null; reason: string | null
  deleted: boolean
}
export type ShiftRow = {
  date: string; store: string; role: string | null
  start: string | null; end: string | null; hours: number; otHours: number
  schedStart: string | null; schedEnd: string | null; schedHours: number | null
  inDeltaMin: number | null; outDeltaMin: number | null
}

export type EmployeeProfile = {
  dim: EmployeeDim
  shifts: ShiftRow[]
  breaks: BreakRow[]
  tills: TillRow[]
  edits: EditRow[]
  /** Overrides where this person was the LOGIN USER. Brink prints only a first name in
   *  that column, so this is a first-name match and is therefore ambiguous when two
   *  people share one — surfaced with that caveat rather than silently attributed. */
  overridesAsUser: { time: string; store: string; button: string | null; approver: string | null; method: string | null }[]
  overrideNameAmbiguous: boolean
}

export async function getProfile(
  employeeKey: string, start: string, end: string,
): Promise<EmployeeProfile | null> {
  const roster = await getRoster()
  const dim = roster.find(r => r.employeeKey === employeeKey)
  if (!dim) return null

  const K = resolvedKeySql
  const k = employeeKey.replace(/'/g, "''")
  const win = `BETWEEN '${start}' AND '${end}'`

  const [shiftRows, breakRows, tillRows, editRows] = await Promise.all([
    query<{
      d: string; store: string; role: string; s: string | null; e: string | null
      hrs: number; ot: number; ss: string | null; se: string | null; sh: number | null
      ind: number | null; outd: number | null
    }[]>(`
      WITH act AS (
        SELECT ${K('l.employee')} AS k, l.store, l.shift_date AS d, l.employee_role AS role,
               l.shift_start, l.shift_end, l.total_hrs, l.ot_hrs
        FROM smoothieking.labor l
        WHERE l.shift_date ${win} AND l.employee_role NOT IN (${EXCLUDED})
      ),
      sch AS (
        SELECT ${K('s.employee')} AS k, s.store, s.work_date AS d,
               s.start_time, s.end_time, s.sched_hours
        FROM smoothieking.labor_schedule s WHERE s.work_date ${win}
      )
      SELECT CONVERT(char(10), act.d, 23) AS d, act.store, act.role,
             CONVERT(char(8), act.shift_start, 108) AS s,
             CONVERT(char(8), act.shift_end, 108)   AS e,
             act.total_hrs AS hrs, act.ot_hrs AS ot,
             CONVERT(char(8), sch.start_time, 108)  AS ss,
             CONVERT(char(8), sch.end_time, 108)    AS se,
             sch.sched_hours AS sh,
             DATEDIFF(MINUTE, sch.start_time, act.shift_start) AS ind,
             DATEDIFF(MINUTE, sch.end_time,   act.shift_end)   AS outd
      FROM act
      LEFT JOIN sch ON sch.k = act.k AND sch.store = act.store AND sch.d = act.d
      WHERE act.k = N'${k}'
      ORDER BY act.d DESC
    `).catch(() => []),

    query<{ d: string; s: string | null; e: string | null; paid: number; ph: number; uh: number }[]>(`
      SELECT CONVERT(char(10), business_date, 23) AS d,
             CONVERT(char(8), start_time, 108) AS s, CONVERT(char(8), end_time, 108) AS e,
             CAST(is_paid AS int) AS paid, paid_hours AS ph, unpaid_hours AS uh
      FROM smoothieking.employee_breaks
      WHERE employee_key = N'${k}' AND business_date ${win}
      ORDER BY business_date DESC
    `).catch(() => []),

    query<{ d: string; drawer: string | null; os: number; tips: number }[]>(`
      SELECT CONVERT(char(10), till_date, 23) AS d, drawer,
             CAST(over_short AS float) AS os, CAST(tips AS float) AS tips
      FROM smoothieking.tillhistory
      WHERE ${K('employee')} = N'${k}' AND CAST(till_date AS date) ${win}
      ORDER BY till_date DESC
    `).catch(() => []),

    query<{
      d: string; f: string | null; ov: string | null; nv: string | null
      by: string | null; reason: string | null; del: number
    }[]>(`
      SELECT CONVERT(char(10), business_date, 23) AS d, edited_field AS f,
             original_value AS ov, new_value AS nv, edited_by AS by,
             reason, CAST(ISNULL(deleted,0) AS int) AS del
      FROM smoothieking.labor_edits
      WHERE ${K('employee')} = N'${k}' AND business_date ${win}
      ORDER BY business_date DESC
    `).catch(() => []),
  ])

  // Overrides carry a FIRST NAME only, so match on that and report the ambiguity rather
  // than pretend it is an identification.
  const firstName = employeeKey.split('|')[1] ?? ''
  const sameFirst = roster.filter(r => (r.employeeKey.split('|')[1] ?? '') === firstName)
  const overrides = firstName
    ? await query<{ t: string; store: string; b: string | null; a: string | null; m: string | null }[]>(`
        SELECT CONVERT(varchar(19), approval_time, 120) AS t, store,
               button_name AS b, approval_user AS a, approval_method AS m
        FROM smoothieking.manager_overrides
        WHERE LOWER(login_user) = N'${firstName.replace(/'/g, "''")}'
          AND business_date ${win}
        ORDER BY approval_time DESC
      `).catch(() => [])
    : []

  return {
    dim,
    shifts: shiftRows.map(r => ({
      date: r.d, store: r.store, role: r.role ?? null,
      start: r.s, end: r.e,
      hours: Number(r.hrs) || 0, otHours: Number(r.ot) || 0,
      schedStart: r.ss, schedEnd: r.se,
      schedHours: r.sh != null ? Number(r.sh) : null,
      inDeltaMin: r.ind != null ? Number(r.ind) : null,
      outDeltaMin: r.outd != null ? Number(r.outd) : null,
    })),
    breaks: breakRows.map(r => ({
      date: r.d, start: r.s, end: r.e, isPaid: Number(r.paid) === 1,
      paidHours: Number(r.ph) || 0, unpaidHours: Number(r.uh) || 0,
    })),
    tills: tillRows.map(r => ({
      date: r.d, drawer: r.drawer, overShort: Number(r.os) || 0, tips: Number(r.tips) || 0,
    })),
    edits: editRows.map(r => ({
      date: r.d, field: r.f, originalValue: r.ov, newValue: r.nv,
      editedBy: r.by, reason: r.reason, deleted: Number(r.del) === 1,
    })),
    overridesAsUser: overrides.map(r => ({
      time: r.t, store: r.store, button: r.b, approver: r.a, method: r.m,
    })),
    overrideNameAmbiguous: sameFirst.length > 1,
  }
}


/**
 * SERVER-ONLY. Full dates of birth, keyed by employee, for the minor-hour check — which
 * needs a real date because it evaluates age on FUTURE scheduled days (someone can turn 18
 * partway through a posted schedule).
 *
 * This must never be returned to a client. A preview deployment once served the roster
 * route unauthenticated and exposed exactly this data for four 16-17 year olds, so DOB was
 * removed from every wire shape; this accessor is the only remaining read path and it is
 * consumed inside route handlers only.
 */
export async function getDobMap(store?: string): Promise<Map<string, string>> {
  const where = store && store !== 'all' ? `WHERE home_store = '${store}'` : ''
  const rows = await query<{ employee_key: string; dob: string | null }[]>(`
    SELECT employee_key, CONVERT(char(10), date_of_birth, 23) AS dob
    FROM smoothieking.vw_employee_dim ${where}
  `).catch(() => [])
  const out = new Map<string, string>()
  for (const r of rows) if (r.dob) out.set(r.employee_key, r.dob)
  return out
}
