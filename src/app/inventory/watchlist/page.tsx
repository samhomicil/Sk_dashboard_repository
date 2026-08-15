'use client'

import { useState, useEffect, useMemo } from 'react'
import type { OrderGuideRow, OrderGuidePayload } from '@/lib/orderGuide'

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const money = (n: number) => '$' + Math.round(n).toLocaleString()
const wd = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const wdmd = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const md = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const LEAD = 4

const STORE_TABS = ['All', 'Pines', 'Miramar', 'Margate'] as const

// Where the on-hand number came from. An estimate is only as good as how recently the
// item was counted, and an unknown is a request for a COUNT, not an order — so neither
// can be shown as a bare number.
function BasisBadge({ r }: { r: OrderGuideRow }) {
  const tip = r.lastCountDate
    ? `last real count: ${r.lastCountKind ?? 'unknown'}, ${r.lastCountDate}`
      + (r.staleNights != null ? ` · ${r.staleNights} night${r.staleNights === 1 ? '' : 's'} ago` : '')
    : 'no count on record in the window'
  if (r.onHandBasis === 'unknown') return <span className="pill pill-gray" title="no usable count and the perpetual book is at or below zero — this needs counting before it can be ordered">Needs count</span>
  if (r.onHandBasis === 'estimated') return <span className="pill pill-yellow" title={tip}>Est</span>
  if (r.onHandBasis === 'disputed') return <span className="pill pill-red" title={tip}>Check</span>
  return null
}

function FlagBadge({ flag }: { flag: OrderGuideRow['flag'] }) {
  if (flag === 'urgent') return <span className="pill pill-red">Order now</span>
  if (flag === 'reorder') return <span className="pill pill-yellow">Reorder</span>
  if (flag === 'data') return <span className="pill pill-gray">Check count</span>
  return <span className="pill pill-green">OK</span>
}

