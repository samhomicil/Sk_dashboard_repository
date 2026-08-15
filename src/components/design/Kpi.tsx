'use client'

/**
 * KPI tile and its in-place trend, from the kit's Overview (#overview).
 *
 * The tile is a BUTTON, not a card: selecting it opens the trend for that metric
 * in a panel below the row, rather than sending the reader to a separate chart
 * that has to restate which metric it is showing. A brass rule across the top
 * marks the selected one — brass is a marker, never a figure.
 *
 * Geometry is the kit's and is deliberate: the spark is authored at 180×52 and the
 * trend at 640 wide, because tick text authored at 10px inside a 340 box renders
 * at 6px on a phone. Charts scroll at authored size instead of shrinking.
 *
 * No rules here. `tone` and `delta` are decided by the screen from core/targets.ts.
 */
import type { ReactNode } from 'react'

export type Series = {
  /** One point per day, in display order. null = closed / no data — never zero. */
  ty: (number | null)[]
  py: (number | null)[]
  labels: string[]
}

export type Metric = {
  key: string
  label: string
  /** Dimmed target beside the label, e.g. "tgt 22.0%". */
  target?: string
  value: string
  /** The move, always signed. */
  delta?: string
  tone?: 'good' | 'warn' | 'bad'
  sub?: string
  series?: Series
  /** Formats a value for the trend's y-axis and end labels. */
  fmt?: (v: number) => string
}

/* ── geometry, from the kit ───────────────────────────────────────────────── */
const SPARK_W = 180, SPARK_H = 52, SPARK_PAD = 8
const TREND_W = 640, TREND_P = 44, TREND_RP = 82

const INK_MUTED = 'var(--ink-muted)'
const TY_STROKE = 'var(--brand)'

/** Finite points only — a closed day is an empty slot, not a point to draw across. */
function extent(s: Series): [number, number] {
  const all = [...s.ty, ...s.py].filter((v): v is number => v != null && isFinite(v))
  if (!all.length) return [0, 1]
  return [Math.min(...all), Math.max(...all)]
}

/**
 * A polyline that BREAKS at gaps rather than drawing through them. Joining across a
 * closed day invents a trend between two days that never met.
 */
function segments(vals: (number | null)[], X: (i: number) => number, Y: (v: number) => number): string[] {
  const out: string[] = []
  let run: string[] = []
  vals.forEach((v, i) => {
    if (v == null || !isFinite(v)) {
      if (run.length > 1) out.push(run.join(' '))
      run = []
    } else run.push(`${X(i)},${Y(v)}`)
  })
  if (run.length > 1) out.push(run.join(' '))
  return out
}

function Spark({ s }: { s: Series }) {
  const [lo, hi] = extent(s)
  const min = lo * 0.97
  const n = Math.max(1, s.ty.length - 1)
  const X = (i: number) => SPARK_PAD + (i / n) * (SPARK_W - SPARK_PAD * 2)
  const Y = (v: number) => SPARK_H - 14 - ((v - min) / (hi - min || 1)) * (SPARK_H - 22)

  return (
    <svg width="100%" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} style={{ display: 'block' }} aria-hidden>
      {segments(s.py, X, Y).map((pts, i) => (
        <polyline key={`py${i}`} points={pts} fill="none" stroke={INK_MUTED} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.7} />
      ))}
      {segments(s.ty, X, Y).map((pts, i) => (
        <polyline key={`ty${i}`} points={pts} fill="none" stroke={TY_STROKE} strokeWidth={1.75} />
      ))}
      {s.labels.map((d, i) => (
        <text key={d + i} x={X(i)} y={SPARK_H - 2} fontFamily="var(--font-mono)" fontSize={10} fill={INK_MUTED} textAnchor="middle">
          {d}
        </text>
      ))}
    </svg>
  )
}

