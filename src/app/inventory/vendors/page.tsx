'use client'

import { useState, useEffect } from 'react'
import type { VendorBrand } from '@/lib/purchasingUtils'

const money = (n: number) => n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
const pct   = (n: number) => `${(n * 100).toFixed(1)}%`

interface VendorsPayload {
  refreshedAt: string
  vendorSplit: { pfgTotal: number; walmartTotal: number }
  pfgBrands: VendorBrand[]
  walmartCategories: { category: string; spend: number }[]
}

export default function InventoryVendorsPage() {
  const [data, setData]       = useState<VendorsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/inventory/vendors')
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>
  }
  if (!data) {
    return <div className="card text-center text-slate-400 py-12">No purchasing data yet.</div>
  }

  const vendorTotal = data.vendorSplit.pfgTotal + data.vendorSplit.walmartTotal
  const walmartTotal = data.walmartCategories.reduce((s, c) => s + c.spend, 0)
  const topBrand = data.pfgBrands[0]

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 -mt-2">Refreshed {new Date(data.refreshedAt).toLocaleString()}</p>

      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Vendor Split</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-400 mb-1">PFS / PFG</div>
            <div className="text-xl font-bold text-slate-800 tabular-nums">{money(data.vendorSplit.pfgTotal)}</div>
            <div className="text-xs text-slate-400">{vendorTotal > 0 ? pct(data.vendorSplit.pfgTotal / vendorTotal) : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Walmart</div>
            <div className="text-xl font-bold text-slate-800 tabular-nums">{money(data.vendorSplit.walmartTotal)}</div>
            <div className="text-xs text-slate-400">{vendorTotal > 0 ? pct(data.vendorSplit.walmartTotal / vendorTotal) : '—'}</div>
          </div>
        </div>
        {topBrand && (
          <div className="mt-4 text-xs text-slate-500">
            <strong className="text-slate-700">{topBrand.brand}</strong> house-label products are {pct(topBrand.pct)} of all PFG
            spend — heavy single-brand concentration, typical for a franchise but worth knowing for any future volume-pricing conversation.
          </div>
        )}
      </div>

      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">PFG Brand Concentration</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Brand / Manufacturer</th>
                <th className="text-right pb-2 font-medium">Spend</th>
                <th className="text-right pb-2 font-medium">% of PFG</th>
              </tr>
            </thead>
            <tbody>
              {data.pfgBrands.map(b => (
                <tr key={b.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">{b.brand}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(b.spend)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{pct(b.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Walmart Category Breakdown</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Category</th>
                <th className="text-right pb-2 font-medium">Spend</th>
                <th className="text-right pb-2 font-medium">% of Walmart</th>
              </tr>
            </thead>
            <tbody>
              {data.walmartCategories.map(c => (
                <tr key={c.category} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">{c.category}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(c.spend)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{walmartTotal > 0 ? pct(c.spend / walmartTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-400">Walmart is a supplemental channel — almost entirely fresh produce toppings and small ad-hoc top-ups, not planned bulk purchasing.</div>
      </div>
    </div>
  )
}
