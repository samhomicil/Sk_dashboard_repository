'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { DaypartPayload, DaypartProductRow } from '@/lib/menuMixUtils'
import { parseSize, parseFlavor } from '@/lib/menuMixUtils'

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CAT_DOT: Record<string, string> = {
  'Smoothies':       '#14b8a6',
  'Smoothie Bowls':  '#8b5cf6',
  'Food':            '#f59e0b',
  'Retail Products': '#38bdf8',
  'Retail Goods':    '#94a3b8',
}

const STORE_COLOR: Record<'pines' | 'miramar' | 'margate', string> = {
  pines:   '#0d9488',
  miramar: '#6366f1',
  margate: '#f59e0b',
}
const STORE_LABEL: Record<'pines' | 'miramar' | 'margate', string> = {
  pines: 'Pines', miramar: 'Miramar', margate: 'Margate',
}
const STORE_KEYS = ['pines', 'miramar', 'margate'] as const

type Metric = 'sales' | 'qty' | 'ee'

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct   = (n: number) => `${(n * 100).toFixed(1)}%`

function displayName(p: DaypartProductRow) {
  return p.subcategory === 'Smoothies'
    ? `${parseSize(p.product)} · ${parseFlavor(p.product)}`
    : parseFlavor(p.product)
}

function DaypartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-lg p-2 text-xs min-w-[130px]">
      <div className="font-semibold text-slate-600 mb-1">{p.name}</div>
      <div className="text-slate-500">{money(p.sales)} · {pct(p.pct)} of sales</div>
      <div className="text-slate-400">{p.perDay.toFixed(1)} units/day</div>
      <div className="text-teal-600 mt-1 font-medium">Click for detail →</div>
    </div>
  )
}

function WeekdayTooltip({ active, payload, metric }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-lg p-2 text-xs min-w-[130px]">
      <div className="font-semibold text-slate-600 mb-1">{p.label}</div>
      {metric === 'sales' && <div className="text-slate-500">{money(p.avgSales)} avg/day</div>}
      {metric === 'qty'   && <div className="text-slate-500">{Math.round(p.avgQty).toLocaleString()} units avg/day</div>}
      {metric === 'ee'    && <div className="text-slate-500">{pct(p.eePct)} EE% ({p.eeSum}/{p.smSum} checks)</div>}
    </div>
  )
}

