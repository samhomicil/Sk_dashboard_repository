'use client'

/**
 * WEEKLY OPS — rebuilt to the reference implementation in
 * design_handoff_sk_dashboard/ui_kits/sk-dashboard/index.html (#opsreport).
 *
 * Structure is the kit's, not the generic module-contract anatomy: this screen has
 * NO TakeCard and NO FlagList. It groups under brand-coloured eyebrows —
 *
 *   PageBar                     title + store seg + this/next week (strong)
 *   Summary · week to date      four stat cards
 *   Weekly detail               actual/forecast dot legend + the day table
 *   Notes & actions             "Week in brief" prose | "Cost vs plan" bullets
 *
 * The first pass applied the contract's general anatomy instead and grew a verdict
 * card and a flag list this screen does not have. The kit wins: it was drawn from
 * these exact screens, and the contract's anatomy is the default for screens the
 * kit does not cover.
 *
 * NO NUMBER CHANGED. Every figure comes from ./derive.ts — the old page's
 * arithmetic moved out untouched — fed by the same /api/ops-week payload.
 * Thresholds ride in on that payload from src/lib/core/targets.ts.
 */
import { useState, useEffect, useMemo } from 'react'
import { swrGet, swrSet } from '@/lib/swrCache'
import { Page, PageBar, Section, Stat, Grid4, Grid11 } from '@/components/design/shell'
import { SegControl, TargetBar } from '@/components/design/controls'
import { UnknownValue } from '@/components/design/states'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'
import {
  buildViews, summarize, actionFor, laborTone, bulletTone, shortDay, money, sMoney, sPct, sHrs,
  type OpsPayload, type View, type Summary,
} from './derive'

// Kit order: All Stores first, then the stores. Store scope is routine, so it is
// the plain control; this/next week flips the whole report between a review and a
// plan, which is the screen's primary decision, so it gets the strong variant.
const STORE_OPTS = [
  { value: 'all', label: 'All Stores' },
  { value: 'margate', label: 'Margate' },
  { value: 'miramar', label: 'Miramar' },
  { value: 'pines', label: 'Pines' },
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
        title="Weekly Operations Report"
        meta={data ? `${v?.name ?? ''} · ${data.weekLabel} · ${data.weekMode === 'next' ? 'next-week plan, all forecast' : 'actual to today, forecast after'}` : null}
      >
        <SegControl label="Store" options={STORE_OPTS} value={store} onChange={setStore} />
        <SegControl label="Week" options={WEEK_OPTS} value={week} onChange={setWeek} strong />
      </PageBar>

      {loading ? (
        <div className="sk-card"><p className="sk-flags-empty">Loading the week…</p></div>
      ) : !data || !v ? (
        <div className="sk-card"><p className="sk-flags-empty">No ops data — check the DB proxy / Azure connection.</p></div>
      ) : (
        <Report data={data} v={v} />
      )}
    </Page>
  )
}

