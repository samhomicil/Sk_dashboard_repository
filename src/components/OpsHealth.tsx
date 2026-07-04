'use client'

import type { KpiData } from '@/lib/types'
import { TARGETS } from '@/lib/config'

interface Props {
  kpis:    KpiData | null
  loading: boolean
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%` }
function dol(n: number) { return n >= 0 ? `+$${Math.abs(Math.round(n))}` : `-$${Math.abs(Math.round(n))}` }

export default function OpsHealth({ kpis, loading }: Props) {
  if (loading) return <div className="card md:col-span-2"><div className="skeleton h-24 w-full" /></div>
  if (!kpis) return null

  const voidOk     = kpis.voidPct     <= TARGETS.voidPct
  const discOk     = kpis.discountPct <= TARGETS.discountPct
  const tillOk     = kpis.tillVariance >= -20 // within -$20 is fine
  const allOk      = voidOk && discOk && tillOk

  const metrics = [
    {
      label: 'Void %',
      target: `<${pct(TARGETS.voidPct)}`,
      value: pct(kpis.voidPct),
      l4w: pct(kpis.voidPctL4W),
      ok: voidOk,
      warn: kpis.voidPct <= TARGETS.voidPct * 1.5,
    },
    {
      label: 'Discount %',
      target: `<${pct(TARGETS.discountPct)}`,
      value: pct(kpis.discountPct),
      l4w: pct(kpis.discountPctL4W),
      ok: discOk,
      warn: kpis.discountPct <= TARGETS.discountPct * 1.2,
    },
    {
      label: 'Till Variance',
      target: '> -$20',
      value: dol(kpis.tillVariance),
      l4w: dol(kpis.tillVarianceL4W),
      ok: tillOk,
      warn: kpis.tillVariance >= -50,
    },
  ]

  return (
    <div className="card md:col-span-2 border border-slate-100">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        Ops Health
        <span className="ml-1 font-normal text-slate-300">— flagged only if outside threshold</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="flex sm:block items-center gap-4 py-2 sm:py-0 border-b sm:border-b-0 border-slate-50 last:border-0">
            <div className="w-28 sm:w-auto shrink-0">
              <div className="text-xs text-slate-500 mb-0.5">
                {m.label} <span className="text-slate-300">{m.target}</span>
              </div>
              <div className="text-xs text-slate-400">L4W: <span className="font-semibold text-slate-500">{m.l4w}</span></div>
            </div>
            <div className="flex items-center gap-2">
              <span className={m.ok ? 'dot-g' : m.warn ? 'dot-y' : 'dot-r'} />
              <span className={`text-lg font-bold ${m.ok ? 'text-slate-700' : m.warn ? 'text-amber-600' : 'text-red-600'}`}>
                {m.value}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${allOk ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        {allOk
          ? '✅ All ops metrics within target — no action needed'
          : `⚠️ ${metrics.filter(m => !m.ok).map(m => m.label).join(', ')} outside target — review needed`
        }
      </div>
    </div>
  )
}
