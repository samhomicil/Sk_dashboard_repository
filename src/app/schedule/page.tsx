'use client'

/**
 * SCHEDULE — build next week and run this one, phone first (laptop, iPad and phone; Sam
 * 2026-10-06).
 *
 * One screen, three kinds of week, all from the same route and core/schedule.ts:
 *   ahead    not started: build it (the generated draft, or what's posted if Teamworx has it)
 *   current  in progress: finished days show scheduled vs worked (Brink); today's shifts that
 *            haven't started and the days ahead edit exactly like next week; the entry sheet
 *            lists only what changed against what's posted
 *   past     read-only: scheduled vs worked
 * Store, week, day and view live in the address, so the back gesture steps out of a day and
 * a link opens the same screen. Every figure comes from core/schedule.ts, run here live on
 * the shifts as they are edited; thresholds ride in from core/targets.ts; this file only
 * formats and handles input. Nothing here is sent to Teamworx.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Page, PageBar, TakeCard, Section, BasisNote, Disclosure, toneClass, type Tone } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { useStoreLock } from '@/components/useStoreLock'
import { isoAdd } from '@/lib/core/dates'
import {
  LABOR_TARGET, CLOSE_MIN_PEOPLE, SHIFT_MIN_HOURS, UNITS_PER_PERSON_HALF_HOUR, RUSH_UNITS, WEEKLY_OT_HOURS, LATE_MINUTES,
} from '@/lib/core/targets'
import { evaluate, expectation, schedClock as clock, SLOT, type SchedShift, type SchedPerson, type SchedDay, type Evaluation } from '@/lib/core/schedule'
import type { SchedulePayload } from '@/app/api/schedule/route'

type StoreKey = 'margate' | 'miramar' | 'pines'
type Source = 'draft' | 'posted' | 'lastWeek' | 'blank'
type Snap = { shifts: SchedShift[]; source: Source }
type View = 'week' | 'day' | 'entry'
type DayState = 'done' | 'today' | 'ahead'
type Actual = NonNullable<SchedulePayload['actual']>

const STORE_OPTS: { value: StoreKey; label: string }[] = [
  { value: 'margate', label: 'Margate' }, { value: 'miramar', label: 'Miramar' }, { value: 'pines', label: 'Pines' },
]
const isStore = (v: string | null): v is StoreKey => STORE_OPTS.some(o => o.value === v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const GOAL = LABOR_TARGET * 100
const AX0 = 6 * 60, AX1 = 21 * 60 + 30                // the time axis every day is drawn on
const TICKS = [7, 9, 11, 13, 15, 17, 19, 21]
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const hrs = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const at = (m: number) => `${(((m - AX0) / (AX1 - AX0)) * 100).toFixed(3)}%`
const span = (a: number, z: number) => `${(((z - a) / (AX1 - AX0)) * 100).toFixed(3)}%`
const dParts = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return { dow: d.getUTCDay(), m: d.getUTCMonth(), day: d.getUTCDate() } }
const dayShort = (iso: string) => { const p = dParts(iso); return `${DAY_LONG[p.dow].slice(0, 3)} ${MON[p.m]} ${p.day}` }
const dayLong = (iso: string) => { const p = dParts(iso); return `${DAY_LONG[p.dow]} ${MON[p.m]} ${p.day}` }
/** The Tuesday that starts the business week holding `iso` (Teamworx weeks run Tue–Mon). */
const weekOf = (iso: string) => isoAdd(iso, -((dParts(iso).dow + 5) % 7))
const rangeLabel = (a: string, z: string) => {
  const p = dParts(a), q = dParts(z)
  return p.m === q.m ? `${MON[p.m]} ${p.day}–${q.day}` : `${MON[p.m]} ${p.day} – ${MON[q.m]} ${q.day}`
}
const laborTone = (pct: number): Tone => (pct > GOAL ? 'warn' : 'neutral')
/** Status colour for a figure or note. 'neutral' gets no class: the shared neutral tone is
 *  brass, and brass is never put on a number (design kit). */
