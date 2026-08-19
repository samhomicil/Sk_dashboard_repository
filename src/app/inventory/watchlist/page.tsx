'use client'

/**
 * Inventory → Actions & watchlist. The order guide: what to buy, by when, and what
 * can be moved between stores instead of bought.
 *
 * URGENCY IS THE ENGINE'S TO DECIDE, NOT THIS SCREEN'S. The page used to colour
 * "runs dry" red from a local `LEAD = 4`, which is the very constant core/sourcing
 * documents as retired: "The old orderGuide LEAD_DAYS = 4 conflated them and drove
 * the urgent flag off a fixed number rather than off whether a truck can actually
 * arrive in time." The engine now grades against ALERT_LEAD_DAYS and the real
 * delivery calendar, so a row could be painted red here while carrying a calmer
 * flag beside it. The colour now follows `r.flag` — one verdict per row, computed
 * once, in the place that knows the truck schedule.
 */
import { useState, useEffect, useMemo } from 'react'
import type { OrderGuideRow, OrderGuidePayload } from '@/lib/orderGuide'
import { Grid11, Section, TakeCard } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const money = (n: number) => '$' + Math.round(n).toLocaleString()
const wd = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const wdmd = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const md = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const STORE_OPTS = [
  { value: 'All', label: 'All' },
  { value: 'Pines', label: 'Pines' },
  { value: 'Miramar', label: 'Miramar' },
  { value: 'Margate', label: 'Margate' },
] as const
type StoreOpt = typeof STORE_OPTS[number]['value']

/** Where the on-hand number came from. An estimate is only as good as how recently the
 *  item was counted, and an unknown is a request for a COUNT, not an order — so neither
 *  can be shown as a bare number. */
function BasisBadge({ r }: { r: OrderGuideRow }) {
  const tip = r.lastCountDate
    ? `last real count: ${r.lastCountKind ?? 'unknown'}, ${r.lastCountDate}`
      + (r.staleNights != null ? ` · ${r.staleNights} night${r.staleNights === 1 ? '' : 's'} ago` : '')
    : 'no count on record in the window'
  if (r.onHandBasis === 'unknown') return <span className="pill pill-gray" title="no usable count and the perpetual book is at or below zero — this needs counting before it can be ordered">Needs count</span>
  if (r.onHandBasis === 'estimated') return <span className="pill pill-yellow" title={tip}>Est</span>
  if (r.onHandBasis === 'disputed') return <span className="pill pill-red" title={tip}>Check</span>
  return null
}

function FlagBadge({ flag }: { flag: OrderGuideRow['flag'] }) {
  if (flag === 'urgent') return <span className="pill pill-red">Order now</span>
  if (flag === 'reorder') return <span className="pill pill-yellow">Reorder</span>
  if (flag === 'data') return <span className="pill pill-gray">Check count</span>
  return <span className="pill pill-green">OK</span>
}

const Loading = () => <div className="sk-card"><p className="sk-flags-empty">Loading the order guide…</p></div>

