'use client'

import { useState, useEffect, useMemo } from 'react'
import type { ShrinkPayload, ShrinkRow } from '@/lib/shrink'
import { BIAS_NOTE } from '@/lib/netchefTiers'

// Diverging pair for the variance bar. Validated (light surface): chroma floor,
// CVD separation deutan ΔE 13.1, normal-vision ΔE 31.4, contrast >= 3:1.
// The app is light-only, so no dark steps are needed.
const SHORT = '#dc2626'   // counted less than the books say — product lost
const OVER  = '#0d9488'   // counted more than expected

const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const money2 = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
const md = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const STORE_TABS = ['All', 'Pines', 'Miramar', 'Margate'] as const

function TierBadge({ row }: { row: ShrinkRow }) {
  // An unsourced count is a paperwork artefact, not a weak model, so it gets its
  // own word — calling it "unmodelled" on a CrunchTime-reported week would be false.
  if (row.unsourced) return <span className="pill pill-red" title={row.tierNote ?? ''}>no opening count</span>
  if (row.tier === 'D') return <span className="pill pill-red" title={row.tierNote ?? ''}>unmodelled</span>
  if (row.tier === 'C') return <span className="pill pill-yellow" title={row.tierNote ?? ''}>low confidence</span>
  return null
}

/** Inline diverging bar: zero at centre, short to the left, overage to the right. */
function VarianceBar({ value, max }: { value: number; max: number }) {
  const frac = max > 0 ? Math.min(Math.abs(value) / max, 1) : 0
  const pct = frac * 50
  const neg = value < 0
  return (
    <div className="relative h-4 w-full min-w-[80px]" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
      <div
        className="absolute inset-y-[3px]"
        style={{
          background: neg ? SHORT : OVER,
          borderRadius: 4,
          right: neg ? '50%' : undefined,
          left: neg ? undefined : '50%',
          width: `${pct}%`,
          marginRight: neg ? 1 : undefined,
          marginLeft: neg ? undefined : 1,
        }}
      />
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'ok' }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${tone === 'bad' ? 'text-red-600' : 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function ShrinkPage() {
  const [data, setData] = useState<ShrinkPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<typeof STORE_TABS[number]>('All')
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

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(r =>
      (store === 'All' || r.store === store) &&
      (!reliableOnly || r.tier === 'A' || r.tier === 'B') &&
      (!shortOnly || r.varianceDollars < 0))
  }, [data, store, reliableOnly, shortOnly])

  const maxAbs = useMemo(() => Math.max(1, ...rows.map(r => Math.abs(r.varianceDollars))), [rows])
  const shown = rows.slice(0, 60)

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>
  if (!data) return (
    <div className="card p-4 text-sm text-slate-600">
      No completed inventory period yet. Shrink is measured over a full count period —
      the nightly hot-list counts are a different signal and are read by the order guide,
      not here.
    </div>
  )

  const summary = store === 'All' ? data.totals : (data.stores.find(s => s.store === store) ?? data.totals)
  // On a 'reported' period the usage figure is CrunchTime's own, so the tiers and
  // the modelling caveat below simply do not apply and must not be shown.
  const modelled = data.usageBasis === 'modelled'

  return (
    <div className="space-y-4">
      {/* filters — one row above the content */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STORE_TABS.map(t => (
            <button key={t} onClick={() => setStore(t)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                store === t ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {t}
            </button>
          ))}
        </div>
        {/* Label the real span. The old "week ending X" was a guess that held
            until the nightly counts arrived, at which point it cheerfully called
            a single evening a week. */}
        <select value={period || data.periodEnd} onChange={e => setPeriod(e.target.value)}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700">
          {data.availablePeriods.map(p => (
            <option key={p.periodEnd} value={p.periodEnd}>
              {md(p.periodStart)} – {md(p.periodEnd)}{p.basis === 'modelled' ? ' · modelled' : ''}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-1">
          <input type="checkbox" checked={shortOnly} onChange={e => setShortOnly(e.target.checked)} />
          losses only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={reliableOnly} onChange={e => setReliableOnly(e.target.checked)} />
          {modelled ? 'hide low-confidence items' : 'hide unsourced counts'}
        </label>
      </div>

      {/* NET first, deliberately. Gross shrink read alone is alarmist: counting
          noise lands on both sides and largely cancels, and our modelled usage
          is known to over-count, which inflates the OVER side specifically. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Net gap" value={money(summary.netDollars)}
              tone={summary.netDollars < 0 ? 'bad' : undefined}
              sub={`${md(data.periodStart)} – ${md(data.periodEnd)} · ${data.periodDays} days · ${
                summary.netPctOfUsage != null ? (summary.netPctOfUsage > 0 ? '+' : '') + summary.netPctOfUsage.toFixed(1) + '% of usage' : '—'}`} />
        {/* "on confident items" is only worth the line when the model is what is
            being doubted. On a reported period every sourced row is tier A, so
            the subline would just restate the headline. */}
        <Tile label="Short" value={money(summary.shrinkDollars)} tone="bad"
              sub={modelled
                ? `${money(summary.reliableShrinkDollars)} on confident items`
                : `across ${summary.shortLines} of ${summary.rowCount} lines`} />
        <Tile label="Over" value={money(summary.overageDollars)}
              sub="counted more than books expected" />
        <Tile label={modelled ? 'Modelled usage' : 'Expected usage'} value={money(summary.usageDollars)}
              sub={modelled ? 'our recipe model, at cost' : 'CrunchTime’s figure, at cost'} />
      </div>

      <div className="card p-3 bg-amber-50 border-amber-200 text-[11px] text-amber-900 leading-relaxed">
        <span className="font-semibold">Read the net figure, not the gross.</span> Short and Over
        are both inflated by ordinary counting noise, which mostly cancels out.{' '}
        {modelled && <>Expected usage on this period is <em>modelled</em> and is known to run high on
        substitutable bases and hand-portioned toppings, and that bias pushes the <em>Over</em> side
        up specifically.{' '}</>}
        A single period is not evidence — what matters is the same item going short period
        after period.
      </div>

      {store === 'All' && (
        <div className="card p-3">
          <div className="text-xs font-semibold text-slate-700 mb-2">By store</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="font-medium pb-1">Store</th>
                <th className="font-medium pb-1 text-right">Net</th>
                <th className="font-medium pb-1 text-right">Short</th>
                <th className="font-medium pb-1 text-right">Over</th>
                <th className="font-medium pb-1 text-right">Net % of usage</th>
              </tr>
            </thead>
            <tbody>
              {data.stores.map(s => (
                <tr key={s.store} className="border-t border-slate-100">
                  <td className="py-1.5 font-medium text-slate-700">{s.store}</td>
                  <td className={`py-1.5 text-right font-semibold ${s.netDollars < 0 ? 'text-red-600' : 'text-slate-700'}`}>{money(s.netDollars)}</td>
                  <td className="py-1.5 text-right text-slate-600">{money(s.shrinkDollars)}</td>
                  <td className="py-1.5 text-right text-slate-600">{money(s.overageDollars)}</td>
                  <td className="py-1.5 text-right text-slate-600">{s.netPctOfUsage != null ? (s.netPctOfUsage > 0 ? '+' : '') + s.netPctOfUsage.toFixed(1) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-3">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-xs font-semibold text-slate-700">
            Biggest gaps {shown.length < rows.length && <span className="font-normal text-slate-400">· top {shown.length} of {rows.length}</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SHORT }} />short</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: OVER }} />over</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="font-medium pb-1">Item</th>
                <th className="font-medium pb-1">Store</th>
                <th className="font-medium pb-1 text-right">Expected use</th>
                <th className="font-medium pb-1 text-right">Actual use</th>
                <th className="font-medium pb-1 text-right">Gap</th>
                <th className="font-medium pb-1 w-24">&nbsp;</th>
                <th className="font-medium pb-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={`${r.store}-${r.productNumber}`} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2">
                    <div className="text-slate-700">{r.productName}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-400">{r.productNumber}{r.unit ? ` · ${r.unit}` : ''}</span>
                      <TierBadge row={r} />
                    </div>
                  </td>
                  <td className="py-1.5 text-slate-500">{r.store}</td>
                  <td className="py-1.5 text-right text-slate-600">{qty(r.theoretical)}</td>
                  <td className="py-1.5 text-right text-slate-600">{qty(r.actual)}</td>
                  <td className="py-1.5 text-right font-medium text-slate-700">{qty(r.variance)}</td>
                  <td className="py-1.5 px-1"><VarianceBar value={r.varianceDollars} max={maxAbs} /></td>
                  <td className={`py-1.5 text-right font-semibold ${r.varianceDollars < 0 ? 'text-red-600' : 'text-teal-700'}`}>
                    {money2(r.varianceDollars)}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={7} className="py-4 text-center text-slate-400">Nothing matches these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-3 text-[11px] text-slate-500 leading-relaxed">
        <div className="font-semibold text-slate-600 mb-1">How this is calculated</div>
        Book stock = opening count + deliveries received − expected usage. The gap is the
        physical count minus that book figure, so a negative gap means product left without
        being sold. Only completed count periods appear here ({data.periodDays} days for this
        one); the nightly hot-list counts are too short to difference this way.{' '}
        {modelled ? (
          <>Expected usage for this period is derived from CrunchTime recipes × items actually
          rung up (menu mix), not from CrunchTime&rsquo;s own report — it agreed with theirs to a
          1.4% median across all three stores for the validation week, but it is an estimate.{' '}
          {BIAS_NOTE} Items where the model is weakest are tagged and hidden by default.</>
        ) : (
          <>Expected usage for this period is CrunchTime&rsquo;s own figure, so no recipe model
          sits between the count and the gap.</>
        )}{' '}
        {data.emptyLines > 0 && `${data.emptyLines} blank template lines were dropped as carrying no information.`}
      </div>
    </div>
  )
}
