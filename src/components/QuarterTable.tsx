'use client'

import type { QuarterRow } from '@/lib/types'
import { TARGETS } from '@/lib/config'
import LaborTooltip from './LaborTooltip'

interface Props {
  quarters: QuarterRow[]
  loading:  boolean
}

function fmtD(n: number | null) { return n !== null ? `$${Math.round(n).toLocaleString()}` : '—' }
function fmtP(n: number | null) { return n !== null ? `${(n * 100).toFixed(1)}%` : '—' }
function diffPill(a: number | null, b: number | null) {
  if (a === null || b === null || b === 0) return null
  const d = (a - b) / b
  return <span className={`pill ${d >= 0 ? 'pill-green' : 'pill-red'}`}>{d >= 0 ? '▲' : '▼'}{Math.abs(d * 100).toFixed(1)}%</span>
}

export default function QuarterTable({ quarters, loading }: Props) {
  if (loading) return <div className="card"><div className="skeleton h-32 w-full" /></div>

  return (
    <div className="card">
      <div className="text-sm font-bold text-slate-700 mb-3">Quarterly Breakdown</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left pb-2">Quarter</th>
              <th className="text-right pb-2">Sales</th>
              <th className="text-right pb-2">vs PY</th>
              <th className="text-right pb-2">vs 10% Tgt</th>
              <th className="text-right pb-2">Orders</th>
              <th className="text-right pb-2">Labor%</th>
              <th className="text-right pb-2">COGS%</th>
              <th className="text-right pb-2">EE%</th>
              <th className="text-right pb-2">ATV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {quarters.map(q => {
              const target = q.salesPY !== null ? Math.round(q.salesPY * 1.10) : null
              const rowCls = q.isCurrent
                ? 'bg-teal-50'
                : q.isFuture
                ? 'opacity-40'
                : ''
              return (
                <tr key={q.quarter} className={rowCls}>
                  <td className="py-2 font-bold text-slate-700">
                    {q.quarter}
                    {q.isCurrent && <span className="ml-2 pill pill-teal text-xs">In Progress</span>}
                    {q.isFuture  && <span className="ml-2 text-xs text-slate-300">upcoming</span>}
                  </td>
                  <td className="text-right font-semibold text-slate-700">{fmtD(q.sales)}</td>
                  <td className="text-right">{diffPill(q.sales, q.salesPY)}</td>
                  <td className="text-right">{diffPill(q.sales, target)}</td>
                  <td className="text-right text-slate-600">{q.orders?.toLocaleString() ?? '—'}</td>
                  <td className="text-right">
                    {q.laborPct !== null
                      ? (
                        <LaborTooltip labor={q.laborCost} hours={q.laborHours}>
                          <span className={`pill ${q.laborPct <= TARGETS.laborPct ? 'pill-green' : q.laborPct <= TARGETS.laborPct * 1.1 ? 'pill-yellow' : 'pill-red'}`}>{fmtP(q.laborPct)}</span>
                        </LaborTooltip>
                      )
                      : '—'}
                  </td>
                  <td className="text-right">
                    {q.cogsPct !== null
                      ? <span className={`pill ${q.cogsPct <= TARGETS.cogsPct ? 'pill-green' : q.cogsPct <= TARGETS.cogsPct * 1.1 ? 'pill-yellow' : 'pill-red'}`}>{fmtP(q.cogsPct)}</span>
                      : '—'}
                  </td>
                  <td className="text-right">
                    {q.eePct !== null
                      ? <span className={`pill ${q.eePct >= TARGETS.eePct ? 'pill-green' : q.eePct >= TARGETS.eePct * 0.75 ? 'pill-yellow' : 'pill-red'}`}>{fmtP(q.eePct)}</span>
                      : '—'}
                  </td>
                  <td className="text-right text-slate-600">{q.atv !== null ? `$${q.atv.toFixed(2)}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
