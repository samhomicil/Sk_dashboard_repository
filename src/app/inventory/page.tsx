'use client'

import { Suspense } from 'react'
import { useInventoryData } from '@/components/useInventoryData'
import { SpendTrendChart, CostPctChart, CategoryMixChart, PriceTrendChart } from '@/components/InventoryCharts'

const money = (n: number) => n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const num = (n: number) => n.toLocaleString()

function OverviewInner() {
  const { data, loading } = useInventoryData()

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => (
      <div key={i} className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>
    ))}</div>
  }
  if (!data) {
    return <div className="card text-center text-slate-400 py-12">No purchasing data in this window — check the DB connection or widen the timeframe.</div>
  }

  const vendorTotal = data.vendorSplit.pfgTotal + data.vendorSplit.walmartTotal

  return (
    <div className="space-y-4">
      {/* Vendor split */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Total Purchasing</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-slate-400 mb-1">Total Spend</div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums">{money(vendorTotal)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">PFS / PFG</div>
            <div className="text-lg font-semibold text-slate-700 tabular-nums">{money(data.vendorSplit.pfgTotal)}</div>
            <div className="text-xs text-slate-400">{vendorTotal > 0 ? pct(data.vendorSplit.pfgTotal / vendorTotal) : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Walmart</div>
            <div className="text-lg font-semibold text-slate-700 tabular-nums">{money(data.vendorSplit.walmartTotal)}</div>
            <div className="text-xs text-slate-400">{vendorTotal > 0 ? pct(data.vendorSplit.walmartTotal / vendorTotal) : '—'}</div>
          </div>
        </div>
      </div>

      {/* Trends over time — insights */}
      {/* *:min-w-0 lets each card shrink below its chart's 480px min width on
          phones — the chart then scrolls inside the card instead of stretching
          the page sideways. */}
      <div className="grid lg:grid-cols-2 gap-4 *:min-w-0">
        <div className="card">
          <div className="text-sm font-bold text-slate-700 mb-1">Spend Over Time</div>
          <div className="text-xs text-slate-400 mb-3">Weekly PFG + Walmart</div>
          <SpendTrendChart data={data.weeklyTrend} />
        </div>
        <div className="card">
          <div className="text-sm font-bold text-slate-700 mb-1">Purchase Cost % of Sales</div>
          <div className="text-xs text-slate-400 mb-3">Weekly purchases ÷ net sales vs the 25% target</div>
          <CostPctChart data={data.weeklyTrend} />
        </div>
        <div className="card">
          <div className="text-sm font-bold text-slate-700 mb-1">Category Mix Shift</div>
          <div className="text-xs text-slate-400 mb-3">Share of weekly PFG spend by category</div>
          <CategoryMixChart data={data.categoryTrend} />
        </div>
        <div className="card">
          <div className="text-sm font-bold text-slate-700 mb-1">Unit Price Over Time</div>
          <div className="text-xs text-slate-400 mb-3">Last-paid price per unit — watch for distributor hikes</div>
          <PriceTrendChart data={data.priceTrend} items={data.topProducts} />
        </div>
      </div>

      {/* Category mix table */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Category Mix (PFG)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Category</th>
                <th className="text-right pb-2 font-medium">Spend</th>
                <th className="text-right pb-2 font-medium">% Mix</th>
                <th className="text-right pb-2 font-medium">Lines</th>
              </tr>
            </thead>
            <tbody>
              {data.categorySpend.map(c => (
                <tr key={c.category} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">{c.category}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(c.spend)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{pct(c.pct)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{num(c.lines)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top 15 products + last price */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Top 15 Products</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Product</th>
                <th className="text-left pb-2 font-medium hidden sm:table-cell">Category</th>
                <th className="text-right pb-2 font-medium">Spend</th>
                <th className="text-right pb-2 font-medium">Last $/unit</th>
                <th className="text-right pb-2 font-medium hidden md:table-cell">Pines</th>
                <th className="text-right pb-2 font-medium hidden md:table-cell">Miramar</th>
                <th className="text-right pb-2 font-medium hidden md:table-cell">Margate</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((p, i) => (
                <tr key={p.itemCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 text-slate-300 tabular-nums">{i + 1}</td>
                  <td className="py-2 font-medium text-slate-700 max-w-[220px] truncate" title={p.description}>{p.description}</td>
                  <td className="py-2 text-slate-500 hidden sm:table-cell">{p.category}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(p.spend)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums" title={p.lastPriceDate ? `as of ${p.lastPriceDate}` : ''}>
                    {p.lastPrice != null ? `$${p.lastPrice.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2 text-right text-slate-500 tabular-nums hidden md:table-cell">{money(p.pines)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums hidden md:table-cell">{money(p.miramar)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums hidden md:table-cell">{money(p.margate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-400">Combined by true item code — the distributor renames product descriptions mid-period for the same SKU. Last $/unit = line total ÷ qty on the most recent order in-window.</div>
      </div>
    </div>
  )
}

export default function InventoryOverviewPage() {
  return (
    <Suspense fallback={<div className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>}>
      <OverviewInner />
    </Suspense>
  )
}
