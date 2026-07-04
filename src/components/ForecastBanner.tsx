'use client'

import { TARGETS } from '@/lib/config'
import type { KpiData, Period } from '@/lib/types'

interface Props {
  kpis:   KpiData
  period: Period
}

function pctFmt(n: number) { return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%` }
function dolFmt(n: number) { return `$${Math.round(n).toLocaleString()}` }

export default function ForecastBanner({ kpis, period }: Props) {
  if (!kpis || kpis.periodComplete) return null
  if (kpis.salesForecast === null) return null

  const { sales, salesPY, salesTarget, salesForecast, daysElapsed, daysTotal } = kpis
  const pctVsPY     = salesPY     > 0 ? (salesForecast - salesPY)     / salesPY     : 0
  const pctVsTarget = salesTarget > 0 ? (salesForecast - salesTarget) / salesTarget : 0
  const onTrack     = pctVsTarget >= -0.03

  const periodLabel = { weekly: 'Week', monthly: 'Month', quarterly: 'Quarter', ytd: 'Year', custom: 'Period' }[period]

  return (
    <div className={`rounded-xl p-4 border ${onTrack ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            {periodLabel}-End Projection
            {daysTotal > 0 && (
              <span className="ml-2 font-normal text-slate-400">
                ({daysElapsed}d elapsed of {daysTotal}d · {Math.round((daysElapsed/daysTotal)*100)}% through period)
              </span>
            )}
          </div>
          <div className="text-2xl font-bold text-slate-800">{dolFmt(salesForecast)}</div>
        </div>
        <div className="flex gap-4 flex-wrap text-sm">
          <div>
            <div className="text-xs text-slate-400 mb-0.5">Actual to Date</div>
            <div className="font-bold text-slate-700">{dolFmt(sales)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-0.5">vs PY Full {periodLabel}</div>
            <div className={`font-bold ${pctVsPY >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {pctFmt(pctVsPY)} ({dolFmt(salesPY)})
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-0.5">vs 10% Target</div>
            <div className={`font-bold ${pctVsTarget >= 0 ? 'text-green-600' : pctVsTarget >= -0.03 ? 'text-amber-500' : 'text-red-500'}`}>
              {pctFmt(pctVsTarget)} ({dolFmt(salesTarget)})
            </div>
          </div>
        </div>
      </div>
      {!onTrack && (
        <div className="mt-2 text-xs text-amber-700">
          ⚠️ Tracking {pctFmt(Math.abs(pctVsTarget))} below the 10% growth target.
          Need {dolFmt((salesTarget - salesForecast) / Math.max(1, daysTotal - daysElapsed))} more/day to close the gap.
        </div>
      )}
    </div>
  )
}
