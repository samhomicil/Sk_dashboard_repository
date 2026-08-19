'use client'

import { useState } from 'react'
import { COGS_TARGET } from '@/lib/core/targets'
import type { WeekPoint, CategoryWeekPoint, TopProductPriced } from '@/lib/purchasingUtils'

// Fixed categorical order (never cycled) — teal-led to match the dashboard, warm/cool
// spread for CVD separation. 'Other' always the last, muted slot.
const CATS = ['var(--brand)', 'var(--status-warn)', 'var(--owner-only)', 'var(--status-bad)', 'var(--ramp-sequential-4)', 'var(--status-good)']
const OTHER = 'var(--ink-muted)'
const PFG_C = 'var(--brand)', WM_C = 'var(--status-warn)'

const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const wk = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  )
}

/* ── Spend by vendor: stacked bars/week, PFG + Walmart ── */
export function SpendTrendChart({ data }: { data: WeekPoint[] }) {
  if (!data.length) return <Empty />
  const W = 720, H = 220, PL = 44, PB = 22, PT = 8
  const max = Math.max(...data.map(d => d.pfg + d.walmart), 1)
  const bw = (W - PL) / data.length
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max)
  const barW = Math.min(28, bw * 0.6)
  return (
    <div className="overflow-x-auto">
      <Legend items={[{ label: 'PFG', color: PFG_C }, { label: 'Walmart', color: WM_C }]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <line x1={PL} x2={W} y1={y(max * t)} y2={y(max * t)} stroke="var(--ground)" />
            <text x={PL - 6} y={y(max * t) + 3} textAnchor="end" className="fill-slate-400" fontSize="9">{money(max * t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PL + bw * i + (bw - barW) / 2
          const hP = (H - PT - PB) * (d.pfg / max), hW = (H - PT - PB) * (d.walmart / max)
          return (
            <g key={d.week}>
              <rect x={cx} y={y(d.pfg)} width={barW} height={Math.max(0, hP)} fill={PFG_C} rx={1}>
                <title>{wk(d.week)} · PFG {money(d.pfg)}</title>
              </rect>
              <rect x={cx} y={y(d.pfg + d.walmart)} width={barW} height={Math.max(0, hW)} fill={WM_C} rx={1}>
                <title>{wk(d.week)} · Walmart {money(d.walmart)}</title>
              </rect>
              {i % Math.ceil(data.length / 12) === 0 && (
                <text x={cx + barW / 2} y={H - 6} textAnchor="middle" className="fill-slate-400" fontSize="9">{wk(d.week)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Cost % of sales vs the recipe-COGS target ── */
export function CostPctChart({ data }: { data: WeekPoint[] }) {
  const pts = data.filter(d => d.sales > 0)
  if (!pts.length) return <Empty />
  const W = 720, H = 200, PL = 34, PB = 22, PT = 10
  const max = Math.max(...pts.map(d => d.costPct), 30) * 1.1
  const x = (i: number) => PL + (W - PL - 8) * (i / Math.max(1, pts.length - 1))
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max)
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.costPct)}`).join(' ')
  // The target is COGS_TARGET, not a 25 typed here. This was a literal, which is
  // exactly how the Overview once graded labor at 25% while Weekly Ops used 22%:
  // the chart and the screen citing it drift apart the moment one is edited.
  // `npm run check` did not catch it because the const was named `target`, which
  // its *TARGET/*THRESHOLD pattern does not match.
  const target = COGS_TARGET * 100
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
        {[0, 10, 20, 30, 40].filter(t => t <= max).map(t => (
          <g key={t}>
            <line x1={PL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--ground)" />
            <text x={PL - 5} y={y(t) + 3} textAnchor="end" className="fill-slate-400" fontSize="9">{t}%</text>
          </g>
        ))}
        <line x1={PL} x2={W} y1={y(target)} y2={y(target)} stroke="var(--ink-muted)" strokeDasharray="4 3" />
        <text x={W - 4} y={y(target) - 4} textAnchor="end" className="fill-slate-400" fontSize="9">{target}% target</text>
        <path d={line} fill="none" stroke={PFG_C} strokeWidth={2} />
        {pts.map((d, i) => (
          <circle key={d.week} cx={x(i)} cy={y(d.costPct)} r={3.5} fill={d.costPct > target ? 'var(--status-bad)' : 'var(--status-good)'}>
            <title>{wk(d.week)} · {d.costPct}% ({money(d.pfg + d.walmart)} / {money(d.sales)})</title>
          </circle>
        ))}
        {pts.map((d, i) => i % Math.ceil(pts.length / 12) === 0 && (
          <text key={d.week} x={x(i)} y={H - 6} textAnchor="middle" className="fill-slate-400" fontSize="9">{wk(d.week)}</text>
        ))}
      </svg>
    </div>
  )
}

/* ── Category mix over time: 100% stacked bars ── */
export function CategoryMixChart({ data }: { data: CategoryWeekPoint[] }) {
  if (!data.length) return <Empty />
  const weeks = [...new Set(data.map(d => d.week))].sort()
  const cats = [...new Set(data.map(d => d.category))].filter(c => c !== 'Other')
  const order = [...cats, ...(data.some(d => d.category === 'Other') ? ['Other'] : [])]
  const colorOf = (c: string) => c === 'Other' ? OTHER : CATS[cats.indexOf(c) % CATS.length]
  const byWeek = new Map<string, Map<string, number>>()
  for (const d of data) { if (!byWeek.has(d.week)) byWeek.set(d.week, new Map()); byWeek.get(d.week)!.set(d.category, d.spend) }
  const W = 720, H = 200, PL = 8, PB = 22, PT = 6
  const bw = (W - PL) / weeks.length, barW = Math.min(30, bw * 0.7)
  return (
    <div className="overflow-x-auto">
      <Legend items={order.map(c => ({ label: c, color: colorOf(c) }))} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
        {weeks.map((w, i) => {
          const m = byWeek.get(w)!
          const total = order.reduce((s, c) => s + (m.get(c) ?? 0), 0) || 1
          const cx = PL + bw * i + (bw - barW) / 2
          let acc = 0
          return (
            <g key={w}>
              {order.map(c => {
                const v = m.get(c) ?? 0
                const h = (H - PT - PB) * (v / total)
                const yTop = PT + (H - PT - PB) * (acc / total)
                acc += v
                return h > 0.5 ? <rect key={c} x={cx} y={yTop} width={barW} height={h} fill={colorOf(c)}><title>{wk(w)} · {c} {money(v)} ({Math.round(v / total * 100)}%)</title></rect> : null
              })}
              {i % Math.ceil(weeks.length / 12) === 0 && (
                <text x={cx + barW / 2} y={H - 6} textAnchor="middle" className="fill-slate-400" fontSize="9">{wk(w)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Unit price over time, one item at a time ── */
export function PriceTrendChart({ data, items }: { data: { itemCode: string; week: string; price: number }[]; items: TopProductPriced[] }) {
  const withData = items.filter(it => data.some(d => d.itemCode === it.itemCode))
  const [sel, setSel] = useState(withData[0]?.itemCode ?? '')
  if (!withData.length) return <Empty />
  const pts = data.filter(d => d.itemCode === sel).sort((a, b) => a.week < b.week ? -1 : 1)
  const W = 720, H = 190, PL = 44, PB = 22, PT = 12
  const vals = pts.map(p => p.price)
  const min = Math.min(...vals) * 0.95, max = Math.max(...vals) * 1.05 || 1
  const x = (i: number) => PL + (W - PL - 8) * (i / Math.max(1, pts.length - 1))
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - min) / (max - min || 1))
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.price)}`).join(' ')
  const first = pts[0]?.price ?? 0, last = pts[pts.length - 1]?.price ?? 0
  const delta = first > 0 ? (last - first) / first * 100 : 0
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <select value={sel} onChange={e => setSel(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1 max-w-[260px]">
          {withData.map(it => <option key={it.itemCode} value={it.itemCode}>{it.description}</option>)}
        </select>
        {pts.length > 1 && (
          <span className={`text-xs font-semibold ${delta > 1 ? 'text-rose-600' : delta < -1 ? 'text-emerald-600' : 'text-slate-400'}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {Math.abs(delta).toFixed(1)}% over window
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
          {[min, (min + max) / 2, max].map((t, k) => (
            <g key={k}>
              <line x1={PL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--ground)" />
              <text x={PL - 5} y={y(t) + 3} textAnchor="end" className="fill-slate-400" fontSize="9">${t.toFixed(2)}</text>
            </g>
          ))}
          <path d={line} fill="none" stroke={PFG_C} strokeWidth={2} />
          {pts.map((d, i) => (
            <circle key={d.week} cx={x(i)} cy={y(d.price)} r={3.5} fill={PFG_C}>
              <title>{wk(d.week)} · ${d.price.toFixed(2)}/unit</title>
            </circle>
          ))}
          {pts.map((d, i) => i % Math.ceil(pts.length / 10) === 0 && (
            <text key={d.week} x={x(i)} y={H - 6} textAnchor="middle" className="fill-slate-400" fontSize="9">{wk(d.week)}</text>
          ))}
        </svg>
      </div>
    </div>
  )
}

function Empty() {
  return <div className="text-xs text-slate-400 py-8 text-center">No data in this window.</div>
}
