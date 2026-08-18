'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Timeframe from '@/components/Timeframe'
import { resolveDateRange, DEFAULT_PERIOD } from '@/lib/dates'
import type { Period } from '@/lib/types'
import Link from 'next/link'
import { MINOR_RULE_LABEL, type MinorRule } from '@/lib/minorLabor'
import Heatmap from '@/components/Heatmap'
import EmployeeTable from '@/components/EmployeeTable'
import DemandGrid from '@/components/DemandGrid'
import type { StaffingData, StaffingCell, EmployeeRow, Store, StoreRow } from '@/lib/types'
import { Page, PageBar, Section, Stat, Grid4, FlagList, type Flag } from '@/components/design/shell'
import { SegControl, TargetBar } from '@/components/design/controls'
import {
  LABOR_TARGET, DRAWER_VARIANCE_LIMIT, VOID_LIMIT_PCT, VOID_VS_SHIFT_MULTIPLE,
} from '@/lib/core/targets'

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
  latePct: number | null; hoursVariance: number
}
type Exceptions = {
  orders: number; voidOrders: number; voidPct: number | null
  discountTotal: number; grossSales: number; discountPct: number | null
  ee: number; sm: number; eePct: number | null
  shiftOrders: number; shiftVoidPct: number | null; shiftDiscountPct: number | null
}
type Cash = {
  ownTills: number; ownNet: number; ownPerTill: number | null; ownShortTills: number
  assocTills: number; assocNet: number; assocPerTill: number | null
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
  exceptions: Exceptions | null
  cash: Cash | null
  grossPerHour: number | null
}

/** Sum the three stores into one grid for "All Stores" — demand is additive. */
function mergeCells(sets: StaffingCell[][]): StaffingCell[] {
  const by = new Map<string, StaffingCell>()
  for (const set of sets) for (const c of set ?? []) {
    const k = `${c.day}|${c.hourNum}`
    const e = by.get(k)
    if (e) { e.avgUnits += c.avgUnits; e.count += c.count }
    else by.set(k, { ...c, employees: [] })
  }
  return [...by.values()]
}

const VIEWS = ['Productivity', 'Attendance', 'Exceptions'] as const
type View = (typeof VIEWS)[number]
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
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100 p-6"><div className="card"><div className="skeleton h-64 w-full" /></div></div>}>
      <EmployeesInner />
    </Suspense>
  )
}

