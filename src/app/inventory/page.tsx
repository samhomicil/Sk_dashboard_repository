'use client'

/**
 * Inventory → Overview. What was bought, from whom, and whether it is landing
 * against the food-cost target.
 *
 * Unlike the other purchasing tabs this screen CAN grade itself: purchases ÷ net
 * sales has a real target in core/targets (COGS_TARGET), so the take carries a
 * tone rather than staying neutral. It reads the most recent complete week rather
 * than the window average, because a run-rate hides the week a price rise landed.
 */
import { Suspense } from 'react'
import { useInventoryData } from '@/components/useInventoryData'
import { SpendTrendChart, CostPctChart, CategoryMixChart, PriceTrendChart } from '@/components/InventoryCharts'
import { Grid11, Section, TakeCard, Tile, Tiles } from '@/components/design/shell'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'
import { COGS_TARGET, COGS_CAP } from '@/lib/core/targets'

const money = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const num = (n: number) => n.toLocaleString()

const MIX_COLS: Col[] = [
  { key: 'category', head: 'Category' },
  { key: 'spend', head: 'Spend', num: true },
  { key: 'mix', head: '% mix', num: true, derive: 'none' },
  { key: 'lines', head: 'Lines', num: true },
]

const TOP_COLS: Col[] = [
  { key: 'rank', head: '#', num: true, derive: 'none' },
  { key: 'product', head: 'Product', nowrap: true },
  { key: 'category', head: 'Category' },
  { key: 'spend', head: 'Spend', num: true },
  { key: 'unit', head: 'Last $/unit', num: true, derive: 'none' },
  { key: 'pines', head: 'Pines', num: true, divider: true },
  { key: 'miramar', head: 'Miramar', num: true },
  { key: 'margate', head: 'Margate', num: true },
]

const Loading = () => (
  <div className="sk-card"><p className="sk-flags-empty">Loading purchasing…</p></div>
)

