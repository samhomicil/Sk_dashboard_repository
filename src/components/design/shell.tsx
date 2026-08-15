/**
 * SHELL — the four blocks every screen opens with, in this order:
 *
 *   PageBar   title, eyebrow, THIS screen's filters, range/freshness line
 *   TakeCard  the verdict in one sentence — what is true, what to do
 *   FlagList  exceptions worth acting on, worst first, or nothing at all
 *   Tile(s)   3–4 headline figures, each with its target visible
 *
 * PageBar and TakeCard are not optional; FlagList is conditional on there being
 * something to flag. Styling lives in src/app/design.css.
 *
 * These components carry NO business rules. They render a tone and a number they
 * are handed. Deciding that 24% labor is `bad` is the caller's job, using the
 * thresholds in src/lib/core/targets.ts — never a literal at the call site.
 */
import type { ReactNode } from 'react'

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

/** Tone → the class that sets --tone. One rule serves every status colour. */
export const toneClass = (t: Tone = 'neutral') => `sk-tone-${t}`

/* ── PageBar ──────────────────────────────────────────────────────────────── */

/**
 * Filters belong to the screen, never to a global header. Weekly Ops is weekly by
 * definition; Inventory runs its own timeframe; Guest Voice ranges 7/14/30/90. A
 * shared period control implies it applies everywhere, when it does not.
 *
 * `meta` is the range / freshness line — say what window the numbers cover and how
 * old they are, in mono, right under the filters.
 */
