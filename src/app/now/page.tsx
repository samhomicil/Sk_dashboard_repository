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
import { useEffect, useState } from 'react'
import { swrGet, swrSet } from '@/lib/swrCache'
import { Page, PageBar, TakeCard, Section, Stat, Grid4, BasisNote, Disclosure, toneClass, type Tone } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { useStoreLock } from '@/components/useStoreLock'
import { minToClock } from '@/lib/core/dates'
import type { NowPayload } from '@/app/api/now/route'
import type { StoreNow, Person, Call } from '@/lib/core/intraday'

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
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`
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

export default function NowPage() {
  const lock = useStoreLock()
  const [picked, setPicked] = useState<StoreKey>('all')
  const view: StoreKey = lock ?? picked                     // a store login never picks
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
  const eyebrow = shown ? shown.store : 'All stores'

  return (
    <Page>
      <PageBar eyebrow={eyebrow} title="Right now" meta={data ? <Freshness d={data} /> : null}>
        {!lock && !single && (
          <SegControl label="Store" options={STORE_OPTS} value={view} onChange={setPicked} />
        )}
      </PageBar>

      {error && <TakeCard tone="bad" label="Not loaded" headline={error}>Pull down or reopen the page to try again.</TakeCard>}
      {!data && !error && <p className="sk-meta">Loading today…</p>}

      {data && !shown && <AllStores d={data} onPick={setPicked} />}
      {data && shown && <StoreView d={data} s={shown} />}

      {data && (
        <BasisNote>
          As of the last Brink pull (every 30 minutes, {clock(data.refresh.window.from)}–{clock(data.refresh.window.to)} today).
          Sales are net, as on every other screen. A unit is one smoothie, bowl or food item made; retail and add-ins are not units.
          “Normal” is the average of the last four {data.day}s. Labor is hourly wages so far ÷ net sales so far — salaried pay and
          owners are never labor. A send-home call needs every remaining half-hour of that person’s shift covered by the people
          still on at {data.targets.unitsPerPerson} units each, against a busy {data.day} (the second-busiest of the last four)
          adjusted to today’s pace{data.holiday ? `. Today is ${data.holiday}: compared against normal ${data.day}s` : ''}.
        </BasisNote>
      )}
    </Page>
  )
}

function Freshness({ d }: { d: NowPayload }) {
  const r = d.refresh
  const day = new Date(d.today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (r.asOf == null) {
    return <>{day} · {r.inWindow || d.now < r.window.from ? `first pull ${clock(r.window.from)}` : 'no pulls today'}</>
  }
  const parts = [day, `as of ${clock(r.asOf)}`]
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

      <div className="sk-now-tiles"><Grid4>
        <Stat label="Sales so far" value={money(s.sales.soFar)}
          sub={`${s.sales.units} units · ${s.sales.orders} orders`}
          delta={vsNormal == null ? 'no normal yet' : `${signedPct(vsNormal)} vs a normal ${d.day} (${money(s.sales.normalByNow)})`}
          tone={vsNormal == null ? undefined : vsNormal >= 0 ? 'good' : 'warn'} />
        <Stat label="Day on pace" value={money(s.sales.onPace)}
          delta={`normal ${d.day} ${money(s.sales.normalDay)}`} />
        <Stat label="Labor so far" value={pct(s.labor.pctSoFar)}
          sub={`${money(s.labor.paySoFar)} wages`} />
        <Stat label="Finish if nothing changes" value={pct(s.labor.finishPct)}
          sub={`target ${pct(t.labor)}`}
          delta={`${s.labor.remainingHours} h still scheduled · ${money(s.labor.remainingCost)}`}
          tone={laborTone(s.labor.finishPct, t.labor, t.laborAmber)} />
      </Grid4></div>

      <Section label="Sales by hour" aside={<span className="sk-meta">vs a normal {d.day}</span>}>
        <HourChart s={s} day={d.day} />
      </Section>

      <Section label="Next three hours" aside={<span className="sk-meta">at {t.unitsPerPerson} units a person each half-hour</span>}>
        <Ahead s={s} />
      </Section>

      <Section label="People" aside={<span className="sk-meta">{s.people.filter(p => p.status === 'on').length} on the floor</span>}>
        <People s={s} late={t.lateMinutes} />
      </Section>
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
    const short = s.ahead.filter(a => a.needUsual > a.heads)
    if (short.length) {
      return <TakeCard tone="warn" label="Short-handed" headline="Nobody to send home — the store is a person short.">
        A usual {d.day} needs more people than are on {short.map(a => span(a.from, a.to)).join(' and ')}.{truck}
      </TakeCard>
    }
    return <TakeCard tone="good" label="Staffing" headline="Nobody to send home right now.">
      Everyone on is needed for the busiest the next few hours usually get.{truck}
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
  const label = rows.map(r => `${hourLabel(r.hour)} ${r.actual != null ? money(r.actual) : `~${money(r.projected ?? 0)}`} (normal ${money(r.normal)})`).join('; ')
  return (
    <div className="sk-card sk-now-chart">
      <div className="sk-now-bars" role="img" aria-label={`Net sales by hour today vs a normal ${day}: ${label}`}>
        {rows.map(r => (
          <div key={r.hour} className="sk-now-bar"
            title={`${hourLabel(r.hour)} — ${r.actual != null ? `${money(r.actual)} so far` : `~${money(r.projected ?? 0)} expected`} · normal ${money(r.normal)}${r.units != null ? ` · ${r.units} units` : ''}`}>
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
        <span><i className="normal" />Normal {day}</span>
      </div>
    </div>
  )
}

function Ahead({ s }: { s: StoreNow }) {
  if (!s.ahead.length) return <p className="sk-meta">The day is over for this store.</p>
  return (
    <div className="sk-card sk-table-wrap">
      <table className="sk-table sk-now-table">
        <thead>
          <tr><th>Time</th><th className="num">Units</th><th className="num">On</th><th className="num">Needs</th></tr>
        </thead>
        <tbody>
          {s.ahead.map(a => {
            // short: fewer on than a USUAL hour needs. spare: more than even a BUSY one needs.
            const short = a.needUsual - a.heads
            const spare = a.heads - a.need
            const [tone, word]: [Tone, string] = short > 0 ? ['bad', `short ${short}`]
              : spare > 0 ? ['warn', `${spare} spare`] : ['good', 'right']
            return (
              <tr key={a.from}>
                <td className="nowrap">{span(a.from, a.to)}
                  <span className="sk-now-sub"><span className={`sk-now-chip ${toneClass(tone)}`}>{word}</span></span>
                </td>
                <td className="num">{a.units}<span className="sk-now-sub">busy {a.busyUnits}</span></td>
                <td className="num">{a.heads}</td>
                <td className="num">{a.needUsual}<span className="sk-now-sub">busy {a.need}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
        <span className="sk-now-sub">{p.role}
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
            {on.map(p => row(p,
              [p.inAt != null ? clock(p.inAt) : '—', p.schedEnd != null ? clock(p.schedEnd) : 'not scheduled'],
              p.lateBy ? { tone: 'warn', text: `${p.lateBy} min late` } : p.salaried ? { tone: 'neutral', text: 'salaried' } : undefined))}
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
  const missing = d.stores.flatMap(s => s.people.filter(p => p.status === 'late' || p.status === 'noshow').map(p => ({ s, p })))
  const byStore = d.stores.filter(s => s.calls.length)
    .map(s => `${s.calls.map(c => firstName(c.employee)).join(' and ')} at ${s.store}`)
  const headline = calls.length
    ? `${calls.length} send-home call${calls.length === 1 ? '' : 's'} — ${byStore.join('; ')}.`
    : 'No send-home calls at any store right now.'
  return (
    <>
      <TakeCard tone={calls.length || missing.length ? 'warn' : 'good'} label="All stores" headline={headline}>
        {missing.length
          ? `Not in yet: ${missing.map(({ s, p }) => `${firstName(p.employee)} (${s.store}, ${p.status === 'noshow' ? 'no-show' : `${p.lateBy} min`})`).join(', ')}.`
          : calls.length ? 'Open a store for who, and why.' : 'Everyone scheduled so far is in.'}
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
                  : s.ahead.some(a => a.needUsual > a.heads) ? 'A person short ahead' : 'Nobody to send home'}
              </span>
              <span className="lines">
                <span>Sales <b>{money(s.sales.soFar)}</b>{vs != null ? ` · ${signedPct(vs)} vs normal` : ''}</span>
                <span>Labor finish <b>{pct(s.labor.finishPct)}</b>{' '}
                  <span className={`sk-now-chip ${toneClass(tone)}`}>{tone === 'good' ? 'on target' : tone === 'warn' ? 'near target' : tone === 'bad' ? 'over target' : 'no sales yet'}</span>
                </span>
                <span><b>{s.people.filter(p => p.status === 'on').length}</b> on now · {s.people.filter(p => p.status === 'coming').length} coming in</span>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
