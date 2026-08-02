// Florida minor-labor rules, checked against the POSTED schedule.
//
// WHY THIS IS IN THE MODULE: 13 of the active crew are under 18. Nothing in the stack
// watches their hours, and the exposure is regulatory rather than a margin question. The
// point is to flag a violation BEFORE it is worked — so this runs on labor_schedule, not
// on labor. A violation found in the timecard is a violation you already committed.
//
// RULES — Florida Statutes ch. 450 (minors 16-17). Encoded conservatively:
//   - Not before 6:30am, not after 11:00pm on a night before a school day.
//   - Max 8 hours on a school day.
//   - Max 30 hours in a school week.
//   - Not during school hours when school is in session.
// 14-15 year olds have stricter limits again; none are currently employed, but the age
// band is carried so the rule set can be extended without restructuring.
//
// SCHOOL CALENDAR IS THE KNOWN GAP. Broward County's calendar is not in the database, so
// `isSchoolDay` uses a conservative approximation: weekdays outside a summer window and
// outside winter/spring breaks are treated as school days. That over-flags during
// unlogged holidays rather than under-flagging, which is the safe direction — but it does
// mean a flag is "check this", not "you broke the law". Wire the real calendar before
// anyone is disciplined off this.
//
// NOT LEGAL ADVICE — this is an operational early-warning, and the thresholds should be
// confirmed against current statute before enforcement.

export type MinorRule =
  | 'before-0630'
  | 'after-2300-school-night'
  | 'over-8h-school-day'
  | 'over-30h-school-week'

export type MinorViolation = {
  employeeKey: string
  employee: string
  store: string
  date: string
  rule: MinorRule
  detail: string
  age: number
}

export const MINOR_RULE_LABEL: Record<MinorRule, string> = {
  'before-0630': 'Scheduled before 6:30am',
  'after-2300-school-night': 'Scheduled past 11:00pm before a school day',
  'over-8h-school-day': 'Over 8 hours on a school day',
  'over-30h-school-week': 'Over 30 hours in a school week',
}

/** Age in whole years on a given date. */
export function ageOn(dob: string, on: string): number {
  const b = new Date(dob + 'T00:00:00')
  const d = new Date(on + 'T00:00:00')
  let age = d.getFullYear() - b.getFullYear()
  const m = d.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age--
  return age
}

/**
 * Conservative school-day approximation for Broward County. Over-flags rather than
 * under-flags; replace with the real calendar when it is available.
 */
export function isSchoolDay(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false      // weekends
  const mo = d.getMonth() + 1
  const day = d.getDate()
  if (mo === 6 || mo === 7) return false                    // summer
  if (mo === 8 && day < 12) return false                    // pre-term August
  if (mo === 12 && day >= 20) return false                  // winter break
  if (mo === 1 && day <= 6) return false                    // winter break tail
  if (mo === 3 && day >= 23 && day <= 27) return false      // spring break (approx)
  return true
}

/** Minutes past midnight from a 'HH:MM[:SS]' time string. */
function minutes(t: string | null): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** ISO week key (Mon-Sun) so weekly totals bucket consistently. */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = (d.getDay() + 6) % 7          // Mon = 0
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

export type ScheduledShift = {
  employeeKey: string
  employee: string
  store: string
  date: string
  startTime: string | null
  endTime: string | null
  hours: number
}

/**
 * Check posted shifts for minors. `dobByKey` supplies date of birth; anyone without a DOB
 * is skipped rather than assumed adult — and the caller should surface that separately,
 * because an unknown minor is the case this is meant to catch.
 */
export function checkMinorSchedule(
  shifts: ScheduledShift[],
  dobByKey: Map<string, string>,
): MinorViolation[] {
  const out: MinorViolation[] = []
  const weekly = new Map<string, { hours: number; schoolWeek: boolean; s: ScheduledShift; age: number }>()

  for (const s of shifts) {
    const dob = dobByKey.get(s.employeeKey)
    if (!dob) continue
    const age = ageOn(dob, s.date)
    if (age >= 18) continue

    const school = isSchoolDay(s.date)
    const start = minutes(s.startTime)
    const end = minutes(s.endTime)
    const base = { employeeKey: s.employeeKey, employee: s.employee, store: s.store, date: s.date, age }

    if (start != null && start < 6 * 60 + 30) {
      out.push({ ...base, rule: 'before-0630', detail: `starts ${s.startTime}` })
    }
    // "School night" = the night before a school day, i.e. tomorrow is a school day.
    const tomorrow = new Date(s.date + 'T00:00:00')
    tomorrow.setDate(tomorrow.getDate() + 1)
    const schoolNight = isSchoolDay(tomorrow.toISOString().slice(0, 10))
    if (end != null && end > 23 * 60 && schoolNight) {
      out.push({ ...base, rule: 'after-2300-school-night', detail: `ends ${s.endTime}` })
    }
    if (school && s.hours > 8) {
      out.push({ ...base, rule: 'over-8h-school-day', detail: `${s.hours.toFixed(1)}h scheduled` })
    }

    const wk = `${s.employeeKey}|${weekKey(s.date)}`
    const acc = weekly.get(wk) ?? { hours: 0, schoolWeek: false, s, age }
    acc.hours += s.hours
    acc.schoolWeek = acc.schoolWeek || school
    weekly.set(wk, acc)
  }

  for (const [, acc] of weekly) {
    if (acc.schoolWeek && acc.hours > 30) {
      out.push({
        employeeKey: acc.s.employeeKey, employee: acc.s.employee, store: acc.s.store,
        date: weekKey(acc.s.date), rule: 'over-30h-school-week',
        detail: `${acc.hours.toFixed(1)}h scheduled that week`, age: acc.age,
      })
    }
  }
  return out
}
