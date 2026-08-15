'use client'

import { TARGETS } from '@/lib/config'
import type { DailyRangeData, DailyRow } from '@/lib/types'
import LaborTooltip from './LaborTooltip'
import { UnknownValue } from '@/components/design/states'

function pct(n: number, d = 1) { return `${(n * 100).toFixed(d)}%` }
function dol(n: number)        { return `$${Math.round(n).toLocaleString()}` }

/** Signed delta against the same date a year ago. Absent PY is unknown, not zero. */
function VsPY({ cur, py, lowerBetter = false }: { cur: number | null; py: number | null; lowerBetter?: boolean }) {
  if (cur == null || py == null || py === 0) return <UnknownValue reason="No prior-year figure for this date." label="—" />
  const delta = (cur - py) / py
  const good  = lowerBetter ? delta <= 0 : delta >= 0
  return <Toned tone={good ? 'good' : 'bad'}>{delta >= 0 ? '+' : '-'}{Math.abs(delta * 100).toFixed(1)}%</Toned>
}

function Toned({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  return <span className={`sk-tone-${tone}`} style={{ color: 'var(--tone)', fontWeight: 600 }}>{children}</span>
}
const gap = (why: string) => <UnknownValue reason={why} label="—" />

interface Props {
  data:    DailyRangeData | null
  loading: boolean
}

export default function DailyTable({ data, loading }: Props) {
  if (loading) {
    return <div className="sk-card"><div className="skeleton" style={{ height: 160 }} /></div>
  }

  if (!data || data.current.length === 0) {
    return <div className="sk-card"><p className="sk-flags-empty">No daily data for this range — try refreshing.</p></div>
  }

  const { current, py } = data

  const totSales    = current.reduce((s, r) => s + (r.sales  ?? 0), 0)
  const totOrders   = current.reduce((s, r) => s + (r.orders ?? 0), 0)
  const totPySales  = py.reduce((s, r) => s + (r.sales  ?? 0), 0)
  const totPyOrders = py.reduce((s, r) => s + (r.orders ?? 0), 0)

  const avgEE        = (() => { const r = current.filter(r => r.eePct    != null); return r.length ? r.reduce((s,r)=>s+r.eePct!,0)/r.length : null })()
  const avgLabor     = (() => { const r = current.filter(r => r.laborPct != null); return r.length ? r.reduce((s,r)=>s+r.laborPct!,0)/r.length : null })()
  const totLaborCost = current.reduce((s, r) => s + (r.laborCost ?? 0), 0)
  const totLaborHrs  = current.reduce((s, r) => s + (r.laborHours ?? 0), 0)
  const avgVoid  = (() => { const r = current.filter(r => r.voidPct  != null); return r.length ? r.reduce((s,r)=>s+r.voidPct!,0)/r.length : null })()

  return (
    <div className="sk-card">
      <div className="sk-sechead" style={{ marginBottom: 12 }}>
        <h3 className="sk-card-title">Daily activity</h3>
        {py.length > 0 && <span className="sk-meta">vs PY = same dates one year ago</span>}
      </div>

      <div className="sk-table-wrap">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Day</th>
              <th className="num" scope="col">Sales</th>
              <th className="num" scope="col">vs PY</th>
              <th className="num" scope="col">Orders</th>
              <th className="num" scope="col">vs PY</th>
              <th className="num" scope="col">ATV</th>
              <th className="num" scope="col">EE %</th>
              <th className="num" scope="col">Labor %</th>
              <th className="num" scope="col">Void %</th>
            </tr>
          </thead>
          <tbody>
            {current.map((row: DailyRow, i: number) => {
              const pyRow = py[i] ?? null
              return (
                <tr key={row.date}>
                  <td className="nowrap" style={{ color: 'var(--ink-muted)' }}>{row.date.slice(5).replace('-', '/')}</td>
                  <td style={{ color: 'var(--ink-muted)' }}>{row.day}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {row.sales != null ? dol(row.sales) : gap('No sales recorded for this date.')}
                  </td>
                  <td className="num"><VsPY cur={row.sales} py={pyRow?.sales ?? null} /></td>
                  <td className="num">{row.orders != null ? row.orders.toLocaleString() : gap('No orders recorded.')}</td>
                  <td className="num"><VsPY cur={row.orders} py={pyRow?.orders ?? null} /></td>
                  <td className="num">{row.atv != null ? `$${row.atv.toFixed(2)}` : gap('No ATV — no orders to divide by.')}</td>
                  <td className="num">
                    {row.eePct != null
                      ? <Toned tone={row.eePct >= TARGETS.eePct ? 'good' : row.eePct >= TARGETS.eePct * 0.75 ? 'warn' : 'bad'}>{pct(row.eePct, 0)}</Toned>
                      : gap('No enhancer attachment recorded.')}
                  </td>
                  <td className="num">
                    {row.laborPct != null
                      ? <LaborTooltip labor={row.laborCost} hours={row.laborHours}>
                          <Toned tone={row.laborPct <= TARGETS.laborPct ? 'good' : 'bad'}>{pct(row.laborPct)}</Toned>
                        </LaborTooltip>
                      : gap('No labor recorded for this date.')}
                  </td>
                  <td className="num">
                    {row.voidPct != null
                      ? (row.voidPct <= TARGETS.voidPct
                          ? pct(row.voidPct)
                          : <Toned tone="bad">{pct(row.voidPct)}</Toned>)
                      : gap('No voids recorded.')}
                  </td>
                </tr>
              )
            })}

            <tr className="total">
              <td colSpan={2}>Total / avg</td>
              <td className="num">{totSales > 0 ? dol(totSales) : gap('No sales in range.')}</td>
              <td className="num"><VsPY cur={totSales} py={totPySales > 0 ? totPySales : null} /></td>
              <td className="num">{totOrders > 0 ? totOrders.toLocaleString() : gap('No orders in range.')}</td>
              <td className="num"><VsPY cur={totOrders} py={totPyOrders > 0 ? totPyOrders : null} /></td>
              <td className="num">{totSales > 0 && totOrders > 0 ? `$${(totSales / totOrders).toFixed(2)}` : gap('No ATV — no orders in range.')}</td>
              <td className="num">
                {avgEE != null
                  ? <Toned tone={avgEE >= TARGETS.eePct ? 'good' : 'bad'}>{pct(avgEE, 0)}</Toned>
                  : gap('No enhancer attachment in range.')}
              </td>
              <td className="num">
                {avgLabor != null
                  ? <LaborTooltip labor={totLaborCost > 0 ? totLaborCost : null} hours={totLaborHrs > 0 ? totLaborHrs : null}>
                      <Toned tone={avgLabor <= TARGETS.laborPct ? 'good' : 'bad'}>{pct(avgLabor)}</Toned>
                    </LaborTooltip>
                  : gap('No labor in range.')}
              </td>
              <td className="num">
                {avgVoid != null
                  ? (avgVoid <= TARGETS.voidPct ? pct(avgVoid) : <Toned tone="bad">{pct(avgVoid)}</Toned>)
                  : gap('No voids in range.')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
