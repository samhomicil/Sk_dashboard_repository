'use client'

import type { KpiData, Promotion, Period } from '@/lib/types'
import { TARGETS } from '@/lib/config'
import { weekLabel } from '@/lib/dates'

interface Props {
  kpis:        KpiData | null
  loading:     boolean
  period?:     Period
  promotions?: Promotion[]
}

interface Flag {
  level: 'red' | 'yellow' | 'green'
  text:  string
}

export default function Callouts({ kpis, loading, period, promotions = [] }: Props) {
  if (loading) return <div className="card md:col-span-2"><div className="skeleton h-32 w-full" /></div>
  if (!kpis) return null

  const showPromotions = period === 'weekly' && promotions.length > 0

  const flags: Flag[] = []

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const dol = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString()}`

  // EE%
  const eeDiff = kpis.eePct - TARGETS.eePct
  if (kpis.eePct < TARGETS.eePct * 0.5) {
    flags.push({ level: 'red', text: `EE% is ${pct(kpis.eePct)} — target ${pct(TARGETS.eePct)}. Recommend adding to weekly team agenda.` })
  } else if (kpis.eePct < TARGETS.eePct * 0.75) {
    flags.push({ level: 'yellow', text: `EE% is ${pct(kpis.eePct)} — ${pct(Math.abs(eeDiff))} below target.` })
  } else if (kpis.eePct >= TARGETS.eePct) {
    flags.push({ level: 'green', text: `EE% at ${pct(kpis.eePct)} — at or above ${pct(TARGETS.eePct)} target. ✓` })
  }

  // Sales vs 10% target
  if (kpis.salesPY > 0) {
    const vsPY  = (kpis.sales - kpis.salesPY) / kpis.salesPY
    const vsTarget = (kpis.sales - kpis.salesTarget) / kpis.salesTarget
    if (vsPY >= TARGETS.salesGrowthYoY) {
      flags.push({ level: 'green', text: `Sales up ${pct(vsPY)} vs PY — exceeding 10% growth target.` })
    } else if (vsTarget >= -0.03) {
      flags.push({ level: 'yellow', text: `Sales up ${pct(vsPY)} vs PY — within reach of 10% target (${dol(kpis.salesTarget - kpis.sales)} gap).` })
    } else {
      flags.push({ level: 'red', text: `Sales ${pct(Math.abs(vsPY < 0 ? vsPY : vsTarget))} behind 10% growth target. Gap: ${dol(kpis.salesTarget - kpis.sales)}.` })
    }
  }

  // COGS vs theoretical
  if (kpis.cogsActualPct != null && kpis.cogsTheoreticalPct != null) {
    const cogsVar = kpis.cogsActualPct - kpis.cogsTheoreticalPct
    if (cogsVar > 0.05) {
      flags.push({ level: 'red', text: `Food cost at ${pct(kpis.cogsActualPct)} — ${pct(Math.abs(cogsVar))} over theoretical ${pct(kpis.cogsTheoreticalPct)}. Investigate inventory counts and waste.` })
    } else if (cogsVar > 0.02) {
      flags.push({ level: 'yellow', text: `Food cost at ${pct(kpis.cogsActualPct)} — ${pct(Math.abs(cogsVar))} over theoretical. Monitor for waste or count errors.` })
    } else if (cogsVar < -0.04) {
      flags.push({ level: 'yellow', text: `Food cost at ${pct(kpis.cogsActualPct)} — ${pct(Math.abs(cogsVar))} below theoretical. Verify inventory count is complete.` })
    } else {
      flags.push({ level: 'green', text: `Food cost ${pct(kpis.cogsActualPct)} — tracking close to theoretical ${pct(kpis.cogsTheoreticalPct)}.` })
    }
  }

  // PFS Spend vs L4W
  if (kpis.pfsPctL4W > 0 && kpis.pfsPct > kpis.pfsPctL4W * 1.5) {
    flags.push({ level: 'yellow', text: `PFS Spend% jumped to ${pct(kpis.pfsPct)} vs L4W avg ${pct(kpis.pfsPctL4W)}. Review latest delivery invoice for discrepancies.` })
  }

  // Labor
  if (kpis.laborPct > TARGETS.laborPct) {
    flags.push({ level: 'red', text: `Labor% at ${pct(kpis.laborPct)} — above ${pct(TARGETS.laborPct)} target. Review scheduling.` })
  } else if (kpis.laborPct > TARGETS.laborPct * 0.9) {
    flags.push({ level: 'yellow', text: `Labor% at ${pct(kpis.laborPct)} — approaching ${pct(TARGETS.laborPct)} target.` })
  } else {
    flags.push({ level: 'green', text: `Labor% at ${pct(kpis.laborPct)} — ${pct(TARGETS.laborPct - kpis.laborPct)} below target.` })
  }

  // Till Variance
  if (kpis.tillVariance < -50) {
    flags.push({ level: 'red', text: `Till Variance at -${dol(kpis.tillVariance)} — investigate cash handling.` })
  } else if (kpis.tillVarianceL4W < -20 && kpis.tillVariance > kpis.tillVarianceL4W) {
    flags.push({ level: 'green', text: `Till Variance improved to -${dol(kpis.tillVariance)} vs L4W avg -${dol(kpis.tillVarianceL4W)}.` })
  }

  // ATV
  if (kpis.atvL4W > 0 && kpis.atv > kpis.atvL4W) {
    flags.push({ level: 'green', text: `ATV up $${(kpis.atv - kpis.atvL4W).toFixed(2)} vs L4W avg — upsell momentum improving.` })
  }

  // Ops metrics
  const opsOk = kpis.voidPct <= TARGETS.voidPct && kpis.discountPct <= TARGETS.discountPct
  if (opsOk) {
    flags.push({ level: 'green', text: `Void% (${pct(kpis.voidPct)}) and Discount% (${pct(kpis.discountPct)}) both within target.` })
  }

  const sorted = [
    ...flags.filter(f => f.level === 'red'),
    ...flags.filter(f => f.level === 'yellow'),
    ...flags.filter(f => f.level === 'green'),
  ]

  const icon = { red: '🔴', yellow: '🟡', green: '🟢' }

  function formatOfferValue(p: Promotion): string | null {
    if (p.offerValue == null) return null
    switch (p.offerValueUnit) {
      case 'dollars':      return `$${p.offerValue} off`
      case 'percent':      return `${p.offerValue}% off`
      case 'multiplier_x': return `${p.offerValue}x points`
      case 'points':       return `${Math.round(p.offerValue).toLocaleString()} pts`
      default:              return `${p.offerValue}${p.offerValueUnit ? ` ${p.offerValueUnit}` : ''}`
    }
  }

  return (
    <div className="card md:col-span-2">
      <div className="text-sm font-bold text-slate-700 mb-0.5">Weekly Callouts</div>
      <div className="text-xs text-slate-400 mb-3">Auto-generated flags from targets and L4W variance</div>

      {showPromotions && (
        <div className="mb-3 pb-3 border-b border-slate-100">
          <div className="text-xs font-bold text-slate-500 mb-1.5">Promotions running this week</div>
          <div className="space-y-2">
            {promotions.map(p => (
              <div key={p.offerName + p.startDate} className="flex items-start gap-2">
                <span className="text-sm shrink-0">📣</span>
                <div className="text-xs leading-5">
                  <span className="font-semibold text-slate-700">{p.offerName}</span>
                  {formatOfferValue(p) && <span className="text-slate-500"> — {formatOfferValue(p)}</span>}
                  <span className="text-slate-400"> · {weekLabel(p.startDate)}–{weekLabel(p.endDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-50">
        {sorted.map((f, i) => (
          <div key={i} className="flex items-start gap-2 py-2">
            <span className="text-sm shrink-0">{icon[f.level]}</span>
            <span className="text-xs text-slate-600 leading-5">{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