function Report({ data, v }: { data: OpsPayload; v: View }) {
  const s = summarize(data, v)
  const { isNext, T, cogsTargetPct } = s

  return (
    <>
      <Section label={isNext ? 'Summary · next week (planned)' : 'Summary · week to date'}>
        <Grid4>{isNext ? nextWeekStats(s) : weekToDateStats(data, s)}</Grid4>
      </Section>

      <Section
        label="Weekly detail"
        aside={
          <div className="sk-legend">
            <span><i className="sk-dot solid" /> actual</span>
            <span><i className="sk-dot hollow" /> forecast</span>
          </div>
        }
      >
        <div className="sk-card">
          <DataTable cols={COLS(isNext)} rows={rowsFor(s)} caption="Weekly operations detail by day" />
        </div>
      </Section>

      <Section label="Notes & actions">
        <Grid11>
          <div className="sk-card">
            <h3 className="sk-card-title">{isNext ? 'Plan for next week' : 'Week in brief'}</h3>
            <Brief data={data} s={s} />
          </div>

          <div className="sk-card">
            <div className="sk-sechead">
              <h3 className="sk-card-title">Cost vs plan</h3>
              <span className="sk-meta">
                recipe COGS ·{' '}
                {data.cogsWindow
                  ? `measured ${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)} (${data.cogsWindow.days}d)`
                  : 'projected week'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginTop: 'var(--space-4)' }}>
              <TargetBar label="Food (COGS)" value={s.cogsPct} target={cogsTargetPct}
                tone={bulletTone(s.cogsPct, cogsTargetPct)}
                detail={<><span>{money(s.cogsAct$)} <span style={{ opacity: 0.6 }}>/ {money(s.cogsPlan$)} plan</span></span><span>target {cogsTargetPct.toFixed(1)}%</span></>} />
              <TargetBar label="Labor" value={s.laborPct} target={s.laborTargetPct}
                tone={bulletTone(s.laborPct, s.laborTargetPct)}
                detail={<><span>{money(T.lcost)} <span style={{ opacity: 0.6 }}>/ {money(s.laborPlan$)} plan</span></span><span>target {s.laborTargetPct.toFixed(1)}%</span></>} />
              <TargetBar label="Prime · food + labor" value={s.primePct} target={s.primeTargetPct}
                tone={bulletTone(s.primePct, s.primeTargetPct)}
                detail={<><span>{money(s.primeAct$)} <span style={{ opacity: 0.6 }}>/ {money(s.primePlan$)} plan</span></span><span>target {s.primeTargetPct.toFixed(1)}%</span></>} />
            </div>

            {v.orders.length > 1 && (
              <div className="sk-chips" style={{ marginTop: 'var(--space-4)' }}>
                <span className="sk-eyebrow">per order</span>
                {v.orders.map(o => (
                  <span key={o.day} className="sk-chip">
                    <b>{o.day}</b>
                    <span style={{ fontWeight: 600 }}>{money(o.target)}</span>
                    <span className="covers">· {o.covers}</span>
                  </span>
                ))}
              </div>
            )}

            {s.transferPct >= 15 && (
              <p className="sk-basis" style={{ marginTop: 'var(--space-4)' }}>
                About {Math.round(s.transferPct)}% of {v.name === 'All stores' ? 'Margate' : 'this store'}&rsquo;s shelf-stable need is met by
                transfers from Pines and Miramar rather than a direct order, which holds food cost without extra buys.
              </p>
            )}

            <Basis data={data} v={v} s={s} />
          </div>
        </Grid11>
      </Section>
    </>
  )
}

/* ── Summary stats ────────────────────────────────────────────────────────── */

function weekToDateStats(data: OpsPayload, s: Summary) {
  const { mw, targetPct, amberPct, cogsTargetPct } = s
  return (
    <>
      <Stat label="Sales · to date" value={money(mw.sact)} sub={`/ ${money(mw.splan)}`}
        delta={`${sMoney(s.mwSalesVar)} · ${sPct(s.mwSalesPct)}`}
        tone={Math.abs(s.mwSalesVar) < 1 ? 'neutral' : s.mwSalesVar < 0 ? 'bad' : 'good'} />
      <Stat label="Labor cost · to date" value={money(mw.lcost)} sub={`/ ${money(mw.lcostPlan)}`}
        delta={`${sMoney(s.mwLaborVar)} · ${sPct(s.mwLaborPct)}`}
        tone={Math.abs(s.mwLaborVar) < 1 ? 'neutral' : s.mwLaborVar > 0 ? 'bad' : 'good'} />
      <Stat label="Labor % pacing" value={`${s.paceAct.toFixed(1)}%`} sub={`vs ${s.paceTarget.toFixed(1)}%`}
        delta={`${sPct(s.paceDrift)} pts`} tone={laborTone(s.paceAct, targetPct, amberPct)} />
      <Stat label="COGS % pacing" value={`${s.cogsPct.toFixed(1)}%`}
        sub={data.cogsWindow
          ? `${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)} · vs ${cogsTargetPct.toFixed(1)}%`
          : `vs ${cogsTargetPct.toFixed(1)}%`}
        delta={`${sPct(s.cogsDrift)} pts`} tone={s.cogsDrift > 0.05 ? 'warn' : 'good'} />
    </>
  )
}

function nextWeekStats(s: Summary) {
  const { T, targetPct, amberPct, cogsTargetPct } = s
  return (
    <>
      <Stat label="Forecast sales" value={money(T.sact)} sub={T.spy ? `PY ${money(T.spy)}` : undefined}
        delta={T.spy ? `${sPct(((T.sact - T.spy) / T.spy) * 100)} YoY` : 'forecast'}
        tone={T.spy && T.sact < T.spy ? 'bad' : 'good'} />
      <Stat label="Planned labor $" value={money(T.lcost)} sub={`/ ${money(s.laborPlan$)} @ ${targetPct.toFixed(0)}%`}
        delta={sMoney(T.lcost - s.laborPlan$)} tone={T.lcost > s.laborPlan$ ? 'bad' : 'good'} />
      <Stat label="Labor % (planned)" value={`${s.tPctAct.toFixed(1)}%`} sub={`vs ${targetPct.toFixed(0)}%`}
        delta={`${sPct(s.tPctAct - targetPct)} pts`} tone={laborTone(s.tPctAct, targetPct, amberPct)} />
      <Stat label="Food budget" value={money(s.cogsPlan$)} sub={`@ ${cogsTargetPct.toFixed(1)}%`}
        delta={`of ${money(s.projSales)} forecast`} tone="neutral" />
    </>
  )
}

