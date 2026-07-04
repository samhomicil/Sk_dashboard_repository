'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export interface SparkPoint {
  day: string
  v:   number | null
  py:  number | null
}

type SparkFmt = '$' | '%' | 'count' | '$2'

interface Props {
  label:    string
  value:    string
  dot:      'green' | 'yellow' | 'red' | 'none'
  pill?:    { text: string; color: 'green' | 'red' | 'yellow' | 'gray' }
  pill2?:   { text: string; color: 'green' | 'red' | 'yellow' | 'gray' }
  sub?:     string
  tooltip?: string
  spark?:   SparkPoint[]
  sparkFmt?: SparkFmt
  target?:  string
  loading?: boolean
}

const DOT_CLASS = {
  green:  'dot-g',
  yellow: 'dot-y',
  red:    'dot-r',
  none:   '',
}

const PILL_CLASS = {
  green:  'pill pill-green',
  red:    'pill pill-red',
  yellow: 'pill pill-yellow',
  gray:   'pill pill-gray',
}

function fmtVal(v: number | null | undefined, fmt: SparkFmt): string {
  if (v == null || isNaN(v)) return '—'
  if (fmt === '$')     return `$${Math.round(v).toLocaleString()}`
  if (fmt === '$2')    return `$${v.toFixed(2)}`
  if (fmt === '%')     return `${(v * 100).toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

function CustomTooltip({ active, payload, label, sparkFmt }: {
  active?: boolean; payload?: {value: number|null; name: string; color: string}[]; label?: string; sparkFmt: SparkFmt
}) {
  if (!active || !payload?.length) return null
  const ty  = payload.find(p => p.name === 'v')
  const py  = payload.find(p => p.name === 'py')
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-slate-600 mb-1">{label}</div>
      {ty && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-teal-600 inline-block" /><span className="text-slate-700">This year: <b>{fmtVal(ty.value, sparkFmt)}</b></span></div>}
      {py && <div className="flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" /><span className="text-slate-500">Last year: <b>{fmtVal(py.value, sparkFmt)}</b></span></div>}
    </div>
  )
}

export default function KpiCard({ label, value, dot, pill, pill2, sub, tooltip, spark, sparkFmt = 'count', target, loading }: Props) {
  if (loading) {
    return (
      <div className="card">
        <div className="skeleton h-3 w-20 mb-3" />
        <div className="skeleton h-8 w-28 mb-2" />
        <div className="skeleton h-3 w-24 mb-2" />
        <div className="skeleton h-14 w-full" />
      </div>
    )
  }

  const hasSpark = spark && spark.length > 0

  return (
    <div className="card flex flex-col">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
        {label}
        {target && <span className="ml-1 font-normal text-slate-300">/ {target}</span>}
      </div>
      <div className="flex items-center gap-2">
        {tooltip ? (
          <span className="relative group cursor-default">
            <span className="text-2xl font-bold text-slate-800">{value}</span>
            <span className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block bg-slate-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-50 pointer-events-none shadow-lg">
              {tooltip}
            </span>
          </span>
        ) : (
          <div className="text-2xl font-bold text-slate-800">{value}</div>
        )}
        {dot !== 'none' && <span className={DOT_CLASS[dot]} />}
      </div>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {pill  && <span className={PILL_CLASS[pill.color]}>{pill.text}</span>}
        {pill2 && <span className={PILL_CLASS[pill2.color]}>{pill2.text}</span>}
      </div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      {hasSpark && (
        <div className="mt-auto pt-2" style={{ height: 64 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
              <YAxis domain={[0, 'auto']} hide />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <Tooltip
                content={<CustomTooltip sparkFmt={sparkFmt} />}
                cursor={{ stroke: '#e2e8f0', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="v"
                name="v"
                stroke="#0d9488"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="py"
                name="py"
                stroke="#94a3b8"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 3"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