function EmployeesInner() {
  const [store, setStore] = useState<(typeof STORES)[number]>('all')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [view, setView] = useState<View>('Productivity')
  // The staffing grid and the pay table moved here from Overview: the kit puts
  // labour on Labor & crew, and both answer "who worked, when, and what did it
  // cost" — the question this page is already about.
  const [staffing, setStaffing] = useState<StaffingData | null>(null)
  const [unitsWindow, setUnitsWindow] = useState<{ start: string; end: string } | null>(null)
  const [labor, setLabor] = useState<EmployeeRow[]>([])
  const [storeRows, setStoreRows] = useState<StoreRow[]>([])
  // Timeframe comes from the URL, same Period model as the inventory module and the
  // dashboard tabs, so a window is shareable and consistent across surfaces.
  const sp = useSearchParams()
  const period = (sp.get('period') as Period) || DEFAULT_PERIOD
  const win = resolveDateRange(period, sp.get('start') || undefined, sp.get('end') || undefined)

  useEffect(() => {
    setLoading(true); setErr(null)
    fetch(`/api/employees/roster?store=${store}&start=${win.start}&end=${win.end}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { d.error ? setErr(d.error) : setData(d) })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [store, win.start, win.end])

  useEffect(() => {
    let stale = false
    fetch(`/api/heatmap?period=${period}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!stale && d?.pines) { setStaffing(d); if (d.unitsWindowStart) setUnitsWindow({ start: d.unitsWindowStart, end: d.unitsWindowEnd }) } })
      .catch(() => {})
    fetch(`/api/employees?store=${store}&period=${period}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!stale && Array.isArray(d)) setLabor(d) })
      .catch(() => {})
    // Per-store labour % against target. Same source the Overview's store breakdown
    // reads, so the two screens cannot disagree about a store's labour.
    fetch(`/api/stores?period=${period}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!stale && Array.isArray(d)) setStoreRows(d) })
      .catch(() => {})
    return () => { stale = true }
  }, [store, period])

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

  /**
   * Needs attention — one flag per person per reason, worst first. Every threshold
   * comes from core/targets.ts, and the subtitle names all three so a reader can see
   * what did and did not qualify.
   *
   * The void test is against the REST OF THE SHIFT, not an absolute rate: an absolute
   * limit flags a whole store on a bad night, while "double the people working the
   * same hours" isolates the person a manager can actually talk to.
   */
  const flags: Flag[] = useMemo(() => {
    const out: Flag[] = []
    for (const r of active) {
      const a = r.attendance, e = r.exceptions, c = r.cash
      if (a?.noShows) {
        out.push({ tone: 'bad', who: r.employee, scope: r.homeStore,
          text: `${a.noShows} no-show${a.noShows === 1 ? '' : 's'} this window — cover the next posted shift.` })
      }
      if (e?.voidPct != null && e.shiftVoidPct != null && e.orders > 0
          && e.voidPct >= VOID_LIMIT_PCT
          && e.voidPct >= e.shiftVoidPct * VOID_VS_SHIFT_MULTIPLE) {
        out.push({ tone: 'bad', who: r.employee, scope: r.homeStore,
          text: `Void ${(e.voidPct * 100).toFixed(1)}% against a rest-of-shift ${(e.shiftVoidPct * 100).toFixed(1)}% — more than double the baseline, worth asking about.` })
      }
      if (c?.ownPerTill != null && Math.abs(c.ownPerTill) > DRAWER_VARIANCE_LIMIT && c.ownTills > 0) {
        out.push({ tone: 'warn', who: r.employee, scope: r.homeStore,
          text: `Drawer off ${signed(c.ownPerTill)} per till across ${c.ownTills} drawer${c.ownTills === 1 ? '' : 's'} — re-check the count routine.` })
      }
    }
    return out
  }, [active])

  const storeLabor = useMemo(
    () => storeRows.filter(r => store === 'all' || r.store === store),
    [storeRows, store])

  return (
    <Page>
      <PageBar
        eyebrow={`${store === 'all' ? 'All stores' : store} · Crew`}
        title="Labor & crew"
      >
        {/* No `meta` range line: Timeframe already prints the window, and printing it
            twice in one bar invites the two to disagree — which is exactly what was
            happening before they were given a single default. */}
        <SegControl
          label="Store"
          options={STORES.map(sv => ({ value: sv, label: sv === 'all' ? 'All Stores' : sv }))}
          value={store}
          onChange={setStore}
        />
        <Timeframe />
      </PageBar>

      {err && (
        <div className="sk-card sk-flags sk-tone-bad">
          <h3 className="sk-card-title">Couldn&apos;t load the crew</h3>
          <p className="sk-subline" style={{ fontFamily: 'var(--font-mono)' }}>{err}</p>
        </div>
      )}
      {loading && <div className="sk-card"><div className="skeleton" style={{ height: 256 }} /></div>}

      {data && !loading && (
        <>
          {/* Regulatory, so it leads — ahead of anything discretionary. */}
          <MinorLaborCard
            violations={data.minorLabor.violations}
            unknownDob={data.minorLabor.unknownDob}
            minorCount={minors.length}
            scheduledShifts={data.minorLabor.scheduledShifts}
          />

          <FlagList
            flags={flags}
            title="Needs attention"
            emptyNote={`No no-shows, no void rate past ${VOID_VS_SHIFT_MULTIPLE}x its shift baseline, and no drawer off more than $${DRAWER_VARIANCE_LIMIT} a till.`}
          />

          <Grid4>
            <Stat label="Active crew" value={String(active.length)}
              sub={minors.length ? `${minors.length} under 18` : 'none under 18'} />
            <Stat label="Hours worked"
              value={active.reduce((t, r) => t + (r.attendance?.workedHours ?? 0), 0).toFixed(0) + 'h'}
              sub={`${data.window.start} – ${data.window.end}`} />
            <Stat label="Attributed sales" value={money(data.basis.attributedGross)}
              sub={data.basis.attributedPct != null
                ? `${(data.basis.attributedPct * 100).toFixed(0)}% of in-store gross`
                : 'no basis'} />
            <Stat label="Upcoming dates" value={String(upcoming.length)}
              sub="birthdays & anniversaries, 30d" />
          </Grid4>

          {/* Labour % per store against the 22% target, read from the same source the
              Overview's store breakdown uses so the two cannot disagree. */}
          {storeLabor.length > 0 && (
            <Section label="Labor against target">
              <div className={storeLabor.length > 1 ? 'sk-grid3' : ''}>
                {storeLabor.map(r => {
                  const pct = r.laborPct * 100
                  const tgt = LABOR_TARGET * 100
                  return (
                    <div key={r.store} className="sk-card">
                      <div className="sk-eyebrow">{r.store}</div>
                      <div style={{ marginTop: 10 }}>
                        <TargetBar
                          label="Labor"
                          value={pct}
                          target={tgt}
                          tone={pct <= tgt ? 'good' : pct <= tgt * 1.1 ? 'warn' : 'bad'}
                          detail={<><span>vs {tgt.toFixed(1)}% target</span></>}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

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
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-bold text-slate-700">Roster</div>
                <div className="text-xs text-slate-400 mt-0.5">{VIEW_NOTE[view]}</div>
              </div>
              <div className="flex items-center gap-3">
                {/* Three narrow views rather than one 17-column table — each stays
                    scannable, and grouping keeps unrelated measures from being read
                    against each other. */}
                <div className="flex gap-1">
                  {VIEWS.map(v => (
                    <button key={v} onClick={() => setView(v)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                        view === v ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
                      }`}>{v}</button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={showInactive}
                    onChange={e => setShowInactive(e.target.checked)} className="accent-teal-600" />
                  inactive
                </label>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  {view === 'Exceptions' && (
                    <tr className="text-[9px] uppercase tracking-wide">
                      <th colSpan={2} />
                      <th colSpan={3} className="pb-1 text-center text-slate-500 border-b-2 border-slate-300">
                        Theirs — rung / counted by them
                      </th>
                      <th colSpan={3} className="pb-1 text-center text-slate-400 border-b-2 border-slate-200">
                        Rest of shift — same hours, other people
                      </th>
                    </tr>
                  )}
                  <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100">
                    <th className="text-left pb-2">Employee</th>
                    <th className="text-left pb-2">Store</th>
                    {view === 'Productivity' && <>
                      <th className="text-right pb-2">Hrs</th>
                      <th className="text-right pb-2">Orders</th>
                      <th className="text-right pb-2">Gross</th>
                      <th className="text-right pb-2">$/hr</th>
                      <th className="text-right pb-2">Avg sale</th>
                      <th className="text-right pb-2" title="Extras &amp; enhancers attach rate">EE%</th>
                    </>}
                    {view === 'Attendance' && <>
                      <th className="text-right pb-2">Sched hrs</th>
                      <th className="text-right pb-2">Actual hrs</th>
                      <th className="text-right pb-2">Variance</th>
                      <th className="text-right pb-2">Late %</th>
                      <th className="text-right pb-2">No-show</th>
                      <th className="text-right pb-2">Unsched</th>
                      <th className="text-right pb-2">OT</th>
                    </>}
                    {view === 'Exceptions' && <>
                      <th className="text-right pb-2">Void %</th>
                      <th className="text-right pb-2">Disc %</th>
                      <th className="text-right pb-2">Cash / drawer</th>
                      <th className="text-right pb-2">Void %</th>
                      <th className="text-right pb-2">Disc %</th>
                      <th className="text-right pb-2">Cash / drawer</th>
                    </>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map(r => {
                    const a = r.attendance, e = r.exceptions, c = r.cash, p = r.productivity
                    return (
                      <tr key={r.employeeKey} className="hover:bg-slate-50 transition-colors">
                        <td className="py-1.5 font-semibold text-slate-700">
                          <Link href={`/employees/${encodeURIComponent(r.employeeKey)}`}
                            className="hover:text-teal-600 transition-colors">{r.employee}</Link>
                          {r.isMinor && (
                            <span className="ml-1.5 px-1 py-0.5 rounded bg-amber-50 text-amber-700 text-[9px] font-bold align-middle">
                              {r.age}
                            </span>
                          )}
                          {r.status === 'inactive' && <span className="ml-1.5 text-[9px] text-slate-300">inactive</span>}
                        </td>
                        <td className="text-slate-400">{r.homeStore}</td>

                        {view === 'Productivity' && <>
                          <Num v={a?.workedHours} d={1} />
                          {r.productivityApplies
                            ? <><Num v={p?.orders} /><Cell>{p ? money(p.grossSales) : '—'}</Cell>
                               <Cell>{r.grossPerHour != null ? money(r.grossPerHour) : '—'}</Cell>
                               <Cell>{p?.ast != null ? money2(p.ast) : '—'}</Cell></>
                            : <td className="text-right text-slate-300" colSpan={4} title={SALARIED_NOTE}>salaried — not measured</td>}
                          <Cell>{e?.eePct != null
                            ? <span className={e.eePct >= 0.6 ? 'text-emerald-600' : e.eePct >= 0.4 ? 'text-slate-600' : 'text-amber-600'}>
                                {(e.eePct * 100).toFixed(1)}%</span>
                            : <NoPos has={!!e} />}</Cell>
                        </>}

                        {view === 'Attendance' && <>
                          <Num v={a?.scheduledHours} d={1} />
                          <Num v={a?.workedHours} d={1} />
                          <Cell>{a ? <span className={Math.abs(a.hoursVariance) > 8 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>
                            {a.hoursVariance > 0 ? '+' : ''}{a.hoursVariance.toFixed(1)}</span> : '—'}</Cell>
                          <Cell>{a?.latePct != null
                            ? <span className={a.latePct > 0.25 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>
                                {(a.latePct * 100).toFixed(0)}%</span>
                            : <span className="text-slate-300" title="fewer than 3 shifts matched to a posted schedule">—</span>}</Cell>
                          <Cell>{a?.noShows ? <span className="text-amber-600 font-semibold">{a.noShows}</span> : (a ? '0' : '—')}</Cell>
                          <Num v={a?.unscheduledShifts} />
                          <Cell>{a?.otHours ? a.otHours.toFixed(1) : (a ? '0' : '—')}</Cell>
                        </>}

                        {view === 'Exceptions' && <>
                          {/* Theirs */}
                          <Rate v={e?.voidPct} limit={0.02} n={e?.orders} unit="orders" fallback={<NoPos has={!!e} />} />
                          <Rate v={e?.discountPct} limit={0.08} n={e?.orders} unit="orders" fallback={<NoPos has={!!e} />} />
                          <Cell>{c?.ownPerTill != null
                            ? <span className={Math.abs(c.ownPerTill) > 5 ? 'text-amber-600 font-semibold' : 'text-slate-500'}
                                    title={`${c.ownTills} drawer${c.ownTills === 1 ? '' : 's'} they ran`}>
                                {signed(c.ownPerTill)}<span className="text-slate-300 ml-1">·{c.ownTills}</span></span>
                            : <span className="text-slate-300" title="ran no drawers in this window">—</span>}</Cell>
                          {/* Rest of shift — muted, so it reads as context rather than as their score */}
                          <Rate v={e?.shiftVoidPct} limit={0.02} n={e?.shiftOrders} unit="orders" muted
                                fallback={<span className="text-slate-300">—</span>} />
                          <Rate v={e?.shiftDiscountPct} limit={0.08} n={e?.shiftOrders} unit="orders" muted
                                fallback={<span className="text-slate-300">—</span>} />
                          <Cell>{c?.assocPerTill != null
                            ? <span className="text-slate-400"
                                    title={`${c.assocTills} drawer${c.assocTills === 1 ? '' : 's'} run by other people while they were clocked in`}>
                                {signed(c.assocPerTill)}<span className="text-slate-300 ml-1">·{c.assocTills}</span></span>
                            : <span className="text-slate-300">—</span>}</Cell>
                        </>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <div className="text-xs text-slate-400 py-6 text-center">No employees in this view.</div>
            )}
            {view === 'Exceptions' && (
              <div className="text-[11px] text-slate-400 mt-3 leading-relaxed space-y-1.5">
                <p>
                  <strong className="text-slate-600">Theirs</strong> is what this person rang or
                  counted themselves. <strong className="text-slate-600">Rest of shift</strong> is
                  the same measure over the <em>same hours</em>, for orders and drawers belonging
                  to <em>other</em> people — their own activity is excluded from it, so the two
                  columns are a like-for-like comparison rather than a total and a subset.
                </p>
                <p>
                  Read them side by side. A 4% void rate means little on its own; a 4% rate
                  against a rest-of-shift 1% is a question worth asking, and against a
                  rest-of-shift 4% it is just what that daypart looks like. The small grey
                  number after each cash figure is the drawer count behind it.
                </p>
                <p>
                  <strong className="text-slate-600">Rest of shift is presence, not fault.</strong>{' '}
                  About 3.7 crew overlap the average drawer session. Tested against a
                  store-controlled null over Jun–Aug, no employee&apos;s rest-of-shift variance was
                  distinguishable from chance — so use it to spot a trend over time, never as
                  evidence about a person.
                </p>
              </div>
            )}
          </div>

          {/* ── Staffing and pay, moved here from Overview ──────────────────── */}
          {staffing && (
            <Section label="Units per labor hour">
              <Heatmap
                data={staffing}
                store={store as Store}
                period={period}
                dates={{ start: win.start, end: win.end, pyStart: '', pyEnd: '' }}
                unitsWindow={unitsWindow}
                loading={false}
              />
            </Section>
          )}

          {/* Demand beneath supply: the grid above divides these units by the labor
              hours that met them, so they read as one pair. */}
          {staffing && (
            <Section label="Hourly demand">
              <DemandGrid cells={
                store === 'all'
                  ? mergeCells([staffing.pines, staffing.miramar, staffing.margate])
                  : (staffing[store.toLowerCase() as 'pines' | 'miramar' | 'margate'] ?? [])
              } />
            </Section>
          )}

          {labor.length > 0 && (
            <div className="mt-4">
              <EmployeeTable employees={labor} loading={false} />
            </div>
          )}
        </>
      )}
    </Page>
  )
}

const VIEW_NOTE: Record<View, string> = {
  Productivity: 'Sales are in-store gross on the Brink cashier basis · sorted by gross',
  Attendance: 'Posted schedule vs Brink timecards · salaried and owners excluded from punctuality',
  Exceptions: 'Their own activity beside the rest of their shift · same definitions as the Ops Health card',
}

/** Right-aligned numeric cell. */
function Num({ v, d = 0 }: { v?: number | null; d?: number }) {
  return <td className="text-right text-slate-600">{v != null ? v.toFixed(d) : '—'}</td>
}
function Cell({ children }: { children: React.ReactNode }) {
  return <td className="text-right text-slate-600">{children}</td>
}
/** A percentage cell that shows its own sample size on hover and greys out when muted. */
function Rate({ v, limit, n, unit, muted, fallback }: {
  v?: number | null; limit: number; n?: number; unit: string
  muted?: boolean; fallback: React.ReactNode
}) {
  if (v == null) return <Cell>{fallback}</Cell>
  const over = v > limit
  const cls = muted
    ? 'text-slate-400'
    : over ? 'text-amber-600 font-semibold' : 'text-slate-500'
  return <Cell><span className={cls} title={n != null ? `${n} ${unit}` : undefined}>{(v * 100).toFixed(2)}%</span></Cell>
}

/** Distinguishes "no POS attribution for this person" from a genuine zero. */
function NoPos({ has }: { has: boolean }) {
  return has
    ? <span className="text-slate-300">—</span>
    : <span className="text-slate-300 italic" title="No POS attribution for this employee — the item-sales export drops the cashier stamp for staff hired since May 2026, so this is unknown, not zero.">n/a</span>
}
function signed(n: number) {
  return `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`
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
            <span className="sk-dot" style={{ background: it.kind === 'birthday' ? 'var(--accent)' : 'var(--brand)' }} />
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
