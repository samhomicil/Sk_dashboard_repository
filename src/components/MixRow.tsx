'use client'

/**
 * The kit's mix row: sales by channel, sales by category, and top products, in a
 * 1:1:2 grid. Replaces BottomRow's four equal columns.
 *
 * Three list panels sharing one row item shape, so the eye learns it once:
 * rank/marker, name, figure, delta. Category uses the sequential ramp — one hue,
 * light to dark, because a category share is a magnitude, not an identity.
 */
import type { ChannelRow, ProductRow, CategoryRow } from '@/lib/types'

const RAMP = [
  'var(--ramp-sequential-5)',
  'var(--ramp-sequential-4)',
  'var(--ramp-sequential-3)',
  'var(--ramp-sequential-2)',
  'var(--ramp-sequential-1)',
]
const pct0 = (v: number) => `${Math.round(v * 100)}%`
const k$ = (v: number) => `$${(v / 1000).toFixed(1)}k`

function Delta({ v, width = 34 }: { v: number; width?: number }) {
  // Zero movement is neither good nor bad; it gets the muted ink, not a colour.
  const tone = Math.abs(v) < 0.0005 ? undefined : v > 0 ? 'good' : 'bad'
  return (
    <span
      className={`sk-delta tabular-nums${tone ? ` sk-tone-${tone}` : ''}`}
      style={{ width, textAlign: 'right', marginTop: 0, color: tone ? 'var(--tone)' : 'var(--ink-muted)' }}
    >
      {v > 0 ? '+' : ''}{Math.round(v * 100)}%
    </span>
  )
}

export default function MixRow({ channels, products, categories, loading }: {
  channels: ChannelRow[]
  products: ProductRow[]
  categories: CategoryRow[]
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="sk-mixrow">
        {[0, 1, 2].map(i => <div key={i} className="sk-card"><div className="skeleton" style={{ height: 160 }} /></div>)}
      </div>
    )
  }

  // An empty list says why it is empty. Rendering nothing at all leaves a titled
  // card with a void under it, which reads as a broken panel rather than a period
  // with no data.
  const Empty = ({ what }: { what: string }) => (
    <p className="sk-flags-empty">No {what} for this period.</p>
  )

  const half = Math.ceil(products.length / 2)
  const productCol = (rows: ProductRow[], offset: number) => (
    <div>
      {rows.map((p, i) => (
        <div key={p.name} className="sk-mixitem">
          <span className="rank">{offset + i + 1}</span>
          <span className="grow">{p.name}</span>
          <span className="tabular-nums" style={{ fontWeight: 600 }}>{p.qtyPerDay.toFixed(1)}/d</span>
          <Delta v={p.changePct} />
        </div>
      ))}
    </div>
  )

  return (
    <div className="sk-mixrow">
      <div className="sk-card">
        <h3 className="sk-card-title">Sales by channel</h3>
        <p className="sk-subline" style={{ margin: '4px 0 12px' }}>% of mix vs PY</p>
        {channels.length === 0 && <Empty what="channel data" />}
        {channels.map(c => (
          <div key={c.name}>
            <div className="sk-mixitem">
              <span className="grow" style={{ fontWeight: 600 }}>{c.name}</span>
              <span className="tabular-nums" style={{ fontWeight: 700 }}>{pct0(c.pct)}</span>
              <span className="sk-mixpy tabular-nums">{c.pctPY > 0 ? `py ${pct0(c.pctPY)}` : ''}</span>
              {c.pctPY > 0
                ? <Delta v={c.pct - c.pctPY} />
                : <span className="sk-mixpy" style={{ width: 34, textAlign: 'right' }}>—</span>}
            </div>
            {c.children?.map(ch => (
              <div key={ch.name} className="sk-mixitem child">
                <span className="grow">{ch.name}</span>
                <span className="tabular-nums">{pct0(ch.pct)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sk-card">
        <h3 className="sk-card-title">Sales by category</h3>
        <p className="sk-subline" style={{ margin: '4px 0 12px' }}>% of mix</p>
        {categories.length === 0 && <Empty what="category data" />}
        {categories.map((c, i) => (
          <div key={c.name} className="sk-mixitem">
            <span className="rank">{i + 1}</span>
            <span className="sk-dot" style={{ background: RAMP[Math.min(i, RAMP.length - 1)] }} />
            <span className="grow">{c.name}</span>
            <span className="tabular-nums" style={{ color: 'var(--ink-muted)' }}>{k$(c.sales)}</span>
            <span className="tabular-nums" style={{ fontWeight: 700, width: 38, textAlign: 'right' }}>{pct0(c.pct)}</span>
          </div>
        ))}
      </div>

      <div className="sk-card">
        <h3 className="sk-card-title">Top products</h3>
        <p className="sk-subline" style={{ margin: '4px 0 12px' }}>Qty/day · vs L4W</p>
        {products.length === 0 ? <Empty what="product data" /> : (
          <div className="sk-grid11" style={{ gap: '0 32px' }}>
            {productCol(products.slice(0, half), 0)}
            {productCol(products.slice(half), half)}
          </div>
        )}
      </div>
    </div>
  )
}
