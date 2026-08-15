'use client'

/**
 * WEEKLY OPS — rebuilt on the design system.
 *
 * Anatomy, in order: PageBar → TakeCard → FlagList → tiles → evidence → basis.
 * A manager opening this at 6am gets the decision in the first block and the proof
 * underneath.
 *
 * NO NUMBER CHANGED IN THIS REBUILD. Every figure comes from ./derive.ts, which is
 * the old page's arithmetic moved out untouched, fed by the same /api/ops-week
 * payload. Thresholds ride in on that payload from src/lib/core/targets.ts — this
 * file decides no target and grades nothing on its own.
 */
import { useState, useEffect, useMemo } from 'react'
import { swrGet, swrSet } from '@/lib/swrCache'
import { Page, PageBar, TakeCard, FlagList, Tile, Tiles, BasisNote, type Flag, type Tone } from '@/components/design/shell'
import { SegControl, TargetBar } from '@/components/design/controls'
import { UnknownValue } from '@/components/design/states'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'
import {
  buildViews, summarize, actionFor, laborTone, shortDay, money, sMoney, sPct, sHrs,
  type OpsPayload, type View, type Summary,
} from './derive'

const STORE_OPTS = [
  { value: 'all', label: 'All' },
  { value: 'pines', label: 'Pines' },
  { value: 'miramar', label: 'Miramar' },
  { value: 'margate', label: 'Margate' },
]
const WEEK_OPTS = [
  { value: 'this' as const, label: 'This week' },
  { value: 'next' as const, label: 'Next week' },
]

