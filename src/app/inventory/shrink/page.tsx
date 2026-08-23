'use client'

/**
 * Shrink — usage variance for one completed inventory period.
 *
 * THE FRAMING RULE, which the redesign preserves deliberately. Gross shrink read
 * alone is alarmist: counting noise lands on BOTH sides and largely cancels, so the
 * screen leads with NET and shows short/over beneath it. On a modelled period our
 * recipe usage is also known to over-count substitutable bases and hand-portioned
 * toppings, which inflates the OVER side specifically. A single period is never
 * evidence — the same item going short period after period is.
 *
 * NO NEW BUSINESS RULES. There is no "shrink is bad above X%" threshold anywhere in
 * this app, and the redesign does not invent one. So the take is DESCRIPTIVE — it
 * names the largest mover and where it sits — and its tone follows the sign of the
 * net gap, which is a fact about the number rather than a grade against a target.
 * Nothing here reads a threshold, so nothing here needs one from core/targets.
 */
import { useState, useEffect, useMemo } from 'react'
import { Section, TakeCard, Tile, Tiles } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'
import type { ShrinkPayload, ShrinkRow } from '@/lib/shrink'
import type { OrderGuidePayload } from '@/lib/orderGuide'
import { BIAS_NOTE } from '@/lib/netchefTiers'

/** How many throughput rows to print. A display cap, not a business rule — every item
 *  still counts toward shrink and toward the order screen; this only decides how far
 *  down the fastest-movers list is worth reading. */
const THROUGHPUT_ROWS = 25

const STORE_OPTS = [
  { value: 'All', label: 'All' },
  { value: 'Pines', label: 'Pines' },
  { value: 'Miramar', label: 'Miramar' },
  { value: 'Margate', label: 'Margate' },
] as const
type StoreOpt = typeof STORE_OPTS[number]['value']

/**
 * THROUGHPUT — how fast stock moves, and how long what is on the shelf lasts.
 *
 * Moved here from Actions & watchlist, which is now only about what is missing. It sits
 * on the shrink screen because both answer "what happened to the stock" rather than
 * "what do I buy", and consumption rate is the denominator shrink is measured against.
 *
 * IT IS NOT THE SHRINK PERIOD, and says so on screen. Shrink measures one COMPLETED
 * count period; this is a trailing per-day rate over a rolling window, projected forward.
 * Presenting them as one timeframe would invite reading a days-of-supply figure as
 * something the count period established, which it did not. Two windows, labelled.
 */
