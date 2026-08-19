'use client'

/**
 * Inventory → By vendor. Where the food spend goes: PFG against Walmart, and the
 * brand concentration inside PFG.
 *
 * The take is about CONCENTRATION, because that is the only thing on this screen
 * anyone can act on — a single house label carrying most of PFG spend is the fact
 * that matters in a volume-pricing conversation. No threshold is graded against;
 * this app has no target for supplier concentration and the redesign does not
 * invent one.
 */
import { Suspense } from 'react'
import { useInventoryData } from '@/components/useInventoryData'
import { Section, TakeCard, Tile, Tiles } from '@/components/design/shell'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'

const money = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

const BRAND_COLS: Col[] = [
  { key: 'brand', head: 'Brand / manufacturer' },
  { key: 'spend', head: 'Spend', num: true },
  { key: 'share', head: '% of PFG', num: true, derive: 'none' },
]

const WM_COLS: Col[] = [
  { key: 'category', head: 'Category' },
  { key: 'spend', head: 'Spend', num: true },
  { key: 'share', head: '% of Walmart', num: true, derive: 'none' },
]

const Loading = () => (
  <div className="sk-card"><p className="sk-flags-empty">Loading purchasing…</p></div>
)

function VendorsInner() {
  const { data, loading } = useInventoryData()

  if (loading) return <Loading />
  if (!data) return <div className="sk-card"><p className="sk-flags-empty">No purchasing data yet.</p></div>

  const { pfgTotal, walmartTotal: wmSplit } = data.vendorSplit
  const vendorTotal = pfgTotal + wmSplit
  const walmartTotal = data.walmartCategories.reduce((s, c) => s + c.spend, 0)
  const topBrand = data.pfgBrands[0]

  return (
    <>
      <TakeCard
        tone="neutral"
        label={topBrand ? pct(topBrand.pct) : '—'}
        headline={topBrand
          ? `${topBrand.brand} house-label products are ${pct(topBrand.pct)} of all PFG spend.`
          : 'No vendor spend in this window.'}
      >
        {topBrand && (
          <>Heavy single-brand concentration is typical for a franchise, and it is not a
          problem on its own — but it is the number to have in hand for any volume-pricing
          conversation. PFG carries {vendorTotal > 0 ? pct(pfgTotal / vendorTotal) : '—'} of
          food spend overall; Walmart is a supplemental channel, not planned bulk purchasing.</>
        )}
      </TakeCard>

      <Section label="Vendor split">
        <Tiles>
          <Tile
            label="PFS / PFG"
            value={money(pfgTotal)}
            hero
            target={vendorTotal > 0 ? `${pct(pfgTotal / vendorTotal)} of food spend` : undefined}
          />
          <Tile
            label="Walmart"
            value={money(wmSplit)}
            target={vendorTotal > 0 ? `${pct(wmSplit / vendorTotal)} of food spend` : undefined}
          />
        </Tiles>
      </Section>

      <Section label="PFG brand concentration">
        <div className="sk-card">
          <DataTable
            caption="PFG spend by brand or manufacturer, with each brand's share of PFG"
            cols={BRAND_COLS}
            rows={data.pfgBrands.map<Row>(b => ({
              key: b.brand,
              cells: [b.brand, money(b.spend), pct(b.pct)],
              values: [null, b.spend, null],
            }))}
          />
        </div>
      </Section>

      <Section label="Walmart breakdown">
        <div className="sk-card">
          <DataTable
            caption="Walmart spend by category, with each category's share of Walmart"
            cols={WM_COLS}
            rows={data.walmartCategories.map<Row>(c => ({
              key: c.category,
              cells: [
                c.category,
                money(c.spend),
                walmartTotal > 0 ? pct(c.spend / walmartTotal) : '—',
              ],
              values: [null, c.spend, null],
            }))}
          />
          <p className="sk-take-why" style={{ marginTop: 'var(--space-3)' }}>
            Walmart is a supplemental channel — almost entirely fresh produce toppings and
            small ad-hoc top-ups, not planned bulk purchasing.
          </p>
        </div>
      </Section>
    </>
  )
}

export default function InventoryVendorsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <VendorsInner />
    </Suspense>
  )
}
