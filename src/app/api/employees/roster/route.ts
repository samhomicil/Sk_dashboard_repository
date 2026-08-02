import { NextRequest } from 'next/server'
import { getRoster, getProductivity, getAttendance, getInStoreGross } from '@/lib/employees'
import { checkMinorSchedule, ageOn, type ScheduledShift } from '@/lib/minorLabor'
import { query } from '@/lib/db'
import { resolvedKeySql } from '@/lib/core/employee'
import { LABOR_EXCLUDE_ROLES } from '@/lib/core/targets'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function iso(d: Date) { return d.toISOString().slice(0, 10) }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const store = sp.get('store') ?? 'all'
  const end = sp.get('end') ?? iso(new Date(Date.now() - 86400000))
  const start = sp.get('start') ?? iso(new Date(new Date(end).getTime() - 27 * 86400000))

  try {
    const [roster, prod, att, gross] = await Promise.all([
      getRoster(store),
      getProductivity(start, end, store === 'all' ? undefined : store),
      getAttendance(start, end, store === 'all' ? undefined : store),
      getInStoreGross(start, end, store === 'all' ? undefined : store),
    ])

    // Minor-labor check runs on the POSTED schedule from today forward — the whole point
    // is to catch a violation before it is worked, so past shifts are not the subject.
    const today = iso(new Date())
    const K = resolvedKeySql
    const excl = LABOR_EXCLUDE_ROLES.map(r => `'${r}'`).join(', ')
    const sfS = store !== 'all' ? `AND s.store = '${store}'` : ''
    const schedRows = await query<{
      k: string; employee: string; store: string; d: string
      start_time: string | null; end_time: string | null; hours: number
    }[]>(`
      SELECT ${K('s.employee')} AS k, s.employee, s.store,
             CONVERT(char(10), s.work_date, 23) AS d,
             CONVERT(char(8), s.start_time, 108) AS start_time,
             CONVERT(char(8), s.end_time, 108)   AS end_time,
             s.sched_hours AS hours
      FROM smoothieking.labor_schedule s
      WHERE s.work_date >= '${today}' ${sfS}
        AND (s.role IS NULL OR s.role NOT IN (${excl}))
    `).catch(() => [])

    const dobByKey = new Map<string, string>()
    for (const r of roster) if (r.dateOfBirth) dobByKey.set(r.employeeKey, r.dateOfBirth)

    const shifts: ScheduledShift[] = schedRows.map(r => ({
      employeeKey: r.k, employee: r.employee, store: r.store, date: r.d,
      startTime: r.start_time, endTime: r.end_time, hours: Number(r.hours) || 0,
    }))
    const violations = checkMinorSchedule(shifts, dobByKey)

    // Anyone scheduled whose DOB we don't have is reported separately: an unknown minor is
    // exactly the case the check exists to catch, so it must not read as "compliant".
    const scheduledKeys = new Set(shifts.map(s => s.employeeKey))
    const unknownDob = roster
      .filter(r => scheduledKeys.has(r.employeeKey) && !r.dateOfBirth)
      .map(r => ({ employeeKey: r.employeeKey, employee: r.employee, store: r.homeStore }))

    const rows = roster.map(r => {
      const p = prod.get(r.employeeKey)
      const a = att.get(r.employeeKey)
      return {
        ...r,
        age: r.dateOfBirth ? ageOn(r.dateOfBirth, today) : null,
        isMinor: r.dateOfBirth ? ageOn(r.dateOfBirth, today) < 18 : null,
        productivity: p ?? null,
        attendance: a ?? null,
        // Per-employee sales per labor hour, on the in-store gross basis. Only shown when
        // both sides exist for the window — a gross figure over zero hours is meaningless.
        grossPerHour: p && a && a.workedHours > 0 ? p.grossSales / a.workedHours : null,
      }
    })

    const inStoreGross = [...gross.values()].reduce((s, g) => s + g.gross, 0)
    const attributedGross = rows.reduce((s, r) => s + (r.productivity?.grossSales ?? 0), 0)

    return Response.json({
      window: { start, end },
      store,
      rows,
      // The denominator the productivity column rolls up to. NOT the Overview KPI's
      // all-channel net sales — see src/lib/employees.ts.
      basis: {
        label: 'In-store gross (Brink cashier basis)',
        inStoreGross,
        attributedGross,
        attributedPct: inStoreGross > 0 ? attributedGross / inStoreGross : null,
      },
      minorLabor: { violations, unknownDob, scheduledShifts: shifts.length },
    })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
