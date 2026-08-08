// Shrink / usage-variance data layer.
//
// Reads smoothieking.netchef_usage_api — the API-reconstructed weekly usage
// table written by netchef-extractor/load_usage_api.py.
//
// THE ONE EQUATION THIS PAGE IS ABOUT:
//     book     = beginning + received - theoretical usage
//     variance = physical - book          <- CrunchTime's sign convention
//
// So NEGATIVE variance means the count came up short of what the books say
// should be on the shelf: product left without being sold. Positive means the
// count found more than expected — usually an over-count, a missed delivery
// entry, or an over-modelled recipe.
//
// CAVEAT THAT SHAPES THE WHOLE UI: qty_issue in this table is OUR recipe-driven
// estimate, not CrunchTime's number. Variance is a residual, so any error in
// modelled usage lands here at full weight. Every row therefore carries a
// confidence tier (see netchefTiers.ts) and the page must not let a tier-D row
// masquerade as real shrink.

import { query } from './db'
import { tierOf, tierReason, type Tier } from './netchefTiers'

export type ShrinkRow = {
  store: string
  productNumber: string
  productName: string
  category: string | null
  unit: string | null
  price: number
  beginning: number
  received: number
  theoretical: number   // modelled usage (ours)
  actual: number        // beginning + received - physical
  book: number
  physical: number
  variance: number      // physical - book; negative = short
  varianceDollars: number
  variancePct: number | null  // variance vs theoretical usage
  tier: Tier
  tierNote: string | null
}

export type StoreSummary = {
  store: string
  shrinkDollars: number      // losses only (negative variance)
  overageDollars: number     // positive variance
  netDollars: number
  usageDollars: number       // modelled usage at cost
  shrinkPctOfUsage: number | null
  netPctOfUsage: number | null
  reliableShrinkDollars: number  // tier A/B only
  reliableNetDollars: number
  rowCount: number
}

export type ShrinkPayload = {
  periodStart: string
  periodEnd: string
  rows: ShrinkRow[]
  stores: StoreSummary[]
  totals: StoreSummary
  availablePeriods: string[]
  generatedAt: string
}

type Raw = {
  store: string
  product_number: string
  product_name: string | null
  category_name: string | null
  package_type: string | null
  price: number | null
  qty_beginning: number | null
  qty_received: number | null
  qty_issue: number | null
  qty_book: number | null
  qty_physical: number | null
  qty_variance: number | null
  period_start: string
  period_end: string
}

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0

function summarise(store: string, rows: ShrinkRow[]): StoreSummary {
  let shrink = 0, overage = 0, usage = 0, reliable = 0, reliableNet = 0
  for (const r of rows) {
    if (r.varianceDollars < 0) {
      shrink += -r.varianceDollars
      if (r.tier === 'A' || r.tier === 'B') reliable += -r.varianceDollars
    } else {
      overage += r.varianceDollars
    }
    if (r.tier === 'A' || r.tier === 'B') reliableNet += r.varianceDollars
    usage += r.theoretical * r.price
  }
  const net = overage - shrink
  return {
    store,
    shrinkDollars: shrink,
    overageDollars: overage,
    netDollars: net,
    usageDollars: usage,
    shrinkPctOfUsage: usage > 0 ? (shrink / usage) * 100 : null,
    netPctOfUsage: usage > 0 ? (net / usage) * 100 : null,
    reliableShrinkDollars: reliable,
    reliableNetDollars: reliableNet,
    rowCount: rows.length,
  }
}

export async function buildShrink(periodEnd?: string): Promise<ShrinkPayload | null> {
  const periods = await query<{ period_end: string }[]>(`
    SELECT DISTINCT CONVERT(char(10), period_end, 23) period_end
    FROM smoothieking.netchef_usage_api
    ORDER BY period_end DESC`)
  if (!periods.length) return null

  const available = periods.map(p => String(p.period_end).slice(0, 10))
  const target = periodEnd && available.includes(periodEnd) ? periodEnd : available[0]

  const raw = await query<Raw[]>(`
    SELECT store, product_number, product_name, category_name, package_type, price,
           qty_beginning, qty_received, qty_issue, qty_book, qty_physical, qty_variance,
           CONVERT(char(10), period_start, 23) period_start,
           CONVERT(char(10), period_end, 23)   period_end
    FROM smoothieking.netchef_usage_api
    WHERE period_end = '${target}'`)
  if (!raw.length) return null

  const rows: ShrinkRow[] = raw.map(r => {
    const price = n(r.price)
    const beginning = n(r.qty_beginning)
    const received = n(r.qty_received)
    const physical = n(r.qty_physical)
    const theoretical = n(r.qty_issue)
    const book = n(r.qty_book)
    const variance = n(r.qty_variance)
    return {
      store: r.store,
      productNumber: r.product_number,
      productName: r.product_name ?? r.product_number,
      category: r.category_name,
      unit: r.package_type,
      price,
      beginning,
      received,
      theoretical,
      actual: beginning + received - physical,
      book,
      physical,
      variance,
      varianceDollars: variance * price,
      variancePct: theoretical !== 0 ? (variance / theoretical) * 100 : null,
      tier: tierOf(r.product_number),
      tierNote: tierReason(r.product_number),
    }
  })

  // Biggest dollar impact first, losses before overages at equal magnitude.
  rows.sort((a, b) => Math.abs(b.varianceDollars) - Math.abs(a.varianceDollars))

  const byStore = new Map<string, ShrinkRow[]>()
  for (const r of rows) {
    if (!byStore.has(r.store)) byStore.set(r.store, [])
    byStore.get(r.store)!.push(r)
  }

  return {
    periodStart: String(raw[0].period_start).slice(0, 10),
    periodEnd: target,
    rows,
    stores: [...byStore.entries()]
      .map(([s, rs]) => summarise(s, rs))
      .sort((a, b) => b.shrinkDollars - a.shrinkDollars),
    totals: summarise('All', rows),
    availablePeriods: available,
    generatedAt: new Date().toISOString(),
  }
}
