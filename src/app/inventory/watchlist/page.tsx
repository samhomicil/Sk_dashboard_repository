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

  const rows = useMemo(() => {
    if (!data) return []
    const r = store === 'All' ? data.rows : data.rows.filter(x => x.store === store)
    return [...r].sort((a, b) => (a.daysOfSupply ?? 9999) - (b.daysOfSupply ?? 9999))
  }, [data, store])

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
          {data.weatherLift > 1.02 && <span className="pill pill-yellow">🔥 heat +{Math.round((data.weatherLift - 1) * 100)}% demand</span>}
          {data.holidays?.length > 0 && <span className="pill pill-teal">🎉 {data.holidays.join(', ')}</span>}
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
            <span className="text-2xl">🚚</span>
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
                    <td className="py-2 text-right tabular-nums text-slate-600">{num(r.onHand)}</td>
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

      {/* full detail */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">All Stocked Items{store !== 'All' ? ` · ${store}` : ''}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Item</th>
                {store === 'All' && <th className="text-left pb-2 font-medium">Store</th>}
                <th className="text-right pb-2 font-medium">On hand</th>
                <th className="text-right pb-2 font-medium">Wk usage</th>
                <th className="text-right pb-2 font-medium">×Fcst</th>
                <th className="text-right pb-2 font-medium">Days</th>
                <th className="text-right pb-2 font-medium">Suggest</th>
                <th className="text-right pb-2 font-medium">Variance</th>
                <th className="text-left pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.store}|${r.productNumber}`} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700 max-w-[220px] truncate" title={r.productName}>{r.productName}</td>
                  {store === 'All' && <td className="py-2 text-slate-600">{r.store}</td>}
                  <td className="py-2 text-right tabular-nums text-slate-600">{num(r.onHand)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-600"
                      title={
                        r.usageBasis === 'theoretical'
                          ? `no usable count — using recipe-driven usage (${num(r.theoreticalUsage)})`
                          : r.usageBasis === 'theoretical-guard'
                          ? `count claimed ${num(r.countUsage)} vs ${num(r.theoreticalUsage)} from recipes — count looks wrong, ordering to the recipe figure`
                          : `count-based; recipes suggest ${num(r.theoreticalUsage)}`
                      }>
                    {num(r.weeklyUsage)}
                    {r.usageBasis === 'theoretical' ? '*' : ''}
                    {r.usageBasis === 'theoretical-guard' && (
                      <span className="ml-1 pill pill-yellow">count?</span>
                    )}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${r.forecastFactor > 1.02 ? 'text-emerald-600' : r.forecastFactor < 0.98 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {r.forecastFactor.toFixed(2)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{r.daysOfSupply !== null ? r.daysOfSupply.toFixed(1) : '—'}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-slate-800">{r.suggestedOrder > 0 ? num(Math.ceil(r.suggestedOrder * 10) / 10) : '—'}</td>
                  <td className={`py-2 text-right tabular-nums ${Math.abs(r.varianceQty) > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{r.varianceQty ? num(r.varianceQty) : '—'}</td>
                  <td className="py-2"><FlagBadge flag={r.flag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
          Suggested order = order-up-to over each order&apos;s coverage window (delivery-to-delivery), spread across the day-of-week demand curve with per-day heat &amp; holidays, − on-hand − pending. Pines/Miramar order Tue+Fri, Margate Tue. <b>↔ transfer</b> = Margate shelf-stable goods (proteins, cups, juices) sourced lean from Pines/Miramar via transfer instead of a 12-day PFG buy.
          Usage is count-based (begin + received − physical) from NetChef; <b>*</b> = fell back to theoretical. Demand factor (×Fcst) = trailing-4-week Brink sales vs the usage week, lifted for upcoming heat &amp; holidays.
          Net-supplier stores (Pines→Margate transfers) read slightly high on usage until transfer-netting is added.
        </div>
      </div>
    </div>
  )
}
