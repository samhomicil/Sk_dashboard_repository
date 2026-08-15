'use client'

import type { StoreRow, KpiData, Period } from '@/lib/types'
import { TARGETS } from '@/lib/config'
import LaborTooltip from './LaborTooltip'
import { UnknownValue } from '@/components/design/states'

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
// Deltas are signed, per the system's copy rule. The old ▲/▼ glyphs said the same
// thing the colour already says, twice.
function diffFmt(n: number) { return `${n >= 0 ? '+' : '-'}${Math.abs(n * 100).toFixed(1)}%` }
function dolFmt(n: number)  { return `$${Math.round(n).toLocaleString()}` }

/** A figure carrying its own judgement: coloured text, never a filled pill. */
function Toned({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  return <span className={`sk-tone-${tone}`} style={{ color: 'var(--tone)', fontWeight: 600 }}>{children}</span>
}

function vsTarget(actual: number, target: number) {
  if (!target) return null
  const diff = (actual - target) / target
  return <Toned tone={diff >= 0 ? 'good' : 'bad'}>{diffFmt(diff)}</Toned>
}

// Same three bands as before — ok / within 10% / beyond — now expressed as tone
// rather than a filled pill. Nine filled pills in one small table shouted louder
// than the sales figures they were meant to qualify.
function tonedPct(val: number, target: number, lowerIsBetter = false) {
  const ok   = lowerIsBetter ? val <= target : val >= target
  const warn = lowerIsBetter ? val <= target * 1.1 : val >= target * 0.9
  return <Toned tone={ok ? 'good' : warn ? 'warn' : 'bad'}>{pctFmt(val)}</Toned>
}

export default function StoreBreakdown({ stores, kpis, period, loading }: Props) {
  if (loading) return <div className="sk-card"><div className="skeleton" style={{ height: 160 }} /></div>

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
    <div className="sk-card">
      <h3 className="sk-card-title">Store breakdown</h3>
      <p className="sk-subline" style={{ margin: '4px 0 12px' }}>
        {isWeekly ? 'This week' : `${forecastLabel} forecast`}
      </p>
      <div className="sk-table-wrap">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th className="num" scope="col">{colLabel}</th>
              <th className="num" scope="col">YoY</th>
              <th className="num" scope="col">vs +10%</th>
              <th className="num" scope="col">Labor</th>
              <th className="num" scope="col">EE %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const yoy = r.salesPY > 0 ? (r.projected - r.salesPY) / r.salesPY : null
              return (
                <tr key={r.store}>
                  <td style={{ fontWeight: 600 }}>{r.store}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{dolFmt(r.projected)}</td>
                  <td className="num">
                    {yoy !== null
                      ? <Toned tone={yoy >= 0 ? 'good' : 'bad'}>{diffFmt(yoy)}</Toned>
                      : <UnknownValue reason="No prior-year sales for this store and period." label="—" />}
                  </td>
                  <td className="num">{vsTarget(r.projected, r.target)}</td>
                  <td className="num">
                    <LaborTooltip labor={r.laborCost} hours={r.laborHours}>
                      {tonedPct(r.laborPct, TARGETS.laborPct, true)}
                    </LaborTooltip>
                  </td>
                  <td className="num">{tonedPct(r.eePct, TARGETS.eePct)}</td>
                </tr>
              )
            })}
            {rows.length > 1 && (() => {
              const totalPY  = rows.reduce((s, r) => s + r.salesPY, 0)
              const totalYoY = totalPY > 0 ? (totalProjected - totalPY) / totalPY : null
              return (
                <tr className="total">
                  <td>Total</td>
                  <td className="num">{dolFmt(totalProjected)}</td>
                  <td className="num">
                    {totalYoY !== null
                      ? <Toned tone={totalYoY >= 0 ? 'good' : 'bad'}>{diffFmt(totalYoY)}</Toned>
                      : <UnknownValue reason="No prior-year sales for this period." label="—" />}
                  </td>
                  <td className="num">{vsTarget(totalProjected, totalTarget)}</td>
                  <td className="num">
                    {kpis && (
                      <LaborTooltip labor={kpis.laborCost} hours={kpis.laborHours}>
                        {tonedPct(kpis.laborPct, TARGETS.laborPct, true)}
                      </LaborTooltip>
                    )}
                  </td>
                  <td className="num">{kpis && tonedPct(kpis.eePct, TARGETS.eePct)}</td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
