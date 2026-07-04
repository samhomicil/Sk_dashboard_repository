'use client'

import type { StoreRow, KpiData, Period } from '@/lib/types'
import { TARGETS } from '@/lib/config'
import LaborTooltip from './LaborTooltip'

interface Props {
  stores:  StoreRow[]
  kpis:    KpiData | null
  period:  Period
  loading: boolean
}

const PERIOD_LABEL: Record<string, string> = {
  weekly: 'This Week', monthly: 'Month-End', quarterly: 'Quarter-End', ytd: 'Year-End', custom: 'Period-End',
}

function pctFmt(n: number)  { return `${(n * 100).toFixed(1)}%` }
function diffFmt(n: number) { return `${n >= 0 ? '▲' : '▼'}${Math.abs(n * 100).toFixed(1)}%` }
function dolFmt(n: number)  { return `$${Math.round(n).toLocaleString()}` }

function pillVsTarget(actual: number, target: number) {
  if (!target) return null
  const diff = (actual - target) / target
  return <span className={`pill ${diff >= 0 ? 'pill-green' : 'pill-red'}`}>{diffFmt(diff)}</span>
}

function pillPct(val: number, target: number, lowerIsBetter = false) {
  const ok   = lowerIsBetter ? val <= target : val >= target
  const warn = lowerIsBetter ? val <= target * 1.1 : val >= target * 0.9
  const cls  = ok ? 'pill-green' : warn ? 'pill-yellow' : 'pill-red'
  return <span className={`pill ${cls}`}>{pctFmt(val)}</span>
}

export default function StoreBreakdown({ stores, kpis, period, loading }: Props) {
  if (loading) return <div className="card"><div className="skeleton h-40 w-full" /></div>

  const isWeekly       = period === 'weekly'
  const forecastLabel  = PERIOD_LABEL[period] ?? 'Period-End'
  const daysElapsed    = kpis?.daysElapsed ?? 1
  const daysTotal      = kpis?.daysTotal   ?? 1
  const periodComplete = kpis?.periodComplete ?? false

  const rows = stores.map(r => ({
    ...r,
    projected: !periodComplete && !isWeekly
      ? Math.round(r.sales / daysElapsed * daysTotal)
      : r.sales,
    target: Math.round(r.salesPY * (1 + TARGETS.salesGrowthYoY)),
  }))

  const totalProjected = rows.reduce((s, r) => s + r.projected, 0)
  const totalTarget    = rows.reduce((s, r) => s + r.target, 0)

  const colLabel = isWeekly ? 'Sales' : (periodComplete ? 'Actual' : 'Projected')

  return (
    <div className="card">
      <div className="text-sm font-bold text-slate-700 mb-3">
        Store Breakdown{!isWeekly ? ` — ${forecastLabel} Forecast` : ''}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase">
              <th className="text-left pb-2">Store</th>
              <th className="text-right pb-2">{colLabel}</th>
              <th className="text-right pb-2">YoY</th>
              <th className="text-right pb-2">vs +10% Tgt</th>
              <th className="text-right pb-2">Labor</th>
              <th className="text-right pb-2">EE%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(r => {
              const yoy = r.salesPY > 0 ? (r.projected - r.salesPY) / r.salesPY : null
              return (
                <tr key={r.store}>
                  <td className="py-2 font-semibold text-slate-700">{r.store}</td>
                  <td className="text-right font-semibold text-slate-700">{dolFmt(r.projected)}</td>
                  <td className="text-right text-xs">
                    {yoy !== null ? (
                      <span className={yoy >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
                        {yoy >= 0 ? '▲' : '▼'}{Math.abs(yoy * 100).toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="text-right">{pillVsTarget(r.projected, r.target)}</td>
                  <td className="text-right">
                    <LaborTooltip labor={r.laborCost} hours={r.laborHours}>
                      {pillPct(r.laborPct, TARGETS.laborPct, true)}
                    </LaborTooltip>
                  </td>
                  <td className="text-right">{pillPct(r.eePct, TARGETS.eePct)}</td>
                </tr>
              )
            })}
            {rows.length > 1 && (() => {
              const totalPY  = rows.reduce((s, r) => s + r.salesPY, 0)
              const totalYoY = totalPY > 0 ? (totalProjected - totalPY) / totalPY : null
              return (
                <tr className="border-t-2 border-slate-200 font-bold">
                  <td className="pt-3 text-slate-800">Total</td>
                  <td className="text-right text-slate-800 pt-3">{dolFmt(totalProjected)}</td>
                  <td className="text-right pt-3 text-xs">
                    {totalYoY !== null ? (
                      <span className={totalYoY >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
                        {totalYoY >= 0 ? '▲' : '▼'}{Math.abs(totalYoY * 100).toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="text-right pt-3">{pillVsTarget(totalProjected, totalTarget)}</td>
                  <td className="text-right pt-3">
                    {kpis && (
                      <LaborTooltip labor={kpis.laborCost} hours={kpis.laborHours}>
                        {pillPct(kpis.laborPct, TARGETS.laborPct, true)}
                      </LaborTooltip>
                    )}
                  </td>
                  <td className="text-right pt-3">{kpis && pillPct(kpis.eePct, TARGETS.eePct)}</td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
