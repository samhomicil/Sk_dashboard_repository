'use client'

import type { StaffingData, StaffingCell } from '@/lib/types'

interface Props {
  data:    StaffingData | null
  store:   string
  period:  string
  loading: boolean
}

const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 15 }, (_, i) => {
  const h = i + 7
  return { num: h, label: `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}` }
})

// Color by txn/emp — same thresholds as original heatmap
function heatBg(v: number): string {
  if (!v)      return '#f8fafc'
  if (v < 5)   return '#dbeafe'
  if (v <= 8)  return '#ccfbf1'
  if (v <= 12) return '#0d9488'
  if (v <= 16) return '#f59e0b'
  return '#ef4444'
}
function heatFg(v: number): string {
  if (!v || v < 5) return '#93c5fd'
  if (v <= 8)      return '#0f766e'
  return '#fff'
}

function StoreGrid({ name, cells, compact, showEmployees }: { name: string; cells: StaffingCell[]; compact: boolean; showEmployees: boolean }) {
  const map = new Map(cells.map(c => [`${c.hourNum}|${c.day}`, c]))

  return (
    <div className="min-w-0">
      {compact && (
        <div className="text-[11px] font-bold text-slate-600 mb-1.5 text-center tracking-wide">{name}</div>
      )}
      {/* No overflow-x-auto in compact; table-fixed makes it fit its container */}
      <table className={`w-full table-fixed ${compact ? 'text-[9px]' : 'text-xs'}`}>
        <thead>
          <tr>
            <th className={`text-right text-slate-400 font-normal pb-1 ${compact ? 'w-[15%] pr-1' : 'w-[14%] pr-3'}`} />
            {DAYS.map(d => (
              <th key={d} className="text-center text-slate-500 font-bold pb-1">
                {compact ? d[0] : d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map(({ num, label }) => (
            <tr key={num}>
              <td className={`text-right text-slate-400 font-medium whitespace-nowrap ${compact ? 'pr-1 py-0.5' : 'pr-3 py-1'}`}>
                {label}
              </td>
              {[0,1,2,3,4,5,6].map(dow => {
                const c = map.get(`${num}|${dow}`)
                const txnPerEmp = c && c.count > 0 ? Math.round((c.avgTxn / c.count) * 10) / 10 : 0
                return (
                  <td key={dow} className={compact ? 'px-0.5 py-0.5' : 'py-1 px-1'}>
                    <div className="relative group">
                      <div
                        className={`w-full flex items-center justify-center rounded font-bold cursor-default ${compact ? 'h-5 text-[9px]' : 'h-9 text-[11px]'}`}
                        style={{ background: heatBg(txnPerEmp), color: heatFg(txnPerEmp) }}
                      >
                        {txnPerEmp > 0 ? txnPerEmp.toFixed(txnPerEmp % 1 === 0 ? 0 : 1) : ''}
                      </div>
                      {c && (
                        <div className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 bg-white border border-slate-200 shadow-lg rounded-lg p-2 pointer-events-none min-w-[190px]">
                          <div className="text-[10px] font-semibold text-slate-700 mb-1">
                            {DAYS[dow]} {label}{compact ? ` · ${name}` : ''}
                          </div>
                          <div className="text-[10px] text-slate-500 mb-1">
                            {c.avgTxn.toFixed(1)} avg txn · {c.count} emp avg → {txnPerEmp.toFixed(1)} txn/emp
                          </div>
                          {showEmployees && c.employees.length > 0 && (
                            <div className="border-t border-slate-100 mt-1 pt-1 space-y-0.5">
                              {c.employees.map((e, i) => (
                                <div key={i} className="flex items-center justify-between gap-3 text-[10px]">
                                  <span className="text-slate-700 truncate">{e.name}</span>
                                  <span className="text-slate-400 shrink-0">off {e.shiftEnd}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STORE_KEYS: Array<{ key: keyof StaffingData; label: string }> = [
  { key: 'pines',   label: 'Pines'   },
  { key: 'miramar', label: 'Miramar' },
  { key: 'margate', label: 'Margate' },
]

export default function Heatmap({ data, store, period, loading }: Props) {
  if (loading) return <div className="card"><div className="skeleton h-24 w-full" /></div>
  if (!data)   return null

  const isAll = store === 'all'
  const showEmployees = period === 'weekly'
  const visibleStores = isAll ? STORE_KEYS : STORE_KEYS.filter(s => s.key === store)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-bold text-slate-700">Staff Schedule — Txn / Employee by Hour</div>
          <div className="text-xs text-slate-400 mt-0.5">
            <span className="font-semibold text-blue-400">Blue &lt;5</span> overstaffed &nbsp;·&nbsp;
            <span className="font-semibold text-teal-600">Teal 5–8</span> optimal &nbsp;·&nbsp;
            <span className="font-semibold text-amber-500">Amber &gt;12</span> understaffed
            {showEmployees ? ' · hover for names' : ' · switch to weekly to see employees'}
          </div>
        </div>
      </div>

      {isAll ? (
        <div className="grid grid-cols-3 gap-6">
          {visibleStores.map(s => (
            <StoreGrid key={s.key} name={s.label} cells={data[s.key]} compact={true} showEmployees={showEmployees} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <StoreGrid name={visibleStores[0]?.label ?? ''} cells={data[visibleStores[0]?.key ?? 'pines']} compact={false} showEmployees={showEmployees} />
        </div>
      )}
    </div>
  )
}
