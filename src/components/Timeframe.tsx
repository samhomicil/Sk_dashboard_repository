'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { resolveDateRange } from '@/lib/dates'
import type { Period } from '@/lib/types'

const OPTS: { key: Period; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'ytd', label: 'YTD' },
  { key: 'custom', label: 'Custom' },
]

const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Shared timeframe control — mirrors the dashboard's Period model (resolveDateRange) and
// writes the choice to the URL, so every tab in a module re-scopes together and a link
// carries its window. Used by the inventory module and the employee module; it is module
// agnostic (it reads usePathname), so any future surface should reuse it rather than
// growing a second period vocabulary.
export default function Timeframe() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const period = (sp.get('period') as Period) || 'quarterly'
  const cs = sp.get('start') || ''
  const ce = sp.get('end') || ''
  const [showCustom, setShowCustom] = useState(period === 'custom')
  const [start, setStart] = useState(cs || resolveDateRange('custom').start)
  const [end, setEnd] = useState(ce || resolveDateRange('custom').end)

  const win = resolveDateRange(period, cs || undefined, ce || undefined)

  function push(p: Period, s?: string, e?: string) {
    const params = new URLSearchParams(Array.from(sp.entries()))
    params.set('period', p)
    if (p === 'custom' && s && e) { params.set('start', s); params.set('end', e) }
    else { params.delete('start'); params.delete('end') }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function pick(p: Period) {
    if (p === 'custom') { setShowCustom(true); push('custom', start, end); return }
    setShowCustom(false); push(p)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
        {OPTS.map(o => (
          <button key={o.key} onClick={() => pick(o.key)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === o.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {showCustom ? (
        <div className="flex items-center gap-1.5">
          <input type="date" value={start} onChange={e => setStart(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1" />
          <span className="text-slate-400 text-xs">→</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1" />
          <button onClick={() => push('custom', start, end)}
            className="text-xs font-medium px-2.5 py-1 rounded-md bg-teal-600 text-white hover:bg-teal-700">Apply</button>
        </div>
      ) : (
        <span className="text-xs text-slate-400">{fmt(win.start)} – {fmt(win.end)}</span>
      )}
    </div>
  )
}