export default function OrderGuidePage() {
  const [data, setData] = useState<OrderGuidePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<typeof STORE_TABS[number]>('All')

  useEffect(() => {
    fetch('/api/inventory/watchlist')
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const scoped = useMemo(() => {
    if (!data) return []
    return store === 'All' ? data.rows : data.rows.filter(x => x.store === store)
  }, [data, store])

  // The guide covers ~450 store-items. Listing them all buried the handful that matter,
  // so only 'act' and 'soon' are rendered as rows; the rest becomes a per-category
  // rollup you can expand. 'act' = out, or runs out before a truck can reach it.
  const rows = useMemo(() =>
    [...scoped.filter(r => r.bucket === 'act' || r.bucket === 'soon')]
      .sort((a, b) => (a.bucket === b.bucket ? 0 : a.bucket === 'act' ? -1 : 1)
                   || (a.daysOfSupply ?? 9999) - (b.daysOfSupply ?? 9999)), [scoped])

  const rollups = useMemo(() => {
    if (!data) return []
    return store === 'All' ? data.collapsed : data.collapsed.filter(c => c.store === store)
  }, [data, store])
  const quiet = scoped.length - rows.length
  const needCount = scoped.filter(r => r.onHandBasis === 'unknown').length

  const toOrder = rows.filter(r => r.flag === 'urgent' || r.flag === 'reorder')
  const cycleCost = toOrder.reduce((s, r) => s + (r.estOrderCost ?? 0), 0)
  const truck = data?.nextTruck?.[store === 'All' ? 'Pines' : store]

  if (loading) return <div className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>
  if (!data) return <div className="card text-center text-slate-400 py-12">No order-guide data — check the NetChef extractor / DB connection.</div>

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 -mt-2">
        <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
          <span>On-hand as of {data.onHandAsOf ?? '—'} · usage week {data.usageWeekStart} → {data.usageWeekEnd} · demand from Brink POS, usage count-based from NetChef</span>
          {data.weatherLift > 1.02 && <span className="pill pill-yellow">Heat +{Math.round((data.weatherLift - 1) * 100)}% demand</span>}
          {data.holidays?.length > 0 && <span className="pill pill-teal">{data.holidays.join(', ')}</span>}
        </p>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
          {STORE_TABS.map(t => (
            <button key={t} onClick={() => setStore(t)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${store === t ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* next truck banner — the actionable "what to do now" */}
      {truck && (
        <div className="card border-l-[3px] border-l-teal-500 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            
            <div>
              <div className="text-sm font-bold text-slate-700">Next truck — {wdmd(truck.delivery)}</div>
              <div className="text-xs text-slate-500">Place this order by <b className="text-slate-700">{wdmd(truck.orderBy)}</b>{truck.following && <> · following truck {wdmd(truck.following)}</>}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-slate-800 tabular-nums">{money(cycleCost)}</div>
            <div className="text-xs text-slate-400">{toOrder.length} items · est. order value</div>
          </div>
        </div>
      )}

      {/* order this week */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-4">
          <div className="text-sm font-bold text-slate-700">
            Order for the {truck ? wdmd(truck.delivery) : 'next'} truck{store !== 'All' ? ` · ${store}` : ''}
            {store !== 'All' && data.coverage?.[store] && (
              <span className="ml-2 text-xs font-normal text-slate-400">covers {data.coverage[store].days}d → {wd(data.coverage[store].through)}</span>
            )}
          </div>
          <div className="text-xs text-slate-400">{toOrder.length} items · {money(cycleCost)}</div>
        </div>
        {toOrder.length === 0 ? (
          <div className="text-sm text-slate-400">Nothing to order — every item is above its cover level.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase border-b border-slate-100">
                  <th className="text-left pb-2 font-medium">Item</th>
                  {store === 'All' && <th className="text-left pb-2 font-medium">Store</th>}
                  <th className="text-right pb-2 font-medium">On hand</th>
                  <th className="text-right pb-2 font-medium">Runs dry</th>
                  <th className="text-right pb-2 font-medium">Suggested order</th>
                  <th className="text-right pb-2 font-medium">Est $</th>
                  <th className="text-left pb-2 font-medium">Put on</th>
                </tr>
              </thead>
              <tbody>
                {toOrder.map(r => (
                  <tr key={`${r.store}|${r.productNumber}`} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 font-medium text-slate-700">{r.productName}
                      {r.driver === 'bowls' && <span className="ml-1.5 pill pill-teal">bowls</span>}
                      {r.sourcing === 'transfer' && <span className="ml-1.5 pill pill-gray">↔ transfer</span>}
                    </td>
                    {store === 'All' && <td className="py-2 text-slate-600">{r.store}</td>}
                    <td className="py-2 text-right tabular-nums text-slate-600">
                    {r.onHandBasis === 'unknown' ? <span className="text-slate-400">?</span> : num(r.onHand)}
                  </td>
                    <td className={`py-2 text-right tabular-nums ${r.daysOfSupply !== null && r.daysOfSupply < LEAD ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}
                      title={r.daysOfSupply !== null ? `${r.daysOfSupply.toFixed(1)} days of supply` : ''}>
                      {r.runOutDate ? md(r.runOutDate) : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums font-bold text-slate-800">
                      {num(Math.ceil(r.suggestedOrder * 10) / 10)} <span className="font-normal text-slate-400">{r.unit}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-500">{r.estOrderCost != null ? money(r.estOrderCost) : '—'}</td>
                    <td className="py-2">
                      {r.sourcing === 'transfer'
                        ? <span className="pill pill-gray">↔ transfer</span>
                        : r.orderTruck
                          ? <span className={r.orderTruck === truck?.delivery ? 'text-slate-600' : 'text-slate-400'}>{wd(r.orderTruck)} {md(r.orderTruck)}</span>
                          : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* pooled system order + transfers — the two things that are cheaper done together */}
      {(data.pooled.length > 0 || data.transfers.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.pooled.length > 0 && (
            <div className="card">
              <div className="text-sm font-bold text-slate-700 mb-1">PFG order · pooled across all stores</div>
              <p className="text-[11px] text-slate-400 mb-3">Need is combined before rounding up to whole cases — ordering store by store buys two cases where one covers all three.</p>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 uppercase border-b border-slate-100">
                  <th className="text-left pb-2 font-medium">Item</th>
                  <th className="text-right pb-2 font-medium">Need</th>
                  <th className="text-right pb-2 font-medium">Cases</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                  <th className="text-left pb-2 font-medium pl-3">Covers</th>
                </tr></thead>
                <tbody>
                  {data.pooled.map(p => (
                    <tr key={p.productNumber} className="border-b border-slate-50">
                      <td className="py-2 font-medium text-slate-700 max-w-[150px] truncate" title={`${p.code} · ${p.pack}`}>{p.name}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{num(p.need)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-teal-700">{p.cases}</td>
                      <td className="py-2 text-right tabular-nums text-slate-700">${p.cost.toFixed(2)}</td>
                      <td className="py-2 pl-3 text-[11px] text-slate-500">{p.allocation.map(a => `${a.store} ${num(a.need)}`).join(' · ')}</td>
                    </tr>
                  ))}
                  <tr><td className="pt-2 font-bold text-slate-700">Total</td><td /><td className="pt-2 text-right tabular-nums font-bold text-teal-700">{data.pooled.reduce((s2, p) => s2 + p.cases, 0)}</td>
                    <td className="pt-2 text-right tabular-nums font-bold text-slate-800">${data.pooled.reduce((s2, p) => s2 + p.cost, 0).toFixed(2)}</td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
          {data.transfers.length > 0 && (
            <div className="card">
              <div className="text-sm font-bold text-slate-700 mb-1">Move between stores</div>
              <p className="text-[11px] text-slate-400 mb-3">Dry goods only — fruit and frozen ride the truck. A donor gives only what it doesn&apos;t need to reach its own next delivery.</p>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 uppercase border-b border-slate-100">
                  <th className="text-left pb-2 font-medium">Item</th>
                  <th className="text-left pb-2 font-medium">Move</th>
                  <th className="text-right pb-2 font-medium">Qty</th>
                  <th className="text-right pb-2 font-medium">Case avoided</th>
                </tr></thead>
                <tbody>
                  {data.transfers.map(t => (
                    <tr key={`${t.to}|${t.productNumber}`} className="border-b border-slate-50">
                      <td className="py-2 font-medium text-slate-700 max-w-[150px] truncate" title={t.name}>{t.name}</td>
                      <td className="py-2 text-slate-600">
                        {t.legs.map(l => l.from).join(' + ')} → <b>{t.to}</b>
                        {t.legs.some(l => l.trust === 'disputed') &&
                          <span className="text-rose-600"> · confirm {t.legs.filter(l => l.trust === 'disputed').map(l => l.from).join(', ')} count first</span>}
                        {t.short > 0.05 && <span className="text-slate-400"> · still short {num(t.short)}</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums font-semibold text-amber-700">{num(t.filled)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{t.caseAvoided ? `$${t.caseAvoided.cost.toFixed(0)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* full detail */}
      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <div className="text-sm font-bold text-slate-700">Needs attention{store !== 'All' ? ` · ${store}` : ''}</div>
          <div className="text-xs text-slate-400 tabular-nums">
            {rows.length} of {scoped.length} items · {quiet} covered or quiet{needCount > 0 ? ` · ${needCount} need a count` : ''}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Item</th>
                {store === 'All' && <th className="text-left pb-2 font-medium">Store</th>}
                <th className="text-right pb-2 font-medium">On hand</th>
                <th className="text-right pb-2 font-medium">Wk usage</th>
                <th className="text-right pb-2 font-medium">Days</th>
                <th className="text-right pb-2 font-medium">Suggest</th>
                <th className="text-left pb-2 font-medium">Buy as</th>
                <th className="text-left pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.store}|${r.productNumber}`} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700 max-w-[220px] truncate" title={r.productName}>{r.productName}</td>
                  {store === 'All' && <td className="py-2 text-slate-600">{r.store}</td>}
                  <td className="py-2 text-right tabular-nums text-slate-600">
                    {r.onHandBasis === 'unknown' ? <span className="text-slate-400">?</span> : num(r.onHand)}
                  </td>
                  {/* Usage always states which basis it used and what the other one said,
                      so a surprising order can be traced without leaving the row. */}
                  <td className="py-2 text-right tabular-nums text-slate-600"
                      title={
                        r.usageBasis === 'theoretical'
                          ? `no usable count — using recipe-driven usage (${num(r.theoreticalUsage)}/wk)`
                          : r.usageBasis === 'theoretical-guard'
                          ? `count claimed ${num(r.countUsage)} vs ${num(r.theoreticalUsage)} from recipes — count looks wrong, ordering to the recipe figure`
                          : `count-based; recipes suggest ${num(r.theoreticalUsage)}/wk`
                      }>
                    {num(r.weeklyUsage)}
                    {r.usageBasis === 'theoretical' ? '*' : ''}
                    {r.usageBasis === 'theoretical-guard' && (
                      <span className="ml-1 pill pill-yellow">count?</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{r.daysOfSupply !== null ? r.daysOfSupply.toFixed(1) : '—'}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-slate-800">{r.suggestedOrder > 0 ? num(Math.ceil(r.suggestedOrder * 10) / 10) : '—'}</td>
                  {/* PFG ships whole cases — "2.1 LB of Gladiator" is not an action. */}
                  <td className="py-2 text-slate-500 whitespace-nowrap">
                    {r.route === 'walmart' && r.walmartUnits
                      ? <span title={r.walmartItem ?? ''}>{r.walmartUnits}× Walmart{r.walmartCost != null ? ` · $${r.walmartCost.toFixed(2)}` : ''}</span>
                      : r.route === 'transfer' ? <span className="text-amber-700">transfer in</span>
                      : r.route === 'next-order' ? <span className="text-slate-400">next order</span>
                      : r.casePack && r.caseUnits
                        ? <span title={r.idleValue != null ? `a whole case leaves $${r.idleValue.toFixed(0)} sitting` : ''}>
                            {Math.ceil(r.suggestedOrder / r.caseUnits)}× {r.casePack}
                          </span>
                        : <span className="text-slate-400">{r.unit ?? '—'}</span>}
                  </td>
                  <td className="py-2 flex items-center gap-1"><FlagBadge flag={r.flag} /><BasisBadge r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
          Suggested order = order-up-to over each order&apos;s coverage window (delivery-to-delivery), spread across the day-of-week demand curve with per-day heat &amp; holidays, − on-hand − pending. Pines/Miramar order Tue+Fri, <b>Margate Tue only</b>, so Margate carries roughly double the cover on the same item. <b>Buy as</b> is the real purchasable unit — PFG case pack and price off recent invoices, or a Walmart substitute where that item is genuinely bought locally.
          Usage is a per-day rate over the trailing {data.usageWindowDays} days; count-based (begin + received − physical) where there is enough count history, otherwise recipe-derived, and <b>*</b> marks the recipe fallback. <b>Est</b> means the line was left blank and the number is carried forward; <b>Needs count</b> means there is no usable count and the perpetual book is at or below zero — those can&apos;t be sized until someone counts them.
          Net-supplier stores (Pines→Margate transfers) read slightly high on usage until transfer-netting is added.
        </div>
      </div>

      {/* everything quiet, summarised rather than listed */}
      {rollups.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <div className="text-sm font-bold text-slate-700">Everything else</div>
            <div className="text-xs text-slate-400 tabular-nums">{quiet} items rolled up</div>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">Covered to the next delivery, or waiting on a count. Nothing here needs a decision this morning.</p>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {rollups.map(c => (
              <div key={`${c.store}|${c.category}`} className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-50 text-xs">
                <span className="text-slate-600 truncate">
                  {store === 'All' && <span className="text-slate-400">{c.store} · </span>}{c.category}
                </span>
                <span className="tabular-nums text-slate-400 whitespace-nowrap">
                  {c.items}
                  {c.needCount > 0 && <span className="text-amber-600"> · {c.needCount} to count</span>}
                  {c.estCost > 0 && <span className="text-slate-500"> · ${c.estCost.toFixed(0)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
