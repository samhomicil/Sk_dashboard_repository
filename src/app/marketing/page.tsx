'use client'

/**
 * MARKETING — what offers are live in the Smoothie King app, what starts next, and
 * what just ended, so a shift knows what guests will walk in asking for.
 *
 * The kit has no promotions screen; this follows the Transactions/Bills pattern
 * (PageBar with the screen's own store control, then grouped tables) and the
 * contract's copy rule — operational, plain nouns. No TakeCard: there is no verdict
 * to give about a calendar, and a manufactured one would be filler.
 *
 *   PageBar          title + store seg · window line
 *   Summary          running now / starts this week / next 30 days
 *   Running now      table
 *   Coming up        table (next 90 days)
 *   Recently ended   collapsed, last 60 days
 */
import { useState, useEffect, useMemo } from 'react'
import { swrGet, swrSet } from '@/lib/swrCache'
import { Page, PageBar, Section, Stat, Grid4, Disclosure } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'
import { useStoreLock } from '@/components/useStoreLock'
import { isoAdd } from '@/lib/core/dates'
import type { MarketingPayload, PromoRow } from '@/app/api/marketing/route'

const STORE_OPTS = [
  { value: 'all', label: 'All Stores' },
  { value: 'margate', label: 'Margate' },
  { value: 'miramar', label: 'Miramar' },
  { value: 'pines', label: 'Pines' },
]

const md = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

const dates = (p: PromoRow) => (p.start === p.end ? md(p.start) : `${md(p.start)} – ${md(p.end)}`)

/** "$3.99", "15% off", "2x points" — the offer in the fewest characters. */
function valueText(p: PromoRow): string {
  const v = p.value
  switch (p.unit) {
    case 'dollars': return v == null ? '$' : `$${v % 1 ? v.toFixed(2) : v.toFixed(0)}`
    case 'percent': return v == null ? '% off' : `${v}% off`
    case 'multiplier_x': return v == null ? 'Bonus points' : `${v}x points`
    case 'points': return v == null ? 'Points' : `${v} pts`
    case 'free_item': return 'Free item'
    default: return '—'
  }
}

const COLS: Col[] = [
  { key: 'dates', head: 'Dates', nowrap: true },
  { key: 'offer', head: 'Offer' },
  { key: 'value', head: 'Value', nowrap: true },
  { key: 'who', head: 'Who gets it' },
  { key: 'src', head: 'Source', nowrap: true },
]

function toRows(list: PromoRow[], today: string): Row[] {
  return list.map(p => ({
    key: String(p.id),
    muted: p.end < today,
    cells: [
      dates(p),
      <span key="o">
        <b>{p.name}</b>
        {p.loyaltyExclusive ? <span className="sk-pill" style={{ marginLeft: 8 }}>Members only</span> : null}
        {p.description ? <span className="sk-take-why" style={{ display: 'block' }}>{p.description}</span> : null}
        {p.minPurchase ? <span className="sk-meta" style={{ display: 'block' }}>Requires: {p.minPurchase}</span> : null}
      </span>,
      valueText(p),
      <span key="w">
        {p.audience ?? 'All guests'}
        {p.channel ? <span className="sk-meta" style={{ display: 'block' }}>{p.channel}</span> : null}
      </span>,
      p.source === 'SK_CORPORATE' ? 'Corporate' : 'Ours',
    ],
  }))
}

export default function MarketingPage() {
  const [data, setData] = useState<MarketingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [picked, setStore] = useState('all')
  // A store-locked login always reads its own store; derived, not synced into state.
  const lock = useStoreLock()
  const store = lock ?? picked

  const key = `marketing:${store}`
  const [prevKey, setPrevKey] = useState('')
  if (prevKey !== key) {
    setPrevKey(key)
    const cached = swrGet<MarketingPayload>(key)
    setData(cached ?? data)
    setLoading(!cached)
  }

  useEffect(() => {
    let stale = false
    fetch(`/api/marketing?store=${store}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { swrSet(key, d); if (!stale) { setData(d); setLoading(false) } })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const split = useMemo(() => {
    if (!data) return null
    const t = data.today
    const week = isoAdd(t, 7)
    const month = isoAdd(t, 30)
    const live = data.promos.filter(p => p.start <= t && p.end >= t)
    const next = data.promos.filter(p => p.start > t)
    const past = data.promos.filter(p => p.end < t).reverse()
    return {
      live, next, past,
      thisWeek: next.filter(p => p.start <= week).length,
      thisMonth: next.filter(p => p.start <= month).length,
            // Latest START, not latest end: open-ended programmes carry assumed 12/31 ends,
      // which would claim a calendar is loaded months past what corporate has issued.
      lastLoaded: data.promos.reduce((m, p) => (p.start > m ? p.start : m), ''),
    }
  }, [data])

  return (
    <Page>
      <PageBar
        title="Marketing"
        meta={data ? `Last 60 days and next 90 · today ${md(data.today)}` : null}
      >
        {!lock && <SegControl label="Store" options={STORE_OPTS} value={store} onChange={setStore} />}
      </PageBar>

      {loading ? (
        <div className="sk-card"><p className="sk-flags-empty">Loading offers…</p></div>
      ) : !data || !split || data.error ? (
        <div className="sk-card"><p className="sk-flags-empty">No promotions data — check the DB proxy / Azure connection.</p></div>
      ) : (
        <>
          <Section label="Summary">
            <Grid4>
              <Stat label="Running now" value={split.live.length} />
              <Stat label="Starting in 7 days" value={split.thisWeek} />
              <Stat label="Starting in 30 days" value={split.thisMonth} />
              <Stat label="Latest offer loaded starts" value={split.lastLoaded ? md(split.lastLoaded) : '—'} />
            </Grid4>
          </Section>

          <Section label="Running now">
            <div className="sk-card">
              {split.live.length
                ? <DataTable cols={COLS} rows={toRows(split.live, data.today)} caption="Offers running today" />
                : <p className="sk-flags-empty">No offers running today.</p>}
            </div>
          </Section>

          <Section label="Coming up">
            <div className="sk-card">
              {split.next.length
                ? <DataTable cols={COLS} rows={toRows(split.next, data.today)} caption="Upcoming offers" />
                : <p className="sk-flags-empty">Nothing loaded yet for the next 90 days.</p>}
            </div>
          </Section>

          {split.past.length > 0 && (
            <Disclosure label="Recently ended" count={split.past.length}>
              <div className="sk-card">
                <DataTable cols={COLS} rows={toRows(split.past, data.today)} caption="Offers that ended in the last 60 days" />
              </div>
            </Disclosure>
          )}
        </>
      )}
    </Page>
  )
}
