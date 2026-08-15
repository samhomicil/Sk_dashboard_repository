'use client'

/**
 * Controls that live in a screen's PageBar, and the target bar its cost panels use.
 * Styling in src/app/design.css. Neither knows a threshold — `target` is passed in.
 */
import type { ReactNode } from 'react'

/**
 * SegControl — every mutually-exclusive scope choice (store, period, basis).
 *
 * `strong` is the emphatic variant: bigger, indigo-filled when active. Use it only
 * where the toggle IS the screen's primary decision — Weekly Ops' this-week /
 * next-week flips the whole report between a review and a plan — never for routine
 * scope like which store.
 */
export function SegControl<T extends string>({
  options,
  value,
  onChange,
  strong = false,
  label,
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  strong?: boolean
  /** Accessible name for the group — screen readers otherwise get loose buttons. */
  label: string
}) {
  return (
    <div className={`sk-seg${strong ? ' strong' : ''}`} role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * TargetBar — one figure against its target line.
 *
 * The track runs to `max` so several bars in a panel are comparable; the target
 * tick is brass, which is the one thing brass is for.
 *
 * `tone` is passed in rather than inferred from value-vs-target, for two reasons:
 * polarity is per metric (labour % high is bad, UPLH high is good), and a bar must
 * grade a figure the SAME way as the tile printing it above — inferring here once
 * put an amber tile over a red bar for one number.
 */
export function TargetBar({
  label,
  value,
  target,
  tone,
  detail,
}: {
  label: ReactNode
  value: number
  target: number
  /** How the screen grades this figure. Same grading as the tile above it. */
  tone: 'good' | 'warn' | 'bad'
  /** The dollars behind the percentage, and the target, in mono under the track. */
  detail?: ReactNode
}) {
  // The target tick sits at a fixed 62% of every track and the fill is scaled to
  // it, so several bars with different targets read against one another: two
  // thirds along always means "at target". Taken from the reference kit.
  const TICK = 62
  const pct = Math.min(100, target > 0 ? (value / target) * TICK : 0)
  return (
    <div className="sk-targetbar">
      <div className="sk-targetbar-head">
        <span>{label}</span>
        <span className="tabular-nums">
          <b>{value.toFixed(1)}%</b>{' '}
          <span className={`sk-tone-${tone}`} data-tone>
            {value >= target ? '+' : '-'}
            {Math.abs(value - target).toFixed(1)} pts
          </span>
        </span>
      </div>
      <div className={`sk-track sk-tone-${tone}`}>
        <div className="sk-track-fill" style={{ width: `${pct}%` }} />
        <div className="sk-track-tick" style={{ left: `${TICK}%` }} title={`target ${target.toFixed(1)}%`} />
      </div>
      {detail ? <div className="sk-targetbar-detail">{detail}</div> : null}
    </div>
  )
}
