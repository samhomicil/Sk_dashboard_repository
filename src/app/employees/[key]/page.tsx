'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'

type Dim = {
  employeeKey: string; employee: string; homeStore: string; role: string
  hourlyRate: number | null; hiredDate: string | null
  hiredSource: 'brink' | 'netchef-approx' | null
  dateOfBirth: string | null; firstShift: string; lastShift: string
  totalHours: number; shiftCount: number; status: 'active' | 'inactive'
}
type Shift = {
  date: string; store: string; role: string | null
  start: string | null; end: string | null; hours: number; otHours: number
  schedStart: string | null; schedEnd: string | null; schedHours: number | null
  inDeltaMin: number | null; outDeltaMin: number | null
}
type Brk = { date: string; start: string | null; end: string | null; isPaid: boolean; paidHours: number; unpaidHours: number }
type Till = { date: string; drawer: string | null; overShort: number; tips: number }
type Edit = { date: string; field: string | null; originalValue: string | null; newValue: string | null; editedBy: string | null; reason: string | null; deleted: boolean }
type Override = { time: string; store: string; button: string | null; approver: string | null; method: string | null }
type Payload = {
  window: { start: string; end: string }
  dim: Dim; shifts: Shift[]; breaks: Brk[]; tills: Till[]; edits: Edit[]
  overridesAsUser: Override[]; overrideNameAmbiguous: boolean
}

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—')

