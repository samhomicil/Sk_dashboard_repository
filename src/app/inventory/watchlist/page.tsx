'use client'

/**
 * Inventory → Actions & watchlist. ONE question: what is missing, per store, this week.
 *
 * SCOPED TO THE NIGHTLY COUNT LIST. The screen used to grade all ~450 store-items,
 * most of which nobody counts — so most rows carried "Est" or "Needs count" and the
 * handful of genuinely short items sat among them. An item nobody counts cannot be
 * called short with any confidence, so it is no longer mixed in with ones that can:
 * nightly-counted items are the list, everything else is a separate count request.
 *
 * HOT LEADS. Within the nightly list, the top-value ingredients (HOT_ITEM_VALUE_SHARE)
 * render as their own block above the rest, because running out of acai base stops the
 * line and running out of a retail bottle does not.
 *
 * WEEKLY, AND ONLY WEEKLY. The module's 4/8/13-week/YTD control does not apply here and
 * is not rendered (see inventory/layout.tsx) — this is read once a week to place orders,
 * and no other period answers that question. The order quantities underneath are still
 * sized per delivery cycle, because that is when trucks actually come: Pines and Miramar
 * are ordered Tue+Fri, Margate Tue only, so Margate's numbers cover roughly double.
 *
 * THROUGHPUT IS NOT HERE. Weekly usage, days of supply and the count-vs-recipe basis
 * moved to /inventory/shrink, which is already the usage-variance screen. What is left
 * on a row is only what you need to place an order: what is on the shelf, how much to
 * buy, and what it costs.
 */
import { useState, useEffect, useMemo } from 'react'
import type { OrderGuideRow, OrderGuidePayload } from '@/lib/orderGuide'
import { Grid11, Section, TakeCard, Disclosure } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'
import { HOT_ITEM_VALUE_SHARE } from '@/lib/core/targets'

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const money = (n: number) => '$' + Math.round(n).toLocaleString()
const wdmd = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const md = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const STORE_OPTS = [
  { value: 'All', label: 'All' },
  { value: 'Pines', label: 'Pines' },
  { value: 'Miramar', label: 'Miramar' },
  { value: 'Margate', label: 'Margate' },
] as const
type StoreOpt = typeof STORE_OPTS[number]['value']

/** Only two states matter when placing an order: it is out (or will be before a truck
 *  can reach it), or it is running down. Everything else is not on this screen. */
function NeedBadge({ flag }: { flag: OrderGuideRow['flag'] }) {
  if (flag === 'urgent') return <span className="pill pill-red">Out / short</span>
  if (flag === 'reorder') return <span className="pill pill-yellow">Running low</span>
  return <span className="pill pill-green">OK</span>
}

/** A counted item whose count is not believable. This is the ONE data caveat that
 *  survives onto the order screen, because ordering against a bad count is how you buy
 *  a case you already have. */
const Disputed = () => <span className="pill pill-red" title="last night's count disagrees sharply with the book — confirm it before ordering">Check count</span>

const Loading = () => <div className="sk-card"><p className="sk-flags-empty">Loading this week&apos;s needs…</p></div>

/** Rows for one need-block. Deliberately narrow: shelf, buy, cost. No usage, no days of
 *  supply, no basis — those live on /inventory/shrink now. */
function needRows(list: OrderGuideRow[], showStore: boolean): Row[] {
  return list.map<Row>(r => ({
    key: `${r.store}|${r.productNumber}`,
    cells: [
      <span key="i" title={r.productName}>
        {r.productName}
        {r.sourcing === 'transfer' && <span className="pill pill-gray" style={{ marginLeft: 6 }}>↔ transfer</span>}
      </span>,
      ...(showStore ? [r.store] : []),
      <span key="o">{num(r.onHand)} <span className="sk-take-why">{r.unit}</span></span>,
      /* The purchasable unit, not the stocking unit — "2.1 LB of Gladiator" is not an
         action a manager can take; "1× 1/25 Lb case" is. */
      r.route === 'walmart' && r.walmartUnits
        ? <span key="b" title={r.walmartItem ?? ''}>{r.walmartUnits}× Walmart</span>
        : r.route === 'transfer' ? <span key="b" className="pill pill-yellow">transfer in</span>
        : r.casePack && r.caseUnits
          ? <span key="b">{Math.ceil(r.suggestedOrder / r.caseUnits)}× {r.casePack}</span>
          : <span key="b"><b>{num(Math.ceil(r.suggestedOrder * 10) / 10)}</b> <span className="sk-take-why">{r.unit ?? ''}</span></span>,
      r.estOrderCost != null ? money(r.estOrderCost) : '—',
      <span key="st" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <NeedBadge flag={r.flag} />
        {r.onHandBasis === 'disputed' && <Disputed />}
      </span>,
    ],
  }))
}

