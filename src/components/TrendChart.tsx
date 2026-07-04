'use client'

import { useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import type { TrendPoint } from '@/lib/types'

interface Props {
  data:    TrendPoint[]
  loading: boolean
  isWeekly?: boolean
}

const fmtK = (v: number) => `$${(v / 1000).toFixed(0)}K`
const fmtD = (v: number) => `$${Number(v).toLocaleString()}`

const SERIES = [
  { key: 'actual',   label: 'Actual',       color: '#5eead4', type: 'bar'  },
  { key: 'forecast', label: 'Forecast',      color: '#a7f3d0', type: 'bar'  },
  { key: 'salesPY',  label: 'Prior Year',    color: '#fb923c', type: 'line' },
  { key: 'target',   label: '10% Target',    color: '#22c55e', type: 'line' },
]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const point: TrendPoint | undefined = payload[0]?.payload
  if (!point) return null

  const rows: Array<{ label: string; value: string; color: string }> = []

  if (point.isCurrent) {
    const actual = point.sales ?? 0
    const total  = point.salesForecast ?? actual
    rows.push({ label: 'Actual to date', value: fmtD(actual),         color: '#0d9488' })
    rows.push({ label: 'Forecast total', value: fmtD(total),          color: '#a7f3d0' })
  } else if (point.isForecast) {
    if (point.salesForecast) rows.push({ label: 'Forecast', value: fmtD(point.salesForecast), color: '#a7f3d0' })
  } else {
    if (point.sales) rows.push({ label: 'This Year', value: fmtD(point.sales), color: '#5eead4' })
  }
  if (point.salesPY)     rows.push({ label: 'Prior Year', value: fmtD(point.salesPY),     color: '#fb923c' })
  if (point.salesTarget) rows.push({ label: '10% Target', value: fmtD(point.salesTarget), color: '#22c55e' })

  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-lg p-2 text-xs min-w-[150px]">
      <div className="font-semibold text-slate-600 mb-1.5">{label}{point.isCurrent ? ' (in progress)' : ''}</div>
      {rows.map(r => (
        <div key={r.label} className="flex items-center justify-between gap-4 mb-0.5">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
            <span className="text-slate-500">{r.label}</span>
          </span>
          <span className="font-semibold text-slate-700">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function TrendChart({ data, loading, isWeekly }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // Pre-compute stacked fields:
  //   salesActual  = past/current actual (null for future)
  //   salesForecastTop = current: remainder above actual; future: full forecast; past: null
  const chartData = data.map(d => ({
    ...d,
    salesActual: d.isForecast ? null : d.sales,
    salesForecastTop: d.isCurrent
      ? Math.max(0, (d.salesForecast ?? 0) - (d.sales ?? 0))
      : d.isForecast ? d.salesForecast : null,
  }))

  if (loading) {
    return <div className="card"><div className="skeleton h-40 w-full" /></div>
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm font-bold text-slate-700">
          {isWeekly ? 'Sales Trend — Weekly (L4W + F4W)' : `Sales Trend — ${new Date().getFullYear()}`}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {SERIES.map(s => (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 text-xs font-medium transition-opacity ${hidden.has(s.key) ? 'opacity-30' : ''}`}
            >
              {s.type === 'bar'
                ? <span className="w-4 h-3 rounded inline-block" style={{ background: s.color }} />
                : <span className="w-6 h-0 border-t-2 inline-block" style={{ borderColor: s.color, borderStyle: s.key === 'target' ? 'dotted' : 'dashed' }} />
              }
              <span className="text-slate-500">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="weekStart" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={42} />
          <Tooltip content={<CustomTooltip />} />

          {!hidden.has('actual') && (
            <Bar dataKey="salesActual" name="salesActual" stackId="week" radius={[0,0,0,0]} maxBarSize={28}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isCurrent ? '#0d9488' : '#5eead4'} />
              ))}
            </Bar>
          )}

          {!hidden.has('forecast') && (
            <Bar dataKey="salesForecastTop" name="salesForecastTop" stackId="week" fill="#a7f3d0" radius={[3,3,0,0]} maxBarSize={28} />
          )}

          {!hidden.has('salesPY') && (
            <Line dataKey="salesPY" name="salesPY" stroke="#fb923c" strokeWidth={2} dot={{ r: 2, fill: '#fb923c' }} strokeDasharray="5 3" type="monotone" connectNulls />
          )}

          {!hidden.has('target') && (
            <Line dataKey="salesTarget" name="salesTarget" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="3 3" type="monotone" connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