function OverviewInner() {
  const { data, loading } = useInventoryData()

  if (loading) return <Loading />
  if (!data) {
    return (
      <div className="sk-card">
        <p className="sk-flags-empty">
          No purchasing data in this window — check the DB connection or widen the timeframe.
        </p>
      </div>
    )
  }

  const vendorTotal = data.vendorSplit.pfgTotal + data.vendorSplit.walmartTotal

  // Grade the most recent COMPLETE week. `week` is the week's start date, so the
  // final row is the one still running and its sales cover only the days elapsed —
  // purchases then divide into a part-week of sales and the ratio roughly doubles.
  // Measured 2026-08-19: the in-progress week held $19,187 of sales against ~$38k
  // for each complete week, which rendered as 58.7% of sales against a 25% target.
  // That is the same mistake as reading a nightly count as an inventory period:
  // the number is not high, the denominator is short.
  //
  // costPct arrives already expressed in percent (24.8, not 0.248), so the targets
  // below are scaled to match.
  const weekComplete = (w: { week: string }) =>
    Date.parse(w.week + 'T00:00:00Z') + 6 * 86_400_000 < Date.now()
  const weeks = data.weeklyTrend.filter(w => w.sales > 0 && weekComplete(w))
  const latest = weeks[weeks.length - 1]
  const targetPct = COGS_TARGET * 100
  const capPct = COGS_CAP * 100
  const tone = !latest ? 'neutral'
    : latest.costPct <= targetPct ? 'good'
    : latest.costPct <= capPct ? 'warn'
    : 'bad'

  return (
    <>
      <TakeCard
        tone={tone}
        label={latest ? `${latest.costPct.toFixed(1)}%` : '—'}
        headline={latest
          ? latest.costPct <= targetPct
            ? `Purchases ran ${latest.costPct.toFixed(1)}% of sales in the week to ${latest.week}, inside the ${targetPct}% target.`
            : `Purchases ran ${latest.costPct.toFixed(1)}% of sales in the week to ${latest.week}, above the ${targetPct}% target.`
          : 'No week in this window has sales to measure against.'}
      >
        {latest && (
          <>{money(vendorTotal)} bought across the window,
          {' '}{vendorTotal > 0 ? pct(data.vendorSplit.pfgTotal / vendorTotal) : '—'} of it through PFG.
          {' '}This is PURCHASING, not usage — a heavy delivery week reads high here without
          anything having been consumed differently. Read it as a trend across weeks, which is
          what the chart below is for.</>
        )}
      </TakeCard>

      <Section label="Total purchasing">
        <Tiles>
          <Tile label="Total spend" value={money(vendorTotal)} hero />
          <Tile
            label="PFS / PFG"
            value={money(data.vendorSplit.pfgTotal)}
            target={vendorTotal > 0 ? `${pct(data.vendorSplit.pfgTotal / vendorTotal)} of spend` : undefined}
          />
          <Tile
            label="Walmart"
            value={money(data.vendorSplit.walmartTotal)}
            target={vendorTotal > 0 ? `${pct(data.vendorSplit.walmartTotal / vendorTotal)} of spend` : undefined}
          />
        </Tiles>
      </Section>

      <Section label="Trends">
        {/* *:min-w-0 lets each card shrink below its chart's 480px min width on
            phones — the chart then scrolls inside the card instead of stretching
            the page sideways. */}
        <Grid11>
          <div className="sk-card">
            <h3 className="sk-card-title">Spend over time</h3>
            <p className="sk-subline">Weekly PFG + Walmart</p>
            <SpendTrendChart data={data.weeklyTrend} />
          </div>
          <div className="sk-card">
            <h3 className="sk-card-title">Purchase cost % of sales</h3>
            <p className="sk-subline">
              Weekly purchases ÷ net sales vs the {targetPct}% target · complete weeks only
            </p>
            <CostPctChart data={data.weeklyTrend.filter(weekComplete)} />
          </div>
          <div className="sk-card">
            <h3 className="sk-card-title">Category mix shift</h3>
            <p className="sk-subline">Share of weekly PFG spend by category</p>
            <CategoryMixChart data={data.categoryTrend} />
          </div>
          <div className="sk-card">
            <h3 className="sk-card-title">Unit price over time</h3>
            <p className="sk-subline">Last-paid price per unit — watch for distributor hikes</p>
            <PriceTrendChart data={data.priceTrend} items={data.topProducts} />
          </div>
        </Grid11>
      </Section>

      <Section label="Category mix · PFG">
        <div className="sk-card">
          <DataTable
            caption="PFG spend by category with its share of the mix"
            cols={MIX_COLS}
            rows={data.categorySpend.map<Row>(c => ({
              key: c.category,
              cells: [c.category, money(c.spend), pct(c.pct), num(c.lines)],
              values: [null, c.spend, null, c.lines],
            }))}
          />
        </div>
      </Section>

      <Section label="Top 15 products">
        <div className="sk-card">
          <DataTable
            caption="Highest-spend products in the window, with the last unit price paid"
            cols={TOP_COLS}
            rows={data.topProducts.map<Row>((pr, i) => ({
              key: pr.itemCode,
              cells: [
                String(i + 1),
                <span key="d" title={pr.description}>{pr.description}</span>,
                pr.category,
                money(pr.spend),
                <span key="u" title={pr.lastPriceDate ? `as of ${pr.lastPriceDate}` : ''}>
                  {pr.lastPrice != null ? `$${pr.lastPrice.toFixed(2)}` : '—'}
                </span>,
                money(pr.pines),
                money(pr.miramar),
                money(pr.margate),
              ],
              values: [null, null, null, pr.spend, null, pr.pines, pr.miramar, pr.margate],
            }))}
          />
          <p className="sk-take-why" style={{ marginTop: 'var(--space-3)' }}>
            Combined by true item code — the distributor renames product descriptions
            mid-period for the same SKU. Last $/unit = line total ÷ qty on the most recent
            order in-window.
          </p>
        </div>
      </Section>
    </>
  )
}

export default function InventoryOverviewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OverviewInner />
    </Suspense>
  )
}