export default function OrderNeedsPage() {
  const [data, setData] = useState<OrderGuidePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<StoreOpt>('All')

  useEffect(() => {
    fetch('/api/inventory/watchlist')
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const scoped = useMemo(
    () => !data ? [] : store === 'All' ? data.rows : data.rows.filter(x => x.store === store),
    [data, store])

  // The nightly list is the screen. Everything else is a count request, not an order.
  const counted = useMemo(() => scoped.filter(r => r.nightlyTracked), [scoped])
  const uncounted = useMemo(
    () => scoped.filter(r => !r.nightlyTracked && r.suggestedOrder > 0)
                .sort((a, b) => (b.weeklyValue) - (a.weeklyValue)), [scoped])

  // Needed = short enough to act on AND there is something to buy. Sorted worst-first,
  // then by value, so the top of each block is the most expensive way to be wrong.
  const needed = useMemo(() =>
    counted.filter(r => r.suggestedOrder > 0 && (r.flag === 'urgent' || r.flag === 'reorder'))
           .sort((a, b) => (a.flag === b.flag ? 0 : a.flag === 'urgent' ? -1 : 1)
                        || b.weeklyValue - a.weeklyValue), [counted])

  const hot = useMemo(() => needed.filter(r => r.hot), [needed])
  const rest = useMemo(() => needed.filter(r => !r.hot), [needed])

  const hotOut = hot.filter(r => r.flag === 'urgent').length
  const cost = needed.reduce((s, r) => s + (r.estOrderCost ?? 0), 0)
  const hotCost = hot.reduce((s, r) => s + (r.estOrderCost ?? 0), 0)
  const truck = data?.nextTruck?.[store === 'All' ? 'Pines' : store]

  // Per-store order totals — the "what needs to be ordered per store" answer, kept
  // visible even when the table is filtered to one store.
  const byStore = useMemo(() => {
    const m = new Map<string, { hot: number; rest: number; cost: number; out: number }>()
    for (const r of (data?.rows ?? [])) {
      if (!r.nightlyTracked || r.suggestedOrder <= 0) continue
      if (r.flag !== 'urgent' && r.flag !== 'reorder') continue
      const c = m.get(r.store) ?? { hot: 0, rest: 0, cost: 0, out: 0 }
      if (r.hot) c.hot += 1; else c.rest += 1
      c.cost += r.estOrderCost ?? 0
      if (r.flag === 'urgent') c.out += 1
      m.set(r.store, c)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data])

  if (loading) return <Loading />
  if (!data) {
    return (
      <div className="sk-card">
        <p className="sk-flags-empty">No order data — check the NetChef extractor / DB connection.</p>
      </div>
    )
  }

  const withStore = (cols: Col[]): Col[] =>
    store === 'All' ? [cols[0], { key: 'store', head: 'Store' }, ...cols.slice(1)] : cols

  const NEED_COLS = withStore([
    { key: 'item', head: 'Item', nowrap: true },
    { key: 'onHand', head: 'On shelf', num: true, derive: 'none' },
    { key: 'buy', head: 'Order', derive: 'none' },
    { key: 'est', head: 'Est $', num: true },
    { key: 'status', head: '' },
  ])

  return (
    <>
      <div className="sk-filterbar">
        <SegControl label="Store" options={[...STORE_OPTS]} value={store} onChange={setStore} />
        {data.weatherLift > 1.02 && (
          <span className="pill pill-yellow">Heat +{Math.round((data.weatherLift - 1) * 100)}% demand</span>
        )}
        {data.holidays?.length > 0 && <span className="pill pill-teal">{data.holidays.join(', ')}</span>}
        <span className="sk-meta sk-filterbar-meta">
          Counted through {data.onHandAsOf ?? '—'}
        </span>
      </div>

      {/* The verdict is the shortage, not the truck. */}
      <TakeCard
        tone={hotOut > 0 ? 'bad' : needed.length > 0 ? 'warn' : 'good'}
        label={truck ? `order by ${wdmd(truck.orderBy)}` : undefined}
        headline={
          needed.length === 0
            ? 'Nothing is short this week — every counted item covers its next delivery.'
            : hotOut > 0
              ? `${hotOut} hot item${hotOut === 1 ? '' : 's'} will run out before the next truck.`
              : `${needed.length} item${needed.length === 1 ? '' : 's'} running low — ${money(cost)} to restock.`
        }
      >
        {needed.length > 0 && (
          <>{hot.length} hot · {rest.length} other · {money(cost)} total
          {truck && <>, delivering {wdmd(truck.delivery)}</>}.
          {uncounted.length > 0 && <> {uncounted.length} more item{uncounted.length === 1 ? '' : 's'} could be short but {uncounted.length === 1 ? 'was' : 'were'} not counted.</>}</>
        )}
      </TakeCard>

      {/* What needs ordering PER STORE — the secondary use case, answered without
          making anyone flip the filter three times. */}
      {byStore.length > 0 && (
        <Section label="By store">
          <div className="sk-card">
            <DataTable
              caption="Items short and estimated restock cost, per store"
              cols={[
                { key: 'store', head: 'Store', nowrap: true },
                { key: 'hot', head: 'Hot short', num: true, derive: 'none' },
                { key: 'other', head: 'Other short', num: true, derive: 'none' },
                { key: 'out', head: 'Out before truck', num: true, derive: 'none' },
                { key: 'cost', head: 'Est $', num: true },
              ]}
              rows={byStore.map<Row>(([s, c]) => ({
                key: s,
                cells: [
                  s,
                  String(c.hot),
                  String(c.rest),
                  <span key="o" data-tone={c.out > 0 ? 'bad' : undefined}>{c.out}</span>,
                  money(c.cost),
                ],
                values: [null, c.hot, c.rest, c.out, c.cost],
              }))}
            />
          </div>
        </Section>
      )}

      <Section
        label={`Hot items to order${store !== 'All' ? ` · ${store}` : ''}`}
        aside={<span className="sk-meta">{hot.length} short · {money(hotCost)}</span>}
      >
        <div className="sk-card">
          {hot.length === 0 ? (
            <p className="sk-flags-empty">
              No hot item is short. These are the top-value ingredients on the nightly
              count list, so this is the line that matters most.
            </p>
          ) : (
            <DataTable
              caption="Hot ingredients that are short, with the quantity to order"
              cols={NEED_COLS}
              rows={needRows(hot, store === 'All')}
            />
          )}
        </div>
      </Section>

      <Disclosure label="Other counted items" count={rest.length}>
        <div className="sk-card">
          {rest.length === 0 ? (
            <p className="sk-flags-empty">Nothing else on the nightly list is short.</p>
          ) : (
            <DataTable
              caption="Everything else on the nightly count list that is short"
              cols={NEED_COLS}
              rows={needRows(rest, store === 'All')}
            />
          )}
        </div>
      </Disclosure>

      {/* Not an order list — a counting list. Kept last and closed by default so it
          never competes with the items we can actually speak to. */}
      {uncounted.length > 0 && (
        <Disclosure label="Not counted — cannot advise" count={uncounted.length}>
          <div className="sk-card">
              <p className="sk-subline" style={{ marginBottom: 'var(--space-3)' }}>
                These are off the nightly count template, so their on-hand is a carried
                book figure rather than a measurement. The model thinks they may be short,
                but that is a guess. Count them and they join the list above.
              </p>
              <DataTable
                caption="Items the model believes are short but which nobody counts"
                cols={withStore([
                  { key: 'item', head: 'Item', nowrap: true },
                  { key: 'last', head: 'Last counted', derive: 'none' },
                  { key: 'est', head: 'Est $ if ordered', num: true },
                ])}
                rows={uncounted.map<Row>(r => ({
                  key: `${r.store}|${r.productNumber}`,
                  cells: [
                    <span key="i" title={r.productName}>{r.productName}</span>,
                    ...(store === 'All' ? [r.store] : []),
                    r.lastCountDate
                      ? <span key="l">{md(r.lastCountDate)}{r.staleNights != null && <span className="sk-take-why"> · {r.staleNights}d ago</span>}</span>
                      : <span key="l" className="sk-take-why">never</span>,
                    r.estOrderCost != null ? money(r.estOrderCost) : '—',
                  ],
                }))}
              />
          </div>
        </Disclosure>
      )}

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

      <p className="sk-take-why">
        Scope is the nightly count list — the {counted.length} item
        {counted.length === 1 ? '' : 's'} someone physically counts each night
        {store !== 'All' ? ` at ${store}` : ''}, because an item nobody counts cannot be
        called short. <b>Hot</b> is the top {Math.round(HOT_ITEM_VALUE_SHARE * 100)}% of weekly consumption
        value among nightly-counted ingredients, ranked per store, so it follows what the
        store actually burns rather than a list someone has to maintain. Order quantity is
        order-up-to over the days that order covers, delivery-to-delivery, spread across
        the day-of-week demand curve with heat and holidays — Pines and Miramar order
        Tue+Fri, <b>Margate Tue only</b>, so Margate carries roughly double the cover on
        the same item. <b>Order</b> is the real purchasable unit: PFG case pack and price
        from recent invoices, or a Walmart substitute where that item is genuinely bought
        locally. Consumption rates, days of supply and the count-versus-recipe basis live
        on <b>Shrink</b>.
      </p>
    </>
  )
}
