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
   * Names the column group this belongs to. Any group at all switches the header
   * to two tiers: the grouping on top, the column names under it. Without it, a
   * reader facing "Plan / Act / Var / Plan / Act / Var" has to guess which pair of
   * measures they belong to.
   */
  group?: string
  /**
   * Keep this column on one line. For a narrative column that would otherwise wrap
   * to three lines and drag the whole row's height with it — on a phone the wrapping
   * cell is often scrolled out of view, so the row looks arbitrarily tall for no
   * visible reason. The table scrolls instead, which is the rule anyway.
   */
  nowrap?: boolean
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
  /** A projected/forecast row — rendered so it can't be read as measured. */
  proj?: boolean
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
  const cls = (c: Col) =>
    `${c.num ? 'num' : ''}${c.divider ? ' divider' : ''}${c.nowrap ? ' nowrap' : ''}`.trim() || undefined

  // Two-tier header. Consecutive columns sharing a group collapse into one
  // spanning cell on the top tier; an UNGROUPED column (Day, Weather, Action)
  // spans both tiers with rowSpan=2 and is skipped on the lower one, which is the
  // shape the reference kit uses and the only one that reads correctly — a blank
  // spacer above "Day" implies Day belongs to some unnamed group.
  const grouped = cols.some(c => c.group)
  const groups = grouped
    ? cols.reduce<{ name?: string; span: number; col: Col }[]>((acc, c) => {
        const last = acc[acc.length - 1]
        if (last && c.group && last.name === c.group) last.span += 1
        else acc.push({ name: c.group, span: 1, col: c })
        return acc
      }, [])
    : null

  return (
    <div className="sk-table-wrap">
      <table className="sk-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          {groups ? (
            <tr className="group">
              {groups.map((g, i) =>
                g.name ? (
                  <th key={i} colSpan={g.span} scope="colgroup" className={`grp ${cls(g.col) ?? ''}`.trim()}>
                    {g.name}
                  </th>
                ) : (
                  <th key={i} rowSpan={2} scope="col" className={cls(g.col)}>
                    {g.col.head}
                  </th>
                ),
              )}
            </tr>
          ) : null}
          <tr>
            {cols.filter(c => !grouped || c.group).map(c => (
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
            const rowCls = `${row.muted ? 'muted' : ''}${row.total ? ' total' : ''}${row.proj ? ' proj' : ''}`.trim()

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
