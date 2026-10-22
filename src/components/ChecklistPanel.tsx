'use client'

/**
 * Checklist completion — the stores' daily checklists in Crunchtime Ops Execution
 * (opening, shift change, closing, AM/PM cleaning, three temperature logs). Each location
 * expands to its checklists, worst first.
 *
 * It is the old Jolt panel's completion half: Ops Execution's corporate forms carry almost
 * no photos, so there is no photo-quality half to show. The target comes from core/targets.
 */
import { useState } from 'react'
import { SOP_COMPLETE_TARGET } from '@/lib/core/targets'
import type { SopData } from './checklistTypes'

const shortDate = (s?: string) => (s ? `${Number(s.split('-')[1])}/${Number(s.split('-')[2])}` : '')

function Rate({ rate, count, target }: { rate: number; count?: number | null; target: number }) {
  return (
    <>
      <span className={rate >= target ? 'sk-tone-good' : 'sk-tone-bad'} style={{ color: 'var(--tone)', fontWeight: 600 }}>
        {(rate * 100).toFixed(0)}%
      </span>
      {count != null && <span style={{ color: 'var(--ink-muted)' }}> ({count})</span>}
    </>
  )
}

/** On-time / late / missed as one bar. Never colour alone: the same three numbers are
 *  printed in the columns beside it. */
function SegBar({ onTime, late, missed, child = false }: { onTime: number; late: number; missed: number; child?: boolean }) {
  const t = onTime + late + missed || 1
  const seg = (n: number, bg: string, title: string) =>
    n > 0 ? <div key={title} style={{ width: `${(n / t) * 100}%`, background: bg }} title={`${title} ${n}`} /> : null
  return (
    <div className="sk-segbar">
      {seg(onTime, child ? 'var(--store-miramar)' : 'var(--brand)', 'On-time')}
      {seg(late, 'var(--store-pines)', 'Late')}
      {seg(missed, 'var(--status-bad)', 'Missed')}
    </div>
  )
}

export default function ChecklistPanel({ data }: { data: SopData | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (k: string) =>
    setOpen(prev => {
      const n = new Set(prev)
      if (!n.delete(k)) n.add(k)
      return n
    })

  if (!data?.locations?.length) {
    return (
      <div className="sk-card">
        <h3 className="sk-card-title">Checklists</h3>
        <p className="sk-subline" style={{ margin: '4px 0 0' }}>
          No Ops Execution checklists were due in this period. The stores moved from Jolt to Ops Execution in mid-October.
        </p>
      </div>
    )
  }
  const w = data.window
  return (
    <div className="sk-card">
      <h3 className="sk-card-title">Checklists</h3>
      <p className="sk-subline" style={{ margin: '4px 0 16px' }}>
        Ops Execution · due {shortDate(w?.start)}–{shortDate(w?.end)} · tgt {(SOP_COMPLETE_TARGET * 100).toFixed(0)}% done · click a location for checklists
      </p>
      <div className="sk-table-wrap">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">Location</th>
              <th className="num" scope="col">Done <span style={{ opacity: 0.6 }}>tgt {(SOP_COMPLETE_TARGET * 100).toFixed(0)}%</span></th>
              <th className="num" scope="col">On time</th>
              <th className="num" scope="col">Missed</th>
              <th className="num" scope="col">Summary</th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map(l => {
              const isOpen = open.has(l.store)
              return [
                <tr key={l.store}>
                  <td className="nowrap">
                    <button type="button" className="sk-expander" aria-expanded={isOpen} onClick={() => toggle(l.store)}>
                      <span className="caret" aria-hidden>›</span>
                      {l.label}
                    </button>
                  </td>
                  <td className="num"><Rate rate={l.complete_rate} count={l.complete} target={SOP_COMPLETE_TARGET} /> <span style={{ color: 'var(--ink-muted)' }}>of {l.total}</span></td>
                  <td className="num">
                    {l.on_time}
                    {l.late > 0 && <span style={{ color: 'var(--ink-muted)' }}> +{l.late} late</span>}
                  </td>
                  <td className="num">{l.missed}</td>
                  <td className="num"><SegBar onTime={l.on_time} late={l.late} missed={l.missed} /></td>
                </tr>,
                ...(isOpen
                  ? l.lists.map(c => (
                      <tr key={`${l.store}/${c.list_name}`} className="child">
                        <td>{c.list_name}</td>
                        <td className="num"><Rate rate={c.complete_rate} count={c.complete} target={SOP_COMPLETE_TARGET} /> <span style={{ color: 'var(--ink-muted)' }}>of {c.total}</span></td>
                        <td className="num">{c.on_time}{c.late > 0 && ` +${c.late} late`}</td>
                        <td className="num">{c.missed}</td>
                        <td className="num"><SegBar onTime={c.on_time} late={c.late} missed={c.missed} child /></td>
                      </tr>
                    ))
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
