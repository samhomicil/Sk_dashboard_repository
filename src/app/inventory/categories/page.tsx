'use client'

/**
 * Inventory → By category. Spend by category, and the products inside whichever
 * one is selected.
 *
 * The old build had TWO controls driving one piece of state — clickable table rows
 * and a row of pills underneath — with nothing to say which you were meant to use.
 * There is now one, and it is a SegControl, which is what this design system uses
 * for a mutually-exclusive scope choice everywhere else. The table went read-only:
 * DataTable has no selection affordance, so a clickable row there would be an
 * invisible control.
 */
import { Suspense, useState } from 'react'
import { useInventoryData } from '@/components/useInventoryData'
import { Section, TakeCard } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'

const money = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const num = (n: number) => n.toLocaleString()

const CAT_COLS: Col[] = [
  { key: 'category', head: 'Category' },
  { key: 'spend', head: 'Spend', num: true },
  { key: 'mix', head: '% mix', num: true, derive: 'none' },
  { key: 'lines', head: 'Lines', num: true },
]

const PROD_COLS: Col[] = [
  { key: 'rank', head: '#', num: true, derive: 'none' },
  { key: 'product', head: 'Product', nowrap: true },
  { key: 'brand', head: 'Brand' },
  { key: 'spend', head: 'Spend', num: true },
  { key: 'qty', head: 'Qty', num: true },
  { key: 'pines', head: 'Pines', num: true, divider: true },
  { key: 'miramar', head: 'Miramar', num: true },
  { key: 'margate', head: 'Margate', num: true },
]

const Loading = () => (
  <div className="sk-card"><p className="sk-flags-empty">Loading purchasing…</p></div>
)

function CategoriesInner() {
  const { data, loading } = useInventoryData()
  const [selected, setSelected] = useState<string | null>(null)

  if (loading) return <Loading />
  if (!data) return <div className="sk-card"><p className="sk-flags-empty">No purchasing data yet.</p></div>

  const active = selected ?? data.categorySpend[0]?.category ?? null
  const products = active ? (data.topProductsByCategory[active] ?? []) : []

  const catRows: Row[] = data.categorySpend.map(c => ({
    key: c.category,
    cells: [c.category, money(c.spend), pct(c.pct), num(c.lines)],
    values: [null, c.spend, null, c.lines],
  }))

  const catOptions = data.categorySpend.map(c => ({ value: c.category, label: c.category }))

  const prodRows: Row[] = products.map((p, i) => ({
    key: p.itemCode,
    cells: [
      String(i + 1),
      <span key="p" title={p.description}>{p.description}</span>,
      p.brand,
      money(p.spend),
      num(p.qty),
      money(p.pines),
      money(p.miramar),
      money(p.margate),
    ],
    values: [null, null, null, p.spend, p.qty, p.pines, p.miramar, p.margate],
  }))

  // Descriptive, derived. Concentration is the thing worth knowing on this screen —
  // where the money actually goes — and there is no target for it in this app, so
  // the tone stays neutral and no threshold is invented to grade it against.
  const top = data.categorySpend[0]
  const totalSpend = data.categorySpend.reduce((t, c) => t + c.spend, 0)
  const topTwo = data.categorySpend.slice(0, 2)
  const topTwoShare = totalSpend > 0
    ? topTwo.reduce((t, c) => t + c.spend, 0) / totalSpend : 0

  return (
    <>
      <TakeCard
        tone="neutral"
        label={top ? pct(top.pct) : '—'}
        headline={top
          ? `${top.category} is the largest category at ${money(top.spend)}.`
          : 'No purchasing in this window.'}
      >
        {top && (
          <>{topTwo.length > 1
            ? <>{topTwo.map(c => c.category).join(' and ')} together account for {pct(topTwoShare)} of
              {' '}{money(totalSpend)} spent across {data.categorySpend.length} categories. </>
            : <>{money(totalSpend)} spent in total. </>}
          Select a category below to see which products drive it.</>
        )}
      </TakeCard>

      <Section label="All categories">
        <div className="sk-card">
          <DataTable
            caption="Purchasing spend by category"
            cols={CAT_COLS}
            rows={catRows}
          />
        </div>
      </Section>

      <Section label="Top products">
        <div className="sk-filterbar">
          <SegControl
            label="Category"
            options={catOptions}
            value={active ?? ''}
            onChange={setSelected}
          />
        </div>
        <div className="sk-card">
          {prodRows.length ? (
            <DataTable
              caption={`Highest-spend products in ${active ?? 'the selected category'}`}
              cols={PROD_COLS}
              rows={prodRows}
            />
          ) : (
            <p className="sk-flags-empty">No products in this category.</p>
          )}
        </div>
      </Section>
    </>
  )
}

export default function InventoryCategoriesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CategoriesInner />
    </Suspense>
  )
}
