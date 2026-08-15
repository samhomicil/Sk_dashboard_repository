'use client'

/**
 * Supply spend, from the kit's Overview: each source's share of sales with its
 * L4W beside it, and a total ruled off beneath.
 *
 * Amazon has no feed, so it prints "no data" rather than 0.0% — an unmeasured
 * source shown as zero reads as a source we've stopped buying from.
 */
import type { KpiData } from '@/lib/types'
import { UnknownValue } from '@/components/design/states'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function Row({ label, value, l4w, total = false }: {
  label: string
  value: number | null
  l4w: number | null
  total?: boolean
}) {
  return (
    <div className={`sk-spend-row${total ? ' total' : ''}`}>
      <span className="label">{label}</span>
      <span className="value tabular-nums">
        {value != null ? pct(value) : <UnknownValue reason="No feed for this source." label="—" />}
      </span>
      <span className="l4w tabular-nums">
        {l4w != null ? `L4W ${pct(l4w)}` : <UnknownValue reason="No feed for this source." label="no data" />}
      </span>
    </div>
  )
}

export default function SupplySpend({ kpis: k, loading }: { kpis: KpiData | null; loading: boolean }) {
  return (
    <div className="sk-card">
      <h3 className="sk-card-title">Supply spend</h3>
      <p className="sk-subline" style={{ margin: '4px 0 16px' }}>% of sales</p>
      {loading || !k ? (
        <p className="sk-flags-empty">Loading…</p>
      ) : (
        <>
          <Row label="PFS" value={k.pfsPct} l4w={k.pfsPctL4W} />
          <Row label="Walmart" value={k.walmartPct} l4w={k.walmartPctL4W} />
          <Row label="Amazon" value={null} l4w={null} />
          <Row label="Total" value={k.pfsPct + k.walmartPct} l4w={k.pfsPctL4W + k.walmartPctL4W} total />
        </>
      )}
    </div>
  )
}
