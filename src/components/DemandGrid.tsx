'use client'

/**
 * Hourly demand — units by day of week × hour, i.e. what the schedule has to cover.
 *
 * The kit calls this panel "Hourly demand" and plots transactions. Sam chose UNITS
 * over orders for this screen, so it plots units and says so; the staffing grid
 * above it is units per labor hour, and the two now answer the same question in the
 * same currency — how much work arrives, and how many people met it.
 *
 * No new query: StaffingCell already carries avgUnits per (day, hour), the same
 * figures the grid above divides by labor hours.
 *
 * Sequential encoding, one hue light → dark, because demand is a MAGNITUDE. The
 * banded red/amber/green of the staffing grid would be wrong here: a busy hour is
 * not a bad hour, it is just a busy one.
 */
import type { StaffingCell } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 7am–9pm, the hours the stores actually trade. */
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7)
const hourLabel = (h: number) => (h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`)

/**
 * Four steps of one hue, palest to deepest. The ramp's first step is the card
 * surface itself, so a cell painted with it looks unpainted — a real value reading
 * as an empty slot. The ramp starts at step 2, where the ink actually shows.
 */
const RAMP = [
  'var(--ramp-sequential-2)',
  'var(--ramp-sequential-3)',
  'var(--ramp-sequential-4)',
  'var(--ramp-sequential-5)',
]

/** Ink flips on the two darkest steps so the figure stays legible on them. */
function step(v: number, max: number): { bg: string; fg: string } {
  if (v <= 0) return { bg: 'transparent', fg: 'var(--ink-muted)' }
  const i = Math.min(RAMP.length - 1, Math.floor((v / (max || 1)) * RAMP.length))
  return { bg: RAMP[i], fg: i >= 2 ? 'var(--ink-inverse)' : 'var(--ink)' }
}

export default function DemandGrid({ cells, title = 'Hourly demand' }: {
  cells: StaffingCell[]
  title?: string
}) {
  if (!cells?.length) return null

  const at = new Map(cells.map(c => [`${c.day}|${c.hourNum}`, c.avgUnits]))
  const get = (d: number, h: number) => at.get(`${d}|${h}`) ?? 0
  const max = Math.max(...cells.map(c => c.avgUnits), 0)
  const rowTotal = (d: number) => HOURS.reduce((t, h) => t + get(d, h), 0)
  const colTotal = (h: number) => DAYS.reduce((t, _d, di) => t + get(di, h), 0)
  const grand = DAYS.reduce((t, _d, di) => t + rowTotal(di), 0)
  const n = (v: number) => (v > 0 ? Math.round(v).toLocaleString() : '')

  return (
    <div className="sk-card">
      <h3 className="sk-card-title">{title}</h3>
      <p className="sk-subline" style={{ margin: '4px 0 16px' }}>
        Units by day of week × hour — what the schedule has to cover
      </p>

      <div className="sk-table-wrap">
        <table className="sk-table sk-heat">
          <thead>
            <tr>
              <th scope="col" />
              {HOURS.map(h => <th key={h} className="num" scope="col">{hourLabel(h)}</th>)}
              <th className="num divider" scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d, di) => (
              <tr key={d}>
                <th scope="row">{d}</th>
                {HOURS.map(h => {
                  const v = get(di, h)
                  const s = step(v, max)
                  return (
                    <td key={h} className="num">
                      <span className="cell" style={{ background: s.bg, color: s.fg }} title={`${d} ${hourLabel(h)} — ${v.toFixed(1)} units`}>
                        {n(v)}
                      </span>
                    </td>
                  )
                })}
                <td className="num divider" style={{ fontWeight: 600 }}>{n(rowTotal(di))}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row">Total</th>
              {HOURS.map(h => <td key={h} className="num">{n(colTotal(h))}</td>)}
              <td className="num divider">{n(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* A ramp needs its ends named, or the shading is decoration. */}
      <div className="sk-ramp-legend">
        <span>0</span>
        {RAMP.map(c => <i key={c} style={{ background: c }} />)}
        <span>{Math.round(max)} units</span>
      </div>
    </div>
  )
}
