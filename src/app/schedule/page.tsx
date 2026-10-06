'use client'

/**
 * SCHEDULE — build next week's schedule, phone first (laptop, iPad and phone; Sam 2026-10-06).
 *
 * The approved mock-up's flow: a read-only week overview → open one day → edit it. Every
 * figure comes from core/schedule.ts, run here live on the shifts as they are edited — the
 * same functions the route used to draft them — so nothing on screen can disagree with the
 * rules. Thresholds ride in from core/targets.ts; this file only formats and handles input.
 * Nothing here is sent to Teamworx: the entry sheet is what gets keyed in.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBar, TakeCard, Section, BasisNote, Disclosure, toneClass, type Tone } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { useStoreLock } from '@/components/useStoreLock'
import { isoAdd } from '@/lib/core/dates'
import { LABOR_TARGET, CLOSE_MIN_PEOPLE, SHIFT_MIN_HOURS, UNITS_PER_PERSON_HALF_HOUR, RUSH_UNITS, WEEKLY_OT_HOURS } from '@/lib/core/targets'
import { evaluate, expectation, schedClock as clock, SLOT, type SchedShift, type SchedPerson, type SchedDay } from '@/lib/core/schedule'
import type { SchedulePayload } from '@/app/api/schedule/route'

type StoreKey = 'margate' | 'miramar' | 'pines'
type Source = 'draft' | 'posted' | 'lastWeek' | 'blank'
type Snap = { shifts: SchedShift[]; source: Source }

const STORE_OPTS: { value: StoreKey; label: string }[] = [
  { value: 'margate', label: 'Margate' }, { value: 'miramar', label: 'Miramar' }, { value: 'pines', label: 'Pines' },
]
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
const laborTone = (pct: number): Tone => (pct > GOAL ? 'warn' : 'neutral')
/** Status colour for a figure or note. 'neutral' gets no class: the shared neutral tone is
 *  brass, and brass is never put on a number (design kit). */
const tone = (t: Tone) => (t === 'neutral' ? '' : toneClass(t))
const pctText = (a: number, b: number) => {
  const x = ((a - b) / b) * 100
  return Math.abs(x) < 0.05 ? 'flat' : `${x > 0 ? 'up' : 'down'} ${Math.abs(x).toFixed(1)}%`
}

export default function SchedulePage() {
  return <Suspense fallback={null}><Schedule /></Suspense>
}