export default function OrderGuidePage() {
  const [data, setData] = useState<OrderGuidePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<StoreOpt>('All')

  useEffect(() => {
    fetch('/api/inventory/watchlist')
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const scoped = useMemo(() => {
    if (!data) return []
    return store === 'All' ? data.rows : data.rows.filter(x => x.store === store)
  }, [data, store])

  // The guide covers ~450 store-items. Listing them all buried the handful that matter,
  // so only 'act' and 'soon' are rendered as rows; the rest becomes a per-category
  // rollup. 'act' = out, or runs out before a truck can reach it.
  const rows = useMemo(() =>
    [...scoped.filter(r => r.bucket === 'act' || r.bucket === 'soon')]
      .sort((a, b) => (a.bucket === b.bucket ? 0 : a.bucket === 'act' ? -1 : 1)
                   || (a.daysOfSupply ?? 9999) - (b.daysOfSupply ?? 9999)), [scoped])

  const rollups = useMemo(() => {
    if (!data) return []
    return store === 'All' ? data.collapsed : data.collapsed.filter(c => c.store === store)
  }, [data, store])

  const quiet = scoped.length - rows.length
  const needCount = scoped.filter(r => r.onHandBasis === 'unknown').length
  const toOrder = rows.filter(r => r.flag === 'urgent' || r.flag === 'reorder')
  const cycleCost = toOrder.reduce((s, r) => s + (r.estOrderCost ?? 0), 0)
  const truck = data?.nextTruck?.[store === 'All' ? 'Pines' : store]
  const urgent = rows.filter(r => r.flag === 'urgent').length

  if (loading) return <Loading />
  if (!data) {
    return (
      <div className="sk-card">
        <p className="sk-flags-empty">No order-guide data — check the NetChef extractor / DB connection.</p>
      </div>
    )
  }

  const withStore = (cols: Col[]): Col[] =>
    store === 'All' ? [cols[0], { key: 'store', head: 'Store' }, ...cols.slice(1)] : cols

  const ORDER_COLS = withStore([
    { key: 'item', head: 'Item', nowrap: true },
    { key: 'onHand', head: 'On hand', num: true, derive: 'none' },
    { key: 'runsDry', head: 'Runs dry', derive: 'none' },
    { key: 'suggest', head: 'Suggested order', num: true, derive: 'none' },
    { key: 'est', head: 'Est $', num: true },
    { key: 'putOn', head: 'Put on' },
  ])

  const DETAIL_COLS = withStore([
    { key: 'item', head: 'Item', nowrap: true },
    { key: 'onHand', head: 'On hand', num: true, derive: 'none' },
    { key: 'usage', head: 'Wk usage', num: true, derive: 'none' },
    { key: 'days', head: 'Days', num: true, derive: 'none' },
    { key: 'suggest', head: 'Suggest', num: true, derive: 'none' },
    { key: 'buyAs', head: 'Buy as' },
    { key: 'status', head: 'Status' },
  ])

  const onHandCell = (r: OrderGuideRow) =>
    r.onHandBasis === 'unknown'
      ? <span className="sk-take-why">?</span>
      : <>{num(r.onHand)}</>

  return (
    <>
      <div className="sk-filterbar">
        <SegControl label="Store" options={[...STORE_OPTS]} value={store} onChange={setStore} />
        {data.weatherLift > 1.02 && (
          <span className="pill pill-yellow">Heat +{Math.round((data.weatherLift - 1) * 100)}% demand</span>
        )}
        {data.holidays?.length > 0 && <span className="pill pill-teal">{data.holidays.join(', ')}</span>}
        <span className="sk-meta sk-filterbar-meta">
          On-hand as of {data.onHandAsOf ?? '—'} · usage week {data.usageWeekStart} → {data.usageWeekEnd}
        </span>
      </div>

      {/* The verdict IS the truck: what to place, by when, for how much. */}
      <TakeCard
        tone={urgent > 0 ? 'bad' : toOrder.length > 0 ? 'warn' : 'good'}
        label={truck ? `by ${wdmd(truck.orderBy)}` : undefined}
        headline={
          !truck ? 'No delivery scheduled in the window.'
          : toOrder.length === 0 ? `Nothing to order for the ${wdmd(truck.delivery)} truck.`
          : `Place ${toOrder.length} item${toOrder.length === 1 ? '' : 's'} — ${money(cycleCost)} — before ${wdmd(truck.orderBy)}.`
        }
      >
        {truck && (
          <>Delivers {wdmd(truck.delivery)}{truck.following && <>, following truck {wdmd(truck.following)}</>}.
          {urgent > 0 && <> {urgent} item{urgent === 1 ? '' : 's'} run{urgent === 1 ? 's' : ''} dry before it arrives.</>}
          {needCount > 0 && <> {needCount} more cannot be sized until someone counts them.</>}</>
        )}
      </TakeCard>

      <Section
        label={`Order for the ${truck ? wdmd(truck.delivery) : 'next'} truck${store !== 'All' ? ` · ${store}` : ''}`}
        aside={
          <span className="sk-meta">
            {toOrder.length} items · {money(cycleCost)}
            {store !== 'All' && data.coverage?.[store] &&
              ` · covers ${data.coverage[store].days}d → ${wd(data.coverage[store].through)}`}
          </span>
        }
      >
        <div className="sk-card">
          {toOrder.length === 0 ? (
            <p className="sk-flags-empty">Nothing to order — every item is above its cover level.</p>
          ) : (
            <DataTable
              caption="Items to place on the next truck, with suggested quantity and estimated cost"
              cols={ORDER_COLS}
              rows={toOrder.map<Row>(r => ({
                key: `${r.store}|${r.productNumber}`,
                cells: [
                  <span key="i">
                    {r.productName}
                    {r.driver === 'bowls' && <span className="pill pill-teal" style={{ marginLeft: 6 }}>bowls</span>}
                    {r.sourcing === 'transfer' && <span className="pill pill-gray" style={{ marginLeft: 6 }}>↔ transfer</span>}
                  </span>,
                  ...(store === 'All' ? [r.store] : []),
                  onHandCell(r),
                  // Tone comes from the engine's flag, not from a lead-time literal
                  // re-derived here — see the note at the top of this file.
                  <span key="d" data-tone={r.flag === 'urgent' ? 'bad' : undefined}
                        title={r.daysOfSupply !== null ? `${r.daysOfSupply.toFixed(1)} days of supply` : ''}>
                    {r.runOutDate ? md(r.runOutDate) : '—'}
                  </span>,
                  <span key="s">
                    <b>{num(Math.ceil(r.suggestedOrder * 10) / 10)}</b>{' '}
                    <span className="sk-take-why">{r.unit}</span>
                  </span>,
                  r.estOrderCost != null ? money(r.estOrderCost) : '—',
                  r.sourcing === 'transfer'
                    ? <span key="p" className="pill pill-gray">↔ transfer</span>
                    : r.orderTruck
                      ? <span key="p" className={r.orderTruck === truck?.delivery ? undefined : 'sk-take-why'}>
                          {wd(r.orderTruck)} {md(r.orderTruck)}
                        </span>
                      : <span key="p" className="sk-take-why">—</span>,
                ],
              }))}
            />
          )}
        </div>
      </Section>

      {(data.pooled.length > 0 || data.transfers.length > 0) && (
        <Section label="Cheaper done together">
          <Grid11>
            {data.pooled.length > 0 && (
              <div className="sk-card">
                <h3 className="sk-card-title">PFG order · pooled across all stores</h3>
                <p className="sk-subline" style={{ marginBottom: 'var(--space-3)' }}>
                  Need is combined before rounding up to whole cases — ordering store by store
                  buys two cases where one covers all three.
                </p>
                <DataTable
                  caption="Pooled PFG order: combined need, whole cases, and which stores each case covers"
                  cols={[
                    { key: 'item', head: 'Item', nowrap: true },
                    { key: 'need', head: 'Need', num: true },
                    { key: 'cases', head: 'Cases', num: true },
                    { key: 'cost', head: 'Cost', num: true },
                    { key: 'covers', head: 'Covers' },
                  ]}
                  rows={[
                    ...data.pooled.map<Row>(p => ({
                      key: p.productNumber,
                      cells: [
                        <span key="n" title={`${p.code} · ${p.pack}`}>{p.name}</span>,
                        num(p.need),
                        String(p.cases),
                        `$${p.cost.toFixed(2)}`,
                        <span key="a" className="sk-take-why">
                          {p.allocation.map(a => `${a.store} ${num(a.need)}`).join(' · ')}
                        </span>,
                      ],
                      values: [null, p.need, p.cases, p.cost, null],
                    })),
                    {
                      key: '__total',
                      total: true,
                      cells: [
                        'Total', '',
                        String(data.pooled.reduce((s, p) => s + p.cases, 0)),
                        `$${data.pooled.reduce((s, p) => s + p.cost, 0).toFixed(2)}`,
                        '',
                      ],
                      values: [null, null,
                        data.pooled.reduce((s, p) => s + p.cases, 0),
                        data.pooled.reduce((s, p) => s + p.cost, 0), null],
                    },
                  ]}
                />
              </div>
            )}

            {data.transfers.length > 0 && (
              <div className="sk-card">
                <h3 className="sk-card-title">Move between stores</h3>
                <p className="sk-subline" style={{ marginBottom: 'var(--space-3)' }}>
                  Dry goods only — fruit and frozen ride the truck. A donor gives only what it
                  doesn&apos;t need to reach its own next delivery.
                </p>
                <DataTable
                  caption="Inter-store moves that avoid buying a whole case"
                  cols={[
                    { key: 'item', head: 'Item', nowrap: true },
                    { key: 'move', head: 'Move' },
                    { key: 'qty', head: 'Qty', num: true },
                    { key: 'avoided', head: 'Case avoided', num: true, derive: 'none' },
                  ]}
                  rows={data.transfers.map<Row>(t => ({
                    key: `${t.to}|${t.productNumber}`,
                    cells: [
                      <span key="n" title={t.name}>{t.name}</span>,
                      <span key="m">
                        {t.legs.map(l => l.from).join(' + ')} → <b>{t.to}</b>
                        {t.legs.some(l => l.trust === 'disputed') && (
                          <span data-tone="bad">
                            {' '}· confirm {t.legs.filter(l => l.trust === 'disputed').map(l => l.from).join(', ')} count first
                          </span>
                        )}
                        {t.short > 0.05 && <span className="sk-take-why"> · still short {num(t.short)}</span>}
                      </span>,
                      num(t.filled),
                      t.caseAvoided ? `$${t.caseAvoided.cost.toFixed(0)}` : '—',
                    ],
                    values: [null, null, t.filled, null],
                  }))}
                />
              </div>
            )}
          </Grid11>
        </Section>
      )}

      <Section
        label={`Needs attention${store !== 'All' ? ` · ${store}` : ''}`}
        aside={
          <span className="sk-meta">
            {rows.length} of {scoped.length} items · {quiet} covered or quiet
            {needCount > 0 ? ` · ${needCount} need a count` : ''}
          </span>
        }
      >
        <div className="sk-card">
          <DataTable
            caption="Every item that is short, running down, or cannot be sized"
            cols={DETAIL_COLS}
            rows={rows.map<Row>(r => ({
              key: `${r.store}|${r.productNumber}`,
              cells: [
                <span key="i" title={r.productName}>{r.productName}</span>,
                ...(store === 'All' ? [r.store] : []),
                onHandCell(r),
                /* Usage always states which basis it used and what the other one said,
                   so a surprising order can be traced without leaving the row. */
                <span key="u" title={
                  r.usageBasis === 'theoretical'
                    ? `no usable count — using recipe-driven usage (${num(r.theoreticalUsage)}/wk)`
                    : r.usageBasis === 'theoretical-guard'
                    ? `count claimed ${num(r.countUsage)} vs ${num(r.theoreticalUsage)} from recipes — count looks wrong, ordering to the recipe figure`
                    : `count-based; recipes suggest ${num(r.theoreticalUsage)}/wk`
                }>
                  {num(r.weeklyUsage)}{r.usageBasis === 'theoretical' ? '*' : ''}
                  {r.usageBasis === 'theoretical-guard' && (
                    <span className="pill pill-yellow" style={{ marginLeft: 4 }}>count?</span>
                  )}
                </span>,
                r.daysOfSupply !== null ? r.daysOfSupply.toFixed(1) : '—',
                r.suggestedOrder > 0 ? <b key="s">{num(Math.ceil(r.suggestedOrder * 10) / 10)}</b> : '—',
                /* PFG ships whole cases — "2.1 LB of Gladiator" is not an action. */
                r.route === 'walmart' && r.walmartUnits
                  ? <span key="b" title={r.walmartItem ?? ''}>{r.walmartUnits}× Walmart{r.walmartCost != null ? ` · $${r.walmartCost.toFixed(2)}` : ''}</span>
                  : r.route === 'transfer' ? <span key="b" className="pill pill-yellow">transfer in</span>
                  : r.route === 'next-order' ? <span key="b" className="sk-take-why">next order</span>
                  : r.casePack && r.caseUnits
                    ? <span key="b" title={r.idleValue != null ? `a whole case leaves $${r.idleValue.toFixed(0)} sitting` : ''}>
                        {Math.ceil(r.suggestedOrder / r.caseUnits)}× {r.casePack}
                      </span>
                    : <span key="b" className="sk-take-why">{r.unit ?? '—'}</span>,
                <span key="st" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <FlagBadge flag={r.flag} /><BasisBadge r={r} />
                </span>,
              ],
            }))}
          />
          <p className="sk-take-why" style={{ marginTop: 'var(--space-3)' }}>
            Suggested order = order-up-to over each order&apos;s coverage window
            (delivery-to-delivery), spread across the day-of-week demand curve with per-day
            heat &amp; holidays, − on-hand − pending. Pines/Miramar order Tue+Fri,{' '}
            <b>Margate Tue only</b>, so Margate carries roughly double the cover on the same
            item. <b>Buy as</b> is the real purchasable unit — PFG case pack and price off
            recent invoices, or a Walmart substitute where that item is genuinely bought
            locally. Usage is a per-day rate over the trailing {data.usageWindowDays} days;
            count-based (begin + received − physical) where there is enough count history,
            otherwise recipe-derived, and <b>*</b> marks the recipe fallback. <b>Est</b> means
            the line was left blank and the number is carried forward; <b>Needs count</b>{' '}
            means there is no usable count and the perpetual book is at or below zero — those
            can&apos;t be sized until someone counts them. Net-supplier stores (Pines→Margate
            transfers) read slightly high on usage until transfer-netting is added.
          </p>
        </div>
      </Section>

      {rollups.length > 0 && (
        <Section
          label="Everything else"
          aside={<span className="sk-meta">{quiet} items rolled up</span>}
        >
          <div className="sk-card">
            <p className="sk-subline" style={{ marginBottom: 'var(--space-3)' }}>
              Covered to the next delivery, or waiting on a count. Nothing here needs a
              decision this morning.
            </p>
            <div className="sk-rollups">
              {rollups.map(c => (
                <div key={`${c.store}|${c.category}`} className="sk-rollup">
                  <span>
                    {store === 'All' && <span className="sk-take-why">{c.store} · </span>}{c.category}
                  </span>
                  <span className="sk-meta">
                    {c.items}
                    {c.needCount > 0 && <span data-tone="warn"> · {c.needCount} to count</span>}
                    {c.estCost > 0 && <> · ${c.estCost.toFixed(0)}</>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </>
  )
}
