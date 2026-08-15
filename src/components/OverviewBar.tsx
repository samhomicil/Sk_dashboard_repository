'use client'

/**
 * Overview's PageBar, from the kit (#overview): eyebrow + title on the left, the
 * screen's own store and range controls on the right, then the date range it
 * covers and when the data was last refreshed.
 *
 * Replaces the sticky white header bar. Filters belong to the screen — the old bar
 * floated above every page and implied its period control applied to all of them.
 *
 * "Daily" is the app's `custom` period: picking it reveals the date inputs, which
 * is how the previous header behaved. Sign-out lives in the sidebar, not here.
 */
import { useState } from 'react'
import { STORE_LABELS } from '@/lib/config'
import type { Store, Period } from '@/lib/types'
import { PageBar } from '@/components/design/shell'
import { SegControl } from '@/components/design/controls'

const RANGES: { value: Period; label: string }[] = [
  { value: 'custom', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'ytd', label: 'YTD' },
]

// Kit order — All Stores, then Margate, Miramar, Pines, matching Weekly Ops so a
// reader's muscle memory carries between the two screens. The store number stays
// in the label: it is how these stores are identified everywhere else.
const STORE_ORDER = ['all', 'margate', 'miramar', 'pines']
const STORES = STORE_ORDER.filter(k => k in STORE_LABELS).map(value => ({
  value: value as Store,
  label: value === 'all' ? 'All Stores' : STORE_LABELS[value as Store],
}))

const md = (iso: string) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '—')

function fmtRefreshed(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function OverviewBar({
  store, period, dates, onStore, onPeriod, onCustomRange,
  refreshedAt, onRefresh, refreshing, refreshMsg,
}: {
  store: Store
  period: Period
  dates: { start: string; end: string; pyStart: string; pyEnd: string }
  onStore: (s: Store) => void
  onPeriod: (p: Period) => void
  onCustomRange: (start: string, end: string) => void
  refreshedAt: string | null
  onRefresh: () => void
  refreshing: boolean
  refreshMsg: string | null
}) {
  const [cStart, setCStart] = useState(dates.start)
  const [cEnd, setCEnd] = useState(dates.end)

  return (
    <>
      <PageBar
        eyebrow={`${store === 'all' ? 'All stores' : STORE_LABELS[store]} · Portfolio`}
        title="Overview"
        meta={
          <>
            <div>{md(dates.start)}–{md(dates.end)} · PY {md(dates.pyStart)}–{md(dates.pyEnd)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, justifyContent: 'inherit' }}>
              {/* The dot is the freshness signal; the label is the refresh control,
                  so "how old is this" and "make it newer" are one thing. */}
              <span
                className="sk-dot"
                style={{ background: refreshedAt ? 'var(--status-good)' : 'var(--status-warn)' }}
              />
              <button
                type="button"
                className="sk-refresh"
                onClick={onRefresh}
                disabled={refreshing}
                title={refreshMsg ?? (refreshedAt ? `Data as of ${fmtRefreshed(refreshedAt)}` : 'No data yet')}
              >
                {refreshing ? 'Refreshing…' : refreshedAt ? `Updated ${fmtRefreshed(refreshedAt)}` : 'Refresh data'}
              </button>
            </div>
          </>
        }
      >
        <SegControl label="Store" options={STORES} value={store} onChange={onStore} />
        <SegControl label="Range" options={RANGES} value={period} onChange={onPeriod} />
      </PageBar>

      {period === 'custom' && (
        <div className="sk-card tight sk-daterow">
          <span className="sk-eyebrow">Dates</span>
          <input type="date" value={cStart} max={cEnd} onChange={e => setCStart(e.target.value)} aria-label="Start date" />
          <span className="sk-subline">to</span>
          <input type="date" value={cEnd} min={cStart} onChange={e => setCEnd(e.target.value)} aria-label="End date" />
          <button type="button" className="sk-ghost" onClick={() => cStart && cEnd && onCustomRange(cStart, cEnd)}>
            Apply
          </button>
        </div>
      )}
    </>
  )
}