function Throughput({ scope }: { scope: string }) {
  const [data, setData] = useState<OrderGuidePayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/inventory/watchlist')
      .then(r => r.json())
      .then(d => (d.error ? setFailed(true) : setData(d)))
      .catch(() => setFailed(true))
  }, [])

  // Fastest movers first — the items whose rate actually drives the food line. Scoped to
  // the nightly-counted set, since a days-of-supply figure over an uncounted item's
  // carried book number is arithmetic on a guess.
  const rows = useMemo(() => {
    if (!data) return []
    return data.rows
      .filter(r => r.nightlyTracked && r.forecastWeeklyUsage > 0
                && (scope === 'All' || r.store === scope))
      .sort((a, b) => b.weeklyValue - a.weeklyValue)
      .slice(0, THROUGHPUT_ROWS)
  }, [data, scope])

  if (failed) return null
  if (!data) {
    return (
      <Section label="Throughput">
        <div className="sk-card"><p className="sk-flags-empty">Loading consumption rates…</p></div>
      </Section>
    )
  }
  if (rows.length === 0) return null

  return (
    <Section
      label="Throughput · consumption rate and days of supply"
      aside={<span className="sk-meta">trailing {data.usageWindowDays} days — not the count period above</span>}
    >
      <div className="sk-card">
        <DataTable
          caption="Weekly consumption, days of supply, and which usage basis each figure rests on"
          cols={[
            { key: 'item', head: 'Item', nowrap: true },
            ...(scope === 'All' ? [{ key: 'store', head: 'Store' }] : []),
            { key: 'usage', head: 'Wk usage', num: true, derive: 'none' },
            { key: 'onHand', head: 'On hand', num: true, derive: 'none' },
            { key: 'days', head: 'Days left', num: true, derive: 'none' },
            { key: 'basis', head: 'Basis' },
          ]}
          rows={rows.map<Row>(r => ({
            key: `${r.store}|${r.productNumber}`,
            cells: [
              <span key="i" title={r.productName}>
                {r.productName}
                {r.hot && <span className="pill pill-teal" style={{ marginLeft: 6 }}>hot</span>}
              </span>,
              ...(scope === 'All' ? [r.store] : []),
              <span key="u">{qty(r.forecastWeeklyUsage)} <span className="sk-take-why">{r.unit}</span></span>,
              qty(r.onHand),
              /* Days left is the one figure here that is forward-looking; tone it when a
                 truck cannot plausibly beat it, but the ORDER decision lives on the
                 watchlist — this is here to explain the rate, not to reissue the verdict. */
              <span key="d" data-tone={r.flag === 'urgent' ? 'bad' : undefined}>
                {r.daysOfSupply != null ? r.daysOfSupply.toFixed(1) : '—'}
              </span>,
              /* The whole point of showing basis: a count-derived rate and a recipe-derived
                 one are different kinds of claim and should never look identical. */
              r.usageBasis === 'theoretical'
                ? <span key="b" className="pill pill-gray" title={`no usable count history — rate derived from recipes (${qty(r.theoreticalUsage)}/wk)`}>recipe</span>
                : r.usageBasis === 'theoretical-guard'
                  ? <span key="b" className="pill pill-yellow" title={`counts implied ${qty(r.countUsage)}/wk against ${qty(r.theoreticalUsage)}/wk from recipes — the count is not believable, so the recipe figure is used`}>count rejected</span>
                  : <span key="b" className="pill pill-green" title={`from counts; recipes suggest ${qty(r.theoreticalUsage)}/wk`}>counted</span>,
            ],
            values: [null, ...(scope === 'All' ? [null] : []),
                     r.forecastWeeklyUsage, r.onHand, r.daysOfSupply, null],
          }))}
        />
        <p className="sk-take-why" style={{ marginTop: 'var(--space-3)' }}>
          The {THROUGHPUT_ROWS} items carrying the most weekly consumption value, nightly-counted
          only. <b>Wk usage</b> is a per-day rate over the trailing {data.usageWindowDays} days
          scaled to a week and adjusted for the current demand run-rate, so it is what the item
          is expected to burn now rather than what it burned during the count period above.
          <b> Days left</b> divides what is on the shelf by that rate. <b>Basis</b> says where
          the rate came from: counted where there is enough count history, recipe-derived
          otherwise, and <i>count rejected</i> where a count implied several times what the
          recipes can account for. This window is not the shrink period — the two answer
          different questions and are deliberately not reconciled to each other.
        </p>
      </div>
    </Section>
  )
}

const money = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const money2 = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
const pct = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1) + '%'
const md = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * Inline diverging bar — zero at centre, short left, over right.
 *
 * Uses the kit's validated diverging pair rather than its own hex. The previous
 * build carried #dc2626/#0d9488 locally, which is exactly the drift tokens exist to
 * stop: two screens showing "loss" in two different reds.
 */
function VarianceBar({ value, max }: { value: number; max: number }) {
  const frac = max > 0 ? Math.min(Math.abs(value) / max, 1) : 0
  const neg = value < 0
  return (
    <div className="sk-divbar" aria-hidden="true">
      <i className="sk-divbar-axis" />
      <i
        className="sk-divbar-fill"
        style={{
          background: neg ? 'var(--ramp-diverging-bad)' : 'var(--ramp-diverging-good)',
          width: `${frac * 50}%`,
          ...(neg ? { right: '50%', marginRight: 1 } : { left: '50%', marginLeft: 1 }),
        }}
      />
    </div>
  )
}

/** A row's caveat, in the vocabulary that is actually true of it. */
function RowFlag({ row }: { row: ShrinkRow }) {
  if (row.unsourced)
    return <span className="sk-pill sk-tone-bad" title={row.tierNote ?? ''}>no opening count</span>
  if (row.tier === 'D')
    return <span className="sk-pill sk-tone-bad" title={row.tierNote ?? ''}>unmodelled</span>
  if (row.tier === 'C')
    return <span className="sk-pill sk-tone-warn" title={row.tierNote ?? ''}>low confidence</span>
  return null
}

const STORE_COLS: Col[] = [
  { key: 'store', head: 'Store' },
  { key: 'net', head: 'Net', num: true },
  { key: 'short', head: 'Short', num: true },
  { key: 'over', head: 'Over', num: true },
  { key: 'usage', head: 'Expected usage', num: true, divider: true },
  { key: 'pctUsage', head: 'Net % of usage', num: true, derive: 'none' },
]

const GAP_COLS: Col[] = [
  { key: 'item', head: 'Item' },
  { key: 'store', head: 'Store' },
  { key: 'expected', head: 'Expected use', num: true },
  { key: 'actual', head: 'Actual use', num: true },
  { key: 'gap', head: 'Gap', num: true, divider: true },
  { key: 'bar', head: '', derive: 'none' },
  { key: 'cost', head: 'Cost', num: true, derive: 'none' },
]

