'use client'

import { useState, useEffect } from 'react'
import type { PurchasingPayload } from '@/lib/purchasingUtils'

const money  = (n: number) => n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
const pct    = (n: number) => `${(n * 100).toFixed(1)}%`
const num    = (n: number) => n.toLocaleString()

export default function InventoryOverviewPage() {
  const [data, setData]       = useState<PurchasingPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/inventory/overview')
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => (
      <div key={i} className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>
    ))}</div>
  }
  if (!data) {
    return (
      <div className="card text-center text-slate-400 py-12">
        No purchasing data yet — run <code className="text-slate-600">npm run refresh</code> to generate data/purchasing.json.
      </div>
    )
  }

  const vendorTotal = data.vendorSplit.pfgTotal + data.vendorSplit.walmartTotal

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 -mt-2">Refreshed {new Date(data.refreshedAt).toLocaleString()}</p>

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

      {/* Category mix */}
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

      {/* Top 15 products */}
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
                <th className="text-right pb-2 font-medium">Pines</th>
                <th className="text-right pb-2 font-medium">Miramar</th>
                <th className="text-right pb-2 font-medium">Margate</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((p, i) => (
                <tr key={p.itemCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 text-slate-300 tabular-nums">{i + 1}</td>
                  <td className="py-2 font-medium text-slate-700 max-w-[220px] truncate" title={p.description}>{p.description}</td>
                  <td className="py-2 text-slate-500 hidden sm:table-cell">{p.category}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(p.spend)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{money(p.pines)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{money(p.miramar)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{money(p.margate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-400">Combined by true item code — the distributor renames product descriptions mid-period for the same SKU.</div>
      </div>

      {/* Monthly trend */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Monthly Spend Trend</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Month</th>
                <th className="text-right pb-2 font-medium">PFG</th>
                <th className="text-right pb-2 font-medium">Walmart</th>
                <th className="text-right pb-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.monthlyTrend.map(m => (
                <tr key={m.month} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">{m.month}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{money(m.pfgSpend)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{money(m.walmartSpend)}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(m.pfgSpend + m.walmartSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
