'use client'

import { useState, useEffect } from 'react'
import type { CategorySpend, TopProduct } from '@/lib/purchasingUtils'

const money = (n: number) => n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
const pct   = (n: number) => `${(n * 100).toFixed(1)}%`
const num   = (n: number) => n.toLocaleString()

interface CategoriesPayload {
  refreshedAt: string
  categorySpend: CategorySpend[]
  topProducts: TopProduct[]
  topProductsByCategory: Record<string, TopProduct[]>
}

export default function InventoryCategoriesPage() {
  const [data, setData]       = useState<CategoriesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/inventory/categories')
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

  const active = selected ?? data.categorySpend[0]?.category ?? null
  const products = active ? (data.topProductsByCategory[active] ?? []) : []

  const pillOn  = 'px-3 py-1.5 text-xs rounded-full font-medium bg-teal-600 text-white whitespace-nowrap'
  const pillOff = 'px-3 py-1.5 text-xs rounded-full font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap'

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 -mt-2">Refreshed {new Date(data.refreshedAt).toLocaleString()}</p>

      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">All Categories</div>
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
                <tr key={c.category}
                  onClick={() => setSelected(c.category)}
                  className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${active === c.category ? 'bg-teal-50' : ''}`}>
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

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-sm font-bold text-slate-700">Top Products — {active}</div>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {data.categorySpend.map(c => (
            <button key={c.category} onClick={() => setSelected(c.category)}
              className={active === c.category ? pillOn : pillOff}>
              {c.category}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Product</th>
                <th className="text-left pb-2 font-medium hidden sm:table-cell">Brand</th>
                <th className="text-right pb-2 font-medium">Spend</th>
                <th className="text-right pb-2 font-medium">Qty</th>
                <th className="text-right pb-2 font-medium">Pines</th>
                <th className="text-right pb-2 font-medium">Miramar</th>
                <th className="text-right pb-2 font-medium">Margate</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr><td colSpan={8} className="py-6 text-center text-slate-400">No products in this category.</td></tr>
              ) : products.map((p, i) => (
                <tr key={p.itemCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 text-slate-300 tabular-nums">{i + 1}</td>
                  <td className="py-2 font-medium text-slate-700 max-w-[200px] truncate" title={p.description}>{p.description}</td>
                  <td className="py-2 text-slate-500 hidden sm:table-cell">{p.brand}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(p.spend)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{num(p.qty)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{money(p.pines)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{money(p.miramar)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{money(p.margate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