export default function ShrinkPage() {
  const [data, setData] = useState<ShrinkPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<StoreOpt>('All')
  const [reliableOnly, setReliableOnly] = useState(true)
  const [shortOnly, setShortOnly] = useState(true)
  const [period, setPeriod] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/inventory/shrink${period ? `?periodEnd=${period}` : ''}`)
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period])

  const modelled = data?.usageBasis === 'modelled'

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(r =>
      (store === 'All' || r.store === store) &&
      (!reliableOnly || (!r.unsourced && (r.tier === 'A' || r.tier === 'B'))) &&
      (!shortOnly || r.varianceDollars < 0))
  }, [data, store, reliableOnly, shortOnly])

  const maxAbs = useMemo(() => Math.max(1, ...rows.map(r => Math.abs(r.varianceDollars))), [rows])
  const shown = rows.slice(0, 60)

  const summary = data
    ? (store === 'All' ? data.totals : data.stores.find(s => s.store === store) ?? data.totals)
    : null

  return (
    <>
      {/* The module header above already carries the title; a second PageBar here
          would stack two of them. These are this SCREEN's filters, which is where
          they belong — the module's calendar timeframe does not govern shrink. */}
      <div className="sk-filterbar">
        <SegControl label="Store" options={[...STORE_OPTS]} value={store} onChange={setStore} />
        {data && (
          <select
            className="sk-select"
            value={period || data.periodEnd}
            onChange={e => setPeriod(e.target.value)}
            aria-label="Inventory period"
          >
            {data.availablePeriods.map(p => (
              <option key={p.periodEnd} value={p.periodEnd}>
                {md(p.periodStart)} – {md(p.periodEnd)}{p.basis === 'modelled' ? ' · modelled' : ''}
              </option>
            ))}
          </select>
        )}
        <label className="sk-checkbox">
          <input type="checkbox" checked={shortOnly} onChange={e => setShortOnly(e.target.checked)} />
          losses only
        </label>
        <label className="sk-checkbox">
          <input type="checkbox" checked={reliableOnly} onChange={e => setReliableOnly(e.target.checked)} />
          {modelled ? 'hide low-confidence items' : 'hide unsourced counts'}
        </label>
        {data && (
          <span className="sk-meta sk-filterbar-meta">
            {md(data.periodStart)} – {md(data.periodEnd)} · {data.periodDays} days ·{' '}
            {modelled ? 'usage modelled from recipes' : 'usage as CrunchTime reports it'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="sk-card"><p className="sk-flags-empty">Counting…</p></div>
      ) : !data || !summary ? (
        <div className="sk-card">
          <p className="sk-flags-empty">
            No completed inventory period yet. Shrink is measured over a full count period —
            the nightly hot-list counts are a different signal, read by the order guide.
          </p>
        </div>
      ) : (
        <Report data={data} summary={summary} rows={shown} total={rows.length}
                maxAbs={maxAbs} modelled={!!modelled} scope={store} />
      )}
    </>
  )
}

function Report({ data, summary, rows, total, maxAbs, modelled, scope }: {
  data: ShrinkPayload
  summary: NonNullable<ShrinkPayload['totals']>
  rows: ShrinkRow[]
  total: number
  maxAbs: number
  modelled: boolean
  scope: string
}) {
  // The take is derived, never authored. It names the store carrying the gap and
  // the single item behind most of it, because those are the two things a manager
  // can actually go and look at.
  const worstStore = [...data.stores].sort((a, b) => a.netDollars - b.netDollars)[0]
  const worstItem = data.rows.filter(r => !r.unsourced && r.varianceDollars < 0)[0]
  const net = summary.netDollars

  const headline = net < 0
    ? `${scope === 'All' ? 'The portfolio' : scope} came up ${money(-net)} short this period.`
    : `${scope === 'All' ? 'The portfolio' : scope} counted ${money(net)} more than the books expected.`

  return (
    <>
      <TakeCard tone={net < 0 ? 'bad' : 'neutral'} label={net < 0 ? 'Short' : 'Over'} headline={headline}>
        {worstStore && scope === 'All' && worstStore.netDollars < 0 ? (
          <>{worstStore.store} carries the most of it at {money(worstStore.netDollars)}
          {worstStore.netPctOfUsage != null ? ` (${pct(worstStore.netPctOfUsage)} of its usage)` : ''}. </>
        ) : null}
        {worstItem ? (
          <>The largest single gap is {worstItem.productName} at {worstItem.store},
          {' '}{money2(worstItem.varianceDollars)}. </>
        ) : null}
        Read the net, not the gross — counting noise lands on both sides and mostly cancels
        {modelled ? ', and modelled usage pushes the over side up specifically' : ''}.
        One period is not evidence; the same item short period after period is.
      </TakeCard>

      <Section label={`Summary · ${md(data.periodStart)} – ${md(data.periodEnd)}`}>
        <Tiles>
          <Tile
            label="Net gap"
            value={money(summary.netDollars)}
            tone={summary.netDollars < 0 ? 'bad' : undefined}
            hero
            target={summary.netPctOfUsage != null ? `${pct(summary.netPctOfUsage)} of usage` : undefined}
          />
          <Tile
            label="Short"
            value={money(summary.shrinkDollars)}
            tone="bad"
            target={modelled
              ? `${money(summary.reliableShrinkDollars)} on confident items`
              : `across ${summary.shortLines} of ${summary.rowCount} lines`}
          />
          <Tile
            label="Over"
            value={money(summary.overageDollars)}
            target="counted more than books expected"
          />
          <Tile
            label={modelled ? 'Modelled usage' : 'Expected usage'}
            value={money(summary.usageDollars)}
            target={modelled ? 'our recipe model, at cost' : 'CrunchTime’s figure, at cost'}
          />
        </Tiles>
      </Section>

      {scope === 'All' && (
        <Section label="By store">
          <div className="sk-card">
            <DataTable
              caption="Net, short and over by store for the period"
              cols={STORE_COLS}
              rows={data.stores.map<Row>(s => ({
                key: s.store,
                cells: [
                  s.store,
                  <b key="n" data-tone={s.netDollars < 0 ? 'bad' : undefined}>{money(s.netDollars)}</b>,
                  money(s.shrinkDollars),
                  money(s.overageDollars),
                  money(s.usageDollars),
                  s.netPctOfUsage != null ? pct(s.netPctOfUsage) : '—',
                ],
                values: [null, s.netDollars, s.shrinkDollars, s.overageDollars, s.usageDollars, null],
              }))}
            />
          </div>
        </Section>
      )}

      <Section
        label="Biggest gaps"
        aside={
          <div className="sk-legend">
            <span><i className="sk-dot" style={{ background: 'var(--ramp-diverging-bad)' }} /> short</span>
            <span><i className="sk-dot" style={{ background: 'var(--ramp-diverging-good)' }} /> over</span>
            {total > rows.length && <span className="sk-meta">top {rows.length} of {total}</span>}
          </div>
        }
      >
        <div className="sk-card">
          {rows.length ? (
            <DataTable
              caption="Largest usage variances for the period, by dollar impact"
              cols={GAP_COLS}
              rows={rows.map<Row>(r => ({
                key: `${r.store}-${r.productNumber}`,
                cells: [
                  <span key="i">
                    <span>{r.productName}</span>
                    <span className="sk-meta"> {r.productNumber}{r.unit ? ` · ${r.unit}` : ''}</span>
                    {' '}<RowFlag row={r} />
                  </span>,
                  r.store,
                  qty(r.theoretical),
                  qty(r.actual),
                  qty(r.variance),
                  <VarianceBar key="b" value={r.varianceDollars} max={maxAbs} />,
                  <b key="c" data-tone={r.varianceDollars < 0 ? 'bad' : 'good'}>{money2(r.varianceDollars)}</b>,
                ],
                values: [null, null, r.theoretical, r.actual, r.variance, null, r.varianceDollars],
              }))}
            />
          ) : (
            <p className="sk-flags-empty">Nothing matches these filters.</p>
          )}
        </div>
      </Section>

      <Throughput scope={scope} />

      <Section label="Method">
        <div className="sk-card">
          <h3 className="sk-card-title">How this is calculated</h3>
          <p className="sk-take-why">
            Book stock = opening count + deliveries received − expected usage. The gap is the
            physical count minus that book figure, so a negative gap means product left without
            being sold. Only completed count periods appear here ({data.periodDays} days for this
            one); the nightly hot-list counts are too short to difference this way.{' '}
            {modelled ? (
              <>Expected usage for this period is derived from CrunchTime recipes × items actually
              rung up, not from CrunchTime&rsquo;s own report — it agreed with theirs to a 1.4%
              median across all three stores for the validation week, but it is an estimate.{' '}
              {BIAS_NOTE} Items where the model is weakest are tagged and hidden by default.</>
            ) : (
              <>Expected usage for this period is CrunchTime&rsquo;s own figure, so no recipe model
              sits between the count and the gap.</>
            )}{' '}
            {data.emptyLines > 0 && `${data.emptyLines} blank template lines were dropped as carrying no information.`}
          </p>
        </div>
      </Section>
    </>
  )
}