export default function OpsReportPage() {
  const [data, setData] = useState<OpsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState('all')
  const [week, setWeek] = useState<'this' | 'next'>('this')

  // Render-phase adjustment on week toggle: a week already viewed this session
  // renders instantly from swrCache; the effect below revalidates it.
  const key = `ops:${week}`
  const [prevKey, setPrevKey] = useState('')
  if (prevKey !== key) {
    setPrevKey(key)
    const cached = swrGet<OpsPayload>(key)
    setData(cached ?? data)
    setLoading(!cached)
  }

  useEffect(() => {
    let stale = false
    // cache:'no-store' — never re-serve a stale JSON body (an older deploy's payload
    // lacked the PY / cogsRate fields, which read as blank cells on a plain refresh).
    fetch(`/api/ops-week?week=${week}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { swrSet(key, d); if (!stale) { setData(d); setLoading(false) } })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week])

  const views = useMemo(() => (data ? buildViews(data) : null), [data])
  const v = views?.[store]

  return (
    <Page>
      <PageBar
        eyebrow="Weekly Ops"
        title={v?.name ?? 'Weekly Ops'}
        meta={data ? `${data.weekLabel} · ${data.weekMode === 'next' ? 'all forecast' : 'actual to today, forecast after'}` : null}
      >
        <SegControl label="Week" options={WEEK_OPTS} value={week} onChange={setWeek} strong />
        <SegControl label="Store" options={STORE_OPTS} value={store} onChange={setStore} />
      </PageBar>

      {loading ? (
        <div className="sk-card">
          <p className="sk-flags-empty">Loading the week…</p>
        </div>
      ) : !data || !v ? (
        <div className="sk-card">
          <p className="sk-flags-empty">No ops data — check the DB proxy / Azure connection.</p>
        </div>
      ) : (
        <Report data={data} v={v} />
      )}
    </Page>
  )
}

/* ── The verdict ──────────────────────────────────────────────────────────── */

/**
 * The take, computed from the same figures the screen prints.
 *
 * Deliberately derived rather than written: a fixed "labor is running hot" would
 * eventually appear on a week where it isn't. The tone comes from the SAME band the
 * table cells use (laborTone), so the headline can never disagree with the column
 * it is summarising.
 */
function verdict(data: OpsPayload, v: View, s: Summary): { tone: Tone; label: string; headline: string; why: string } {
  const { isNext, tPctAct, paceAct, paceDrift, targetPct, amberPct, focus, mwSalesVar, mwLaborVar, T, laborPlan$ } = s

  if (isNext) {
    const over = T.lcost - laborPlan$
    const tone = laborTone(tPctAct, targetPct, amberPct)
    return tone === 'good'
      ? {
          tone: 'good', label: 'On plan',
          headline: 'Hold next week’s schedule as written.',
          why: `The posted schedule runs ${tPctAct.toFixed(1)}% labor against the ${targetPct.toFixed(0)}% target on ${money(T.sact)} of forecast sales.`,
        }
      : {
          tone, label: 'Trim the schedule',
          headline: `Cut about ${money(over)} of hours before next week locks.`,
          why: `As posted, the schedule runs ${tPctAct.toFixed(1)}% labor against the ${targetPct.toFixed(0)}% target on ${money(T.sact)} of forecast sales${focus ? `, worst on ${focus.day}` : ''}.`,
        }
  }

  // Mid-week. Name the bucket that actually moved, rather than asserting one.
  const movers: string[] = []
  if (Math.abs(mwLaborVar) >= 1) movers.push(`labor ${sMoney(mwLaborVar)} vs plan`)
  if (Math.abs(mwSalesVar) >= 1) movers.push(`sales ${sMoney(mwSalesVar)} vs the staffing-implied plan`)
  const because = movers.length ? `Week to date: ${movers.join(', ')}.` : 'Week to date is level with plan.'

  if (focus) {
    return {
      tone: laborTone(focus.est, targetPct, amberPct),
      label: 'Trim before doors open',
      headline: `Cut about ${money(focus.over)} from ${focus.day}’s schedule.`,
      why: `${focus.day} is projected at ${focus.est.toFixed(0)}% labor against the ${targetPct.toFixed(0)}% target — the largest lever left this week. ${because}`,
    }
  }
  const tone = laborTone(paceAct, targetPct, amberPct)
  return {
    tone,
    label: tone === 'good' ? 'On target' : 'Watch labor',
    headline: tone === 'good'
      ? 'Hold the schedule — nothing needs trimming this week.'
      : `Labor is pacing ${paceAct.toFixed(1)}% against the ${targetPct.toFixed(0)}% target.`,
    why: `${because} No remaining day is projected over the ${targetPct.toFixed(0)}% target${paceDrift ? `, and pace is ${sPct(paceDrift)} pts against plan` : ''}.`,
  }
}

/**
 * Flags come from the bands that already exist — the labor tone the table cells
 * use, the weather anomaly flag each day already carries, the COGS drift the cost
 * panel already grades. Nothing new is judged here.
 */
function flagsFor(data: OpsPayload, s: Summary): Flag[] {
  const out: Flag[] = []
  for (const w of data.warnings ?? []) out.push({ tone: 'bad', who: 'Data', text: w })

  for (const d of s.days) {
    const tone = laborTone(d.laborPctAct, s.targetPct, s.amberPct)
    if (d.laborPctAct > 0 && tone !== 'good') {
      out.push({
        tone,
        who: d.day,
        scope: d.type === 'PROJ' ? 'projected' : 'actual',
        text: actionFor(d, s.targetPct, s.amberPct),
      })
    }
  }
  if (s.cogsDrift > 0.05) {
    out.push({
      tone: s.cogsDrift > 1 ? 'bad' : 'warn',
      who: 'Food cost',
      scope: data.cogsWindow ? `${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)}` : 'latest inventory week',
      text: `recipe COGS ${s.cogsPct.toFixed(1)}% against the ${s.cogsTargetPct.toFixed(1)}% target — ${sPct(s.cogsDrift)} pts, about ${money(s.cogsAct$ - s.cogsPlan$)} on the week.`,
    })
  }
  // Weather stays OUT of the flag list and in the basis note, where the old page
  // had it. In a Florida August every one of the seven days clears 85°F, so a heat
  // flag names the whole week and says nothing — and a list that always has entries
  // is a list people stop reading. It is context for the forecast, not an exception.
  return out
}

/* ── The screen ───────────────────────────────────────────────────────────── */

function Report({ data, v }: { data: OpsPayload; v: View }) {
  const s = summarize(data, v)
  const { isNext, T, mw, targetPct, amberPct, cogsTargetPct } = s
  const take = verdict(data, v, s)

  const cols: Col[] = [
    { key: 'day', head: 'Day' },
    { key: 'wx', head: 'Weather' },
    { key: 'splan', head: 'Plan', num: true, divider: true, group: 'Sales' },
    { key: 'sact', head: isNext ? 'Forecast' : 'Act / Fcst', num: true, group: 'Sales' },
    { key: 'svar', head: 'Var', num: true, group: 'Sales', derive: 'none' },
    { key: 'spy', head: 'PY', num: true, group: 'Sales' },
    { key: 'hplan', head: 'Plan', num: true, divider: true, group: 'Labor hours' },
    { key: 'hact', head: 'Act / Sched', num: true, group: 'Labor hours' },
    { key: 'hvar', head: 'Var', num: true, group: 'Labor hours', derive: 'none' },
    { key: 'lpplan', head: 'Target', num: true, divider: true, group: 'Labor %' },
    { key: 'lpact', head: 'Act / Est', num: true, group: 'Labor %', derive: 'none' },
    { key: 'action', head: 'Action', divider: true, nowrap: true },
  ]

  const tone = (t: 'good' | 'warn' | 'bad', text: string) => (
    <span className={`sk-tone-${t}`} style={{ color: 'var(--tone)' }}>{text}</span>
  )
  // Green = good. Hours over plan is bad; sales over plan is good — polarity is per
  // metric, exactly as the old varClass(overIsBad) argument had it.
  const varTone = (n: number, overIsBad = false) =>
    Math.abs(n) < 1e-9 ? 'good' : overIsBad ? (n > 0 ? 'bad' : 'good') : n < 0 ? 'bad' : 'good'

  const rows: Row[] = s.days.map(d => ({
    key: d.day,
    proj: d.type === 'PROJ',
    cells: [
      d.day,
      <span key="wx" className={d.anomaly ? 'sk-tone-warn' : undefined} style={d.anomaly ? { color: 'var(--tone)' } : undefined}>
        {d.weather.temp} {d.weather.condition}
      </span>,
      money(d.salesPlan),
      money(d.salesActual),
      tone(varTone(d.salesVar), sMoney(d.salesVar)),
      d.salesPY ? money(d.salesPY) : <UnknownValue key="py" reason="No prior-year sales for this date." label="—" />,
      d.hoursPlan.toFixed(1),
      d.hoursActual.toFixed(1),
      tone(varTone(d.hoursVar, true), sHrs(d.hoursVar)),
      `${d.laborPctPlan.toFixed(1)}%`,
      tone(laborTone(d.laborPctAct, targetPct, amberPct), `${d.laborPctAct.toFixed(1)}%`),
      actionFor(d, targetPct, amberPct),
    ],
    values: [null, null, d.salesPlan, d.salesActual, null, d.salesPY, d.hoursPlan, d.hoursActual, null, null, null, null],
  }))

  rows.push({
    key: 'total',
    total: true,
    cells: [
      'Total', '',
      money(T.splan), money(T.sact), tone(varTone(s.tSalesVar), sMoney(s.tSalesVar)),
      T.spy ? money(T.spy) : <UnknownValue key="tpy" reason="No prior-year sales for this week." label="—" />,
      T.hplan.toFixed(1), T.hact.toFixed(1), tone(varTone(s.tHrsVar, true), sHrs(s.tHrsVar)),
      `${s.tPctPlan.toFixed(1)}%`,
      tone(laborTone(s.tPctAct, targetPct, amberPct), `${s.tPctAct.toFixed(1)}%`),
      'Full-week plan vs projected',
    ],
    values: [null, null, T.splan, T.sact, null, T.spy, T.hplan, T.hact, null, null, null, null],
  })

  // One track scale across all three bars, so their lengths are comparable.
  const barMax = Math.max(s.primePct, s.primeTargetPct) * 1.1

  return (
    <>
      <TakeCard tone={take.tone} label={take.label} headline={take.headline}>
        {take.why}
      </TakeCard>

      <FlagList flags={flagsFor(data, s)} emptyNote="No day is over the labor target and food cost is inside plan." />

      <Tiles>
        {isNext ? (
          <>
            <Tile label="Forecast sales" value={money(T.sact)} target={T.spy ? `${sPct(((T.sact - T.spy) / T.spy) * 100)} vs last year` : 'no prior year'} />
            <Tile label="Planned labor" value={money(T.lcost)} target={`budget ${money(s.laborPlan$)} at ${targetPct.toFixed(0)}%`}
              tone={T.lcost - s.laborPlan$ > 1 ? 'bad' : 'good'} />
            <Tile label="Labor %, planned" value={`${s.tPctAct.toFixed(1)}%`} target={`target ${targetPct.toFixed(0)}%`}
              tone={laborTone(s.tPctAct, targetPct, amberPct)} />
            <Tile label="Food budget" value={money(s.cogsPlan$)} target={`${cogsTargetPct.toFixed(1)}% of forecast`} />
          </>
        ) : (
          <>
            <Tile label="Sales, week to date" value={money(mw.sact)} target={`plan ${money(mw.splan)} · ${sMoney(s.mwSalesVar)}`}
              tone={Math.abs(s.mwSalesVar) < 1 ? undefined : s.mwSalesVar < 0 ? 'bad' : 'good'} />
            <Tile label="Labor cost, week to date" value={money(mw.lcost)} target={`plan ${money(mw.lcostPlan)} · ${sMoney(s.mwLaborVar)}`}
              tone={Math.abs(s.mwLaborVar) < 1 ? undefined : s.mwLaborVar > 0 ? 'bad' : 'good'} />
            <Tile label="Labor % pacing" value={`${s.paceAct.toFixed(1)}%`} target={`plan ${s.paceTarget.toFixed(1)}% · ${sPct(s.paceDrift)} pts`}
              tone={laborTone(s.paceAct, targetPct, amberPct)} hero />
            <Tile label="Food cost" value={`${s.cogsPct.toFixed(1)}%`}
              target={data.cogsWindow
                ? `${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)} · target ${cogsTargetPct.toFixed(1)}%`
                : `target ${cogsTargetPct.toFixed(1)}%`}
              tone={s.cogsDrift > 0.05 ? 'warn' : 'good'} />
          </>
        )}
      </Tiles>

      <div className="sk-card">
        <h3 className="sk-card-title">Cost against plan</h3>
        <p className="sk-meta" style={{ margin: '4px 0 16px' }}>
          recipe COGS ·{' '}
          {data.cogsWindow
            ? `measured ${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)} (${data.cogsWindow.days}d)`
            : 'projected week'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <TargetBar label="Food (COGS)" value={s.cogsPct} target={cogsTargetPct} max={barMax} tone={s.cogsDrift > 0.05 ? 'warn' : 'good'}
            detail={<><span>{money(s.cogsAct$)} of {money(s.cogsPlan$)} budget</span><span>target {cogsTargetPct.toFixed(1)}%</span></>} />
          {v.orders.length > 1 && (
            <div className="sk-meta" style={{ marginTop: 'calc(-1 * var(--space-2))' }}>
              per order — {v.orders.map(o => `${o.day} ${money(o.target)} (${o.covers})`).join(' · ')}
            </div>
          )}
          <TargetBar label="Labor" value={s.laborPct} target={s.laborTargetPct} max={barMax} tone={laborTone(s.laborPct, targetPct, amberPct)}
            detail={<><span>{money(T.lcost)} of {money(s.laborPlan$)} budget</span><span>target {s.laborTargetPct.toFixed(1)}%</span></>} />
          <TargetBar label="Prime — food + labor" value={s.primePct} target={s.primeTargetPct} max={barMax} tone={s.primePct > s.primeTargetPct ? 'warn' : 'good'}
            detail={<><span>{money(s.primeAct$)} of {money(s.primePlan$)} budget</span><span>target {s.primeTargetPct.toFixed(1)}%</span></>} />
        </div>
        {s.transferPct >= 15 && (
          <p className="sk-basis" style={{ marginTop: 'var(--space-4)' }}>
            About {Math.round(s.transferPct)}% of {v.name === 'All stores' ? 'Margate' : 'this store'}’s shelf-stable need is met by
            transfers from Pines and Miramar rather than a direct order, which holds food cost without extra buys.
          </p>
        )}
      </div>

      <div className="sk-card">
        <h3 className="sk-card-title">The week, day by day</h3>
        <p className="sk-meta" style={{ margin: '4px 0 12px' }}>
          italic rows are forecast, not measured
        </p>
        <DataTable cols={cols} rows={rows} caption="Weekly operations detail by day" />
      </div>

      <BasisNote>
        Same method as the daily recap: estimated labor is scheduled cost ÷ forecast sales, graded at
        {' '}{targetPct.toFixed(0)}% with an amber band to {amberPct.toFixed(0)}%, on a holiday-adjusted forecast.
        {' '}Food cost is <b>theoretical</b> — recipe usage × last known unit cost ÷ net sales over{' '}
        {data.cogsWindow
          ? `${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)}, the ${data.cogsWindow.days} day${data.cogsWindow.days === 1 ? '' : 's'} usage actually exists for`
          : 'the latest NetChef inventory week'}
        {data.cogsWindow && data.cogsWindow.unpriced > 0
          ? ` (${data.cogsWindow.unpriced} product${data.cogsWindow.unpriced === 1 ? '' : 's'} had usage we could not price, so the rate is fractionally low)`
          : ''}. The {cogsTargetPct.toFixed(1)}% food target is <b>derived</b> — this {v.name === 'All stores' ? 'group' : 'store'}’s
        {' '}recipe run-rate over {data.cogsWeeks ?? 1} week{(data.cogsWeeks ?? 1) === 1 ? '' : 's'} minus a 0.5-point improvement goal.
        {v.orders.length > 1 && <> Per-order targets split that budget across each delivery by its window’s forecast demand — the same curve as the order guide, so the Friday order runs larger than Tuesday’s.</>}
        {' '}A typical actual PFG order runs {money(v.otbBase)}.
        {data.holidays.length > 0 && <> {data.holidays.map(h => `${h.name} (${h.day})`).join(', ')} falls in this week; the forecast is holiday-adjusted from last year, as the daily recap does.</>}
        {s.hotDays.length > 0 && <> Every reading over 85°F lifts demand — {s.hotDays.length === s.days.length ? 'the whole week is above it' : `${s.hotDays.join(', ')} clear it`}, so protect peak and hold off-peak.</>}
        {s.rainDays.length > 0 && <> Rain is forecast on {s.rainDays.join(', ')} — watch AM traffic.</>}
      </BasisNote>
    </>
  )
}
