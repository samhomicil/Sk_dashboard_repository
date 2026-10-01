'use client'

/**
 * NOW — a store's day while it is still running, read on a phone behind the counter.
 *
 * Not in the design kit, so it follows module-contract.md's anatomy: PageBar → TakeCard
 * (the decision: who can go home) → stat tiles → evidence (sales by hour, the next three
 * hours, people) → basis. Every figure arrives computed from /api/now (core/intraday.ts);
 * thresholds ride in on the payload from core/targets.ts. This file only formats.
 *
 * Everything is "as of" the last 30-minute Brink pull, never the wall clock.
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { swrGet, swrSet } from '@/lib/swrCache'
import {
  Page, PageBar, TakeCard, FlagList, Section, Stat, Grid4, Disclosure, toneClass,
  type Tone, type Flag,
} from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { useStoreLock } from '@/components/useStoreLock'
import { minToClock } from '@/lib/core/dates'
import type { NowPayload } from '@/app/api/now/route'
import type { StoreNow, Person, Call, AttendanceFlag, LateEvent, AheadRow } from '@/lib/core/intraday'

type StoreKey = 'all' | 'pines' | 'miramar' | 'margate'
type S = NowPayload['stores'][number]

const STORE_OPTS: { value: StoreKey; label: string }[] = [
  { value: 'all', label: 'All Stores' },
  { value: 'margate', label: 'Margate' },
  { value: 'miramar', label: 'Miramar' },
  { value: 'pines', label: 'Pines' },
]
// The next pull lands every 30 minutes; an open phone picks it up within five.
const POLL_MS = 5 * 60 * 1000

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const money2 = (n: number) => `$${n.toFixed(2)}`
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const pct0 = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
const hourFull = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
/** '2026-09-24' → 'Thu 24 Sep' */
const dayShort = (iso: string) => {
  const d = new Date(iso + 'T12:00:00Z')
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`
}
/** The comparison figure: shown after a slash, in italics, never labelled per cell — the
 *  section header says once what it is ("today / avg of the last 4 Thursdays"). */
const Avg = ({ v }: { v: string }) => <i className="sk-now-avg">/ {v}</i>
const DAY_LONG: Record<string, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
}
const avgHeader = (d: NowPayload) =>
  <>today <i className="sk-now-avg">/ avg of the last {d.targets.histWeeks} {DAY_LONG[d.day] ?? d.day}s</i></>
/** The next hours are planned for a BUSY day: the larger of the two forecasts, so a manager
 *  sees one number of units and one number of people. Staffing is decided per half-hour, so
 *  the row shows the busiest half-hour — then "needed" is just those units ÷ 6, rounded up. */
const neededOf = (a: AheadRow) => Math.max(a.need, a.needUsual)
/** 'in 7:29 AM for 6:30 AM' — every late mention carries the clock-in and the due time. */
const inFor = (inAt: number, sched: number) => `in ${clock(inAt)} for ${clock(sched)}`
const signedPct = (x: number) => {
  const n = Math.round(Math.abs(x) * 100)
  return n === 0 ? '0%' : `${x > 0 ? '+' : '−'}${n}%`
}
const clock = (m: number) => minToClock(m)
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`
/** 600, 660 → '10–11 AM'; 690, 780 → '11:30 AM–1 PM' */
const span = (from: number, to: number) => {
  const part = (m: number, withMer: boolean) => {
    const h = Math.floor(m / 60) % 24, mm = m % 60
    return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${withMer ? (h < 12 ? ' AM' : ' PM') : ''}`
  }
  const same = (Math.floor(from / 60) % 24 < 12) === (Math.floor(to / 60) % 24 < 12)
  return `${part(from, !same)}–${part(to, true)}`
}
/** 'Ramirez, Gianna' → 'Gianna Ramirez' */
const nameOf = (raw: string) => {
  const [last, first] = raw.split(',').map(x => x.trim())
  return first ? `${first} ${last}` : raw
}
const firstName = (raw: string) => nameOf(raw).split(' ')[0]

function laborTone(x: number | null, target: number, amber: number): Tone {
  if (x == null) return 'neutral'
  return x <= target ? 'good' : x <= target + amber ? 'warn' : 'bad'
}

// useSearchParams needs a Suspense boundary so the page shell can still prerender.
export default function NowPage() {
  return (
    <Suspense fallback={<Page><p className="sk-meta">Loading today…</p></Page>}>
      <NowScreen />
    </Suspense>
  )
}

const isKey = (v: string | null): v is StoreKey => STORE_OPTS.some(o => o.value === v)

function NowScreen() {
  const lock = useStoreLock()
  // The store is in the address (/now?store=pines), so the phone's back gesture returns to
  // All Stores, and a notification can link straight to one store.
  const q = useSearchParams().get('store')
  const picked: StoreKey = isKey(q) ? q : 'all'
  const view: StoreKey = lock ?? picked                     // a store login never picks
  const fromAll = useRef(false)                             // did we push this store view?
  useEffect(() => { if (view === 'all') fromAll.current = false }, [view])
  const go = (k: StoreKey) => {
    if (k === view) return
    if (k === 'all') {
      // Back to where we came from when we came from All Stores, so the history stays
      // [All Stores] rather than growing [All, Pines, All] on every round trip.
      if (fromAll.current) { fromAll.current = false; window.history.back(); return }
      window.history.replaceState(null, '', '/now')
    } else if (view === 'all') {
      window.history.pushState(null, '', `/now?store=${k}`)
      fromAll.current = true
    } else {
      window.history.replaceState(null, '', `/now?store=${k}`)  // store to store: one step back is still All
    }
    window.scrollTo({ top: 0 })
  }
  const key = `now:${lock ?? 'all'}`   // the payload depends on the login, not the tab
  const [data, setData] = useState<NowPayload | null>(() => swrGet<NowPayload>(key) ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const run = () => {
      fetch(`/api/now?store=${lock ?? 'all'}`, { cache: 'no-store' })
        .then(async r => {
          if (!r.ok) throw new Error(r.status === 403 ? 'This login has no store assigned.' : `Could not load (${r.status}).`)
          return (await r.json()) as NowPayload
        })
        .then(d => { if (alive) { setData(d); swrSet(key, d); setError(null) } })
        .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load.') })
    }
    run()
    const t = setInterval(run, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [lock, key])

  // One store in the payload means a store login (the server sent only theirs).
  const single = data?.stores.length === 1 ? data.stores[0] : null
  const shown: S | null = !data ? null
    : single ?? (view !== 'all' ? data.stores.find(s => s.key === view) ?? null : null)
  const canPick = !lock && !single
  const eyebrow = shown && canPick
    ? <><button type="button" className="sk-backlink sk-now-back" onClick={() => go('all')}>← All stores</button>
        <span aria-hidden="true"> / </span>{shown.store}</>
    : shown ? shown.store : 'All stores'

  return (
    <Page>
      <PageBar eyebrow={eyebrow} title="Right now" meta={data ? <Freshness d={data} s={shown} /> : null}>
        {canPick && (
          <SegControl label="Store" options={STORE_OPTS} value={view} onChange={go} />
        )}
      </PageBar>

      {error && <TakeCard tone="bad" label="Not loaded" headline={error}>Pull down or reopen the page to try again.</TakeCard>}
      {!data && !error && <p className="sk-meta">Loading today…</p>}

      {data && !shown && <AllStores d={data} onPick={go} />}
      {data && shown && <StoreView d={data} s={shown} />}

    </Page>
  )
}

function Freshness({ d, s }: { d: NowPayload; s: S | null }) {
  const r = d.refresh
  const day = new Date(d.today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (r.asOf == null) {
    return <>{day} · {r.inWindow || d.now < r.window.from ? `first pull ${clock(r.window.from)}` : 'no pulls today'}</>
  }
  const parts = [day, `as of ${clock(r.asOf)}`]
  if (s?.lastSale != null) parts.push(`last sale ${clock(s.lastSale)}`)
  if (r.stale) parts.push(`${r.ageMin} min old — pulls are late`)
  else if (r.next != null) parts.push(`next ${clock(r.next)}`)
  else parts.push('pulls resume tomorrow')
  if (r.lastFailed && !r.stale) parts.push('last pull failed')
  return <>{parts.join(' · ')}</>
}

/* ── One store ─────────────────────────────────────────────────────────────── */

function StoreView({ d, s }: { d: NowPayload; s: S }) {
  const t = d.targets
  const vsNormal = s.sales.normalByNow > 0 ? s.sales.soFar / s.sales.normalByNow - 1 : null
  return (
    <>
      <Decision d={d} s={s} />

      <Attendance d={d} s={s} />

      <Section label="So far" aside={<span className="sk-meta">{avgHeader(d)}</span>}>
      <div className="sk-now-tiles"><Grid4>
        <Stat label="Sales so far" value={money(s.sales.soFar)}
          sub={<>{s.sales.normalByNow > 0 ? <><Avg v={money(s.sales.normalByNow)} /> · </> : null}{s.sales.units} units · {s.sales.orders} orders</>}
          delta={vsNormal == null ? undefined : signedPct(vsNormal)}
          tone={vsNormal == null ? undefined : vsNormal >= 0 ? 'good' : 'warn'} />
        <Stat label="Day on pace" value={money(s.sales.onPace)}
          sub={s.sales.normalDay > 0 ? <Avg v={money(s.sales.normalDay)} /> : undefined}
          delta={s.sales.normalDay > 0 ? signedPct(s.sales.onPace / s.sales.normalDay - 1) : undefined}
          tone={s.sales.normalDay > 0 ? (s.sales.onPace >= s.sales.normalDay ? 'good' : 'warn') : undefined} />
        <Stat label="Labor so far" value={pct(s.labor.pctSoFar)}
          sub={`${money(s.labor.paySoFar)} wages`} />
        <Stat label="Finish if nothing changes" value={pct(s.labor.finishPct)}
          sub={`target ${pct(t.labor)}`}
          delta={`${s.labor.remainingHours} h still scheduled · ${money(s.labor.remainingCost)}`}
          tone={laborTone(s.labor.finishPct, t.labor, t.laborAmber)} />
      </Grid4></div>
      </Section>

      <Register d={d} s={s} />

      <Section label="Hour by hour" aside={<span className="sk-meta">
        {avgHeader(d)}{s.sales.normalByNow > 0 ? ` · running ${signedMoney(s.sales.soFar - s.sales.normalByNow)}` : ''}
      </span>}>
        <HourChart s={s} day={d.day} />
        <HourTable s={s} />
      </Section>

      <Section label="Next three hours" aside={<span className="sk-meta">planned for a busy day · one person makes about {t.unitsPerPerson} units a half-hour</span>}>
        <Ahead s={s} />
      </Section>

      <Section label="Who’s clocked in" aside={<span className="sk-meta">{s.people.filter(p => p.status === 'on').length} on the floor</span>}>
        <People s={s} late={t.lateMinutes} />
      </Section>
    </>
  )
}

function Attendance({ d, s }: { d: NowPayload; s: S }) {
  const t = d.targets
  const earlier = (h?: LateEvent[]) => (h?.length
    ? ` Before: ${h.map(e => `${dayShort(e.d)} ${inFor(e.inAt, e.sched)}`).join('; ')}.` : '')
  const again = (c?: number, h?: LateEvent[]) =>
    (c && c >= 2 ? ` — ${ordinal(c)} late start in ${t.lateLookback} days.${earlier(h)}` : '')
  const say = (a: AttendanceFlag): Flag => {
    const base = { who: nameOf(a.employee), scope: a.role }
    switch (a.kind) {
      case 'noshow': return { ...base, tone: 'bad', text: `no-show — was due in at ${clock(a.sched!)}` }
      case 'missing': return { ...base, tone: 'bad', text: `not in yet — due ${clock(a.sched!)}, ${a.minutes} min ago${again(a.count, a.history)}` }
      case 'late': return { ...base, tone: 'warn', text: `${inFor(a.at!, a.sched!)} — ${a.minutes} min late${again(a.count, a.history)}` }
      case 'repeat-late': return { ...base, tone: 'warn', text: `${a.at != null && a.sched != null ? `${inFor(a.at, a.sched)} today, on time` : a.sched != null ? `due in at ${clock(a.sched)}` : 'today'} — late ${a.count} times in the last ${t.lateLookback} days:${earlier(a.history).replace(' Before:', '')}` }
      case 'left-early': return { ...base, tone: 'warn', text: `left at ${clock(a.at!)}, due out ${clock(a.sched!)} — ${a.minutes} min early` }
      case 'past-out': return { ...base, tone: 'warn', text: `still on, ${a.minutes} min past the ${clock(a.sched!)} finish` }
      case 'unscheduled': return { ...base, tone: 'warn', text: `clocked in at ${clock(a.at!)} without a scheduled shift` }
      case 'overtime': return { ...base, tone: 'warn', text: `on track for ${a.hours} h this week — past ${t.weeklyHours}` }
      default: return { ...base, tone: 'warn', text: a.kind }
    }
  }
  return <FlagList title="Attendance" flags={s.attendance.map(say)} limit={10}
    emptyNote="Everyone scheduled so far is in, on time." />
}

function Register({ d, s }: { d: NowPayload; s: S }) {
  const f = s.facts, t = d.targets
  const vs = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b - 1 : null)
  const ticketVs = vs(f.avgTicket, f.avgTicketNormal)
  const top = s.voidsBy[0]
  const discOver = f.discountPct != null && f.discountPct > t.discountPct
  return (
    <Section label="At the register" aside={<span className="sk-meta">{avgHeader(d)}</span>}>
      <div className="sk-now-tiles"><Grid4>
        <Stat label="Avg ticket" value={f.avgTicket == null ? '—' : money2(f.avgTicket)}
          sub={<>{f.avgTicketNormal != null ? <><Avg v={money2(f.avgTicketNormal)} /> · </> : null}
            {f.discountPct == null ? null : `discounts ${pct(f.discountPct)}${discOver ? ` — over ${pct0(t.discountPct)}` : ''}`}</>}
          delta={ticketVs == null ? undefined : signedPct(ticketVs)}
          tone={ticketVs == null ? undefined : ticketVs >= 0 ? 'good' : 'warn'} />
        <Stat label="Online & delivery" value={pct0(f.digitalShare)}
          sub={<>{f.digitalNormal != null ? <><Avg v={pct0(f.digitalNormal)} /> · </> : null}of orders</>} />
        <Stat label="Enhancers" value={pct0(f.ee)}
          sub={<>{f.eeNormal != null ? <><Avg v={pct0(f.eeNormal)} /> · </> : null}target {pct0(t.ee)}</>}
          delta={f.ee == null ? undefined
            : f.ee >= t.ee ? 'at or over target' : `${Math.round((t.ee - f.ee) * 100)} pts under target`}
          tone={f.ee == null ? undefined : f.ee >= t.ee ? 'good' : 'warn'} />
        <Stat label="Voids" value={pct(f.voidPct)} sub={`${f.voidOrders} of ${f.allOrders} orders`}
          delta={[
            f.voidPct != null && f.voidPct > t.voidPct ? `over the ${pct0(t.voidPct)} limit` : `under the ${pct0(t.voidPct)} limit`,
            f.voidOrders ? `${money(f.voidAmount)} voided` : '',
            top ? `most by ${firstName(top.employee)} (${top.orders})` : '',
          ].filter(Boolean).join(' · ')}
          tone={f.voidPct == null ? undefined : f.voidPct > t.voidPct ? 'bad' : 'good'} />
      </Grid4></div>
    </Section>
  )
}

function HourTable({ s }: { s: StoreNow }) {
  const rows = s.sales.byHour
  if (!rows.length) return null
  const done = rows.filter(r => r.actual != null)
  const ahead = rows.filter(r => r.actual == null)
  const table = (list: typeof rows) => (
    <div className="sk-card sk-table-wrap">
      <table className="sk-table sk-now-table">
        <thead>
          <tr><th>Hour</th><th className="num">Sales <i className="sk-now-avg">/ avg</i></th><th className="num">Units</th><th className="num">On</th><th className="num">Labor</th></tr>
        </thead>
        <tbody>
          {list.map(r => {
            const future = r.actual == null
            return (
              <tr key={r.hour} className={future ? 'proj' : undefined}>
                <td className="nowrap">{hourFull(r.hour)}
                  {r.partial ? <span className="sk-now-sub">so far</span> : null}
                </td>
                <td className="num">{future ? `~${money(r.projected ?? 0)}` : money(r.actual!)} <Avg v={money(r.normal)} /></td>
                <td className="num">{future ? `~${r.unitsAhead ?? 0}` : r.units}</td>
                <td className="num">{r.heads}</td>
                <td className="num">{r.laborPct == null ? '—' : pct0(r.laborPct)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
  if (!done.length) return table(ahead)
  return (
    <>
      {table(done)}
      {ahead.length > 0 && (
        <Disclosure label="Rest of the day, expected" count={ahead.length}>
          {table(ahead)}
          <p className="sk-meta">Expected at today’s pace, with the people scheduled. Labor is the scheduled wages for the hour ÷ its expected sales.</p>
        </Disclosure>
      )}
    </>
  )
}

function Decision({ d, s }: { d: NowPayload; s: S }) {
  const r = d.refresh
  const truck = s.truck ? ` Truck day: one extra person is held ${clock(s.truck.from)}–${clock(s.truck.to)} for receiving.` : ''
  if (r.asOf == null) {
    return <TakeCard tone="neutral" label="Waiting" headline="No data for today yet.">
      The first Brink pull lands at {clock(r.window.from)}.
    </TakeCard>
  }
  if (r.stale) {
    return <TakeCard tone="warn" label="Paused" headline={`Brink data is ${r.ageMin} minutes old — send-home calls are paused.`}>
      They come back on their own when the next pull lands. Everything below is as of {clock(r.asOf)}.
    </TakeCard>
  }
  if (!r.inWindow) {
    return <TakeCard tone="neutral" label="Closed" headline="Pulls are done for the day.">
      Final figures replace today’s overnight; tomorrow’s first pull is at the usual time.
    </TakeCard>
  }
  if (s.calls.length === 0) {
    const short = s.ahead.filter(a => neededOf(a) > a.heads)
    if (short.length) {
      return <TakeCard tone="warn" label="Short-handed" headline="Nobody to send home — the store is a person short.">
        Planned for a busy {DAY_LONG[d.day] ?? d.day}, {short.map(a => span(a.from, a.to)).join(' and ')} needs more people than are scheduled.{truck}
      </TakeCard>
    }
    const h = s.hold
    return <TakeCard tone="good" label="Staffing" headline="Nobody to send home right now.">
      {h
        ? h.lead
          ? `${nameOf(h.employee)} is the only shift lead on ${span(h.at, h.at + 30)}, so stays until ${clock(h.until)}.`
          : `${nameOf(h.employee)} is needed until ${clock(h.until)}: ${span(h.at, h.at + 30)} is up to ${h.units} units, ${h.need} people needed.`
        : 'Everyone on is staying to close, or leaves within the hour anyway.'}{truck}
    </TakeCard>
  }
  const c0 = s.calls[0]
  const headline = s.calls.length === 1
    ? `Send ${nameOf(c0.employee)} home now — ${c0.hours.toFixed(1)} h early, ≈ ${money(c0.dollars)}.`
    : `${s.calls.length} people can go home now — ${s.calls.reduce((a, c) => a + c.hours, 0).toFixed(1)} h, ≈ ${money(s.calls.reduce((a, c) => a + c.dollars, 0))}.`
  return (
    <TakeCard tone="warn" label="Send home" headline={headline}>
      <span className="sk-now-calls">
        {s.calls.map(c => <CallLine key={c.employee} c={c} />)}
      </span>
      {truck}
    </TakeCard>
  )
}

function CallLine({ c }: { c: Call }) {
  return (
    <span className="sk-now-call">
      <span className="amount num">−{c.hours.toFixed(1)} h</span>
      <span>
        <b>{nameOf(c.employee)}</b> was due out at {clock(c.plannedEnd)}. The busiest half-hour left in that shift
        is about {c.peakUnits} unit{c.peakUnits === 1 ? '' : 's'} ({clock(c.peakAt)}); the {c.headsLeft} still on can make {c.capacity}.
        {c.truck ? ' The truck crew is kept.' : ''}
      </span>
    </span>
  )
}

function HourChart({ s, day }: { s: StoreNow; day: string }) {
  const rows = s.sales.byHour
  if (!rows.length) return <p className="sk-meta">No trading hours on record for a {day}.</p>
  const top = Math.max(1, ...rows.map(r => Math.max(r.actual ?? 0, r.projected ?? 0, r.normal)))
  const h = (v: number) => `${Math.max(0, (v / top) * 100)}%`
  const label = rows.map(r => `${hourLabel(r.hour)} ${r.actual != null ? money(r.actual) : `~${money(r.projected ?? 0)}`} (avg ${money(r.normal)})`).join('; ')
  return (
    <div className="sk-card sk-now-chart">
      <div className="sk-now-bars" role="img" aria-label={`Net sales by hour today vs the average ${day}: ${label}`}>
        {rows.map(r => (
          <div key={r.hour} className="sk-now-bar"
            title={`${hourLabel(r.hour)} — ${r.actual != null ? `${money(r.actual)} so far` : `~${money(r.projected ?? 0)} expected`} · avg ${money(r.normal)}${r.units != null ? ` · ${r.units} units` : ''}`}>
            {r.actual != null
              ? <i className="actual" style={{ height: h(r.actual) }} />
              : <i className="proj" style={{ height: h(r.projected ?? 0) }} />}
            <b style={{ bottom: h(r.normal) }} />
          </div>
        ))}
      </div>
      <div className="sk-now-axis" aria-hidden="true">
        {rows.map(r => <span key={r.hour}>{hourLabel(r.hour)}</span>)}
      </div>
      <div className="sk-now-legend">
        <span><i className="actual" />Today</span>
        <span><i className="proj" />Still to come, at today’s pace</span>
        <span><i className="normal" />Avg {day}</span>
      </div>
    </div>
  )
}

function Ahead({ s }: { s: StoreNow }) {
  if (!s.ahead.length) return <p className="sk-meta">The day is over for this store.</p>
  return (
    <div className="sk-card sk-now-ahead">
      {s.ahead.map(a => {
        const needed = neededOf(a)
        const gap = a.heads - needed
        const [tone, word]: [Tone, string] = gap < 0 ? ['bad', `${-gap} short`]
          : gap > 0 ? ['warn', `${gap} more than needed`] : ['good', 'covered']
        return (
          <div key={a.from} className="sk-now-ahead-row">
            <div className="top">
              <b>{span(a.from, a.to)}</b>
              <span className={`sk-now-chip ${toneClass(tone)}`}>{word}</span>
            </div>
            <span className="sk-now-sub">
              Up to {a.peak} units in the busiest half-hour · {a.heads} on · {needed} needed{a.truck ? ', truck crew included' : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function People({ s, late }: { s: StoreNow; late: number }) {
  const on = s.people.filter(p => p.status === 'on').sort((a, b) => (a.inAt ?? 0) - (b.inAt ?? 0))
  const coming = s.people.filter(p => p.status === 'coming').sort((a, b) => (a.schedStart ?? 0) - (b.schedStart ?? 0))
  const missing = s.people.filter(p => p.status === 'late' || p.status === 'noshow')
  const done = s.people.filter(p => p.status === 'done')
  const row = (p: Person, cols: [string, string], note?: { tone: Tone; text: string }) => (
    <tr key={`${p.employee}-${p.schedStart ?? p.inAt}`}>
      <td>{nameOf(p.employee)}
        <span className="sk-now-sub">{[
          p.role,
          p.inAt != null && p.hoursToday ? `${p.hoursToday.toFixed(1)} h today` : '',
          p.weekWorked == null ? '' : p.weekWorked > 0 ? `${p.weekWorked} h this week` : 'first shift this week',
        ].filter(Boolean).join(' · ')}
          {note ? <> <span className={`sk-now-chip ${toneClass(note.tone)}`}>{note.text}</span></> : null}
        </span>
      </td>
      <td className="num">{cols[0]}</td>
      <td className="num">{cols[1]}</td>
    </tr>
  )
  const group = (label: string) => (
    <tr className="sk-now-group"><td colSpan={3} className="sk-eyebrow">{label}</td></tr>
  )
  return (
    <>
      <div className="sk-card sk-table-wrap">
        <table className="sk-table sk-now-table">
          <thead><tr><th>Name</th><th className="num">In</th><th className="num">Out</th></tr></thead>
          <tbody>
            {on.length > 0 && group('On the floor')}
            {on.map(p => {
              const over = !p.salaried && p.schedEnd != null ? s.asOf - p.schedEnd : 0
              return row(p,
                [p.inAt != null ? clock(p.inAt) : '—', p.schedEnd != null ? clock(p.schedEnd) : 'not scheduled'],
                over > late ? { tone: 'warn', text: `${over} min past out` }
                  : p.lateBy && p.schedStart != null ? { tone: 'warn', text: `${p.lateBy} min late · due ${clock(p.schedStart)}` }
                  : p.salaried ? { tone: 'neutral', text: 'salaried' } : undefined)
            })}
            {missing.length > 0 && group('Not in yet')}
            {missing.map(p => row(p,
              [p.schedStart != null ? clock(p.schedStart) : '—', p.schedEnd != null ? clock(p.schedEnd) : '—'],
              p.status === 'noshow' ? { tone: 'bad', text: 'no-show' } : { tone: 'bad', text: `${p.lateBy} min overdue` }))}
            {coming.length > 0 && group('Coming in')}
            {coming.map(p => row(p,
              [p.schedStart != null ? clock(p.schedStart) : '—', p.schedEnd != null ? clock(p.schedEnd) : '—']))}
          </tbody>
        </table>
      </div>
      {done.length > 0 && (
        <Disclosure label="Finished today" count={done.length}>
          <p className="sk-meta">{done.map(p => `${firstName(p.employee)} ${p.inAt != null ? clock(p.inAt) : ''}–${p.outAt != null ? clock(p.outAt) : ''}`).join(' · ')}</p>
        </Disclosure>
      )}
      <p className="sk-meta">Late means in more than {late} minutes after the scheduled start.</p>
    </>
  )
}

/* ── All stores (Dan and owners) ───────────────────────────────────────────── */

function AllStores({ d, onPick }: { d: NowPayload; onPick: (k: StoreKey) => void }) {
  const calls = d.stores.flatMap(s => s.calls.map(c => ({ s, c })))
  const flagsOf = (kinds: AttendanceFlag['kind'][]) =>
    d.stores.flatMap(s => s.attendance.filter(a => kinds.includes(a.kind)).map(a => ({ s, a })))
  const missing = flagsOf(['missing', 'noshow'])
  const late = flagsOf(['late'])
  const byStore = d.stores.filter(s => s.calls.length)
    .map(s => `${s.calls.map(c => firstName(c.employee)).join(' and ')} at ${s.store}`)
  const headline = calls.length
    ? `${calls.length} send-home call${calls.length === 1 ? '' : 's'} — ${byStore.join('; ')}.`
    : 'No send-home calls at any store right now.'
  const why = [
    missing.length ? `Not in yet: ${missing.map(({ s, a }) => `${nameOf(a.employee)} (${s.store}) due ${clock(a.sched!)}${a.kind === 'noshow' ? ', never clocked in' : `, ${a.minutes} min ago`}`).join('; ')}.` : '',
    late.length ? `Late today: ${late.map(({ s, a }) => `${nameOf(a.employee)} (${s.store}) ${inFor(a.at!, a.sched!)}, ${a.minutes} min`).join('; ')}.` : '',
  ].filter(Boolean).join(' ')
  return (
    <>
      <TakeCard tone={calls.length || missing.length ? 'warn' : 'good'} label="All stores" headline={headline}>
        {why || (calls.length ? 'Open a store for who, and why.' : 'Everyone scheduled so far is in, on time.')}
      </TakeCard>
      <div className="sk-now-stores">
        {d.stores.map(s => {
          const vs = s.sales.normalByNow > 0 ? s.sales.soFar / s.sales.normalByNow - 1 : null
          const tone = laborTone(s.labor.finishPct, d.targets.labor, d.targets.laborAmber)
          return (
            <button key={s.key} type="button" className={`sk-card sk-now-store ${toneClass(tone)}`} onClick={() => onPick(s.key)}>
              <span className="sk-eyebrow">{s.store}</span>
              <span className="sk-card-title">
                {s.calls.length ? `Send ${s.calls.map(c => firstName(c.employee)).join(' & ')} home`
                  : s.ahead.some(a => neededOf(a) > a.heads) ? 'A person short ahead' : 'Nobody to send home'}
              </span>
              <span className="lines">
                <span>Sales <b>{money(s.sales.soFar)}</b>{s.sales.normalByNow > 0 ? <> <Avg v={money(s.sales.normalByNow)} /></> : null}{vs != null ? ` · ${signedPct(vs)}` : ''}</span>
                <span>Labor finish <b>{pct(s.labor.finishPct)}</b>{' '}
                  <span className={`sk-now-chip ${toneClass(tone)}`}>{tone === 'good' ? 'on target' : tone === 'warn' ? 'near target' : tone === 'bad' ? 'over target' : 'no sales yet'}</span>
                </span>
                <span><b>{s.people.filter(p => p.status === 'on').length}</b> on now · {s.people.filter(p => p.status === 'coming').length} coming in
                  {s.lastSale != null ? ` · last sale ${clock(s.lastSale)}` : ''}</span>
                {s.attendance.filter(a => a.kind === 'missing' || a.kind === 'noshow').map(a => (
                  <span key={`out-${a.employee}`}><span className={`sk-now-chip ${toneClass('bad')}`}>not in</span>{' '}
                    {firstName(a.employee)}, due {clock(a.sched!)}</span>
                ))}
                {s.attendance.filter(a => a.kind === 'late').map(a => (
                  <span key={`late-${a.employee}`}><span className={`sk-now-chip ${toneClass('warn')}`}>late</span>{' '}
                    {firstName(a.employee)} {inFor(a.at!, a.sched!)}</span>
                ))}
                <span>Enhancers <b>{pct0(s.facts.ee)}</b> · voids <b>{s.facts.voidOrders}</b> · ticket <b>{s.facts.avgTicket == null ? '—' : money2(s.facts.avgTicket)}</b></span>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