const tone = (t: Tone) => (t === 'neutral' ? '' : toneClass(t))
const pctText = (a: number, b: number) => {
  const x = ((a - b) / b) * 100
  return Math.abs(x) < 0.05 ? 'flat' : `${x > 0 ? 'up' : 'down'} ${Math.abs(x).toFixed(1)}%`
}
const signed = (a: number, b: number) => { const x = ((a - b) / b) * 100; return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}%` }
const strip = (xs: SchedShift[]) => xs.map(({ date, s, e, key }) => ({ date, s, e, key }))

export default function SchedulePage() {
  return <Suspense fallback={null}><Schedule /></Suspense>
}

function Schedule() {
  const params = useSearchParams()
  const lock = useStoreLock()
  const qStore = params.get('store'), qWeek = params.get('week'), qDay = params.get('day'), qView = params.get('view')
  const store: StoreKey = lock ?? (isStore(qStore) ? qStore : 'margate')
  const week = qWeek && ISO.test(qWeek) ? qWeek : null
  const [data, setData] = useState<SchedulePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [shifts, setShifts] = useState<SchedShift[]>([])
  const [source, setSource] = useState<Source>('draft')
  const [hist, setHist] = useState<Snap[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [opened, setOpened] = useState<string[]>([])     // closed-last-year days the store is opening
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const nextId = useRef(1)
  const loaded = useRef<string | null>(null)
  const defaultTue = useRef<string | null>(null)          // what a bare /schedule opened (next week)
  const fromWeek = useRef(false)                          // did we push the open day/sheet onto history?

  const withIds = useCallback((xs: Omit<SchedShift, 'id'>[]) => xs.map(x => ({ ...x, id: nextId.current++ })), [])

  // ── the address is the state: ?store=&week=&day=&view=entry ──
  const nav = useCallback((next: { store?: StoreKey; week?: string | null; day?: string | null; view?: 'entry' | null }, how: 'push' | 'replace') => {
    const u = new URLSearchParams()
    u.set('store', next.store ?? store)
    const wk = next.week === undefined ? week : next.week
    if (wk) u.set('week', wk)
    const d = next.day === undefined ? qDay : next.day
    if (d) u.set('day', d)
    const v = next.view === undefined ? qView : next.view
    if (v === 'entry') u.set('view', 'entry')
    window.history[how === 'push' ? 'pushState' : 'replaceState'](null, '', `/schedule?${u}`)
  }, [store, week, qDay, qView])

  useEffect(() => {
    const wk = week ? weekOf(week) : defaultTue.current
    const want = `${store}|${wk ?? 'next'}`
    if (loaded.current === want) {
      if (!week && wk) window.history.replaceState(null, '', `/schedule?store=${store}&week=${wk}`)
      return
    }
    let live = true
    setData(null); setError(null)
    fetch(`/api/schedule?store=${store}${week ? `&week=${week}` : ''}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.reason ?? `error ${r.status}`); return r.json() })
      .then((d: SchedulePayload) => {
        if (!live) return
        loaded.current = `${store}|${d.tuesday}`
        const start: Source = d.mode !== 'ahead' || d.starts.posted.length ? 'posted' : 'draft'
        setData(d); setShifts(withIds(d.starts[start])); setSource(start); setHist([]); setSel(null); setOpened([]); setSaving('idle')
        // a bare /schedule opens next week; put the week in the address so it can be shared
        if (!week) { defaultTue.current = d.tuesday; window.history.replaceState(null, '', `/schedule?store=${store}&week=${d.tuesday}`) }
      })
      .catch(e => live && setError(String(e.message ?? e)))
    return () => { live = false }
  }, [store, week, withIds])

  const days = useMemo(() => (data ? data.days.map(d => (opened.includes(d.date) && data.ifOpen[d.date]) || d) : []), [data, opened])
  // today is judged from now on: what already happened can't be fixed here
  const run = useCallback((xs: SchedShift[]) => evaluate(data!.store.name, days, xs, data!.people, data!.elsewhere,
    data!.mode === 'current' ? { [data!.today]: data!.now } : {}), [data, days])
  const ev = useMemo(() => (data ? run(shifts) : null), [data, run, shifts])

  // ── edits: every change is undoable ──
  const commit = useCallback((next: SchedShift[]) => { setHist(h => [...h, { shifts, source }].slice(-50)); setShifts(next) }, [shifts, source])
  const edit = (id: number, fn: (s: SchedShift) => SchedShift) => commit(shifts.map(s => (s.id === id ? fn({ ...s }) : s)))
  const undo = () => {
    const last = hist[hist.length - 1]
    if (!last) return
    setShifts(last.shifts); setSource(last.source); setHist(hist.slice(0, -1)); setSel(null)
  }

  // ── what can still change: finished days never; today only what hasn't started ──
  const stateOf = (date: string): DayState => (!data ? 'ahead' : data.mode === 'past' || date < data.today ? 'done' : date === data.today ? 'today' : 'ahead')
  const earliest = (day: SchedDay) => (stateOf(day.date) === 'today' ? Math.max(day.a, Math.ceil((data!.now + 1) / SLOT) * SLOT) : day.a)
  const editable = (s: SchedShift) => { const st = stateOf(s.date); return st === 'ahead' || (st === 'today' && s.s > data!.now) }
  const canAdd = (day: SchedDay) => stateOf(day.date) !== 'done' && day.z - earliest(day) >= 60
  /** Replace what can still change, keep what can't (a saved version or a reset, mid-week). */
  const keepLocked = (incoming: SchedShift[]) => [...shifts.filter(s => !editable(s)), ...incoming.filter(editable)]

  const load = (src: Source) => {
    if (!data) return
    setHist(h => [...h, { shifts, source }].slice(-50))
    setShifts(data.mode === 'current' ? keepLocked(withIds(data.starts[src])) : withIds(data.starts[src])); setSource(src); setSel(null)
  }

  // ── drag: move a bar, or pull either end ──
  const drag = useRef<{ id: number; mode: 'move' | 'l' | 'r'; grab: number; moved: boolean; snap: Snap } | null>(null)
  const minuteAt = (e: React.PointerEvent, el: Element) => {
    const track = el.closest('[data-track]') ?? el
    const r = track.getBoundingClientRect()
    return AX0 + ((e.clientX - r.left) / r.width) * (AX1 - AX0)
  }
  const startDrag = (e: React.PointerEvent, s: SchedShift, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0 || !editable(s)) return
    if (mode !== 'move') e.stopPropagation()
    drag.current = { id: s.id, mode, grab: minuteAt(e, e.currentTarget) - s.s, moved: false, snap: { shifts, source } }
  }
  const dragOver = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !data) return
    const m = minuteAt(e, e.currentTarget)
    setShifts(cur => cur.map(s => {
      if (s.id !== d.id) return s
      const day = days.find(x => x.date === s.date)!
      const lo = earliest(day)
      const snap = (x: number) => Math.round(x / SLOT) * SLOT
      const n = { ...s }
      if (d.mode === 'move') { const len = s.e - s.s; n.s = Math.max(lo, Math.min(day.z - len, snap(m - d.grab))); n.e = n.s + len }
      else if (d.mode === 'l') n.s = Math.max(lo, Math.min(s.e - 60, snap(m)))
      else n.e = Math.min(day.z, Math.max(s.s + 60, snap(m)))
      if (n.s !== s.s || n.e !== s.e) d.moved = true
      return n
    }))
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) setHist(h => [...h, d.snap].slice(-50))
    else setSel(cur => (cur === d.id ? null : d.id))           // a tap, not a drag, opens the shift
  }

  const save = async () => {
    if (!data) return
    setSaving('saving')
    const name = `Version ${data.saved.length + 1}`
    const r = await fetch('/api/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: data.store.key, week: data.tuesday, name, source, shifts: strip(shifts) }),
    }).catch(() => null)
    if (!r?.ok) { setSaving('failed'); return }
    const { id } = await r.json()
    setData({ ...data, saved: [...data.saved, { id, name, source, by: null, at: 'just now', shifts: strip(shifts) }] })
    setSaving('saved')
  }

  // ── where we are, in words ──
  const names = (() => {
    if (!data) return null
    const thisTue = weekOf(data.today)
    const rel = data.tuesday === thisTue ? 'This week' : data.tuesday === isoAdd(thisTue, 7) ? 'Next week' : data.tuesday === isoAdd(thisTue, -7) ? 'Last week' : null
    const range = rangeLabel(data.dates[0], data.dates[6])
    return { rel, range, full: rel ? `${rel} · ${range}` : `Week of ${range}` }
  })()
  const dayIdx = data ? (qDay && data.dates.includes(qDay) ? data.dates.indexOf(qDay) : Math.max(0, data.dates.indexOf(data.today))) : 0
  const view: View = qView === 'entry' && data?.mode !== 'past' ? 'entry' : qDay ? 'day' : 'week'
  const open = (i: number) => () => {
    if (!data) return
    if (view === 'week') { fromWeek.current = true; nav({ day: data.dates[i], view: null }, 'push') }
    else nav({ day: data.dates[i], view: null }, 'replace')
    setSel(null)
  }
  const toWeek = () => {
    setSel(null)
    if (fromWeek.current) { fromWeek.current = false; window.history.back(); return }
    nav({ day: null, view: null }, 'replace')
  }
  const toEntry = () => { fromWeek.current = view === 'week'; nav({ day: null, view: 'entry' }, view === 'week' ? 'push' : 'replace'); setSel(null) }
  const stepWeek = (k: number) => { fromWeek.current = false; nav({ week: isoAdd(data!.tuesday, 7 * k), day: null, view: null }, 'push') }

  const crumbs = (
    <nav aria-label="Breadcrumb" className="sk-sched-crumbs">
      <Link href={`/schedule?store=${store}`} onClick={() => { fromWeek.current = false }}>Schedule</Link>
      {names ? <>
        <span aria-hidden>›</span>
        {view === 'week' ? <span aria-current="page">{names.full}</span> : <button type="button" onClick={toWeek}>{names.full}</button>}
      </> : null}
      {data && view !== 'week' ? <>
        <span aria-hidden>›</span>
        <span aria-current="page">{view === 'entry' ? 'Entry sheet' : DAY_LONG[dParts(data.dates[dayIdx]).dow]}</span>
      </> : null}
    </nav>
  )
  const pickers = (
    <>
      {lock ? null : <SegControl label="Store" options={STORE_OPTS} value={store}
        onChange={v => { fromWeek.current = false; nav({ store: v, week: null, day: null, view: null }, 'replace') }} />}
      {names ? (
        <div className="sk-sched-week-step" role="group" aria-label="Week">
          <button type="button" aria-label="Previous week" onClick={() => stepWeek(-1)}>‹</button>
          <span>{names.full}</span>
          <button type="button" aria-label="Next week" onClick={() => stepWeek(1)}>›</button>
        </div>
      ) : null}
    </>
  )
  const title = !data || !names ? 'Schedule'
    : data.mode === 'ahead' ? (names.rel ? `Build ${names.rel.toLowerCase()}` : 'Build the week')
    : data.mode === 'current' ? 'This week' : names.rel ?? 'Past week'

  if (error) return <Page><PageBar eyebrow={crumbs} title="Schedule">{pickers}</PageBar><TakeCard tone="bad" label="Not loaded" headline="The schedule could not be loaded.">{error}</TakeCard></Page>
  if (!data || !ev || !names) return <Page><PageBar eyebrow={crumbs} title="Schedule">{pickers}</PageBar><p className="sk-sched-muted">Loading…</p></Page>

  const people = new Map(data.people.map(p => [p.key, p]))
  const posted = data.starts.posted
  const act = new Map((data.actual?.days ?? []).map(d => [d.date, d]))
  const states = days.map(d => stateOf(d.date))
  const editableDays = days.map((_, i) => states[i] !== 'done')

  // ── the week's figures: finished days at actual sales and pay, the rest at the forecast and
  //    the schedule as it stands (Weekly Ops' week-in-progress rule) ──
  let salesH = 0, wagesH = 0, doneSales = 0, donePay = 0, doneFc = 0, payMissing: string[] = []
  days.forEach((d, i) => {
    if (states[i] === 'done') {
      const a = act.get(d.date)
      const pay = a?.pay ?? null
      if (pay == null) payMissing.push(DAY_LONG[d.dow])
      salesH += a?.sales ?? 0; wagesH += pay ?? ev.days[i].wages
      doneSales += a?.sales ?? 0; donePay += pay ?? 0; doneFc += d.sales
    } else { salesH += d.sales; wagesH += ev.days[i].wages }
  })
  payMissing = data.mode === 'ahead' ? [] : payMissing
  const pctH = salesH ? (wagesH / salesH) * 100 : 0
  const doneDays = states.filter(s => s === 'done').length
  const todayIdx = states.indexOf('today')
  const hourly = data.people.filter(p => !p.salaried && p.rate > 0)
  const avgRate = hourly.length ? hourly.reduce((t, p) => t + p.rate, 0) / hourly.length : 0
  const trimHours = avgRate ? Math.max(0, (wagesH - LABOR_TARGET * salesH) / avgRate) : 0
  const plannedPct = (() => { const e = run(withIdsStatic(posted)); return e.pct })()

  // ── verdict ──
  const fixDays = ev.days.map((d, i) => (editableDays[i] && d.bad.length ? i : -1)).filter(i => i >= 0)
  const over = ev.days.filter((d, i) => editableDays[i] && d.pct > GOAL).length
  const worst = ev.days.reduce((w, d, i) => (editableDays[i] && (!editableDays[w] || d.pct > ev.days[w].pct) ? i : w), editableDays.indexOf(true) < 0 ? 0 : editableDays.indexOf(true))

  const day = days[dayIdx], dr = ev.days[dayIdx], dayState = states[dayIdx]
  const dayShifts = shifts.filter(s => s.date === day.date).sort((a, b) => a.s - b.s || a.e - b.e)
  const selShift = dayShifts.find(s => s.id === sel && editable(s)) ?? null
  const lo = earliest(day)
  const elsewhereH = (k: string) => (ev.elsewhereHours.get(k) ?? []).reduce((t, x) => t + x.hours, 0)
  const weekHoursAll = new Map(data.people.map(p => [p.key, (ev.weekHours.get(p.key) ?? 0) + elsewhereH(p.key)]))
  const shortAt = dr.on.findIndex((o, i) => o < day.need[i] && day.a + i * SLOT >= lo)
  const onNow = (date: string) => {
    const t = data.actual?.pulledAt ?? data.now
    return (data.actual?.worked ?? []).filter(w => w.date === date && w.s <= t && (w.e == null || w.e > t)).length
  }

  return (
    <Page>
      <div className="sk-sched" data-view={view}>
      <PageBar eyebrow={crumbs} title={title}
        meta={data.mode === 'past'
          ? `${data.store.name} · scheduled and worked from Brink`
          : `${data.store.name}${data.mode === 'current' ? ` · sales and clock-ins as of ${data.actual?.pulledAt != null ? clock(data.actual.pulledAt) : 'the last Brink pull'}` : ''} · availability and time off as of ${data.asOf.availability?.slice(5, 16) ?? '—'} · nothing here is sent to Teamworx`}>
        {pickers}
      </PageBar>

      {data.mode === 'ahead' ? (
        <div className="sk-sched-summary">
          <div className="sk-card">
            <div className="sk-sched-label">Sales forecast</div>
            <div className="sk-sched-big">{money(ev.sales)}</div>
            <SalesCompare d={data} forecast={ev.sales} />
          </div>
          <div className="sk-card">
            <div className="sk-sched-label">Labor this week</div>
            <div className={`sk-sched-big ${tone(laborTone(ev.pct))}`}>{ev.pct.toFixed(1)}% <span className="sk-sched-muted sk-sched-small">of sales · target {GOAL}%</span></div>
            <div className="sk-sched-small">{money(ev.wages)} wages · {hrs(ev.hours)} hours on the schedule</div>
          </div>
        </div>
      ) : data.mode === 'current' ? (
        <div className="sk-sched-summary">
          <div className="sk-card">
            <div className="sk-sched-label">Sales this week</div>
            <div className="sk-sched-big">{money(doneSales + (todayIdx >= 0 ? act.get(data.today)?.sales ?? 0 : 0))} <span className="sk-sched-muted sk-sched-small">so far</span></div>
            {doneDays ? <div className="sk-sched-small">Finished days <b>{signed(doneSales, doneFc)}</b> vs forecast</div> : null}
            <div className="sk-sched-small sk-sched-muted">{doneDays ? `Week heading for ${money(salesH)} (forecast ${money(ev.sales)})` : `Forecast for the week ${money(ev.sales)}`}</div>
          </div>
          <div className="sk-card">
            <div className="sk-sched-label">Labor this week</div>
            <div className={`sk-sched-big ${tone(laborTone(pctH))}`}>{pctH.toFixed(1)}% <span className="sk-sched-muted sk-sched-small">heading for · target {GOAL}%</span></div>
            {doneDays && doneSales ? <div className="sk-sched-small">Finished days so far: <b className={tone(laborTone((donePay / doneSales) * 100))}>{((donePay / doneSales) * 100).toFixed(1)}%</b></div> : null}
            <div className="sk-sched-small sk-sched-muted">Finished days at actual pay; today and ahead at the schedule as it stands{payMissing.length ? ` (${payMissing.join(', ')}: pay not in from Brink yet, scheduled cost used)` : ''}</div>
          </div>
        </div>
      ) : (
        <div className="sk-sched-summary">
          <div className="sk-card">
            <div className="sk-sched-label">Sales</div>
            <div className="sk-sched-big">{money(doneSales)}</div>
            <div className="sk-sched-small"><b>{signed(doneSales, doneFc)}</b> vs the {money(doneFc)} forecast</div>
            <SalesCompare d={data} forecast={doneSales} />
          </div>
          <div className="sk-card">
            <div className="sk-sched-label">Labor</div>
            <div className={`sk-sched-big ${tone(laborTone(pctH))}`}>{pctH.toFixed(1)}% <span className="sk-sched-muted sk-sched-small">of sales · target {GOAL}%</span></div>
            <div className="sk-sched-small">{money(wagesH)} actual pay · posted schedule planned {plannedPct.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {data.mode === 'past' ? (
        <TakeCard tone={pctH > GOAL ? 'warn' : 'good'}
          headline={`Finished at ${pctH.toFixed(1)}% labor${pctH > GOAL ? `, ${(pctH - GOAL).toFixed(1)} points over the ${GOAL}% target.` : `, within the ${GOAL}% target.`}`}>
          Sales came in {signed(doneSales, doneFc)} against forecast; the posted schedule planned {plannedPct.toFixed(1)}%.{payMissing.length ? ` ${payMissing.join(', ')}: pay not in from Brink yet.` : ''}
        </TakeCard>
      ) : data.mode === 'current' ? (
        <TakeCard tone={fixDays.length ? 'bad' : pctH > GOAL ? 'warn' : 'good'}
          headline={pctH > GOAL
            ? `The week is heading for ${pctH.toFixed(1)}% labor. To finish at ${GOAL}%, the rest of the week needs about ${hrs(trimHours)} fewer crew hours (~${money(trimHours * avgRate)}).`
            : `The week is heading for ${pctH.toFixed(1)}% labor, within the ${GOAL}% target.`}>
          {doneDays ? `Sales on the finished days came in ${signed(doneSales, doneFc)} against forecast. ` : ''}
          {fixDays.length ? `${fixDays.length} ${fixDays.length === 1 ? 'day still needs' : 'days still need'} fixing.` : 'The rest of the week is covered and nobody closes alone.'}
          <span className="sk-sched-jumps">
            {fixDays.slice(0, 3).map(i => <button key={i} type="button" className={`sk-sched-jump ${tone('bad')}`} onClick={open(i)}>{DAY_LONG[days[i].dow].slice(0, 3)}: {ev.days[i].words.join(', ')} ›</button>)}
            {fixDays.length > 3 ? <span className="sk-sched-muted sk-sched-small sk-sched-more">and {fixDays.length - 3} more below</span> : null}
          </span>
        </TakeCard>
      ) : (
        <TakeCard tone={fixDays.length ? 'bad' : over ? 'warn' : 'good'}
          headline={fixDays.length ? `${fixDays.length} ${fixDays.length === 1 ? 'day needs' : 'days need'} fixing.` : 'Every half-hour is covered and nobody closes alone.'}>
          {over ? `${over === 7 ? 'All 7 days are' : `${over} of 7 days are`} over the ${GOAL}% labor target — ${DAY_LONG[days[worst].dow]} the most at ${ev.days[worst].pct.toFixed(1)}%.` : `Every day is within the ${GOAL}% labor target.`}
          <span className="sk-sched-jumps">
            {fixDays.map(i => <button key={i} type="button" className={`sk-sched-jump ${tone('bad')}`} onClick={open(i)}>{DAY_LONG[days[i].dow].slice(0, 3)}: {ev.days[i].words.join(', ')} ›</button>)}
            {over && !fixDays.includes(worst) ? <button type="button" className={`sk-sched-jump ${tone('warn')}`} onClick={open(worst)}>{DAY_LONG[days[worst].dow].slice(0, 3)}: {ev.days[worst].pct.toFixed(1)}% labor ›</button> : null}
          </span>
        </TakeCard>
      )}

      {data.mode === 'ahead' ? (
        <div className="sk-sched-setup">
          <label>Built from
            <select value={source} onChange={e => load(e.target.value as Source)}>
              <option value="draft">Generated draft</option>
              {posted.length ? <option value="posted">As posted in Teamworx</option> : null}
              <option value="lastWeek">Copy of last week, as posted</option>
              <option value="blank">Blank week</option>
            </select>
          </label>
          <button type="button" className="sk-sched-btn" onClick={undo} disabled={!hist.length}>Undo</button>
        </div>
      ) : data.mode === 'current' ? (
        <div className="sk-sched-setup">
          <span className="sk-sched-small sk-sched-muted sk-sched-grow">Starts from what’s posted in Teamworx. Finished days and shifts already under way can’t change here.</span>
          <button type="button" className="sk-sched-btn" onClick={() => load('posted')} disabled={!hist.length}>Back to as posted</button>
          <button type="button" className="sk-sched-btn" onClick={undo} disabled={!hist.length}>Undo</button>
        </div>
      ) : null}

      <div className="sk-sched-panes" data-view={view}>
        <div className="sk-sched-week">
          {days.map((d, i) => (
            <DayRow key={d.date} d={d} i={i} days={days} r={ev.days[i]} state={states[i]} a={act.get(d.date)}
              postedDay={posted.filter(s => s.date === d.date)} actual={data.actual} people={people}
              current={view !== 'entry' && i === dayIdx} onOpen={open(i)}
              onNow={states[i] === 'today' ? onNow(d.date) : 0} pulledAt={data.actual?.pulledAt ?? null} />
          ))}
          <div className="sk-sched-total">
            <b>{data.mode === 'ahead' ? 'Week' : data.mode === 'current' ? 'Heading for' : 'Week'}</b>
            <span className="sk-sched-muted">{money(data.mode === 'ahead' ? ev.sales : salesH)} · {hrs(ev.hours)} h scheduled</span>
            <b className={tone(laborTone(data.mode === 'ahead' ? ev.pct : pctH))}>{(data.mode === 'ahead' ? ev.pct : pctH).toFixed(1)}%</b>
          </div>
          <Disclosure label="Crew hours this week">
            <CrewHours people={data.people} weekHours={ev.weekHours} elsewhere={ev.elsewhereHours} />
            {ev.crew.map(t => <p key={t} className={`sk-sched-small ${tone('bad')}`}>{t}</p>)}
          </Disclosure>
          {data.mode !== 'past' ? (
            <div className="sk-sched-actions">
              <button type="button" className="sk-sched-btn" onClick={toEntry}>Teamworx entry sheet</button>
              <button type="button" className="sk-sched-btn" onClick={save} disabled={saving === 'saving'}>
                {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved ✓ — save again' : saving === 'failed' ? 'Not saved — try again' : 'Save as a version'}
              </button>
            </div>
          ) : null}
          {data.mode !== 'past' && data.saved.length ? (
            <div className="sk-card sk-sched-versions">
              {data.saved.map(v => {
                const e2 = run(withIdsStatic(v.shifts))
                return (
                  <div key={v.id} className="sk-sched-row">
                    <span><b>{v.name}</b><br /><span className="sk-sched-muted sk-sched-small">{hrs(e2.hours)} h · {e2.pct.toFixed(1)}% labor · {e2.short} half-hours short · {e2.alone} close alone{v.by ? ` · ${v.by}` : ''}</span></span>
                    <button type="button" className="sk-sched-btn" onClick={() => commit(data.mode === 'current' ? keepLocked(withIds(v.shifts)) : withIds(v.shifts))}>Load</button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        {view === 'entry' ? (
          <EntrySheet data={data} days={days} ev={ev} shifts={shifts} people={people} editableDays={editableDays} back={toWeek} />
        ) : dayState === 'done' ? (
          <div className="sk-card sk-sched-day">
            <DayHead day={day} idx={dayIdx} toWeek={toWeek} go={i => open(i)()} />
            <DoneDay day={day} r={ev.days[dayIdx]} a={act.get(day.date)} postedDay={posted.filter(s => s.date === day.date)}
              actual={data.actual} people={people} />
          </div>
        ) : day.holiday?.closed ? (
          <div className="sk-card sk-sched-day">
            <DayHead day={day} idx={dayIdx} toWeek={toWeek} go={i => open(i)()} />
            <p><b>{day.holiday.name}.</b> The store was closed on it last year, so nothing is planned and no shifts were drafted.</p>
            {data.ifOpen[day.date] ? (
              <div className="sk-sched-actions">
                <button type="button" className="sk-sched-btn primary" onClick={() => setOpened([...opened, day.date])}>
                  We’re opening — plan it like a normal {DAY_LONG[day.dow]}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="sk-card sk-sched-day" onPointerUp={endDrag} onPointerLeave={endDrag}>
            <DayHead day={day} idx={dayIdx} toWeek={toWeek} go={i => open(i)()} />
            {dayState === 'today' ? (
              <div className="sk-sched-note">
                <span>Today is under way. The Now page has the live picture — who’s on, who’s late, who can go home. Shifts that haven’t started can still change here.</span>
                <Link className="sk-sched-btn primary sk-sched-link" href={`/now?store=${store}`}>Open Now ›</Link>
              </div>
            ) : null}
            <p><b>What to expect:</b> {opened.includes(day.date) ? `Closed last year — planned here as a normal ${DAY_LONG[day.dow]}. ` : ''}{expectation(days, dayIdx).text}</p>
            <p className="sk-sched-facts">
              <span><span className="sk-sched-muted">Forecast</span> <b>{money(day.sales)}</b></span>
              {dayState === 'today' ? <span><span className="sk-sched-muted">Sold so far</span> <b>{money(act.get(day.date)?.sales ?? 0)}</b></span> : null}
              <span><span className="sk-sched-muted">Hours</span> <b>{hrs(dr.hours)}</b></span>
              <span><span className="sk-sched-muted">Wages</span> <b>{money(dr.wages)}</b></span>
              <span><span className="sk-sched-muted">Labor</span> <b className={tone(laborTone(dr.pct))}>{dr.pct.toFixed(1)}%</b> <span className="sk-sched-muted">{dr.pct > GOAL ? `(${(dr.pct - GOAL).toFixed(1)} pts over target)` : '(within target)'}</span></span>
            </p>

            <NeedChart day={day} on={dr.on} />

            {dr.bad.length || dr.warn.length ? (
              <div className="sk-sched-problems">
                {dr.bad.map(t => <p key={t} className={tone('bad')}>{t}</p>)}
                {dr.warn.map(t => <p key={t} className={tone('warn')}>{t}</p>)}
              </div>
            ) : null}

            <Section label="Shifts" aside={<span className="sk-meta">Tap a shift to change it or who works it · drag to move · drag its ends to resize</span>}>
              <Axis />
              {dayShifts.map(s => {
                const p = s.key ? people.get(s.key) : undefined
                const live = editable(s)
                const its = ev.issues.get(s.id) ?? []
                const bad = its.some(x => x.tone === 'bad')
                const isOpen = live && s.id === sel
                const note = !live ? 'Under way' : its[0]?.text ?? (p && !p.salaried && !p.entered ? 'no availability on file' : '')
                return (
                  <div key={s.id} className="sk-sched-shift">
                    <div className="sk-sched-shiftrow">
                      <button type="button" className="sk-sched-name" aria-expanded={live ? isOpen : undefined} disabled={!live} onClick={() => setSel(isOpen ? null : s.id)}>
                        <b>{p?.short ?? (s.key ? s.key : 'Open shift')}{p?.dob ? ' · 16–17' : ''} {live ? <span className="sk-sched-muted">{isOpen ? '⌄' : '›'}</span> : null}</b>
                        <span className="sk-sched-small sk-sched-mono">{clock(s.s)}–{clock(s.e)}</span>
                        {note ? <span className={`sk-sched-small ${live ? tone(bad ? 'bad' : 'warn') : 'sk-sched-muted'}`}>{note}</span> : null}
                      </button>
                      <div className="sk-sched-track" data-track onPointerMove={dragOver}>
                        <div className={`sk-sched-bar${s.key ? '' : ' open'}${bad ? ' bad' : ''}${live ? '' : ' locked'}`} style={{ left: at(s.s), width: span(s.s, s.e) }}
                          title={`${p?.name ?? 'Open shift'} · ${clock(s.s)}–${clock(s.e)} · ${hrs((s.e - s.s) / 60)} h`}
                          onPointerDown={e => startDrag(e, s, 'move')}>
                          {live ? <span aria-hidden className="grip l" onPointerDown={e => startDrag(e, s, 'l')} /> : null}
                          <span className="t">{clock(s.s)}–{clock(s.e)}</span>
                          {live ? <span aria-hidden className="grip r" onPointerDown={e => startDrag(e, s, 'r')} /> : null}
                        </div>
                      </div>
                    </div>
                    {isOpen ? <Editor s={s} day={day} lo={lo} days={days} canMoveTo={days.map(canAdd)} data={data} shifts={shifts} run={run} edit={edit}
                      remove={() => { commit(shifts.filter(x => x.id !== s.id)); setSel(null) }}
                      moveTo={i => {
                        edit(s.id, x => {
                          const t = days[i], lo2 = earliest(t), len = Math.min(x.e - x.s, t.z - lo2)
                          x.date = t.date; x.s = Math.max(lo2, Math.min(t.z - len, x.s)); x.e = x.s + len; return x
                        })
                        nav({ day: days[i].date, view: null }, 'replace')
                      }} /> : null}
                  </div>
                )
              })}
              {canAdd(day) ? (
                <button type="button" className="sk-sched-add" onClick={() => {
                  const s0 = shortAt >= 0 ? day.a + shortAt * SLOT : Math.max(lo, day.z - 240)
                  const s = Math.max(lo, Math.min(s0, day.z - 240))
                  const id = nextId.current++
                  commit([...shifts, { id, date: day.date, s, e: Math.min(day.z, s + 240), key: null }]); setSel(id)
                }}>+ Add a shift{shortAt >= 0 ? ` at ${clock(day.a + shortAt * SLOT)}, where it is short` : ''}</button>
              ) : null}
            </Section>

            {canAdd(day) ? (
              <Available day={day} lo={lo} dr={dr} data={data} dayShifts={dayShifts} selShift={selShift}
                weekHours={weekHoursAll} elsewhere={ev.elsewhereHours} put={k => selShift && edit(selShift.id, x => ({ ...x, key: k }))}
                add={(k, a, z) => { const id = nextId.current++; commit([...shifts, { id, date: day.date, s: a, e: z, key: k }]); setSel(id) }} />
            ) : null}
          </div>
        )}
      </div>

      <BasisNote>
        Sales forecast = the average of the last 4 same weekdays, the same rule as Weekly Ops and the Now page; on a holiday it is scaled by
        how that holiday traded last year against the weeks around it (as Weekly Ops does), a holiday the store was closed on last year is
        planned closed, and a short-hours holiday keeps last year’s hours.
        People needed each half-hour = 1 person per {UNITS_PER_PERSON_HALF_HOUR} smoothies, bowls or food items, planned for a busy
        version of the day (the 2nd-busiest of the last 4) — if the day runs slower, the Now page says who can go home — plus 1 during
        the truck delivery, and {CLOSE_MIN_PEOPLE} in the last half-hour so nobody closes alone. A rush = {RUSH_UNITS}+ items a half-hour
        for an hour or more. The draft uses shifts of at least {SHIFT_MIN_HOURS} h and fills the people furthest below their usual hours first.
        Wages = hours × each person’s Brink pay rate, before payroll taxes; the salaried manager’s shifts count as people on the floor
        at no extra wage. Checked as you go: not available (NetChef), approved time off (Teamworx), one shift per person per day, minors
        16–17, overtime past {WEEKLY_OT_HOURS} h — hours posted at another store count toward overtime and the minors’ weekly limit.
        Owners are not scheduled here.{' '}
        {data.mode !== 'ahead' ? <>For a week under way or finished: the schedule week runs Tuesday–Monday like Teamworx (Weekly Ops runs
        Monday–Sunday); finished days use actual sales and actual pay from Brink, today and the days ahead the forecast and the schedule’s
        cost. Clock times are Brink’s; late, early or over is flagged past {LATE_MINUTES} minutes, as on the Now page. “Fewer crew
        hours” = how far the week’s cost is above {GOAL}% of its sales, at the crew’s average pay rate.</> : null}
      </BasisNote>
      </div>
    </Page>
  )
}

/** Fresh ids for an evaluation that never touches state. */
let tmpId = -1
const withIdsStatic = (xs: Omit<SchedShift, 'id'>[]): SchedShift[] => xs.map(x => ({ ...x, id: tmpId-- }))

function DayHead({ day, idx, toWeek, go }: { day: SchedDay; idx: number; toWeek: () => void; go: (i: number) => void }) {
  return (
    <div className="sk-sched-dayhead">
      <button type="button" className="sk-sched-btn sk-sched-back" onClick={toWeek}>‹ Week</button>
      <h2>{dayLong(day.date)}</h2>
      <button type="button" className="sk-sched-btn" aria-label="Previous day" disabled={idx === 0} onClick={() => go(idx - 1)}>‹</button>
      <button type="button" className="sk-sched-btn" aria-label="Next day" disabled={idx === 6} onClick={() => go(idx + 1)}>›</button>
    </div>
  )
}

type WorkRow = { key: string; name: string; salaried: boolean; sched: string; worked: string; s: number; schedH: number; workedH: number; notes: { text: string; tone: Tone }[] }

/** Scheduled (as posted) against worked (Brink clock times), one row per person. */
function compareDay(date: string, postedDay: SchedShift[], actual: Actual | null, people: Map<string, SchedPerson>): WorkRow[] {
  const worked = (actual?.worked ?? []).filter(w => w.date === date)
  const keys = [...new Set([...postedDay.filter(s => s.key).map(s => s.key!), ...worked.map(w => w.key)])]
  const rows: WorkRow[] = keys.map(k => {
    const sc = postedDay.filter(s => s.key === k).sort((a, b) => a.s - b.s)
    const wk = worked.filter(w => w.key === k).sort((a, b) => a.s - b.s)
    const p = people.get(k)
    const salaried = p?.salaried ?? wk.some(w => w.basis === 'schedule')
    const s0 = sc.length ? sc[0].s : null, e0 = sc.length ? sc[sc.length - 1].e : null
    const ws = wk.length ? wk[0].s : null
    const we = wk.length && wk.every(w => w.e != null) ? Math.max(...wk.map(w => w.e!)) : null
    const notes: WorkRow['notes'] = []
    if (!salaried) {
      if (s0 != null && ws == null) notes.push({ text: 'did not clock in', tone: 'bad' })
      if (s0 == null && ws != null) notes.push({ text: 'not on the schedule', tone: 'warn' })
      if (s0 != null && ws != null && ws - s0 > LATE_MINUTES) notes.push({ text: `in ${ws - s0} min late`, tone: 'warn' })
      if (e0 != null && we != null && e0 - we > LATE_MINUTES) notes.push({ text: `left ${e0 - we} min early`, tone: 'warn' })
      if (e0 != null && we != null && we - e0 > LATE_MINUTES) notes.push({ text: `stayed ${we - e0} min over`, tone: 'warn' })
    }
    return {
      key: k, name: p?.name ?? wk[0]?.name ?? k, salaried,
      sched: sc.length ? sc.map(s => `${clock(s.s)}–${clock(s.e)}`).join(', ') : '—',
      worked: !wk.length ? '—' : salaried ? 'as scheduled (salaried)' : wk.map(w => `${clock(w.s)}–${w.e == null ? 'still on' : clock(w.e)}`).join(', '),
      s: s0 ?? ws ?? 0,
      schedH: sc.reduce((t, s) => t + (s.e - s.s) / 60, 0),
      workedH: wk.reduce((t, w) => t + (w.e == null ? 0 : (w.e - w.s) / 60), 0),
      notes,
    }
  })
  for (const s of postedDay.filter(x => !x.key)) {
    rows.push({ key: `open-${s.id}`, name: 'Open shift', salaried: false, sched: `${clock(s.s)}–${clock(s.e)}`, worked: '—', s: s.s,
      schedH: (s.e - s.s) / 60, workedH: 0, notes: [{ text: 'never assigned', tone: 'warn' }] })
  }
  return rows.sort((a, b) => a.s - b.s)
}

function DayRow({ d, i, days, r, state, a, postedDay, actual, people, current, onOpen, onNow, pulledAt }: {
  d: SchedDay; i: number; days: SchedDay[]; r: Evaluation['days'][number]; state: DayState
  a: Actual['days'][number] | undefined; postedDay: SchedShift[]; actual: Actual | null; people: Map<string, SchedPerson>
  current: boolean; onOpen: () => void; onNow: number; pulledAt: number | null
}) {
  const ex = expectation(days, i)
  if (state === 'done') {
    const rows = compareDay(d.date, postedDay, actual, people)
    const off = rows.filter(x => x.notes.length).length
    const pct = a && a.pay != null && a.sales ? (a.pay / a.sales) * 100 : null
    const worked = a?.hours ?? rows.reduce((t, x) => t + x.workedH, 0)
    return (
      <button type="button" className="sk-card sk-sched-dayrow" aria-current={current ? 'true' : undefined} onClick={onOpen}>
        <span className="sk-sched-row">
          <span><b>{dayShort(d.date)}</b> <span className="sk-sched-muted sk-sched-small">{d.holiday?.name ?? ''}</span></span>
          <span className="sk-sched-chip">Done</span>
        </span>
        <span className="sk-sched-row sk-sched-small">
          <span className="sk-sched-muted">{money(a?.sales ?? 0)} sold vs {money(d.sales)} forecast{d.sales ? ` (${signed(a?.sales ?? 0, d.sales)})` : ''}</span>
          <b className={pct == null ? 'sk-sched-muted' : tone(laborTone(pct))}>{pct == null ? 'pay not in yet' : `${pct.toFixed(1)}% labor`}</b>
        </span>
        <span className="sk-sched-muted sk-sched-small">Worked {hrs(worked)} h of {hrs(r.hours)} scheduled{off ? ` · ${off} off schedule` : ''}</span>
      </button>
    )
  }
  if (d.holiday?.closed) {
    return (
      <button type="button" className="sk-card sk-sched-dayrow" aria-current={current ? 'true' : undefined} onClick={onOpen}>
        <span className="sk-sched-row">
          <span><b>{dayShort(d.date)}</b> <span className="sk-sched-muted sk-sched-small">{d.holiday.name}</span></span>
          <span className="sk-sched-chip">Closed last year</span>
        </span>
        <span className="sk-sched-muted sk-sched-small">{r.hours ? `${hrs(r.hours)} h scheduled` : 'Not planned — add shifts only if you\'re opening'}</span>
      </button>
    )
  }
  const chip = d.holiday?.closed ? 'Closed last year'
    : state === 'today' ? 'In progress'
    : r.words.length === 1 ? r.words[0] : r.words.length ? `${r.words.length} to fix` : r.warn.length ? `${r.warn.length} to check` : 'Covered'
  const chipTone: Tone = d.holiday?.closed || state === 'today' ? 'neutral' : r.bad.length ? 'bad' : r.warn.length ? 'warn' : 'neutral'
  return (
    <button type="button" className="sk-card sk-sched-dayrow" aria-current={current ? 'true' : undefined} onClick={onOpen}>
      <span className="sk-sched-row">
        <span><b>{dayShort(d.date)}</b> <span className="sk-sched-muted sk-sched-small">{state === 'today' ? 'Today' : ex.tag}</span></span>
        <span className={`sk-sched-chip ${tone(chipTone)}`}>{chip}</span>
      </span>
      <span className="sk-sched-row sk-sched-small">
        <span className="sk-sched-muted">{state === 'today' ? `${money(a?.sales ?? 0)} so far of ${money(d.sales)} forecast` : `${money(d.sales)} forecast · ${hrs(r.hours)} h`}</span>
        <b className={tone(laborTone(r.pct))}>{r.pct.toFixed(1)}% {state === 'today' ? 'planned' : 'labor'}</b>
      </span>
      <span className="sk-sched-muted sk-sched-small">
        {state === 'today' ? (pulledAt != null ? `${onNow} on the clock at ${clock(pulledAt)}` : 'No Brink pull yet today') : ex.short}
      </span>
    </button>
  )
}

function DoneDay({ day, r, a, postedDay, actual, people }: {
  day: SchedDay; r: Evaluation['days'][number]; a: Actual['days'][number] | undefined
  postedDay: SchedShift[]; actual: Actual | null; people: Map<string, SchedPerson>
}) {
  const rows = compareDay(day.date, postedDay, actual, people)
  const sold = a?.sales ?? 0
  const x = day.sales ? ((sold - day.sales) / day.sales) * 100 : 0
  const salesWords = !day.sales ? `Sold ${money(sold)}` : Math.abs(x) < 3 ? 'Sales came in on forecast' : `Sales came in ${Math.abs(x).toFixed(1)}% ${x < 0 ? 'under' : 'over'} forecast`
  const pct = a && a.pay != null && sold ? (a.pay / sold) * 100 : null
  return (
    <>
      <p>{pct == null ? `${salesWords}; the day's pay isn't in from Brink yet.` : `${salesWords}; labor ran ${pct.toFixed(1)}% against ${r.pct.toFixed(1)}% planned.`}</p>
      <p className="sk-sched-facts">
        <span><span className="sk-sched-muted">Sold</span> <b>{money(sold)}</b></span>
        <span><span className="sk-sched-muted">Forecast</span> <b>{money(day.sales)}</b></span>
        <span><span className="sk-sched-muted">Worked</span> <b>{a?.hours != null ? `${hrs(a.hours)} h` : '—'}</b></span>
        <span><span className="sk-sched-muted">Scheduled</span> <b>{hrs(r.hours)} h</b></span>
        <span><span className="sk-sched-muted">Pay</span> <b>{a?.pay != null ? money(a.pay) : '—'}</b></span>
        <span><span className="sk-sched-muted">Labor</span> <b className={pct == null ? '' : tone(laborTone(pct))}>{pct == null ? '—' : `${pct.toFixed(1)}%`}</b></span>
      </p>
      <Section label="Scheduled vs worked">
        <div className="sk-sched-table" role="table">
          <div className="sk-sched-tr sk-sched-th" role="row"><span role="columnheader">Person</span><span role="columnheader">Scheduled</span><span role="columnheader">Clocked</span><span role="columnheader">Note</span></div>
          {rows.map(w => (
            <div key={w.key} className="sk-sched-tr" role="row">
              <b role="cell">{w.name}{w.salaried ? <span className="sk-sched-muted"> · salaried</span> : null}</b>
              <span role="cell" className="sk-sched-mono">{w.sched}</span>
              <span role="cell" className="sk-sched-mono">{w.worked}</span>
              <span role="cell">{w.notes.length ? w.notes.map((n, k) => <span key={k} className={tone(n.tone)}>{k ? ', ' : ''}{n.text}</span>) : <span className="sk-sched-muted">{w.salaried ? '' : 'on time'}</span>}</span>
            </div>
          ))}
          {!rows.length ? <p className="sk-sched-muted sk-sched-small">Nobody was scheduled or clocked in.</p> : null}
        </div>
      </Section>
    </>
  )
}

type Change = { kind: 'Add' | 'Remove' | 'Change' | 'Reassign'; when: string; who: string; detail?: string }

/** What to key into Teamworx so it matches this screen: only the differences from what's posted. */
function diffDay(posted: SchedShift[], cur: SchedShift[], name: (k: string | null) => string): Change[] {
  const P = [...posted], C = [...cur], out: Change[] = []
  for (let i = P.length - 1; i >= 0; i--) {
    const j = C.findIndex(c => c.key === P[i].key && c.s === P[i].s && c.e === P[i].e)
    if (j >= 0) { P.splice(i, 1); C.splice(j, 1) }
  }
  for (let i = P.length - 1; i >= 0; i--) {                       // same person, new times
    if (!P[i].key) continue
    const j = C.findIndex(c => c.key === P[i].key)
    if (j < 0) continue
    out.push({ kind: 'Change', when: `${clock(P[i].s)}–${clock(P[i].e)} → ${clock(C[j].s)}–${clock(C[j].e)}`, who: name(P[i].key) })
    P.splice(i, 1); C.splice(j, 1)
  }
  for (let i = P.length - 1; i >= 0; i--) {                       // same times, someone else
    const j = C.findIndex(c => c.s === P[i].s && c.e === P[i].e)
    if (j < 0) continue
    out.push({ kind: 'Reassign', when: `${clock(P[i].s)}–${clock(P[i].e)}`, who: name(C[j].key), detail: `was ${name(P[i].key)}` })
    P.splice(i, 1); C.splice(j, 1)
  }
  for (const p of P) out.push({ kind: 'Remove', when: `${clock(p.s)}–${clock(p.e)}`, who: name(p.key) })
  for (const c of C) out.push({ kind: 'Add', when: `${clock(c.s)}–${clock(c.e)}`, who: name(c.key) })
  return out
}

function EntrySheet({ data, days, ev, shifts, people, editableDays, back }: {
  data: SchedulePayload; days: SchedDay[]; ev: Evaluation; shifts: SchedShift[]; people: Map<string, SchedPerson>
  editableDays: boolean[]; back: () => void
}) {
  const name = (k: string | null) => (k ? people.get(k)?.name ?? k : 'Open shift')
  const posted = data.starts.posted
  const where = `Teamworx › Manage Schedules › ${data.store.name} › week ending ${dayShort(data.dates[6])}`
  const full = (
    <>
      {days.map((d, i) => (
        <div key={d.date} className="sk-sched-entry">
          <div className="sk-sched-row"><b>{dayLong(d.date)}</b><span className="sk-sched-muted sk-sched-small">{hrs(ev.days[i].hours)} h</span></div>
          {shifts.filter(s => s.date === d.date).sort((a, b) => a.s - b.s).map(s => (
            <div key={s.id} className="sk-sched-entryline">
              <span className="sk-sched-mono">{clock(s.s)}–{clock(s.e)}</span>
              <b>{name(s.key)}</b>
              <span className="sk-sched-muted">{s.key ? people.get(s.key)?.role ?? '' : ''}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
  const changes = days.map((d, i) => ({ d, list: editableDays[i] ? diffDay(posted.filter(s => s.date === d.date), shifts.filter(s => s.date === d.date), name) : [] }))
  const n = changes.reduce((t, c) => t + c.list.length, 0)
  return (
    <div className="sk-card sk-sched-day">
      <div className="sk-sched-dayhead">
        <button type="button" className="sk-sched-btn" onClick={back}>‹ Back</button>
        <h2>Teamworx entry sheet</h2>
      </div>
      {!posted.length ? (
        <>
          <p className="sk-sched-muted sk-sched-small">Key each shift into {where}. This follows the schedule as it stands now.</p>
          {full}
        </>
      ) : (
        <>
          <p className="sk-sched-muted sk-sched-small">
            {n ? `${n} ${n === 1 ? 'change' : 'changes'} to make in ${where} — only what differs from what's posted${data.mode === 'current' ? ', for today and the days ahead' : ''}.`
              : `No changes — this matches what's posted in Teamworx${data.mode === 'current' ? ' for today and the days ahead' : ''}.`}
          </p>
          {changes.filter(c => c.list.length).map(({ d, list }) => (
            <div key={d.date} className="sk-sched-entry">
              <b>{dayLong(d.date)}</b>
              {list.map((c, k) => (
                <div key={k} className="sk-sched-entryline">
                  <span className={`sk-sched-kind ${tone(c.kind === 'Remove' ? 'bad' : 'neutral')}`}>{c.kind}</span>
                  <span><b>{c.who}</b>{c.detail ? <span className="sk-sched-muted"> ({c.detail})</span> : null}</span>
                  <span className="sk-sched-mono">{c.when}</span>
                </div>
              ))}
            </div>
          ))}
          <Disclosure label="The whole week as it stands">{full}</Disclosure>
        </>
      )}
    </div>
  )
}

function SalesCompare({ d, forecast }: { d: SchedulePayload; forecast: number }) {
  // The forecast IS the 4-week same-weekday average, so "vs last 4 weeks" sits near flat by
  // construction; the last-year line is the one that carries the seasonal signal.
  const w = d.compare.last4
  const avg = w.length ? w.reduce((t, x) => t + x.net, 0) / w.length : null
  return (
    <>
      <div className="sk-sched-small">Last 4 weeks {avg == null ? '—' : <>{money(avg)} · <b>{pctText(forecast, avg)}</b></>}</div>
      <div className="sk-sched-small">Last year {d.compare.lastYear == null ? <span className="sk-sched-muted">not in the data</span> : <>{money(d.compare.lastYear)} · <b>{pctText(forecast, d.compare.lastYear)}</b></>}</div>
    </>
  )
}

function Axis() {
  return (
    <div className="sk-sched-shiftrow sk-sched-axisrow" aria-hidden>
      <span />
      <div className="sk-sched-axis">{TICKS.map(h => <span key={h} style={{ left: at(h * 60) }}>{clock(h * 60)}</span>)}</div>
    </div>
  )
}

/** People needed (grey) vs people scheduled (line), red where short — the one chart. */
function NeedChart({ day, on }: { day: SchedDay; on: number[] }) {
  const maxP = Math.max(3, ...day.need, ...on)
  const y = (p: number) => `${((p / (maxP + 0.4)) * 100).toFixed(2)}%`
  return (
    <div className="sk-sched-chart">
      <span className="sk-sched-label">People needed vs scheduled</span>
      <div className="sk-sched-plot">
        <div className="sk-sched-yaxis">{[1, 2, 3, 4].filter(p => p <= maxP).map(p => <span key={p} style={{ bottom: y(p) }}>{p}</span>)}</div>
        <div className="sk-sched-area">
          {[1, 2, 3, 4].filter(p => p <= maxP).map(p => <i key={p} className="grid" style={{ bottom: y(p) }} />)}
          {day.need.map((n, i) => {
            const c = day.a + i * SLOT
            return <i key={'n' + i} className="need" style={{ left: at(c), width: span(c, c + SLOT), height: y(n) }}
              title={`${clock(c)} · ${n} needed, ${on[i]} scheduled · about ${Math.round(day.units[i])} items`} />
          })}
          {on.map((o, i) => (o < day.need[i] ? (
            <i key={'s' + i} className="short" style={{ left: at(day.a + i * SLOT), width: span(0, SLOT), bottom: y(o), height: `calc(${y(day.need[i])} - ${y(o)})` }} />
          ) : null))}
          {on.map((o, i) => <i key={'l' + i} className="line" style={{ left: at(day.a + i * SLOT), width: span(0, SLOT), bottom: y(o) }} />)}
          {on.map((o, i) => (i && o !== on[i - 1] ? (
            <i key={'j' + i} className="join" style={{ left: at(day.a + i * SLOT), bottom: y(Math.min(o, on[i - 1])), height: `calc(${y(Math.max(o, on[i - 1]))} - ${y(Math.min(o, on[i - 1]))})` }} />
          ) : null))}
        </div>
      </div>
      <div className="sk-sched-axis sk-sched-axis-chart">{TICKS.map(h => <span key={h} style={{ left: at(h * 60) }}>{clock(h * 60)}</span>)}</div>
      <div className="sk-sched-legend"><span><i className="need" />needed</span><span><i className="line" />scheduled</span><span><i className="short" />short</span></div>
    </div>
  )
}

const otherText = (list: { store: string; hours: number }[] | undefined): ReactNode =>
  list?.length ? <span className="sk-sched-muted"> + {list.map(x => `${hrs(x.hours)} at ${x.store}`).join(', ')}</span> : null

function CrewHours({ people, weekHours, elsewhere }: { people: SchedPerson[]; weekHours: Map<string, number>; elsewhere: Evaluation['elsewhereHours'] }) {
  return (
    <div className="sk-sched-crew">
      {people.map(p => ({ p, h: weekHours.get(p.key) ?? 0, o: elsewhere.get(p.key) })).sort((a, b) => b.h - a.h).map(({ p, h, o }) => (
        <div key={p.key} className="sk-sched-row sk-sched-small">
          <span><b>{p.name}</b> <span className="sk-sched-muted">{[p.salaried ? 'salaried' : '', p.dob ? '16–17' : '', p.entered ? '' : 'no availability on file'].filter(Boolean).join(' · ')}</span></span>
          <span className={tone(p.usual != null && Math.abs(h - p.usual) >= 4 ? 'warn' : 'neutral')}>{hrs(h)} h{otherText(o)} <span className="sk-sched-muted">/ usual {p.usual == null ? '—' : hrs(p.usual)}</span></span>
        </div>
      ))}
    </div>
  )
}

function Editor({ s, day, lo, days, canMoveTo, data, shifts, run, edit, remove, moveTo }: {
  s: SchedShift; day: SchedDay; lo: number; days: SchedDay[]; canMoveTo: boolean[]; data: SchedulePayload; shifts: SchedShift[]
  run: (xs: SchedShift[]) => Evaluation
  edit: (id: number, fn: (x: SchedShift) => SchedShift) => void; remove: () => void; moveTo: (i: number) => void
}) {
  const ev = run(shifts)
  const other = (k: string) => (ev.elsewhereHours.get(k) ?? []).reduce((t, x) => t + x.hours, 0)
  const choices = data.people.map(q => {
    const trial = shifts.map(x => (x.id === s.id ? { ...x, key: q.key } : x))
    const t = run(trial)
    const its = [...(t.issues.get(s.id) ?? [])]
    const w = (t.weekHours.get(q.key) ?? 0) + other(q.key)
    if (!q.salaried && w > WEEKLY_OT_HOURS) its.push({ tone: 'warn', text: `goes into overtime (${hrs(w)} h${other(q.key) ? ', both stores' : ''})` })
    const b = its.find(x => x.tone === 'bad'), wn = its.find(x => x.tone === 'warn')
    const pref = (q.avail[s.date] ?? []).some(x => x.st === 'P' && x.a < s.e && x.z > s.s)
    const have = (ev.weekHours.get(q.key) ?? 0) + other(q.key)
    return { q, why: b?.text ?? wn?.text ?? (pref ? 'Prefers this time' : q.salaried ? 'Manager — sets own hours' : q.entered ? 'Available' : 'Availability not on file'),
      tone: (b ? 'bad' : wn ? 'warn' : 'neutral') as Tone, mine: s.key === q.key, have, o: ev.elsewhereHours.get(q.key),
      rank: (s.key === q.key ? -9 : 0) + (b ? 3 : wn ? 1 : 0) + (pref ? -0.5 : 0) + (q.entered ? 0 : 0.3) - Math.max(0, (q.usual ?? 0) - have) / 100 }
  }).sort((a, b) => a.rank - b.rank)
  return (
    <div className="sk-sched-editor">
      <div className="sk-sched-steps">
        <span className="sk-sched-step">
          <span>Start</span>
          <button type="button" aria-label="Start 30 minutes earlier" onClick={() => edit(s.id, x => ({ ...x, s: Math.max(lo, x.s - 30) }))}>−</button>
          <b>{clock(s.s)}</b>
          <button type="button" aria-label="Start 30 minutes later" onClick={() => edit(s.id, x => ({ ...x, s: Math.min(x.e - 60, x.s + 30) }))}>+</button>
        </span>
        <span className="sk-sched-step">
          <span>End</span>
          <button type="button" aria-label="End 30 minutes earlier" onClick={() => edit(s.id, x => ({ ...x, e: Math.max(x.s + 60, x.e - 30) }))}>−</button>
          <b>{clock(s.e)}</b>
          <button type="button" aria-label="End 30 minutes later" onClick={() => edit(s.id, x => ({ ...x, e: Math.min(day.z, x.e + 30) }))}>+</button>
        </span>
        <label>Day
          <select value={days.findIndex(d => d.date === s.date)} onChange={e => moveTo(Number(e.target.value))}>
            {days.map((d, i) => (canMoveTo[i] || d.date === s.date ? <option key={d.date} value={i}>{dayShort(d.date)}</option> : null))}
          </select>
        </label>
      </div>
      <span className="sk-sched-label">Who works it — best fits first</span>
      {choices.map(c => (
        <button key={c.q.key} type="button" className="sk-sched-choice" aria-pressed={c.mine} onClick={() => edit(s.id, x => ({ ...x, key: c.q.key }))}>
          <span><b>{c.q.name}{c.q.dob ? ' · 16–17' : ''}</b><br /><span className={`sk-sched-small ${tone(c.tone)}`}>{c.why}</span></span>
          <span className="sk-sched-small sk-sched-muted">{hrs(c.have)} h{c.o?.length ? ' (both stores)' : ''} · usual {c.q.usual == null ? '—' : hrs(c.q.usual)}</span>
        </button>
      ))}
      <div className="sk-sched-actions">
        <button type="button" className="sk-sched-btn" onClick={() => edit(s.id, x => ({ ...x, key: null }))}>Make it an open shift</button>
        <button type="button" className={`sk-sched-btn ${tone('bad')}`} onClick={remove}>Delete shift</button>
      </div>
    </div>
  )
}

/** Who can work this day, in words, with one button each. */
function Available({ day, lo, dr, data, dayShifts, selShift, weekHours, elsewhere, put, add }: {
  day: SchedDay; lo: number; dr: Evaluation['days'][number]; data: SchedulePayload
  dayShifts: SchedShift[]; selShift: SchedShift | null; weekHours: Map<string, number>; elsewhere: Evaluation['elsewhereHours']
  put: (key: string) => void; add: (key: string, a: number, z: number) => void
}) {
  const rows = data.people.map(p => {
    const off = (p.off[day.date] ?? []).filter(b => b.status === 'approved')
    const away = data.elsewhere.filter(x => x.key === p.key && x.date === day.date).map(x => ({ a: x.s, z: x.e }))
    const cuts = [...(p.avail[day.date] ?? []).filter(b => b.st === 'N'), ...off, ...away].sort((a, b) => a.a - b.a)
    let free: { a: number; z: number }[] = [], t = lo
    for (const b of cuts) { if (b.a > t) free.push({ a: t, z: Math.min(b.a, day.z) }); t = Math.max(t, b.z) }
    if (t < day.z) free.push({ a: t, z: day.z })
    free = free.filter(w => w.z - w.a >= 120)
    const working = dayShifts.filter(s => s.key === p.key)
    const have = weekHours.get(p.key) ?? 0
    const status = !free.length ? 'out' : p.entered || p.salaried ? 'free' : 'unknown'
    let when = off.length && !free.length ? 'Time off (approved)' : !free.length ? (away.length ? 'Working at another store' : 'Not available')
      : p.salaried ? 'Manager — sets own hours'
      : !p.entered ? 'Availability not on file — ask before scheduling'
      : free.length === 1 && free[0].a <= lo && free[0].z >= day.z ? (lo > day.a ? 'Available the rest of the day' : 'Available all day')
      : 'Available ' + free.map(w => (w.a <= lo ? `until ${clock(w.z)}` : w.z >= day.z ? `after ${clock(w.a)}` : `${clock(w.a)}–${clock(w.z)}`)).join(', ')
    const prefs = (p.avail[day.date] ?? []).filter(b => b.st === 'P')
    if (prefs.length && status === 'free') when += ' · prefers ' + prefs.map(b => `${clock(b.a)}–${clock(b.z)}`).join(', ')
    const there = data.elsewhere.filter(x => x.key === p.key && x.date === day.date)
    if (there.length && free.length) when += ' · ' + there.map(x => `at ${x.store} ${clock(x.s)}–${clock(x.e)}`).join(', ')
    if (working.length) when = `Working ${working.map(s => `${clock(s.s)}–${clock(s.e)}`).join(', ')} · ${when.charAt(0).toLowerCase()}${when.slice(1)}`
    const room = (p.dob ? 30 : WEEKLY_OT_HOURS) - have
    let canAct = status !== 'out' && room >= 1 && !working.length
    let act: () => void = () => {}
    if (selShift) {
      const fits = free.some(w => w.a <= selShift.s && w.z >= selShift.e) || status === 'unknown'
      canAct = canAct && selShift.key !== p.key && fits && room >= (selShift.e - selShift.s) / 60
      act = () => put(p.key)
    } else {
      act = () => {
        const w = free[0] ?? { a: lo, z: day.z }
        const len = Math.min(240, w.z - w.a, Math.floor(room * 2) * 30)
        const shortI = dr.on.findIndex((o, i) => o < day.need[i] && day.a + i * SLOT >= w.a && day.a + (i + 1) * SLOT <= w.z)
        let s = shortI >= 0 ? day.a + shortI * SLOT : w.a
        if (shortI < 0) {            // nothing short: put them where demand is heaviest in their free hours
          let best = -Infinity
          for (let a = w.a; a + len <= w.z; a += SLOT) {
            let load = 0
            for (let i = 0; i < day.need.length; i++) { const c = day.a + i * SLOT; if (c >= a && c + SLOT <= a + len) load += day.units[i] - dr.on[i] * UNITS_PER_PERSON_HALF_HOUR }
            if (load > best) { best = load; s = a }
          }
        }
        s = Math.max(w.a, Math.min(s, w.z - len))
        add(p.key, s, s + len)
      }
    }
    const order = (status === 'out' ? 3 : working.length ? 2 : status === 'unknown' ? 1 : 0) * 1000 - Math.max(0, (p.usual ?? 0) - have)
    return { p, when, have, status, canAct, act, order, o: elsewhere.get(p.key) }
  }).sort((a, b) => a.order - b.order)
  return (
    <Section label={`Who's available ${dayShort(day.date).slice(0, 3)}`} aside={<span className="sk-meta">{selShift ? `Choosing someone for ${clock(selShift.s)}–${clock(selShift.e)}` : 'Free first, fewest hours against usual first'}</span>}>
      {rows.map(r => (
        <div key={r.p.key} className={`sk-sched-person${r.status === 'out' ? ' out' : ''}`}>
          <span>
            <b>{r.p.name}</b> <span className="sk-sched-muted sk-sched-small">{[r.p.role === 'Team Captain' ? 'Captain' : '', r.p.salaried ? 'salaried' : '', r.p.dob ? '16–17' : ''].filter(Boolean).join(' · ')}</span><br />
            <span className={`sk-sched-small ${tone(r.status === 'unknown' ? 'warn' : 'neutral')}`}>{r.when}</span><br />
            <span className="sk-sched-small sk-sched-muted">{hrs(r.have)} h this week{r.o?.length ? ` (incl. ${r.o.map(x => `${hrs(x.hours)} at ${x.store}`).join(', ')})` : ''} · usual {r.p.usual == null ? '—' : hrs(r.p.usual)}{r.p.dob ? ' · max 30' : ''}</span>
          </span>
          {r.canAct ? <button type="button" className={`sk-sched-btn${selShift ? ' primary' : ''}`} onClick={r.act}>{selShift ? 'Put on this shift' : 'Add a shift'}</button> : null}
        </div>
      ))}
    </Section>
  )
}
