'use client'

/**
 * DataTable — the evidence block. 40px rows, mono eyebrow header, tabular numerals
 * on every numeric column, expandable rows that RECONCILE with their children.
 *
 * That last one is the reason this exists as a component rather than a <table> per
 * screen. The recurring bug in this product is a figure authored beside its own
 * parts and drifting from them: week rows stating an inflow the day register below
 * them contradicted, budget percentages authored per store while the dollars came
 * from line items, a portfolio delta that disagreed with the store rows under it.
 *
 * ── Why the props look like this ──────────────────────────────────────────────
 * Cells are pre-rendered ReactNodes, not `(row) => ReactNode` renderers. Only the
 * expand/collapse needs the client, and a renderer function cannot cross the
 * server/client boundary — passing one throws at build time. Formatting the cells
 * on the SERVER, where the data already is, keeps every screen a server component
 * and ships less JS. `values` carries the raw numbers alongside, purely so the
 * reconciliation check has something to add up.
 */
import { useState, type ReactNode } from 'react'

export type Col = {
  key: string
  /** Header text. Kept short — the eyebrow row is 11px mono. */
  head: ReactNode
  /** Numeric columns are right-aligned and tabular in BOTH header and cell. */
  num?: boolean
  /** Starts a grouped set — draws the divider rule to its left. */
  divider?: boolean
  /**
   * How a parent cell relates to its children. Numeric columns are expected to
   * sum by default; set 'none' where the parent genuinely is not the sum (a rate,
   * a max, a closing balance) so the exception is visible in the source rather
   * than silent in the output.
   */
  derive?: 'sum' | 'none'
}

export type Cell = {
  key: string
  /** One entry per column, in column order. */
  cells: ReactNode[]
  /** Same order. Used only by the dev reconciliation check; null = not a number. */
  values?: (number | null)[]
}

export type Row = Cell & {
  children?: Cell[]
  /** Paused / inactive rows sort last and read muted — never first. */
  muted?: boolean
  /** A totals row: heavier, ruled off above. */
  total?: boolean
}

/**
 * Dev-only reconciliation check. A parent whose printed number disagrees with the
 * children it expands to is the exact failure this system exists to close, so it
 * shouts in the console during development rather than shipping quietly.
 */
function assertReconciles(cols: Col[], rows: Row[]) {
  if (process.env.NODE_ENV === 'production') return
  for (const row of rows) {
    if (!row.children?.length || !row.values) continue
    cols.forEach((c, i) => {
      if (!c.num || c.derive === 'none') return
      const parent = row.values![i]
      if (parent == null) return
      const kids = row.children!.reduce((t, k) => t + (k.values?.[i] ?? 0), 0)
      // Tolerance covers cent-level rounding, not a real disagreement.
      if (Math.abs(parent - kids) > Math.max(0.02, Math.abs(parent) * 0.001)) {
        console.warn(
          `[DataTable] row "${row.key}" column "${c.key}": parent ${parent} but children sum to ${kids}. ` +
            `Derive the parent from its rows, or mark the column derive:'none' and say why.`,
        )
      }
    })
  }
}

export function DataTable({ cols, rows, caption }: { cols: Col[]; rows: Row[]; caption?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  assertReconciles(cols, rows)

  const toggle = (k: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (!next.delete(k)) next.add(k)
      return next
    })

  // Muted (paused, inactive) rows sort last, never first — but a totals row sorts
  // below even those, or it totals rows printed underneath it. Stable within each
  // group, so the caller's order holds.
  const rank = (r: Row) => (r.total ? 2 : r.muted ? 1 : 0)
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b))
  const cls = (c: Col) => `${c.num ? 'num' : ''}${c.divider ? ' divider' : ''}`.trim() || undefined

  return (
    <div className="sk-table-wrap">
      <table className="sk-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} className={cls(c)} scope="col">
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.flatMap(row => {
            const expandable = !!row.children?.length
            const isOpen = expandable && open.has(row.key)
            const rowCls = `${row.muted ? 'muted' : ''}${row.total ? ' total' : ''}`.trim()

            return [
              <tr key={row.key} className={rowCls || undefined}>
                {cols.map((c, i) => (
                  <td key={c.key} className={cls(c)}>
                    {i === 0 && expandable ? (
                      <button
                        type="button"
                        className="sk-expander"
                        aria-expanded={isOpen}
                        onClick={() => toggle(row.key)}
                      >
                        <span className="caret" aria-hidden>
                          ›
                        </span>
                        {row.cells[i]}
                      </button>
                    ) : (
                      row.cells[i]
                    )}
                  </td>
                ))}
              </tr>,
              ...(isOpen
                ? row.children!.map(child => (
                    <tr key={`${row.key}/${child.key}`} className="child">
                      {cols.map((c, i) => (
                        <td key={c.key} className={cls(c)}>
                          {child.cells[i]}
                        </td>
                      ))}
                    </tr>
                  ))
                : []),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