function GroupedWeekdayTooltip({ active, payload, label, metric }: any) {
  if (!active || !payload?.length) return null
  const fmt = (v: number) => metric === 'sales' ? money(v) : metric === 'ee' ? pct(v) : Math.round(v).toLocaleString()
  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-lg p-2 text-xs min-w-[140px]">
      <div className="font-semibold text-slate-600 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-3">
          <span style={{ color: p.fill }}>{STORE_LABEL[p.dataKey as keyof typeof STORE_LABEL]}</span>
          <span className="text-slate-600 tabular-nums">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function DaypartTrends({ store }: { store: string }) {
  const [data, setData]                       = useState<DaypartPayload | null>(null)
  const [loading, setLoading]                 = useState(true)
  const [selectedDaypart, setSelectedDaypart] = useState<string | null>(null)
  const [metric, setMetric]                   = useState<Metric>('sales')

  useEffect(() => {
    setLoading(true)
    setSelectedDaypart(null)
    fetch(`/api/menu-mix-daypart?store=${store}`)
      .then(r => r.json())
      .then(d => { setData(d?.daypart?.length ? d : null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [store])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card"><div className="animate-pulse h-48 bg-slate-100 rounded-lg w-full" /></div>
        <div className="card"><div className="animate-pulse h-48 bg-slate-100 rounded-lg w-full" /></div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="card border-2 border-dashed border-slate-200" style={{ boxShadow: 'none', background: '#f8fafc' }}>
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-slate-300 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
          </svg>
          <div>
            <div className="font-bold text-slate-600">Day-Part &amp; Weekday Trends</div>
            <div className="text-sm text-slate-500 mt-1 max-w-2xl">Data not available yet.</div>
          </div>
        </div>
      </div>
    )
  }

  const windowDays = data.weekday.reduce((s, w) => s + w.days, 0) || 1
  const totalSales = data.daypart.reduce((s, d) => s + d.sales, 0)

  const dpRows = data.daypart.map(d => ({
    ...d,
    pct:    totalSales > 0 ? d.sales / totalSales : 0,
    perDay: d.qty / windowDays,
  }))

  const wdRows = [...data.weekday]
    .sort((a, b) => a.dow - b.dow)
    .map(w => {
      const eeRow = data.ee.find(e => e.dow === w.dow)
      return {
        ...w,
        label:    DOW_LABELS[w.dow],
        avgSales: w.days > 0 ? w.sales / w.days : 0,
        avgQty:   w.days > 0 ? w.qty / w.days : 0,
        eePct:    eeRow && eeRow.sm > 0 ? eeRow.ee / eeRow.sm : 0,
        eeSum:    eeRow?.ee ?? 0,
        smSum:    eeRow?.sm ?? 0,
      }
    })

  const wdValue = (r: (typeof wdRows)[number]) => metric === 'sales' ? r.avgSales : metric === 'qty' ? r.avgQty : r.eePct
  const peakDow = wdRows.reduce((best, r) => wdValue(r) > wdValue(best) ? r : best, wdRows[0])?.dow

  const isGrouped = store === 'all' && !!data.weekdayByStore
  const groupedRows = isGrouped
    ? DOW_LABELS.map((label, dow) => {
        const row: Record<string, string | number> = { label, dow }
        for (const s of STORE_KEYS) {
          if (metric === 'ee') {
            const eRow = data.eeByStore?.[s]?.find(e => e.dow === dow)
            row[s] = eRow && eRow.sm > 0 ? eRow.ee / eRow.sm : 0
          } else {
            const wRow = data.weekdayByStore![s].find(w => w.dow === dow)
            row[s] = wRow ? (metric === 'sales' ? wRow.sales / (wRow.days || 1) : wRow.qty / (wRow.days || 1)) : 0
          }
        }
        return row
      })
    : []

  const detailCats     = selectedDaypart ? (data.categories[selectedDaypart] ?? []) : []
  const detailCatTotal = detailCats.reduce((s, c) => s + c.sales, 0)
  const detailProducts = selectedDaypart ? (data.products[selectedDaypart] ?? []) : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-sm font-bold text-slate-700">Daypart Mix</div>
            <div className="text-xs text-slate-400">Trailing 90 days</div>
          </div>
          <div className="text-xs text-slate-400 mb-3">{data.windowStart} – {data.windowEnd} · click a bar for detail</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={dpRows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip content={<DaypartTooltip />} cursor={{ fill: '#f1f5f9' }} />
              <Bar
                dataKey="sales"
                radius={[4, 4, 0, 0]}
                maxBarSize={56}
                style={{ cursor: 'pointer' }}
                onClick={(d: any) => setSelectedDaypart(prev => prev === d.name ? null : d.name)}
              >
                {dpRows.map(d => (
                  <Cell key={d.name} fill={d.name === selectedDaypart ? '#0d9488' : '#14b8a6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-slate-50">
            {dpRows.map(d => (
              <button
                key={d.name}
                onClick={() => setSelectedDaypart(prev => prev === d.name ? null : d.name)}
                className={`text-center rounded-md py-1 transition-colors ${d.name === selectedDaypart ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
              >
                <div className="text-xs text-slate-400">{d.name}</div>
                <div className="text-sm font-semibold text-slate-700 tabular-nums">{pct(d.pct)}</div>
                <div className="text-xs text-slate-400 tabular-nums">{d.perDay.toFixed(1)}/day</div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-sm font-bold text-slate-700">Weekday Trends</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMetric('sales')}
                className={`px-2 py-0.5 text-[10px] rounded-full font-medium transition-colors ${metric === 'sales' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                Revenue
              </button>
              <button
                onClick={() => setMetric('qty')}
                className={`px-2 py-0.5 text-[10px] rounded-full font-medium transition-colors ${metric === 'qty' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                Units
              </button>
              <button
                onClick={() => setMetric('ee')}
                className={`px-2 py-0.5 text-[10px] rounded-full font-medium transition-colors ${metric === 'ee' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                EE%
              </button>
            </div>
          </div>
          <div className="text-xs text-slate-400 mb-3">
            {data.windowStart} – {data.windowEnd} · avg per weekday occurrence{isGrouped ? ' · by store' : ''}
          </div>
          <ResponsiveContainer width="100%" height={150}>
            {isGrouped ? (
              <BarChart data={groupedRows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<GroupedWeekdayTooltip metric={metric} />} cursor={{ fill: '#f1f5f9' }} />
                {STORE_KEYS.map(s => (
                  <Bar key={s} dataKey={s} fill={STORE_COLOR[s]} radius={[3, 3, 0, 0]} maxBarSize={14} />
                ))}
              </BarChart>
            ) : (
              <BarChart data={wdRows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<WeekdayTooltip metric={metric} />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey={metric === 'sales' ? 'avgSales' : metric === 'qty' ? 'avgQty' : 'eePct'} radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {wdRows.map(r => <Cell key={r.dow} fill={r.dow === peakDow ? '#0d9488' : '#5eead4'} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
          {isGrouped && (
            <div className="flex items-center justify-center gap-4 mt-1 text-xs">
              {STORE_KEYS.map(s => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STORE_COLOR[s] }} />
                  <span className="text-slate-500">{STORE_LABEL[s]}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-50">
            {metric === 'ee'
              ? <>{DOW_LABELS[peakDow]} has the highest EE% ({pct(wdValue(wdRows[peakDow]))}){store !== 'all' ? '' : ' across all stores'} — add-on attach rate peaks here.</>
              : <>{DOW_LABELS[peakDow]} is the busiest day by {metric === 'sales' ? 'revenue' : 'units'}{store !== 'all' ? '' : ' across all stores'} — plan staffing accordingly.</>}
          </div>
        </div>
      </div>

      {selectedDaypart && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-slate-700">{selectedDaypart} — Category &amp; Product Mix</div>
            <button onClick={() => setSelectedDaypart(null)} className="text-xs text-slate-400 hover:text-slate-600 font-medium">
              Close ✕
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Category Mix</div>
              {detailCats.map(c => {
                const share = detailCatTotal > 0 ? c.sales / detailCatTotal : 0
                return (
                  <div key={c.subcategory} className="mb-2.5">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">
                        <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: CAT_DOT[c.subcategory] ?? '#94a3b8' }} />
                        {c.subcategory}
                      </span>
                      <span className="font-medium text-slate-700 tabular-nums">{pct(share)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: CAT_DOT[c.subcategory] ?? '#94a3b8' }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="md:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Top Products</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase border-b border-slate-100">
                      <th className="text-left pb-2 font-medium w-5">#</th>
                      <th className="text-left pb-2 font-medium">Product</th>
                      <th className="text-right pb-2 font-medium">Units</th>
                      <th className="text-right pb-2 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailProducts.map((p, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-1.5 text-slate-300 tabular-nums">{i + 1}</td>
                        <td className="py-1.5 pr-2 font-medium text-slate-700 max-w-[220px] truncate" title={p.product}>
                          <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: CAT_DOT[p.subcategory] ?? '#94a3b8' }} />
                          {displayName(p)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">{p.qty.toLocaleString()}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-slate-700">{money(p.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
