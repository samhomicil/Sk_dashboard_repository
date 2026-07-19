'use client'

import { Fragment, useState } from 'react'

// Jolt completion — per-location Complete / On-Time / Late / Missed with a summary
// bar, each location row collapsing open to its per-checklist breakdown.
// "Complete" = the checklist was submitted in Jolt over the rolling 7-day window.

interface Counts {
  total: number; on_time: number; late: number; missed: number; complete: number
  complete_rate: number; on_time_rate: number; late_rate: number; missed_rate: number
}
interface ListRow extends Counts { list_name: string }
interface LocationRow extends Counts { store: string; label: string; lists: ListRow[] }
export interface SopData {
  window: { start: string; end: string } | null
  locations: LocationRow[]
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`
const shortDate = (s?: string) => (s ? `${Number(s.split('-')[1])}/${Number(s.split('-')[2])}` : '')

const COMPLETE_TARGET = 0.85 // completion target; below this reads red

// Default columns show "count (pct%)". The Complete column leads with the pct and
// colors it green/red against the 85% target.
function Cell({ count, rate, pctFirst, target }: {
  count: number; rate: number; pctFirst?: boolean; target?: number
}) {
  const color = target != null
    ? (rate >= target ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold')
    : 'text-slate-700'
  return (
    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
      {pctFirst ? (
        <><span className={color}>{pct(rate)}</span> <span className="text-slate-400">({count})</span></>
      ) : (
        <span className="text-slate-700">{count} <span className="text-slate-400">({pct(rate)})</span></span>
      )}
    </td>
  )
}

function SummaryBar({ r }: { r: Counts }) {
  const seg = (w: number, color: string, title: string) =>
    w > 0 ? <div style={{ width: `${w * 100}%`, background: color }} className="h-2" title={title} /> : null
  return (
    <div className="flex w-full min-w-[90px] rounded-sm overflow-hidden bg-slate-100">
      {seg(r.on_time_rate, '#2563eb', `On-time ${pct(r.on_time_rate)}`)}
      {seg(r.late_rate, '#7dd3fc', `Late ${pct(r.late_rate)}`)}
      {seg(r.missed_rate, '#dc2626', `Missed ${pct(r.missed_rate)}`)}
    </div>
  )
}

export default function SopCard({ data, loading }: { data: SopData | null; loading?: boolean }) {
  const locations = data?.locations ?? []
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (s: string) => setOpen(o => ({ ...o, [s]: !o[s] }))

  if (loading) {
    return (
      <div className="card">
        <div className="skeleton h-3 w-40 mb-3" />
        <div className="skeleton h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Jolt Completion</span>
        <span className="text-[10px] text-slate-400">
          submitted{data?.window ? ` · ${shortDate(data.window.start)}–${shortDate(data.window.end)}` : ''}
        </span>
      </div>

      {locations.length === 0 ? (
        <div className="text-xs text-slate-400 py-4">No Jolt data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="px-2 py-1.5 text-left font-semibold">Location</th>
                <th className="px-2 py-1.5 text-right font-semibold">
                  Complete <span className="font-normal text-slate-300">tgt 85%</span>
                </th>
                <th className="px-2 py-1.5 text-right font-semibold">On-Time</th>
                <th className="px-2 py-1.5 text-right font-semibold">Late</th>
                <th className="px-2 py-1.5 text-right font-semibold">Missed</th>
                <th className="px-2 py-1.5 text-left font-semibold w-28">Summary</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => {
                const isOpen = !!open[loc.store]
                return (
                  <Fragment key={loc.store}>
                    <tr
                      className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                      onClick={() => toggle(loc.store)}
                    >
                      <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                        <span className="inline-block w-3 text-slate-400">{isOpen ? '▾' : '▸'}</span>
                        {loc.label}
                      </td>
                      <Cell count={loc.complete} rate={loc.complete_rate} pctFirst target={COMPLETE_TARGET} />
                      <Cell count={loc.on_time} rate={loc.on_time_rate} />
                      <Cell count={loc.late} rate={loc.late_rate} />
                      <Cell count={loc.missed} rate={loc.missed_rate} />
                      <td className="px-2 py-1.5"><SummaryBar r={loc} /></td>
                    </tr>
                    {isOpen && loc.lists.map(l => (
                      <tr key={l.list_name} className="bg-slate-50/60 border-b border-slate-100 text-slate-500">
                        <td className="px-2 py-1 pl-8 whitespace-nowrap">{l.list_name}</td>
                        <Cell count={l.complete} rate={l.complete_rate} pctFirst target={COMPLETE_TARGET} />
                        <Cell count={l.on_time} rate={l.on_time_rate} />
                        <Cell count={l.late} rate={l.late_rate} />
                        <Cell count={l.missed} rate={l.missed_rate} />
                        <td className="px-2 py-1"><SummaryBar r={l} /></td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