/* ── The day table ────────────────────────────────────────────────────────── */

const COLS = (isNext: boolean): Col[] => [
  { key: 'day', head: 'Day', nowrap: true },
  { key: 'wx', head: 'Weather', nowrap: true },
  { key: 'splan', head: 'Plan', num: true, divider: true, group: 'Sales' },
  { key: 'sact', head: isNext ? 'Forecast' : 'Act / fcst', num: true, group: 'Sales' },
  { key: 'svar', head: 'Var', num: true, group: 'Sales', derive: 'none' },
  { key: 'spy', head: 'PY', num: true, group: 'Sales' },
  { key: 'hplan', head: 'Plan', num: true, divider: true, group: 'Labor hours' },
  { key: 'hact', head: 'Act / sched', num: true, group: 'Labor hours' },
  { key: 'hvar', head: 'Var', num: true, group: 'Labor hours', derive: 'none' },
  { key: 'lpplan', head: 'Tgt', num: true, divider: true, group: 'Labor %' },
  { key: 'lpact', head: 'Act / est', num: true, group: 'Labor %', derive: 'none' },
  // Not nowrap: the kit lets the action sentence wrap. Pinning it to one line
  // pushes it past the card edge and clips the last word.
  { key: 'action', head: 'Action', divider: true },
]

const toned = (t: 'good' | 'warn' | 'bad', text: string) => (
  <span className={`sk-tone-${t}`} style={{ color: 'var(--tone)', fontWeight: 600 }}>{text}</span>
)
// Green = good. Hours over plan is bad; sales over plan is good — polarity is per
// metric, exactly as the old varClass(overIsBad) argument had it.
const varTone = (n: number, overIsBad = false): 'good' | 'bad' =>
  Math.abs(n) < 1e-9 ? 'good' : overIsBad ? (n > 0 ? 'bad' : 'good') : n < 0 ? 'bad' : 'good'

const muted = (text: string) => <span style={{ color: 'var(--ink-muted)' }}>{text}</span>

function rowsFor(s: Summary): Row[] {
  const { T, targetPct, amberPct } = s
  const rows: Row[] = s.days.map(d => ({
    key: d.day,
    proj: d.type === 'PROJ',
    cells: [
      <span key="d" style={{ fontWeight: 600 }}>
        <i className={`sk-dot ${d.type === 'PROJ' ? 'hollow' : 'solid'}`} style={{ marginRight: 8 }} />
        {d.day}
      </span>,
      <span key="wx" className={d.anomaly ? 'sk-tone-warn' : undefined} style={d.anomaly ? { color: 'var(--tone)' } : undefined}>
        {d.weather.temp} {d.weather.condition}
      </span>,
      money(d.salesPlan),
      money(d.salesActual),
      toned(varTone(d.salesVar), sMoney(d.salesVar)),
      d.salesPY ? muted(money(d.salesPY)) : <UnknownValue key="py" reason="No prior-year sales for this date." label="—" />,
      d.hoursPlan.toFixed(1),
      d.hoursActual.toFixed(1),
      toned(varTone(d.hoursVar, true), sHrs(d.hoursVar)),
      muted(`${d.laborPctPlan.toFixed(1)}%`),
      toned(laborTone(d.laborPctAct, targetPct, amberPct), `${d.laborPctAct.toFixed(1)}%`),
      muted(actionFor(d, targetPct, amberPct)),
    ],
    values: [null, null, d.salesPlan, d.salesActual, null, d.salesPY, d.hoursPlan, d.hoursActual, null, null, null, null],
  }))

  rows.push({
    key: 'total',
    total: true,
    cells: [
      'Total', muted('—'),
      money(T.splan), money(T.sact), toned(varTone(s.tSalesVar), sMoney(s.tSalesVar)),
      T.spy ? money(T.spy) : <UnknownValue key="tpy" reason="No prior-year sales for this week." label="—" />,
      T.hplan.toFixed(1), T.hact.toFixed(1), toned(varTone(s.tHrsVar, true), sHrs(s.tHrsVar)),
      `${s.tPctPlan.toFixed(1)}%`,
      toned(laborTone(s.tPctAct, targetPct, amberPct), `${s.tPctAct.toFixed(1)}%`),
      <span key="t" style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>Full-week plan vs projected</span>,
    ],
    values: [null, null, T.splan, T.sact, null, T.spy, T.hplan, T.hact, null, null, null, null],
  })
  return rows
}