export function KpiTile({ m, selected, onSelect }: { m: Metric; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="sk-kpi" aria-pressed={selected} onClick={onSelect}>
      {m.series ? <span className="sk-kpi-expand">{selected ? 'Close' : 'Expand'}</span> : null}
      <div className="sk-eyebrow">
        {m.label}
        {m.target ? <span style={{ opacity: 0.6 }}> {m.target}</span> : null}
      </div>
      <div className="sk-metric tabular-nums">{m.value}</div>
      {m.delta ? <div className={`sk-delta${m.tone ? ` sk-tone-${m.tone}` : ''}`}>{m.delta}</div> : null}
      {m.sub ? <div className="sk-subline">{m.sub}</div> : null}
      {m.series ? <div style={{ marginTop: 'auto', paddingTop: 12 }}><Spark s={m.series} /></div> : null}
    </button>
  )
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className="sk-kpis">{children}</div>
}

/**
 * The trend panel a selected tile opens. This year solid indigo, last year dashed
 * grey, each labelled at its own end — so identity never rests on colour alone.
 */
export function MetricTrend({ m, onClose }: { m: Metric; onClose: () => void }) {
  const s = m.series
  if (!s) return null
  const H = 260
  const fmt = m.fmt ?? ((v: number) => String(Math.round(v)))
  const [lo, hi] = extent(s)
  const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.1 || 1
  const top = hi + pad
  const bottom = Math.max(0, lo - pad)
  const n = Math.max(1, s.labels.length - 1)
  const X = (i: number) => TREND_P + (i / n) * (TREND_W - TREND_P - TREND_RP)
  const Y = (v: number) => H - 34 - ((v - bottom) / (top - bottom || 1)) * (H - 60)

  const lines = [
    { d: s.py, c: INK_MUTED, w: 1.25, dash: '4 3', label: 'Last year' },
    { d: s.ty, c: TY_STROKE, w: 1.75, dash: undefined, label: 'This year' },
  ]
  const lastOf = (d: (number | null)[]) => {
    for (let i = d.length - 1; i >= 0; i--) if (d[i] != null) return { i, v: d[i] as number }
    return null
  }

  return (
    <div className="sk-card">
      <div className="sk-sechead" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="sk-card-title">{m.label} trend</h3>
          <p className="sk-subline" style={{ margin: '4px 0 0' }}>This period vs the same dates last year</p>
        </div>
        <button type="button" className="sk-ghost" onClick={onClose}>Close</button>
      </div>
      <div className="sk-chart-scroll">
        <svg width="100%" viewBox={`0 0 ${TREND_W} ${H}`} role="img" aria-label={`${m.label} this year versus last year`}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const v = bottom + f * (top - bottom)
            return (
              <g key={f}>
                <line x1={TREND_P} x2={TREND_W - TREND_RP} y1={Y(v)} y2={Y(v)} stroke="var(--ground)" />
                <text x={TREND_P - 8} y={Y(v) + 3} fontFamily="var(--font-mono)" fontSize={10} fill={INK_MUTED} textAnchor="end">
                  {fmt(v)}
                </text>
              </g>
            )
          })}
          <line x1={TREND_P} x2={TREND_W - TREND_RP} y1={Y(bottom)} y2={Y(bottom)} stroke="var(--border)" />
          {lines.map(ln => {
            const last = lastOf(ln.d)
            return (
              <g key={ln.label}>
                {segments(ln.d, X, Y).map((pts, i) => (
                  <polyline key={i} points={pts} fill="none" stroke={ln.c} strokeWidth={ln.w} strokeDasharray={ln.dash} />
                ))}
                {last && (
                  <text x={X(last.i) + 8} y={Y(last.v) + 3} fontFamily="var(--font-mono)" fontSize={10} fill={ln.c}>
                    {ln.label}
                  </text>
                )}
              </g>
            )
          })}
          {s.labels.map((d, i) => (
            <text key={d + i} x={X(i)} y={H - 10} fontFamily="var(--font-mono)" fontSize={10} fill={INK_MUTED} textAnchor="middle">
              {d}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}
