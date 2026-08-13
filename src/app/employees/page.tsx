'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MINOR_RULE_LABEL, type MinorRule } from '@/lib/minorLabor'

type Productivity = {
  orders: number; guests: number; grossSales: number
  asg: number | null; ast: number | null
  attSeconds: number | null; tppSeconds: number | null; days: number
}
type Attendance = {
  scheduledShifts: number; workedShifts: number
  scheduledHours: number; workedHours: number
  avgClockInDeltaMin: number | null; avgClockOutDeltaMin: number | null
  lateArrivals: number; noShows: number; unscheduledShifts: number; otHours: number
}
type Row = {
  employeeKey: string; employee: string; homeStore: string; role: string
  hourlyRate: number | null
  hiredDate: string | null; hiredSource: 'brink' | 'netchef-approx' | null
  birthdayMonthDay: string | null; age: number | null; isMinor: boolean | null
  productivityApplies: boolean
  lastShift: string; status: 'active' | 'inactive'
  productivity: Productivity | null
  attendance: Attendance | null
  grossPerHour: number | null
}
type Violation = {
  employeeKey: string; employee: string; store: string
  date: string; rule: MinorRule; detail: string; age: number
}
type Payload = {
  window: { start: string; end: string }
  rows: Row[]
  basis: { label: string; inStoreGross: number; attributedGross: number; attributedPct: number | null }
  minorLabor: {
    violations: Violation[]
    unknownDob: { employeeKey: string; employee: string; store: string }[]
    scheduledShifts: number
  }
}

const STORES = ['all', 'Pines', 'Miramar', 'Margate'] as const

const SALARIED_NOTE =
  'Salaried managers and owners work open-to-close administrative shifts and rarely ring ' +
  'orders, so a per-hour sales figure would be meaningless for them — not a performance signal.'

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const money2 = (n: number) => `$${n.toFixed(2)}`

/** 'MMM D' from an ISO date, without pulling the date into local-timezone drift. */
function monthDay(iso: string) {
  const [, m, d] = iso.split('-').map(Number)
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${d}`
}

/** 'MMM D' from a bare MM-DD (no year involved). */
function monthDayMD(md: string) {
  const [m, d] = md.split('-').map(Number)
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${d}`
}

/** Days until the next occurrence of a bare MM-DD. */
function daysUntilAnniversaryMD(md: string, today = new Date()): number {
  const [m, d] = md.split('-').map(Number)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let next = new Date(today.getFullYear(), m - 1, d)
  if (next < t) next = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - t.getTime()) / 86400000)
}

/** Days until the next anniversary of `iso` (month/day only). */
function daysUntilAnniversary(iso: string, today = new Date()): number {
  const [, m, d] = iso.split('-').map(Number)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let next = new Date(today.getFullYear(), m - 1, d)
  if (next < t) next = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - t.getTime()) / 86400000)
}

function yearsSince(iso: string, today = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number)
  let n = today.getFullYear() - y
  const anniv = new Date(today.getFullYear(), m - 1, d)
  if (anniv > today) n--
  return n
}