export function PageBar({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  /** Range + freshness, e.g. "Mon 4 Aug – Sun 10 Aug · counted 2 days ago". */
  meta?: ReactNode
  /** This screen's own filters. */
  children?: ReactNode
}) {
  return (
    <div className="sk-pagebar">
      <div>
        {eyebrow ? <div className="sk-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
      </div>
      {children || meta ? (
        <div className="sk-pagebar-right">
          {children ? <div className="sk-pagebar-filters">{children}</div> : null}
          {meta ? <div className="sk-meta">{meta}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/* ── TakeCard ─────────────────────────────────────────────────────────────── */

/**
 * The verdict a screen opens with, before any evidence.
 *
 * Write the headline as the DECISION, not the metric:
 *   ✅ "Trim Margate's labor before the shift starts."
 *   ❌ "Margate labor 24%."
 *
 * Derive the reason too. A hardcoded "driven by food and labor" eventually appears
 * on a screen where both beat target — compute which buckets actually moved the
 * variance and name those.
 */
export function TakeCard({
  tone = 'neutral',
  label,
  headline,
  children,
}: {
  tone?: Tone
  /** Short status word — "Over budget", "Self-funds", "Needs funding". */
  label?: ReactNode
  /** The finding. */
  headline?: ReactNode
  /** The because. */
  children?: ReactNode
}) {
  return (
    <div className={`sk-card sk-take ${toneClass(tone)}`}>
      {label ? <span className="sk-pill">{label}</span> : null}
      <span className="sk-take-text">
        {headline ? <b>{headline}</b> : null}{' '}
        <span className="sk-take-why">{children}</span>
      </span>
    </div>
  )
}

/* ── FlagList ─────────────────────────────────────────────────────────────── */

export type Flag = {
  tone: 'bad' | 'warn' | 'good'
  /** Who or what the flag is about. */
  who: string
  /** Optional qualifier — store, shift, account. */
  scope?: string
  /** What happened and what to do, in one sentence. */
  text: ReactNode
}

const SEVERITY: Record<Flag['tone'], number> = { bad: 0, warn: 1, good: 2 }

/**
 * Data-derived exceptions, worst first.
 *
 * LET IT BE EMPTY. An empty state is the correct output when nothing crosses a
 * threshold, and a list that is always populated gets ignored. No "all within
 * target" filler.
 */
export function FlagList({
  title = 'Needs attention',
  flags,
  limit = 7,
  emptyNote = 'Nothing over threshold this period.',
}: {
  title?: ReactNode
  flags: Flag[]
  limit?: number
  emptyNote?: ReactNode
}) {
  const sorted = [...flags].sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone])
  const shown = sorted.slice(0, limit)
  const urgent = sorted.filter(f => f.tone === 'bad').length
  const tone: Tone = sorted.length === 0 ? 'good' : urgent ? 'bad' : 'warn'

  return (
    <div className={`sk-card sk-flags ${toneClass(tone)}`}>
      <div className="sk-flags-head">
        <h3 className="sk-card-title">{title}</h3>
        {sorted.length > 0 && (
          <span className="sk-meta">
            {sorted.length} flag{sorted.length === 1 ? '' : 's'}
            {urgent ? ` · ${urgent} to act on now` : ''}
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="sk-flags-empty">{emptyNote}</p>
      ) : (
        <>
          <div style={{ marginTop: 'var(--space-2)' }}>
            {shown.map((f, i) => (
              <div key={i} className={`sk-flag ${toneClass(f.tone)}`}>
                <span className="sk-flag-dot" />
                <span>
                  <b>{f.who}</b>
                  {f.scope ? <span className="sk-take-why"> ({f.scope})</span> : null} — {f.text}
                </span>
              </div>
            ))}
          </div>
          {sorted.length > shown.length && (
            <div className="sk-meta" style={{ marginTop: 'var(--space-3)' }}>
              {sorted.length - shown.length} more below
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Tiles ────────────────────────────────────────────────────────────────── */

/**
 * Three or four headline figures, each with its target visible. `hero` is for the
 * one lead figure a screen has (prime cost on Budget, portfolio sales on Overview).
 *
 * `target` is a string the caller formats from core/targets.ts — this component
 * neither knows nor decides what good looks like.
 */
export function Tile({
  label,
  value,
  target,
  tone,
  hero = false,
  children,
}: {
  label: ReactNode
  value: ReactNode
  /** e.g. "target 22.0%" — formatted by the caller from core/targets.ts. */
  target?: ReactNode
  tone?: Tone
  hero?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`sk-card ${tone ? toneClass(tone) : ''}`}>
      <div className="sk-eyebrow">{label}</div>
      <div className={`sk-tile-value${hero ? ' hero' : ''}`} data-tone={tone || undefined}>
        {value}
      </div>
      {target ? <div className="sk-tile-target">{target}</div> : null}
      {children}
    </div>
  )
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="sk-tiles">{children}</div>
}

/* ── Sections ─────────────────────────────────────────────────────────────── */

/**
 * A titled group of blocks. The kit groups a screen's content under brand-coloured
 * eyebrows — "Summary · week to date", "Weekly detail", "Notes & actions" — rather
 * than giving every card its own heading. `aside` is the right-hand slot on the
 * header row, used for legends.
 */
export function Section({
  label,
  aside,
  children,
}: {
  label: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="sk-section">
      {aside ? (
        <div className="sk-sechead">
          <div className="sk-eyebrow sk-section-label">{label}</div>
          {aside}
        </div>
      ) : (
        <div className="sk-eyebrow sk-section-label">{label}</div>
      )}
      {children}
    </section>
  )
}

/**
 * Stat — the summary card: label, figure with an inline qualifier, and the change
 * beneath it. Four across, one row.
 *
 * `sub` is what the figure is measured against ("/ $21,079"); `delta` is the move,
 * always signed. Both are the caller's to format, and `tone` is the caller's to
 * decide — grading belongs to the screen, which reads core/targets.ts.
 */
export function Stat({
  label,
  value,
  sub,
  delta,
  tone,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  delta?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="sk-card tight">
      <div className="sk-eyebrow">{label}</div>
      <div className="sk-stat-value">
        {value}
        {sub ? <span className="sk-stat-sub"> {sub}</span> : null}
      </div>
      {delta ? <div className={`sk-delta ${tone ? toneClass(tone) : ''}`.trim()}>{delta}</div> : null}
    </div>
  )
}

export function Grid4({ children }: { children: ReactNode }) {
  return <div className="sk-grid4">{children}</div>
}
/** Two equal panels. Collapses to one column below 900px. */
export function Grid11({ children }: { children: ReactNode }) {
  return <div className="sk-grid11">{children}</div>
}

/* ── Page frame ───────────────────────────────────────────────────────────── */

/** Ground, max width, and the stack rhythm every screen shares. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="sk-page">
      <div className="sk-page-inner">{children}</div>
    </div>
  )
}

/**
 * The basis footnote — ONLY where the basis is genuinely non-obvious: a derived
 * target, a fully-loaded cost stack, a cash-vs-accrual difference. If the subline
 * can carry it, use the subline. Never restate what the table already says.
 */
export function BasisNote({ children }: { children: ReactNode }) {
  return <p className="sk-basis">{children}</p>
}
