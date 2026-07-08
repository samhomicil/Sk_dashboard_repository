'use client'

import { useState, useEffect } from 'react'
import type { WatchlistRow, WatchlistPayload } from '@/lib/inventoryWatchlistUtils'
import { STORE_DISPLAY } from '@/lib/inventoryWatchlistUtils'

const money = (n: number) => `$${n.toFixed(2)}`
const num   = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

function VarianceBadge({ row }: { row: WatchlistRow }) {
  if (row.dataQualityFlag) return <span className="pill pill-gray">Data quality</span>
  if (row.varianceFlag === 'overage')   return <span className="pill pill-red">Over theoretical</span>
  if (row.varianceFlag === 'shortfall') return <span className="pill pill-yellow">Under theoretical</span>
  return <span className="pill pill-green">On track</span>
}

export default function InventoryWatchlistPage() {
  const [data, setData]       = useState<WatchlistPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/inventory/watchlist')
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>
  }
  if (!data) {
    return <div className="card text-center text-slate-400 py-12">No watchlist data yet.</div>
  }

  const needsAttention = data.rows
    .filter(r => r.dataQualityFlag || r.varianceFlag !== 'ok' || (r.daysOfSupply !== null && r.daysOfSupply < 14))
    .sort((a, b) => (a.daysOfSupply ?? 9999) - (b.daysOfSupply ?? 9999))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 -mt-2">
        <p className="text-xs text-slate-400">
          Theoretical/actual data as of {data.theoreticalAsOf} · pulled manually via Sigma, not on the automatic refresh cycle
        </p>
        <span className="pill pill-teal">{data.coverageMapped} of {data.coverageTotal} Dry Grocery SKUs mapped</span>
      </div>

      {/* This week's actions */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">This Week&apos;s Actions</div>
        {needsAttention.length === 0 ? (
          <div className="text-sm text-slate-400">Nothing flagged — all mapped items are tracking close to theoretical with healthy days of supply.</div>
        ) : (
          <ul className="space-y-2">
            {needsAttention.map(r => (
              <li key={`${r.itemFamilyId}|${r.store}`} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5"><VarianceBadge row={r} /></span>
                <span className="text-slate-700">
                  <strong>{r.displayName}</strong> — {r.recommendation}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail table */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-4">Item Detail</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left pb-2 font-medium">Item</th>
                <th className="text-left pb-2 font-medium">Store</th>
                <th className="text-right pb-2 font-medium">Weekly usage</th>
                <th className="text-right pb-2 font-medium">Days/unit</th>
                <th className="text-right pb-2 font-medium">Par</th>
                <th className="text-right pb-2 font-medium">Unit cost</th>
                <th className="text-left pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={`${r.itemFamilyId}|${r.store}`} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">{r.displayName}</td>
                  <td className="py-2 text-slate-600">{STORE_DISPLAY[r.store]}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{num(r.weeklyTheoreticalQty)} lb</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{r.daysOfSupply !== null ? r.daysOfSupply.toFixed(0) : '—'}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{r.par}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{r.unitCostPerUnit !== null ? `${money(r.unitCostPerUnit)}/lb` : '—'}</td>
                  <td className="py-2"><VarianceBadge row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open questions */}
      <div className="card border-l-4 border-amber-400" style={{ background: '#fffbeb' }}>
        <div className="text-sm font-bold text-amber-800 mb-2">Open Questions — Read Before Acting</div>
        <ul className="text-xs text-amber-900 space-y-1.5 list-disc pl-4">
          <li>Variance flags a gap between theoretical and actual usage — it does not distinguish real waste from a bad physical count. Investigate before assuming either.</li>
          <li>This is a partial pilot: only {data.coverageMapped} of {data.coverageTotal} Dry Grocery SKUs are mapped. Absence from this list means unmapped, not clean.</li>
          <li>Purchase quantity is never used here as a demand signal — Miramar deliberately buys extra dry goods and transfers to the other stores, so purchase history alone would be misleading.</li>
        </ul>
      </div>
    </div>
  )
}
