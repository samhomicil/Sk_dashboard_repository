'use client'

/**
 * Inventory → By store. Category spend split across the three stores.
 *
 * The share row is the point of the screen, and it is the row most likely to be
 * misread, which is why the note above the table is not decoration: Miramar buys
 * several dry goods for all three stores and transfers them out, so its column
 * runs high for a reason that has nothing to do with consumption.
 */
import { Suspense } from 'react'
import { useInventoryData } from '@/components/useInventoryData'
import { storeTotal } from '@/lib/purchasingUtils'
import { Section, TakeCard } from '@/components/design/shell'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'

const money = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

const COLS: Col[] = [
  { key: 'category', head: 'Category' },
  { key: 'pines', head: 'Pines', num: true },
  { key: 'miramar', head: 'Miramar', num: true },
  { key: 'margate', head: 'Margate', num: true },
  { key: 'total', head: 'Total', num: true, divider: true },
]

const Loading = () => (
  <div className="sk-card"><p className="sk-flags-empty">Loading purchasing…</p></div>
)

function StoresInner() {
  const { data, loading } = useInventoryData()

  if (loading) return <Loading />
  if (!data) return <div className="sk-card"><p className="sk-flags-empty">No purchasing data yet.</p></div>

  const totals = data.categoryByStore.reduce(
    (acc, c) => ({ pines: acc.pines + c.pines, miramar: acc.miramar + c.miramar, margate: acc.margate + c.margate }),
    { pines: 0, miramar: 0, margate: 0 },
  )
  const grand = totals.pines + totals.miramar + totals.margate
  const share = (n: number) => (grand > 0 ? pct(n / grand) : '—')

  const rows: Row[] = [
    ...data.categoryByStore.map<Row>(c => ({
      key: c.category,
      cells: [c.category, money(c.pines), money(c.miramar), money(c.margate), money(storeTotal(c))],
      values: [null, c.pines, c.miramar, c.margate, storeTotal(c)],
    })),
    {
      key: '__total',
      total: true,
      cells: ['Store total', money(totals.pines), money(totals.miramar), money(totals.margate), money(grand)],
      values: [null, totals.pines, totals.miramar, totals.margate, grand],
    },
    {
      key: '__share',
      total: true,
      // A share row is not a sum of the rows above it, so it declares itself as
      // derive:'none' through the column spec rather than tripping the table's
      // reconciliation check.
      cells: ['% of total', share(totals.pines), share(totals.miramar), share(totals.margate), '100%'],
    },
  ]

  // Derived, not authored. There is no target for "share of purchasing" in this
  // app and the redesign does not invent one, so the take states the concentration
  // and names the transfer practice that explains most of it — tone stays neutral
  // because a high share here is a fact about how ordering is organised, not a
  // number failing a threshold.
  const byShare = ([['Pines', totals.pines], ['Miramar', totals.miramar], ['Margate', totals.margate]] as const)
    .slice().sort((a, b) => b[1] - a[1])
  const [topName, topSpend] = byShare[0]
  const evenShare = grand / 3

  return (
    <>
      <TakeCard
        tone="neutral"
        label={grand > 0 ? share(topSpend) : '—'}
        headline={grand > 0
          ? `${topName} buys the largest share of purchasing, ${money(topSpend)} of ${money(grand)}.`
          : 'No purchasing in this window.'}
      >
        {grand > 0 && (
          <>That is {money(topSpend - evenShare)} above an even three-way split
          {topName === 'Miramar'
            ? ', which is expected — Miramar orders several dry goods for all three stores and transfers them out.'
            : '.'} Read shares here as ordering behaviour, not consumption — Actions &amp; watchlist carries usage figures that account for the transfers.</>
        )}
      </TakeCard>

      <Section label="Category × store">
        <div className="sk-card">
          <DataTable
            caption="Purchasing spend by category and store, with each store's share of the total"
            cols={COLS}
            rows={rows}
          />
        </div>
      </Section>
    </>
  )
}

export default function InventoryStoresPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StoresInner />
    </Suspense>
  )
}