export default function ProfilePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const [d, setD] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/employees/profile?key=${encodeURIComponent(decodeURIComponent(key))}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => (j.error ? setErr(j.error) : setD(j)))
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [key])

  if (loading) return <Shell><div className="card"><div className="skeleton h-64 w-full" /></div></Shell>
  if (err || !d) return (
    <Shell>
      <div className="card border-l-4 border-red-500">
        <div className="text-sm font-semibold text-red-700">Couldn&apos;t load this employee</div>
        <div className="text-xs text-slate-500 mt-1 font-mono">{err}</div>
      </div>
    </Shell>
  )

  const { dim } = d
  const workedHours = d.shifts.reduce((s, x) => s + x.hours, 0)
  const otHours = d.shifts.reduce((s, x) => s + x.otHours, 0)
  const matched = d.shifts.filter(s => s.inDeltaMin != null)
  const avgIn = matched.length ? matched.reduce((s, x) => s + (x.inDeltaMin ?? 0), 0) / matched.length : null
  const late = matched.filter(s => (s.inDeltaMin ?? 0) > 5).length
  const netOverShort = d.tills.reduce((s, t) => s + t.overShort, 0)
  const unpaidBreak = d.breaks.reduce((s, b) => s + b.unpaidHours, 0)
  const isSalaried = /salary|owner/i.test(dim.role)

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <Link href="/employees" className="text-xs text-slate-400 hover:text-teal-600">← All employees</Link>
          <h1 className="text-xl font-bold text-slate-800 mt-1">{dim.employee}</h1>
          <div className="text-xs text-slate-500 mt-0.5">
            {dim.homeStore} · {dim.role || '—'}
            {dim.hourlyRate ? ` · $${dim.hourlyRate.toFixed(2)}/hr` : ' · salaried'}
            {dim.status === 'inactive' && <span className="ml-2 text-slate-300">inactive</span>}
          </div>
        </div>
        <div className="text-right text-xs text-slate-400">
          <div>{d.window.start} – {d.window.end}</div>
          {dim.hiredDate && (
            <div className="mt-0.5">
              Hired {dim.hiredDate}
              {dim.hiredSource === 'netchef-approx' && (
                <span className="ml-1 text-amber-600" title="Brink has no hire date for this person; this is NetChef’s record-creation date">approx</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="Hours" value={`${workedHours.toFixed(1)}h`} sub={`${d.shifts.length} shifts`} />
        <Tile label="Overtime" value={`${otHours.toFixed(1)}h`} />
        <Tile
          label="Avg clock-in"
          value={isSalaried ? '—' : avgIn != null ? `${avgIn > 0 ? '+' : ''}${avgIn.toFixed(0)}m` : '—'}
          sub={isSalaried ? 'salaried — punches are administrative' : `${late} late of ${matched.length} matched`}
        />
        <Tile
          label="Till net"
          value={d.tills.length ? money(netOverShort) : '—'}
          sub={d.tills.length ? `${d.tills.length} drawers` : 'no drawers run'}
        />
      </div>

      {/* Cash variance framing: one drawer is noise, and direction matters — a persistent
          OVER can mean under-ringing just as a persistent SHORT can mean loss. */}
      {d.tills.length > 0 && (
        <Card title="Cash drawers" sub={`net ${money(netOverShort)} across ${d.tills.length} sessions · unpaid break ${unpaidBreak.toFixed(1)}h`}>
          <p className="text-[11px] text-slate-400 mb-2">
            A single drawer is noise. Look for the same direction repeating — and treat a
            persistent overage as seriously as a shortage, since it can mean sales not rung.
          </p>
          <Table
            head={['Date', 'Drawer', 'Over / short', 'Tips']}
            rows={d.tills.slice(0, 12).map(t => [
              t.date, t.drawer ?? '—',
              <span key="os" className={t.overShort < -5 ? 'text-red-600 font-semibold' : t.overShort > 5 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>
                {money(t.overShort)}
              </span>,
              money(t.tips),
            ])}
          />
        </Card>
      )}

      <Card title="Shifts" sub="scheduled vs actual">
        <Table
          head={['Date', 'Store', 'Scheduled', 'Actual', 'In', 'Out', 'Hrs']}
          rows={d.shifts.slice(0, 20).map(s => [
            s.date, s.store,
            s.schedStart ? `${hhmm(s.schedStart)}–${hhmm(s.schedEnd)}` : <span key="u" className="text-amber-600">unscheduled</span>,
            `${hhmm(s.start)}–${hhmm(s.end)}`,
            delta(s.inDeltaMin, isSalaried),
            delta(s.outDeltaMin, isSalaried, true),
            s.hours.toFixed(1),
          ])}
        />
      </Card>

      {d.breaks.length > 0 && (
        <Card title="Breaks" sub={`${d.breaks.length} recorded`}>
          <Table
            head={['Date', 'Start', 'End', 'Paid', 'Hours']}
            rows={d.breaks.slice(0, 12).map(b => [
              b.date, hhmm(b.start), hhmm(b.end), b.isPaid ? 'paid' : 'unpaid',
              (b.isPaid ? b.paidHours : b.unpaidHours).toFixed(2),
            ])}
          />
        </Card>
      )}

      {d.overridesAsUser.length > 0 && (
        <Card title="Manager overrides" sub={`${d.overridesAsUser.length} where this person was logged in`}>
          {d.overrideNameAmbiguous && (
            <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-2">
              Brink records only a first name on overrides, and more than one person on the
              roster shares this one — these may not all be this employee. Treat as
              unconfirmed.
            </div>
          )}
          <Table
            head={['Time', 'Store', 'Action', 'Approved by', 'Method']}
            rows={d.overridesAsUser.slice(0, 12).map(o => [
              o.time, o.store, o.button ?? '—', o.approver ?? '—', o.method ?? '—',
            ])}
          />
        </Card>
      )}

      {d.edits.length > 0 && (
        <Card title="Timecard edits" sub={`${d.edits.length} on this person's shifts`}>
          <p className="text-[11px] text-slate-400 mb-2">
            Edits are made by managers, not by this employee. Shown here as context on their
            hours — the accountability sits with the editor.
          </p>
          <Table
            head={['Date', 'Field', 'From', 'To', 'By', 'Reason']}
            rows={d.edits.slice(0, 12).map(e => [
              e.date, e.deleted ? 'shift deleted' : e.field ?? '—',
              e.originalValue ?? '—', e.newValue ?? '—', e.editedBy ?? '—', e.reason || '—',
            ])}
          />
        </Card>
      )}
    </Shell>
  )
}

function delta(v: number | null, salaried: boolean, out = false) {
  if (salaried || v == null) return <span className="text-slate-300">—</span>
  const bad = out ? Math.abs(v) > 30 : v > 5
  return <span className={bad ? 'text-amber-600 font-semibold' : 'text-slate-500'}>{v > 0 ? '+' : ''}{v}m</span>
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 p-4 md:p-6 max-w-5xl mx-auto">{children}</div>
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

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <div className="text-sm font-bold text-slate-700">{title}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5 mb-2">{sub}</div>}
      {children}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <div className="text-xs text-slate-400 py-3">Nothing in this window.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100">
            {head.map((h, i) => (
              <th key={h} className={`pb-2 ${i === 0 ? 'text-left' : i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {r.map((c, j) => (
                <td key={j} className={`py-1.5 ${j === 0 ? 'text-slate-700 font-medium' : j >= 2 ? 'text-right text-slate-600' : 'text-slate-500'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