export default function EmployeesPage() {
  const [store, setStore] = useState<(typeof STORES)[number]>('all')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    setLoading(true); setErr(null)
    fetch(`/api/employees/roster?store=${store}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { d.error ? setErr(d.error) : setData(d) })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [store])

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows
      .filter(r => showInactive || r.status === 'active')
      .sort((a, b) => (b.productivity?.grossSales ?? -1) - (a.productivity?.grossSales ?? -1)
        || a.employee.localeCompare(b.employee))
  }, [data, showInactive])

  const active = data?.rows.filter(r => r.status === 'active') ?? []
  const minors = active.filter(r => r.isMinor)

  // Recognition: birthdays and work anniversaries inside the next 30 days.
  const upcoming = useMemo(() => {
    const out: { employee: string; store: string; kind: 'birthday' | 'anniversary'; date: string; days: number; years?: number }[] = []
    for (const r of active) {
      if (r.birthdayMonthDay) {
        // MM-DD only — no birth year is sent to the client.
        const d = daysUntilAnniversaryMD(r.birthdayMonthDay)
        if (d <= 30) out.push({ employee: r.employee, store: r.homeStore, kind: 'birthday', date: monthDayMD(r.birthdayMonthDay), days: d })
      }
      if (r.hiredDate && r.hiredSource === 'brink') {
        const d = daysUntilAnniversary(r.hiredDate)
        if (d <= 30) out.push({
          employee: r.employee, store: r.homeStore, kind: 'anniversary',
          date: monthDay(r.hiredDate), days: d, years: yearsSince(r.hiredDate) + (d === 0 ? 0 : 1),
        })
      }
    }
    return out.sort((a, b) => a.days - b.days)
  }, [active])

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-bold text-slate-800">Employees</h1>
        <div className="flex gap-1">
          {STORES.map(s => (
            <button key={s} onClick={() => setStore(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                store === s ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:text-slate-700'
              }`}>
              {s === 'all' ? 'All Stores' : s}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="card mb-4 border-l-4 border-red-500">
          <div className="text-sm font-semibold text-red-700">Couldn&apos;t load employees</div>
          <div className="text-xs text-slate-500 mt-1 font-mono">{err}</div>
        </div>
      )}
      {loading && <div className="card"><div className="skeleton h-64 w-full" /></div>}

      {data && !loading && (
        <>
          {/* ── Minor-labor compliance: regulatory, so it leads ───────────────── */}
          <MinorLaborCard
            violations={data.minorLabor.violations}
            unknownDob={data.minorLabor.unknownDob}
            minorCount={minors.length}
            scheduledShifts={data.minorLabor.scheduledShifts}
          />

          {/* ── Stat tiles ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
            <Tile label="Active crew" value={String(active.length)}
              sub={minors.length ? `${minors.length} under 18` : 'none under 18'} />
            <Tile label="Hours worked" value={
              active.reduce((s, r) => s + (r.attendance?.workedHours ?? 0), 0).toFixed(0) + 'h'}
              sub={`${data.window.start} – ${data.window.end}`} />
            <Tile label="Attributed sales" value={money(data.basis.attributedGross)}
              sub={data.basis.attributedPct != null
                ? `${(data.basis.attributedPct * 100).toFixed(0)}% of in-store gross`
                : 'no basis'} />
            <Tile label="Upcoming dates" value={String(upcoming.length)}
              sub="birthdays & anniversaries, 30d" />
          </div>

          {/* The basis note is not decoration — it stops these numbers being read
              against the Overview KPI, which is a different (all-channel net) question. */}
          <div className="text-[11px] text-slate-400 mb-4 -mt-1">
            Sales figures are <strong className="text-slate-500">{data.basis.label}</strong> —
            they roll up to in-store gross ({money(data.basis.inStoreGross)}), not to the
            dashboard&apos;s all-channel net sales.
          </div>

          {upcoming.length > 0 && <RecognitionCard items={upcoming} />}

          {/* ── Roster ────────────────────────────────────────────────────────── */}
          <div className="card mt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-slate-700">Roster</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Rates and hours from Brink · sorted by attributed sales
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                <input type="checkbox" checked={showInactive}
                  onChange={e => setShowInactive(e.target.checked)} className="accent-teal-600" />
                show inactive
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100">
                    <th className="text-left pb-2">Employee</th>
                    <th className="text-left pb-2">Store</th>
                    <th className="text-left pb-2">Role</th>
                    <th className="text-right pb-2">Rate</th>
                    <th className="text-right pb-2">Hrs</th>
                    <th className="text-right pb-2">Orders</th>
                    <th className="text-right pb-2">Gross</th>
                    <th className="text-right pb-2">$/hr</th>
                    <th className="text-right pb-2">Avg sale</th>
                    <th className="text-right pb-2">Late</th>
                    <th className="text-left pb-2">Hired</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map(r => (
                    <tr key={r.employeeKey} className="hover:bg-slate-50 transition-colors">
                      <td className="py-1.5 font-semibold text-slate-700">
                        <Link href={`/employees/${encodeURIComponent(r.employeeKey)}`}
                          className="hover:text-teal-600 transition-colors">
                          {r.employee}
                        </Link>
                        {r.isMinor && (
                          <span className="ml-1.5 px-1 py-0.5 rounded bg-amber-50 text-amber-700 text-[9px] font-bold align-middle">
                            {r.age}
                          </span>
                        )}
                        {r.status === 'inactive' && (
                          <span className="ml-1.5 text-[9px] text-slate-300">inactive</span>
                        )}
                      </td>
                      <td className="text-slate-400">{r.homeStore}</td>
                      <td className="text-slate-500">{shortRole(r.role)}</td>
                      <td className="text-right text-slate-600">
                        {r.hourlyRate ? money2(r.hourlyRate) : <span className="text-slate-300 italic">salary</span>}
                      </td>
                      <td className="text-right text-slate-600">
                        {r.attendance?.workedHours ? r.attendance.workedHours.toFixed(1) : '—'}
                      </td>
                      <td className="text-right text-slate-600">
                        {r.productivityApplies ? (r.productivity?.orders ?? '—')
                          : <span className="text-slate-300" title={SALARIED_NOTE}>—</span>}
                      </td>
                      <td className="text-right text-slate-700 font-semibold">
                        {r.productivityApplies
                          ? (r.productivity ? money(r.productivity.grossSales) : '—')
                          : <span className="text-slate-300 font-normal" title={SALARIED_NOTE}>—</span>}
                      </td>
                      <td className="text-right text-slate-600">
                        {r.grossPerHour != null ? money(r.grossPerHour) : '—'}
                      </td>
                      <td className="text-right text-slate-600">
                        {r.productivity?.ast != null ? money2(r.productivity.ast) : '—'}
                      </td>
                      <td className="text-right">
                        {r.attendance ? (
                          <span className={r.attendance.lateArrivals > 2 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                            {r.attendance.lateArrivals}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-slate-500">
                        {r.hiredDate ? (
                          <span title={r.hiredSource === 'netchef-approx'
                            ? 'Approximate — Brink has no hire date for this person, so this is NetChef’s record-creation date'
                            : 'From Brink'}>
                            {r.hiredDate}
                            {r.hiredSource === 'netchef-approx' && (
                              <span className="ml-1 text-[9px] text-amber-600">approx</span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <div className="text-xs text-slate-400 py-6 text-center">No employees in this view.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function shortRole(role: string) {
  if (!role) return '—'
  const r = role.toLowerCase()
  if (r.includes('owner')) return 'Owner'
  if (r.includes('general manager')) return 'GM'
  if (r.includes('assistant')) return 'AGM'
  if (r.includes('salary')) return 'Salary'
  if (r.includes('captain')) return 'Capt.'
  if (r.includes('training')) return 'Training'
  return 'TM'
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card py-3">
      <div className="text-[10px] uppercase text-slate-400 font-medium">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function MinorLaborCard({ violations, unknownDob, minorCount, scheduledShifts }: {
  violations: Violation[]
  unknownDob: { employeeKey: string; employee: string; store: string }[]
  minorCount: number
  scheduledShifts: number
}) {
  const clean = violations.length === 0 && unknownDob.length === 0
  if (scheduledShifts === 0) {
    return (
      <div className="card border-l-4 border-slate-300">
        <div className="text-sm font-semibold text-slate-600">Minor-hour compliance</div>
        <div className="text-xs text-slate-400 mt-1">
          No schedule posted for the days ahead, so nothing to check yet. Run the Brink
          schedule pull to populate it.
        </div>
      </div>
    )
  }
  return (
    <div className={`card border-l-4 ${clean ? 'border-teal-500' : 'border-red-500'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {/* Status is carried by the icon + wording, not by colour alone. */}
          <div className="text-sm font-semibold text-slate-700">
            {clean ? '✓ ' : '⚠ '}Minor-hour compliance
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {minorCount} of the active crew {minorCount === 1 ? 'is' : 'are'} under 18.
            Checking {scheduledShifts} posted shift{scheduledShifts === 1 ? '' : 's'} against
            Florida limits for 16–17 year olds.
          </div>
        </div>
        {!clean && (
          <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-[11px] font-bold whitespace-nowrap">
            {violations.length} to review
          </span>
        )}
      </div>

      {violations.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {violations.map((v, i) => (
            <li key={i} className="text-xs flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-slate-700">{v.employee}</span>
              <span className="text-slate-400">({v.age}, {v.store})</span>
              <span className="text-red-600 font-medium">{MINOR_RULE_LABEL[v.rule]}</span>
              <span className="text-slate-500">— {v.date}, {v.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {unknownDob.length > 0 && (
        <div className="mt-3 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
          <strong>{unknownDob.length}</strong> scheduled {unknownDob.length === 1 ? 'person has' : 'people have'} no
          date of birth on record, so they could not be checked:{' '}
          {unknownDob.map(u => u.employee).join(', ')}. An unknown minor is exactly what this
          check is for — treat this as unverified, not as compliant.
        </div>
      )}

      {clean && (
        <div className="mt-2 text-xs text-slate-400">
          No violations on the posted schedule. School-day detection is approximate (the
          Broward calendar isn&apos;t wired in), so this flags more than it misses.
        </div>
      )}
    </div>
  )
}

function RecognitionCard({ items }: {
  items: { employee: string; store: string; kind: 'birthday' | 'anniversary'; date: string; days: number; years?: number }[]
}) {
  return (
    <div className="card">
      <div className="text-sm font-bold text-slate-700">Coming up</div>
      <div className="text-xs text-slate-400 mt-0.5 mb-3">Next 30 days</div>
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-50 text-xs">
            <span>{it.kind === 'birthday' ? '🎂' : '⭐'}</span>
            <span className="font-semibold text-slate-700">{it.employee}</span>
            <span className="text-slate-400">
              {it.kind === 'anniversary' && it.years ? `${it.years}yr · ` : ''}
              {it.date}
              {it.days === 0 ? ' (today)' : ` (${it.days}d)`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
