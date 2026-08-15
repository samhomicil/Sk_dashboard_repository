'use client'

/**
 * Jolt SOP compliance — completion and photo quality in ONE table, as the kit has
 * it, with a two-tier header naming the two column groups.
 *
 * They were two separate panels, which meant scrolling between "was the checklist
 * submitted" and "was it actually done to standard" for the same store — the two
 * halves of one question. A location that submits everything and fails half its
 * photos looks fine in isolation on either panel.
 *
 * Each location expands to its checklists. Quality is joined by location AND
 * checklist name, so a checklist with no graded photos shows "not measured"
 * rather than a zero it never earned.
 *
 * No thresholds here: both targets come from core/targets.ts via the two cards
 * this replaces.
 */
import { useState } from 'react'
import { SOP_COMPLETE_TARGET, JOLT_QUALITY_TARGET } from '@/lib/core/targets'
import type { SopData, SopQualityData } from './joltTypes'
import { NotMeasured } from '@/components/design/states'

const shortDate = (s?: string) => (s ? `${Number(s.split('-')[1])}/${Number(s.split('-')[2])}` : '')

/** Rate + count, graded against its target. Completion shows 2dp, quality 0dp. */
function Rate({ rate, count, dp, target }: { rate: number; count?: number | null; dp: number; target: number }) {
  return (
    <>
      <span className={rate >= target ? 'sk-tone-good' : 'sk-tone-bad'} style={{ color: 'var(--tone)', fontWeight: 600 }}>
        {(rate * 100).toFixed(dp)}%
      </span>
      {count != null && <span style={{ color: 'var(--ink-muted)' }}> ({count})</span>}
    </>
  )
}

/** On-time / late / missed as one bar. Indigo, tint, red — never colour alone: the
 *  same three numbers are printed in the columns beside it. */
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

export default function JoltPanel({ jolt, quality }: { jolt: SopData | null; quality: SopQualityData | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (!jolt?.locations?.length) return null

  const toggle = (k: string) =>
    setOpen(prev => {
      const n = new Set(prev)
      if (!n.delete(k)) n.add(k)
      return n
    })

  const qByStore = new Map((quality?.locations ?? []).map(q => [q.store, q]))
  const w = jolt.window
  const qw = quality?.window

  return (
    <div className="sk-card">
      <h3 className="sk-card-title">Jolt SOP compliance</h3>
      <p className="sk-subline" style={{ margin: '4px 0 16px' }}>
        Submitted {shortDate(w?.start)}–{shortDate(w?.end)}
        {qw && (qw.start !== w?.start || qw.end !== w?.end) ? ` · photos ${shortDate(qw.start)}–${shortDate(qw.end)}` : ''}
        {' · tgt '}{(SOP_COMPLETE_TARGET * 100).toFixed(0)}% on both · click a location for checklists
      </p>

      <div className="sk-table-wrap">
        <table className="sk-table">
          <thead>
            <tr className="group">
              <th rowSpan={2} scope="col">Location</th>
              <th className="grp num" colSpan={4} scope="colgroup">Completion</th>
              <th className="grp num divider" colSpan={4} scope="colgroup">Photo quality</th>
            </tr>
            <tr>
              <th className="num" scope="col">Complete <span style={{ opacity: 0.6 }}>tgt {(SOP_COMPLETE_TARGET * 100).toFixed(0)}%</span></th>
              <th className="num" scope="col">On-time</th>
              <th className="num" scope="col">Missed</th>
              <th className="num" scope="col">Summary</th>
              <th className="num divider" scope="col">Quality <span style={{ opacity: 0.6 }}>tgt {(JOLT_QUALITY_TARGET * 100).toFixed(0)}%</span></th>
              <th className="num" scope="col">Pass</th>
              <th className="num" scope="col">Fail</th>
              <th className="num" scope="col">N/A</th>
            </tr>
          </thead>
          <tbody>
            {jolt.locations.map(l => {
              const q = qByStore.get(l.store)
              const isOpen = open.has(l.store)
              const qLists = new Map((q?.lists ?? []).map(x => [x.list_name, x]))
              return [
                <tr key={l.store}>
                  <td className="nowrap">
                    <button type="button" className="sk-expander" aria-expanded={isOpen} onClick={() => toggle(l.store)}>
                      <span className="caret" aria-hidden>›</span>
                      {l.label}
                    </button>
                  </td>
                  <td className="num"><Rate rate={l.complete_rate} count={l.complete} dp={2} target={SOP_COMPLETE_TARGET} /></td>
                  <td className="num">
                    {l.on_time}
                    {l.late > 0 && <span style={{ color: 'var(--ink-muted)' }}> +{l.late} late</span>}
                  </td>
                  <td className="num">{l.missed}</td>
                  <td className="num"><SegBar onTime={l.on_time} late={l.late} missed={l.missed} /></td>
                  <td className="num divider">
                    {q && q.graded > 0
                      ? <Rate rate={q.quality_rate} count={q.graded} dp={0} target={JOLT_QUALITY_TARGET} />
                      : <NotMeasured reason="No photos graded for this location in the window.">—</NotMeasured>}
                  </td>
                  <td className="num">{q?.pass ?? '—'}</td>
                  <td className="num sk-tone-bad" style={q?.fail ? { color: 'var(--tone)' } : undefined}>{q?.fail ?? '—'}</td>
                  <td className="num" style={{ color: 'var(--ink-muted)' }}>{q ? q.neutral + q.cant : '—'}</td>
                </tr>,
                ...(isOpen
                  ? l.lists.map(c => {
                      const cq = qLists.get(c.list_name)
                      return (
                        <tr key={`${l.store}/${c.list_name}`} className="child">
                          <td>{c.list_name}</td>
                          <td className="num"><Rate rate={c.complete_rate} count={c.complete} dp={2} target={SOP_COMPLETE_TARGET} /></td>
                          <td className="num">{c.on_time}{c.late > 0 && ` +${c.late} late`}</td>
                          <td className="num">{c.missed}</td>
                          <td className="num"><SegBar onTime={c.on_time} late={c.late} missed={c.missed} child /></td>
                          <td className="num divider">
                            {cq && cq.graded > 0
                              ? <Rate rate={cq.quality_rate} count={null} dp={0} target={JOLT_QUALITY_TARGET} />
                              : <NotMeasured reason="No photos graded on this checklist.">—</NotMeasured>}
                          </td>
                          <td className="num">{cq?.pass ?? '—'}</td>
                          <td className="num">{cq?.fail ?? '—'}</td>
                          <td className="num">—</td>
                        </tr>
                      )
                    })
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