/* ── Prose ────────────────────────────────────────────────────────────────── */

const b = (t: 'good' | 'warn' | 'bad', text: string) => (
  <b className={`sk-tone-${t}`} style={{ color: 'var(--tone)' }}>{text}</b>
)

/** Week in brief — the old page's wording, which is the daily recap's framing. */
function Brief({ data, s }: { data: OpsPayload; s: Summary }) {
  const { isNext, T, targetPct, amberPct, focus } = s
  return (
    <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-muted)', margin: '8px 0 0' }}>
      {isNext ? (
        <>Next week is forecast at <b>{money(T.sact)}</b> in sales{T.spy ? <> ({sPct(((T.sact - T.spy) / T.spy) * 100)} vs last year)</> : ''}.
          {' '}At the current schedule, labor runs {b(laborTone(s.tPctAct, targetPct, amberPct), `${s.tPctAct.toFixed(1)}%`)} vs the {targetPct.toFixed(0)}% target
          {s.tPctAct > targetPct ? <> — trim <b>{money(T.lcost - s.laborPlan$)}</b> in hours to land on plan.</> : <> — staffing is on plan.</>}</>
      ) : (
        <>Labor is pacing {b(laborTone(s.paceAct, targetPct, amberPct), `${s.paceAct.toFixed(1)}%`)} vs the {targetPct.toFixed(0)}% target
          {' '}({sPct(s.paceDrift)} pts, {sMoney(s.mwLaborVar)} week to date); sales are running{' '}
          {b(varTone(s.mwSalesVar), sMoney(s.mwSalesVar))} {s.mwSalesVar < 0 ? 'under' : 'over'} the staffing-implied plan.</>
      )}
      {focus
        ? <> Biggest lever ahead: <b>{focus.day}</b>&rsquo;s schedule runs an estimated <b>{focus.est.toFixed(0)}%</b> labor — about <b>{money(focus.over)}</b> over the {targetPct.toFixed(0)}% target, trimmable before doors open.</>
        : <> No upcoming day is projected over the {targetPct.toFixed(0)}% labor target — hold the schedule.</>}
      {s.hotDays.length > 0 && <> Heat ({s.hotDays.length === s.days.length ? 'all week' : s.hotDays.join(', ')}) lifts demand — protect peak, hold off-peak.</>}
      {s.rainDays.length > 0 && <> Rain in the forecast on {s.rainDays.join(', ')} — watch AM traffic.</>}
      {data.holidays.length > 0 && <> {data.holidays.map(h => `${h.name} (${h.day})`).join(', ')} — the forecast is holiday-adjusted from last year, same as the daily recap.</>}
      {data.warnings?.length > 0 && <> {data.warnings.join(' ')}</>}
    </p>
  )
}

/** The basis note — only what the panel above cannot say for itself. */
function Basis({ data, v, s }: { data: OpsPayload; v: View; s: Summary }) {
  const { cogsTargetPct, targetPct, amberPct } = s
  return (
    <p className="sk-basis" style={{ marginTop: 'var(--space-4)' }}>
      Food cost is <b>theoretical</b> — recipe usage × last known unit cost ÷ net sales over{' '}
      {data.cogsWindow
        ? `${shortDay(data.cogsWindow.start)}–${shortDay(data.cogsWindow.end)}, the ${data.cogsWindow.days} day${data.cogsWindow.days === 1 ? '' : 's'} usage actually exists for`
        : 'the latest NetChef inventory week'}
      {data.cogsWindow && data.cogsWindow.unpriced > 0
        ? ` (${data.cogsWindow.unpriced} product${data.cogsWindow.unpriced === 1 ? '' : 's'} had usage we could not price, so the rate is fractionally low)`
        : ''}. The {cogsTargetPct.toFixed(1)}% target is <b>derived</b> — this {v.name === 'All stores' ? 'group' : 'store'}&rsquo;s recipe
      {' '}run-rate over {data.cogsWeeks ?? 1} week{(data.cogsWeeks ?? 1) === 1 ? '' : 's'} minus a 0.5-point improvement goal.
      {v.orders.length > 1 && <> Per-order targets split that budget across each delivery by its window&rsquo;s forecast demand — the same curve as the order guide, so the Friday order runs larger than Tuesday&rsquo;s.</>}
      {' '}A typical actual PFG order runs {money(v.otbBase)}. Estimated labor is scheduled cost ÷ forecast sales, graded at{' '}
      {targetPct.toFixed(0)}% with an amber band to {amberPct.toFixed(0)}% — the same method as the daily recap.
    </p>
  )
}
