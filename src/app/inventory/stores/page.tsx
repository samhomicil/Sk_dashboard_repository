'use client'

import { useState, useEffect } from 'react'
import type { CategoryByStore } from '@/lib/purchasingUtils'
import { storeTotal } from '@/lib/purchasingUtils'

const money = (n: number) => n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
const pct   = (n: number) => `${(n * 100).toFixed(1)}%`

interface StoresPayload {
  refreshedAt: string
  categoryByStore: CategoryByStore[]
}

export default function InventoryStoresPage() {
  const [data, setData]       = useState<StoresPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/inventory/stores')
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

  const totals = data.categoryByStore.reduce(
    (acc, c) => ({ pines: acc.pines + c.pines, miramar: acc.miramar + c.miramar, margate: acc.margate + c.margate }),
    { pines: 0, miramar: 0, margate: 0 }
  )
  const grand = totals.pines + totals.miramar + totals.margate

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 -mt-2">Refreshed {new Date(data.refreshedAt).toLocaleString()}</p>

      <div className="card border-l-4 border-teal-500" style={{ background: '#f0fdfa' }}>
        <div className="text-xs text-teal-800">
          <strong>Note on Miramar&apos;s share:</strong> Miramar is used as a deliberate ordering hub for several dry-goods
          items — bought there and split via transfer to Pines and Margate to smooth week-to-week costs. Its higher spend
          share on a given category or item often reflects that practice, not higher standalone consumption. See the
          Watchlist tab for usage figures that account for this.
        </div>
      </div>

      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Category × Store</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Category</th>
                <th className="text-right pb-2 font-medium">Pines</th>
                <th className="text-right pb-2 font-medium">Miramar</th>
                <th className="text-right pb-2 font-medium">Margate</th>
                <th className="text-right pb-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.categoryByStore.map(c => (
                <tr key={c.category} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">{c.category}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{money(c.pines)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{money(c.miramar)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{money(c.margate)}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(storeTotal(c))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
                <td className="py-2">Store total</td>
                <td className="py-2 text-right tabular-nums">{money(totals.pines)}</td>
                <td className="py-2 text-right tabular-nums">{money(totals.miramar)}</td>
                <td className="py-2 text-right tabular-nums">{money(totals.margate)}</td>
                <td className="py-2 text-right tabular-nums">{money(grand)}</td>
              </tr>
              <tr className="text-slate-400">
                <td className="pt-1">% of total</td>
                <td className="pt-1 text-right tabular-nums">{grand > 0 ? pct(totals.pines / grand) : '—'}</td>
                <td className="pt-1 text-right tabular-nums">{grand > 0 ? pct(totals.miramar / grand) : '—'}</td>
                <td className="pt-1 text-right tabular-nums">{grand > 0 ? pct(totals.margate / grand) : '—'}</td>
                <td className="pt-1 text-right tabular-nums">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
