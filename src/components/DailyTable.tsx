'use client'

import { TARGETS } from '@/lib/config'
import type { DailyRangeData, DailyRow } from '@/lib/types'
import LaborTooltip from './LaborTooltip'

function pct(n: number, d = 1) { return `${(n * 100).toFixed(d)}%` }
function dol(n: number)        { return `$${Math.round(n).toLocaleString()}` }

function VsPY({ cur, py, lowerBetter = false }: { cur: number | null; py: number | null; lowerBetter?: boolean }) {
  if (cur == null || py == null || py === 0) return <span className="text-slate-300">—</span>
  const delta = (cur - py) / py
  const good  = lowerBetter ? delta <= 0 : delta >= 0
  return (
    <span className={`font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>
      {delta >= 0 ? '▲' : '▼'}{Math.abs(delta * 100).toFixed(1)}%
    </span>
  )
}

interface Props {
  data:    DailyRangeData | null
  loading: boolean
}

export default function DailyTable({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="card">
        <div className="skeleton h-6 w-32 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}
        </div>
      </div>
    )
  }

  if (!data || data.current.length === 0) {
    return (
      <div className="card text-sm text-slate-400 italic">
        No daily data for this range — try refreshing Sigma data.
      </div>
    )
  }

  const { current, py } = data

  const totSales    = current.reduce((s, r) => s + (r.sales  ?? 0), 0)
  const totOrders   = current.reduce((s, r) => s + (r.orders ?? 0), 0)
  const totPySales  = py.reduce((s, r) => s + (r.sales  ?? 0), 0)
  const totPyOrders = py.reduce((s, r) => s + (r.orders ?? 0), 0)

  const avgEE        = (() => { const r = current.filter(r => r.eePct    != null); return r.length ? r.reduce((s,r)=>s+r.eePct!,0)/r.length : null })()
  const avgLabor     = (() => { const r = current.filter(r => r.laborPct != null); return r.length ? r.reduce((s,r)=>s+r.laborPct!,0)/r.length : null })()
  const totLaborCost = current.reduce((s, r) => s + (r.laborCost ?? 0), 0)
  const totLaborHrs  = current.reduce((s, r) => s + (r.laborHours ?? 0), 0)
  const avgVoid  = (() => { const r = current.filter(r => r.voidPct  != null); return r.length ? r.reduce((s,r)=>s+r.voidPct!,0)/r.length : null })()

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-slate-700">Daily Activity</div>
        {py.length > 0 && (
          <div className="text-xs text-slate-400">vs PY = same dates one year ago</div>
        )}
      </div>

      <table className="w-full text-xs min-w-[640px]">
        <thead>
          <tr className="border-b border-slate-100 text-slate-400 text-left">
            <th className="pb-2 w-16 font-medium">Date</th>
            <th className="pb-2 w-10 font-medium">Day</th>
            <th className="pb-2 text-right w-20 font-medium">Sales</th>
            <th className="pb-2 text-right w-16 font-medium">vs PY</th>
            <th className="pb-2 text-right w-16 font-medium">Orders</th>
            <th className="pb-2 text-right w-16 font-medium">vs PY</th>
            <th className="pb-2 text-right w-16 font-medium">ATV</th>
            <th className="pb-2 text-right w-14 font-medium">EE%</th>
            <th className="pb-2 text-right w-16 font-medium">Labor%</th>
            <th className="pb-2 text-right w-14 font-medium">Void%</th>
          </tr>
        </thead>
        <tbody>
          {current.map((row: DailyRow, i: number) => {
            const pyRow = py[i] ?? null
            return (
              <tr key={row.date} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="py-1.5 text-slate-500">{row.date.slice(5).replace('-', '/')}</td>
                <td className="py-1.5 text-slate-400">{row.day}</td>
                <td className="py-1.5 text-right font-semibold text-slate-800">
                  {row.sales != null ? dol(row.sales) : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-1.5 text-right">
                  <VsPY cur={row.sales} py={pyRow?.sales ?? null} />
                </td>
                <td className="py-1.5 text-right text-slate-700">
                  {row.orders != null ? row.orders.toLocaleString() : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-1.5 text-right">
                  <VsPY cur={row.orders} py={pyRow?.orders ?? null} />
                </td>
                <td className="py-1.5 text-right text-slate-600">
                  {row.atv != null ? `$${row.atv.toFixed(2)}` : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-1.5 text-right">
                  {row.eePct != null ? (
                    <span className={row.eePct >= TARGETS.eePct ? 'text-emerald-600 font-semibold' : row.eePct >= TARGETS.eePct * 0.75 ? 'text-amber-600' : 'text-red-500'}>
                      {pct(row.eePct, 0)}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-1.5 text-right">
                  {row.laborPct != null ? (
                    <LaborTooltip labor={row.laborCost} hours={row.laborHours}>
                      <span className={row.laborPct <= TARGETS.laborPct ? 'text-emerald-600' : 'text-red-500'}>
                        {pct(row.laborPct)}
                      </span>
                    </LaborTooltip>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-1.5 text-right">
                  {row.voidPct != null ? (
                    <span className={row.voidPct <= TARGETS.voidPct ? 'text-slate-600' : 'text-red-500'}>
                      {pct(row.voidPct)}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            )
          })}

          {/* Summary row */}
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-xs">
            <td colSpan={2} className="py-2 text-slate-500">Total / Avg</td>
            <td className="py-2 text-right text-slate-800">{totSales > 0 ? dol(totSales) : '—'}</td>
            <td className="py-2 text-right">
              <VsPY cur={totSales} py={totPySales > 0 ? totPySales : null} />
            </td>
            <td className="py-2 text-right text-slate-700">{totOrders > 0 ? totOrders.toLocaleString() : '—'}</td>
            <td className="py-2 text-right">
              <VsPY cur={totOrders} py={totPyOrders > 0 ? totPyOrders : null} />
            </td>
            <td className="py-2 text-right text-slate-600">
              {totSales > 0 && totOrders > 0 ? `$${(totSales / totOrders).toFixed(2)}` : '—'}
            </td>
            <td className="py-2 text-right">
              {avgEE != null ? (
                <span className={avgEE >= TARGETS.eePct ? 'text-emerald-600' : 'text-red-500'}>{pct(avgEE, 0)}</span>
              ) : <span className="text-slate-300">—</span>}
            </td>
            <td className="py-2 text-right">
              {avgLabor != null ? (
                <LaborTooltip labor={totLaborCost > 0 ? totLaborCost : null} hours={totLaborHrs > 0 ? totLaborHrs : null}>
                  <span className={avgLabor <= TARGETS.laborPct ? 'text-emerald-600' : 'text-red-500'}>{pct(avgLabor)}</span>
                </LaborTooltip>
              ) : <span className="text-slate-300">—</span>}
            </td>
            <td className="py-2 text-right">
              {avgVoid != null ? (
                <span className={avgVoid <= TARGETS.voidPct ? 'text-slate-600' : 'text-red-500'}>{pct(avgVoid)}</span>
              ) : <span className="text-slate-300">—</span>}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