function Schedule() {
  const params = useSearchParams()
  const lock = useStoreLock()
  const [picked, setPicked] = useState<StoreKey>((params.get('store') as StoreKey) || 'margate')
  const store: StoreKey = lock ?? picked
  const [week, setWeek] = useState<string | null>(params.get('week'))
  const [data, setData] = useState<SchedulePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [shifts, setShifts] = useState<SchedShift[]>([])
  const [source, setSource] = useState<Source>('draft')
  const [hist, setHist] = useState<Snap[]>([])
  const [dayIdx, setDayIdx] = useState(0)
  const [view, setView] = useState<'week' | 'day' | 'entry'>('week')
  const [sel, setSel] = useState<number | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const nextId = useRef(1)

  const withIds = useCallback((xs: Omit<SchedShift, 'id'>[]) => xs.map(x => ({ ...x, id: nextId.current++ })), [])

  useEffect(() => {
    let live = true
    setData(null); setError(null)
    fetch(`/api/schedule?store=${store}${week ? `&week=${week}` : ''}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.reason ?? `error ${r.status}`); return r.json() })
      .then((d: SchedulePayload) => {
        if (!live) return
        setData(d); setShifts(withIds(d.starts.draft)); setSource('draft'); setHist([]); setSel(null); setDayIdx(0)
        if (!week) setWeek(d.tuesday)
      })
      .catch(e => live && setError(String(e.message ?? e)))
    return () => { live = false }
  }, [store, week, withIds])

  const ev = useMemo(() => (data ? evaluate(data.store.name, data.days, shifts, data.people) : null), [data, shifts])

  // ── edits: every change is undoable ──
  const commit = useCallback((next: SchedShift[]) => { setHist(h => [...h, { shifts, source }].slice(-50)); setShifts(next) }, [shifts, source])
  const edit = (id: number, fn: (s: SchedShift) => SchedShift) => commit(shifts.map(s => (s.id === id ? fn({ ...s }) : s)))
  const load = (src: Source) => {
    if (!data) return
    setHist(h => [...h, { shifts, source }].slice(-50))
    setShifts(withIds(data.starts[src])); setSource(src); setSel(null)
  }
  const undo = () => {
    const last = hist[hist.length - 1]
    if (!last) return
    setShifts(last.shifts); setSource(last.source); setHist(hist.slice(0, -1)); setSel(null)
  }

  // ── drag: move a bar, or pull either end ──
  const drag = useRef<{ id: number; mode: 'move' | 'l' | 'r'; grab: number; moved: boolean; snap: Snap } | null>(null)
  const minuteAt = (e: React.PointerEvent, el: Element) => {
    const track = el.closest('[data-track]') ?? el
    const r = track.getBoundingClientRect()
    return AX0 + ((e.clientX - r.left) / r.width) * (AX1 - AX0)
  }
  const startDrag = (e: React.PointerEvent, s: SchedShift, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0) return
    if (mode !== 'move') e.stopPropagation()
    drag.current = { id: s.id, mode, grab: minuteAt(e, e.currentTarget) - s.s, moved: false, snap: { shifts, source } }
  }
  const dragOver = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !data) return
    const m = minuteAt(e, e.currentTarget)
    setShifts(cur => cur.map(s => {
      if (s.id !== d.id) return s
      const day = data.days.find(x => x.date === s.date)!
      const snap = (x: number) => Math.round(x / SLOT) * SLOT
      const n = { ...s }
      if (d.mode === 'move') { const len = s.e - s.s; n.s = Math.max(day.a, Math.min(day.z - len, snap(m - d.grab))); n.e = n.s + len }
      else if (d.mode === 'l') n.s = Math.max(day.a, Math.min(s.e - 60, snap(m)))
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
    const r = await fetch('/api/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: data.store.key, week: data.tuesday, name: `Version ${data.saved.length + 1}`, source,
        shifts: shifts.map(({ date, s, e, key }) => ({ date, s, e, key })) }),
    }).catch(() => null)
    if (!r?.ok) { setSaving('failed'); return }
    const { id } = await r.json()
    setData({ ...data, saved: [...data.saved, { id, name: `Version ${data.saved.length + 1}`, source, by: null, at: 'just now',
      shifts: shifts.map(({ date, s, e, key }) => ({ date, s, e, key })) }] })
    setSaving('saved')
  }

  const pickers = (
    <>
      {lock ? null : <SegControl label="Store" options={STORE_OPTS} value={store} onChange={v => { setPicked(v); setWeek(null) }} />}
      {data ? (
        <div className="sk-sched-week-step" role="group" aria-label="Week">
          <button type="button" aria-label="Previous week" disabled={data.tuesday <= isoAdd(data.today, -((new Date(data.today + 'T12:00:00Z').getUTCDay() + 5) % 7))}
            onClick={() => setWeek(isoAdd(data.tuesday, -7))}>‹</button>
          <span>{dayShort(data.dates[0])} – {dayShort(data.dates[6]).slice(4)}</span>
          <button type="button" aria-label="Next week" onClick={() => setWeek(isoAdd(data.tuesday, 7))}>›</button>
        </div>
      ) : null}
    </>
  )

  if (error) return <Page><PageBar eyebrow="Schedule" title="Build the schedule">{pickers}</PageBar><TakeCard tone="bad" label="Not loaded" headline="The schedule could not be loaded.">{error}</TakeCard></Page>
  if (!data || !ev) return <Page><PageBar eyebrow="Schedule" title="Build the schedule">{pickers}</PageBar><p className="sk-sched-muted">Loading…</p></Page>

  const people = new Map(data.people.map(p => [p.key, p]))
  const S_ = data.days

  // ── verdict ──
  const fixDays = ev.days.map((d, i) => (d.bad.length ? i : -1)).filter(i => i >= 0)
  const over = ev.days.filter(d => d.pct > GOAL).length
  const worst = ev.days.reduce((w, d, i) => (d.pct > ev.days[w].pct ? i : w), 0)
  const open = (i: number) => () => { setDayIdx(i); setView('day'); setSel(null) }

  const day = S_[dayIdx], dr = ev.days[dayIdx]
  const dayShifts = shifts.filter(s => s.date === day.date).sort((a, b) => a.s - b.s || a.e - b.e)
  const selShift = dayShifts.find(s => s.id === sel) ?? null

  return (
    <Page>
      <div className="sk-sched">
      <PageBar eyebrow="Schedule" title="Build the schedule"
        meta={`${data.store.name} · availability and time off as of ${data.asOf.availability?.slice(5, 16) ?? '—'} · nothing here is sent to Teamworx`}>
        {pickers}
      </PageBar>

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

      <TakeCard tone={fixDays.length ? 'bad' : over ? 'warn' : 'good'}
        headline={fixDays.length ? `${fixDays.length} ${fixDays.length === 1 ? 'day needs' : 'days need'} fixing.` : 'Every half-hour is covered and nobody closes alone.'}>
        {over ? `${over === 7 ? 'All 7 days are' : `${over} of 7 days are`} over the ${GOAL}% labor target — ${DAY_LONG[S_[worst].dow]} the most at ${ev.days[worst].pct.toFixed(1)}%.` : `Every day is within the ${GOAL}% labor target.`}
        <span className="sk-sched-jumps">
          {fixDays.map(i => <button key={i} type="button" className={`sk-sched-jump ${tone('bad')}`} onClick={open(i)}>{DAY_LONG[S_[i].dow].slice(0, 3)}: {ev.days[i].words.join(', ')} ›</button>)}
          {over && !fixDays.includes(worst) ? <button type="button" className={`sk-sched-jump ${tone('warn')}`} onClick={open(worst)}>{DAY_LONG[S_[worst].dow].slice(0, 3)}: {ev.days[worst].pct.toFixed(1)}% labor ›</button> : null}
        </span>
      </TakeCard>

      <div className="sk-sched-setup">
        <label>Built from
          <select value={source} onChange={e => load(e.target.value as Source)}>
            <option value="draft">Generated draft</option>
            {data.starts.posted.length ? <option value="posted">As posted in Teamworx</option> : null}
            <option value="lastWeek">Copy of last week, as posted</option>
            <option value="blank">Blank week</option>
          </select>
        </label>
        <button type="button" className="sk-sched-btn" onClick={undo} disabled={!hist.length}>Undo</button>
      </div>

      <div className="sk-sched-panes" data-view={view}>
        <div className="sk-sched-week">
          {S_.map((d, i) => {
            const r = ev.days[i], ex = expectation(S_, i)
            const chip = r.words.length === 1 ? r.words[0] : r.words.length ? `${r.words.length} to fix` : r.warn.length ? `${r.warn.length} to check` : 'Covered'
            return (
              <button key={d.date} type="button" className="sk-card sk-sched-dayrow" aria-current={view !== 'entry' && i === dayIdx ? 'true' : undefined} onClick={open(i)}>
                <span className="sk-sched-row">
                  <span><b>{dayShort(d.date)}</b> <span className="sk-sched-muted sk-sched-small">{ex.tag}</span></span>
                  <span className={`sk-sched-chip ${tone(r.bad.length ? 'bad' : r.warn.length ? 'warn' : 'neutral')}`}>{chip}</span>
                </span>
                <span className="sk-sched-row sk-sched-small">
                  <span className="sk-sched-muted">{money(d.sales)} forecast · {hrs(r.hours)} h</span>
                  <b className={tone(laborTone(r.pct))}>{r.pct.toFixed(1)}% labor</b>
                </span>
                <span className="sk-sched-muted sk-sched-small">{ex.short}</span>
              </button>
            )
          })}
          <div className="sk-sched-total">
            <b>Week</b><span className="sk-sched-muted">{money(ev.sales)} · {hrs(ev.hours)} h</span>
            <b className={tone(laborTone(ev.pct))}>{ev.pct.toFixed(1)}%</b>
          </div>
          <Disclosure label="Crew hours this week">
            <CrewHours people={data.people} weekHours={ev.weekHours} />
            {ev.crew.map(t => <p key={t} className={`sk-sched-small ${tone('bad')}`}>{t}</p>)}
          </Disclosure>
          <div className="sk-sched-actions">
            <button type="button" className="sk-sched-btn" onClick={() => { setView('entry'); setSel(null) }}>Teamworx entry sheet</button>
            <button type="button" className="sk-sched-btn" onClick={save} disabled={saving === 'saving'}>
              {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved ✓ — save again' : saving === 'failed' ? 'Not saved — try again' : 'Save as a version'}
            </button>
          </div>
          {data.saved.length ? (
            <div className="sk-card sk-sched-versions">
              {data.saved.map(v => {
                const e2 = evaluate(data.store.name, data.days, withIds(v.shifts), data.people)
                return (
                  <div key={v.id} className="sk-sched-row">
                    <span><b>{v.name}</b><br /><span className="sk-sched-muted sk-sched-small">{hrs(e2.hours)} h · {e2.pct.toFixed(1)}% labor · {e2.short} half-hours short · {e2.alone} close alone{v.by ? ` · ${v.by}` : ''}</span></span>
                    <button type="button" className="sk-sched-btn" onClick={() => commit(withIds(v.shifts))}>Load</button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        {view === 'entry' ? (
          <div className="sk-card sk-sched-day">
            <div className="sk-sched-dayhead">
              <button type="button" className="sk-sched-btn" onClick={() => setView('week')}>‹ Back</button>
              <h2>Teamworx entry sheet</h2>
            </div>
            <p className="sk-sched-muted sk-sched-small">Key each shift into Teamworx › Manage Schedules › {data.store.name} › week ending {dayShort(data.dates[6])}. This follows the schedule as it stands now.</p>
            {S_.map(d => (
              <div key={d.date} className="sk-sched-entry">
                <div className="sk-sched-row"><b>{dayLong(d.date)}</b><span className="sk-sched-muted sk-sched-small">{hrs(ev.days[S_.indexOf(d)].hours)} h</span></div>
                {shifts.filter(s => s.date === d.date).sort((a, b) => a.s - b.s).map(s => (
                  <div key={s.id} className="sk-sched-entryline">
                    <span className="sk-sched-mono">{clock(s.s)}–{clock(s.e)}</span>
                    <b>{s.key ? people.get(s.key)?.name ?? s.key : 'Open shift'}</b>
                    <span className="sk-sched-muted">{s.key ? people.get(s.key)?.role ?? '' : ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="sk-card sk-sched-day" onPointerUp={endDrag} onPointerLeave={endDrag}>
            <div className="sk-sched-dayhead">
              <button type="button" className="sk-sched-btn sk-sched-back" onClick={() => { setView('week'); setSel(null) }}>‹ Week</button>
              <h2>{dayLong(day.date)}</h2>
              <button type="button" className="sk-sched-btn" aria-label="Previous day" disabled={dayIdx === 0} onClick={() => { setDayIdx(dayIdx - 1); setSel(null) }}>‹</button>
              <button type="button" className="sk-sched-btn" aria-label="Next day" disabled={dayIdx === 6} onClick={() => { setDayIdx(dayIdx + 1); setSel(null) }}>›</button>
            </div>
            <p><b>What to expect:</b> {expectation(S_, dayIdx).text}</p>
            <p className="sk-sched-facts">
              <span><span className="sk-sched-muted">Forecast</span> <b>{money(day.sales)}</b></span>
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
                const its = ev.issues.get(s.id) ?? []
                const bad = its.some(x => x.tone === 'bad')
                const isOpen = s.id === sel
                const note = its[0]?.text ?? (p && !p.salaried && !p.entered ? 'no availability on file' : '')
                return (
                  <div key={s.id} className="sk-sched-shift">
                    <div className="sk-sched-shiftrow">
                      <button type="button" className="sk-sched-name" aria-expanded={isOpen} onClick={() => setSel(isOpen ? null : s.id)}>
                        <b>{p?.short ?? (s.key ? s.key : 'Open shift')}{p?.dob ? ' · 16–17' : ''} <span className="sk-sched-muted">{isOpen ? '⌄' : '›'}</span></b>
                        <span className="sk-sched-small sk-sched-mono">{clock(s.s)}–{clock(s.e)}</span>
                        {note ? <span className={`sk-sched-small ${tone(bad ? 'bad' : 'warn')}`}>{note}</span> : null}
                      </button>
                      <div className="sk-sched-track" data-track onPointerMove={dragOver}>
                        <div className={`sk-sched-bar${s.key ? '' : ' open'}${bad ? ' bad' : ''}`} style={{ left: at(s.s), width: span(s.s, s.e) }}
                          title={`${p?.name ?? 'Open shift'} · ${clock(s.s)}–${clock(s.e)} · ${hrs((s.e - s.s) / 60)} h`}
                          onPointerDown={e => startDrag(e, s, 'move')}>
                          <span aria-hidden className="grip l" onPointerDown={e => startDrag(e, s, 'l')} />
                          <span className="t">{clock(s.s)}–{clock(s.e)}</span>
                          <span aria-hidden className="grip r" onPointerDown={e => startDrag(e, s, 'r')} />
                        </div>
                      </div>
                    </div>
                    {isOpen ? <Editor s={s} day={day} days={S_} data={data} shifts={shifts} edit={edit}
                      remove={() => { commit(shifts.filter(x => x.id !== s.id)); setSel(null) }}
                      moveTo={i => { edit(s.id, x => { const t = S_[i], len = Math.min(x.e - x.s, t.z - t.a); x.date = t.date; x.s = Math.max(t.a, Math.min(t.z - len, x.s)); x.e = x.s + len; return x }); setDayIdx(i) }} /> : null}
                  </div>
                )
              })}
              <button type="button" className="sk-sched-add" onClick={() => {
                const short = dr.on.findIndex((o, i) => o < day.need[i])
                const s0 = short >= 0 ? day.a + short * SLOT : Math.max(day.a, day.z - 240)
                const s = Math.max(day.a, Math.min(s0, day.z - 240))
                const id = nextId.current++
                commit([...shifts, { id, date: day.date, s, e: Math.min(day.z, s + 240), key: null }]); setSel(id)
              }}>+ Add a shift{dr.on.some((o, i) => o < day.need[i]) ? ` at ${clock(day.a + dr.on.findIndex((o, i) => o < day.need[i]) * SLOT)}, where it is short` : ''}</button>
            </Section>

            <Available day={day} dr={dr} data={data} shifts={shifts} dayShifts={dayShifts} selShift={selShift}
              weekHours={ev.weekHours} put={k => selShift && edit(selShift.id, x => ({ ...x, key: k }))}
              add={(k, a, z) => { const id = nextId.current++; commit([...shifts, { id, date: day.date, s: a, e: z, key: k }]); setSel(id) }} />
          </div>
        )}
      </div>

      <BasisNote>
        Sales forecast = the average of the last 4 same weekdays, the same rule as Weekly Ops and the Now page.
        People needed each half-hour = 1 person per {UNITS_PER_PERSON_HALF_HOUR} smoothies, bowls or food items, planned for a busy
        version of the day (the 2nd-busiest of the last 4) — if the day runs slower, the Now page says who can go home — plus 1 during
        the truck delivery, and {CLOSE_MIN_PEOPLE} in the last half-hour so nobody closes alone. A rush = {RUSH_UNITS}+ items a half-hour
        for an hour or more. The draft uses shifts of at least {SHIFT_MIN_HOURS} h and fills the people furthest below their usual hours first.
        Wages = hours × each person&apos;s Brink pay rate, before payroll taxes; the salaried manager&apos;s shifts count as people on the floor
        at no extra wage. Checked as you go: not available (NetChef), approved time off (Teamworx), one shift per person per day, minors
        16–17, overtime past {WEEKLY_OT_HOURS} h. Owners are not scheduled here.
      </BasisNote>
      </div>
    </Page>
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

function CrewHours({ people, weekHours }: { people: SchedPerson[]; weekHours: Map<string, number> }) {
  return (
    <div className="sk-sched-crew">
      {people.map(p => ({ p, h: weekHours.get(p.key) ?? 0 })).sort((a, b) => b.h - a.h).map(({ p, h }) => (
        <div key={p.key} className="sk-sched-row sk-sched-small">
          <span><b>{p.name}</b> <span className="sk-sched-muted">{[p.salaried ? 'salaried' : '', p.dob ? '16–17' : '', p.entered ? '' : 'no availability on file'].filter(Boolean).join(' · ')}</span></span>
          <span className={tone(p.usual != null && Math.abs(h - p.usual) >= 4 ? 'warn' : 'neutral')}>{hrs(h)} h <span className="sk-sched-muted">/ usual {p.usual == null ? '—' : hrs(p.usual)}</span></span>
        </div>
      ))}
    </div>
  )
}

function Editor({ s, day, days, data, shifts, edit, remove, moveTo }: {
  s: SchedShift; day: SchedDay; days: SchedDay[]; data: SchedulePayload; shifts: SchedShift[]
  edit: (id: number, fn: (x: SchedShift) => SchedShift) => void; remove: () => void; moveTo: (i: number) => void
}) {
  const ev = evaluate(data.store.name, data.days, shifts, data.people)
  const choices = data.people.map(q => {
    const trial = shifts.map(x => (x.id === s.id ? { ...x, key: q.key } : x))
    const t = evaluate(data.store.name, data.days, trial, data.people)
    const its = [...(t.issues.get(s.id) ?? [])]
    const w = t.weekHours.get(q.key) ?? 0
    if (!q.salaried && w > WEEKLY_OT_HOURS) its.push({ tone: 'warn', text: `goes into overtime (${hrs(w)} h)` })
    const b = its.find(x => x.tone === 'bad'), wn = its.find(x => x.tone === 'warn')
    const pref = (q.avail[s.date] ?? []).some(x => x.st === 'P' && x.a < s.e && x.z > s.s)
    const have = ev.weekHours.get(q.key) ?? 0
    return { q, why: b?.text ?? wn?.text ?? (pref ? 'Prefers this time' : q.salaried ? 'Manager — sets own hours' : q.entered ? 'Available' : 'Availability not on file'),
      tone: (b ? 'bad' : wn ? 'warn' : 'neutral') as Tone, mine: s.key === q.key, have,
      rank: (s.key === q.key ? -9 : 0) + (b ? 3 : wn ? 1 : 0) + (pref ? -0.5 : 0) + (q.entered ? 0 : 0.3) - Math.max(0, (q.usual ?? 0) - have) / 100 }
  }).sort((a, b) => a.rank - b.rank)
  return (
    <div className="sk-sched-editor">
      <div className="sk-sched-steps">
        <span className="sk-sched-step">
          <span>Start</span>
          <button type="button" aria-label="Start 30 minutes earlier" onClick={() => edit(s.id, x => ({ ...x, s: Math.max(day.a, x.s - 30) }))}>−</button>
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
            {days.map((d, i) => <option key={d.date} value={i}>{dayShort(d.date)}</option>)}
          </select>
        </label>
      </div>
      <span className="sk-sched-label">Who works it — best fits first</span>
      {choices.map(c => (
        <button key={c.q.key} type="button" className="sk-sched-choice" aria-pressed={c.mine} onClick={() => edit(s.id, x => ({ ...x, key: c.q.key }))}>
          <span><b>{c.q.name}{c.q.dob ? ' · 16–17' : ''}</b><br /><span className={`sk-sched-small ${tone(c.tone)}`}>{c.why}</span></span>
          <span className="sk-sched-small sk-sched-muted">{hrs(c.have)} h · usual {c.q.usual == null ? '—' : hrs(c.q.usual)}</span>
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
function Available({ day, dr, data, shifts, dayShifts, selShift, weekHours, put, add }: {
  day: SchedDay; dr: ReturnType<typeof evaluate>['days'][number]; data: SchedulePayload; shifts: SchedShift[]
  dayShifts: SchedShift[]; selShift: SchedShift | null; weekHours: Map<string, number>
  put: (key: string) => void; add: (key: string, a: number, z: number) => void
}) {
  const rows = data.people.map(p => {
    const off = (p.off[day.date] ?? []).filter(b => b.status === 'approved')
    const cuts = [...(p.avail[day.date] ?? []).filter(b => b.st === 'N'), ...off].sort((a, b) => a.a - b.a)
    let free: { a: number; z: number }[] = [], t = day.a
    for (const b of cuts) { if (b.a > t) free.push({ a: t, z: Math.min(b.a, day.z) }); t = Math.max(t, b.z) }
    if (t < day.z) free.push({ a: t, z: day.z })
    free = free.filter(w => w.z - w.a >= 120)
    const working = dayShifts.filter(s => s.key === p.key)
    const have = weekHours.get(p.key) ?? 0
    const status = off.length && !free.length ? 'out' : !free.length ? 'out' : p.entered || p.salaried ? 'free' : 'unknown'
    let when = off.length && !free.length ? 'Time off (approved)' : !free.length ? 'Not available'
      : p.salaried ? 'Manager — sets own hours'
      : !p.entered ? 'Availability not on file — ask before scheduling'
      : free.length === 1 && free[0].a <= day.a && free[0].z >= day.z ? 'Available all day'
      : 'Available ' + free.map(w => (w.a <= day.a ? `until ${clock(w.z)}` : w.z >= day.z ? `after ${clock(w.a)}` : `${clock(w.a)}–${clock(w.z)}`)).join(', ')
    const prefs = (p.avail[day.date] ?? []).filter(b => b.st === 'P')
    if (prefs.length && status === 'free') when += ' · prefers ' + prefs.map(b => `${clock(b.a)}–${clock(b.z)}`).join(', ')
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
        const w = free[0] ?? { a: day.a, z: day.z }
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
    return { p, when, have, status, canAct, act, order }
  }).sort((a, b) => a.order - b.order)
  void shifts
  return (
    <Section label={`Who's available ${dayShort(day.date).slice(0, 3)}`} aside={<span className="sk-meta">{selShift ? `Choosing someone for ${clock(selShift.s)}–${clock(selShift.e)}` : 'Free first, fewest hours against usual first'}</span>}>
      {rows.map(r => (
        <div key={r.p.key} className={`sk-sched-person${r.status === 'out' ? ' out' : ''}`}>
          <span>
            <b>{r.p.name}</b> <span className="sk-sched-muted sk-sched-small">{[r.p.role === 'Team Captain' ? 'Captain' : '', r.p.salaried ? 'salaried' : '', r.p.dob ? '16–17' : ''].filter(Boolean).join(' · ')}</span><br />
            <span className={`sk-sched-small ${tone(r.status === 'unknown' ? 'warn' : 'neutral')}`}>{r.when}</span><br />
            <span className="sk-sched-small sk-sched-muted">{hrs(r.have)} h this week · usual {r.p.usual == null ? '—' : hrs(r.p.usual)}{r.p.dob ? ' · max 30' : ''}</span>
          </span>
          {r.canAct ? <button type="button" className={`sk-sched-btn${selShift ? ' primary' : ''}`} onClick={r.act}>{selShift ? 'Put on this shift' : 'Add a shift'}</button> : null}
        </div>
      ))}
    </Section>
  )
}
