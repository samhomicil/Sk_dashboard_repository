'use client'

/**
 * Quarterly breakdown, on the design system's table.
 *
 * The bands are unchanged — ok at target, warn within 10%, bad beyond — but they
 * are tone on the figure now rather than a filled pill. Seven pills across a row
 * competed with the sales column they were supposed to qualify.
 *
 * The current quarter and an upcoming one are marked in words ("in progress",
 * "upcoming"), not by tinting the row: a teal band said "look here" about a row
 * that is simply incomplete.
 */
import type { QuarterRow } from '@/lib/types'
import { TARGETS } from '@/lib/config'
import LaborTooltip from './LaborTooltip'
import { UnknownValue } from '@/components/design/states'

interface Props {
  quarters: QuarterRow[]
  loading:  boolean
}

function fmtD(n: number | null) { return n !== null ? `$${Math.round(n).toLocaleString()}` : '—' }
function fmtP(n: number | null) { return n !== null ? `${(n * 100).toFixed(1)}%` : '—' }

function Toned({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  return <span className={`sk-tone-${tone}`} style={{ color: 'var(--tone)', fontWeight: 600 }}>{children}</span>
}
const none = (why: string) => <UnknownValue reason={why} label="—" />

function diff(a: number | null, b: number | null) {
  if (a === null || b === null || b === 0) return none('No prior-year figure to compare against.')
  const d = (a - b) / b
  return <Toned tone={d >= 0 ? 'good' : 'bad'}>{d >= 0 ? '+' : '-'}{Math.abs(d * 100).toFixed(1)}%</Toned>
}
const band = (v: number, target: number, lowerBetter: boolean) =>
  (lowerBetter ? v <= target : v >= target) ? 'good'
    : (lowerBetter ? v <= target * 1.1 : v >= target * 0.75) ? 'warn' : 'bad'

export default function QuarterTable({ quarters, loading }: Props) {
  if (loading) return <div className="sk-card"><div className="skeleton" style={{ height: 128 }} /></div>

  return (
    <div className="sk-card">
      <h3 className="sk-card-title">Quarterly breakdown</h3>
      <p className="sk-subline" style={{ margin: '4px 0 12px' }}>Current quarter in progress</p>
      <div className="sk-table-wrap">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">Quarter</th>
              <th className="num" scope="col">Sales</th>
              <th className="num" scope="col">vs PY</th>
              <th className="num" scope="col">vs +10%</th>
              <th className="num" scope="col">Orders</th>
              <th className="num" scope="col">Labor %</th>
              <th className="num" scope="col">COGS %</th>
              <th className="num" scope="col">EE %</th>
              <th className="num" scope="col">ATV</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map(q => {
              const target = q.salesPY !== null ? Math.round(q.salesPY * 1.10) : null
              return (
                <tr key={q.quarter} className={q.isFuture ? 'muted' : undefined}>
                  <td className="nowrap" style={{ fontWeight: 600 }}>
                    {q.quarter}
                    {q.isCurrent && <span className="sk-note"> in progress</span>}
                    {q.isFuture && <span className="sk-note"> upcoming</span>}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtD(q.sales)}</td>
                  <td className="num">{diff(q.sales, q.salesPY)}</td>
                  <td className="num">{diff(q.sales, target)}</td>
                  <td className="num">{q.orders?.toLocaleString() ?? none('No order count for this quarter.')}</td>
                  <td className="num">
                    {q.laborPct !== null
                      ? <LaborTooltip labor={q.laborCost} hours={q.laborHours}>
                          <Toned tone={band(q.laborPct, TARGETS.laborPct, true)}>{fmtP(q.laborPct)}</Toned>
                        </LaborTooltip>
                      : none('No labor recorded for this quarter.')}
                  </td>
                  <td className="num">
                    {q.cogsPct !== null
                      ? <Toned tone={band(q.cogsPct, TARGETS.cogsPct, true)}>{fmtP(q.cogsPct)}</Toned>
                      : none('No counted inventory in this quarter.')}
                  </td>
                  <td className="num">
                    {q.eePct !== null
                      ? <Toned tone={band(q.eePct, TARGETS.eePct, false)}>{fmtP(q.eePct)}</Toned>
                      : none('No enhancer attachment recorded.')}
                  </td>
                  <td className="num">{q.atv !== null ? `$${q.atv.toFixed(2)}` : none('No ATV for this quarter.')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
