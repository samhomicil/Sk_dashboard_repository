// Shrink / usage-variance data layer.
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
// TWO TABLES, AND WHICH ONE IS THE TRUTH. Both mirror each other column for
// column, and the difference is entirely in qty_issue:
//
//   netchef_usage      CrunchTime's own scraped report. qty_issue is THEIRS.
//                      Variance is CrunchTime's own number, with no modelling
//                      residual in it at all. Only goes back to 2026-07-27.
//   netchef_usage_api  our REST reconstruction. qty_issue is COMPUTED by
//                      theoretical.py (~1.4% median error, 3-4% of the variance
//                      signal), so every row inherits that error and needs a
//                      confidence tier. Reaches back to 2025-12-30.
//
// So we prefer the scrape wherever it has the period and fall back to the
// reconstruction for older weeks, carrying `usageBasis` through to the UI: the
// tier badges and the modelling caveat are TRUE of one source and FALSE of the
// other, and showing them on a CrunchTime-reported week would be a lie.
//
// THE PERIOD TRAP THIS FILE EXISTS TO AVOID. Since 2026-08-03 the API loader
// also writes NIGHTLY hot-list counts into netchef_usage_api as one-day periods
// (period_start = period_end). Those are not inventory periods. Taking the
// MAX(period_end) across the table lands on last night's count and differences a
// single evening's shelf against a book figure — which is how this page once
// reported a +1006% net gap and $11,964 of "overage" for a single day. Shrink is
// only ever measured over a real count period, so every query here is filtered
// to INVENTORY_PERIOD_MIN_DAYS or longer.
//
// A nightly count is a legitimate signal, just a different question — it belongs
// to the on-hand chain in core/onHand.ts, which knows how to read its blanks.

import { query } from './db'
import { INVENTORY_PERIOD_MIN_DAYS } from './core/targets'
import { tierOf, tierReason, type Tier } from './netchefTiers'

/** Which table a period's figures came from, and therefore how much to trust them. */
export type UsageBasis = 'reported' | 'modelled'

const TABLE: Record<UsageBasis, string> = {
  reported: 'smoothieking.netchef_usage',
  modelled: 'smoothieking.netchef_usage_api',
}

/** Only real count periods. Anything shorter is a nightly hot-list count. */
const REAL_PERIOD = `DATEDIFF(day, period_start, period_end) + 1 >= ${INVENTORY_PERIOD_MIN_DAYS}`

export type ShrinkRow = {
  store: string
  productNumber: string
  productName: string
  category: string | null
  unit: string | null
  price: number
  beginning: number
  received: number
  theoretical: number   // expected usage — CrunchTime's or ours, per usageBasis
  actual: number        // beginning + received - physical
  book: number
  physical: number
  variance: number      // physical - book; negative = short
  varianceDollars: number
  variancePct: number | null  // variance vs expected usage
  tier: Tier
  tierNote: string | null
  /** counted stock the books cannot account for — see unsourced() */
  unsourced: boolean
}

export type StoreSummary = {
  store: string
  shrinkDollars: number      // losses only (negative variance)
  overageDollars: number     // positive variance
  netDollars: number
  usageDollars: number       // expected usage at cost
  shrinkPctOfUsage: number | null
  netPctOfUsage: number | null
  reliableShrinkDollars: number  // tier A/B only
  reliableNetDollars: number
  rowCount: number
  shortLines: number         // lines that came up short, i.e. how spread the loss is
}

export type ShrinkPeriod = {
  periodStart: string
  periodEnd: string
  days: number
  basis: UsageBasis
}

export type ShrinkPayload = {
  periodStart: string
  periodEnd: string
  periodDays: number
  /** 'reported' = CrunchTime's own usage figure; 'modelled' = ours, tiers apply */
  usageBasis: UsageBasis
  rows: ShrinkRow[]
  stores: StoreSummary[]
  totals: StoreSummary
  availablePeriods: ShrinkPeriod[]
  /** template lines dropped as carrying no information (see buildShrink) */
  emptyLines: number
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

/**
 * A count the books cannot source: nothing on hand at open, nothing received,
 * yet stock counted at close. It is never real shrink — it is either an
 * unrecorded inter-store transfer (NetChef records none: qty_in_transit is 0
 * across all 11,126 rows) or a prior period's blank template line, which posts
 * as 0 and so understates the opening balance. Either way the variance is an
 * artefact of the paperwork, so it is demoted rather than counted as a find.
 */
const unsourced = (beginning: number, received: number, physical: number) =>
  beginning === 0 && received === 0 && physical > 0

function summarise(store: string, rows: ShrinkRow[]): StoreSummary {
  let shrink = 0, overage = 0, usage = 0, reliable = 0, reliableNet = 0, shortLines = 0
  for (const r of rows) {
    if (r.varianceDollars < 0) {
      shrink += -r.varianceDollars
      shortLines++
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
    shortLines,
  }
}

/**
 * Every real count period from both tables, newest first. Where both hold the
 * same period_end the scrape wins, because its usage figure is CrunchTime's own.
 */
async function listPeriods(): Promise<ShrinkPeriod[]> {
  const sql = (basis: UsageBasis) => `
    SELECT DISTINCT CONVERT(char(10), period_start, 23) period_start,
           CONVERT(char(10), period_end, 23) period_end,
           DATEDIFF(day, period_start, period_end) + 1 days
    FROM ${TABLE[basis]}
    WHERE ${REAL_PERIOD}`
  const [reported, modelled] = await Promise.all([
    query<{ period_start: string; period_end: string; days: number }[]>(sql('reported')),
    query<{ period_start: string; period_end: string; days: number }[]>(sql('modelled')),
  ])

  const byEnd = new Map<string, ShrinkPeriod>()
  // modelled first so the reported pass overwrites it on any shared period_end.
  for (const basis of ['modelled', 'reported'] as const) {
    for (const p of basis === 'modelled' ? modelled : reported) {
      const periodEnd = String(p.period_end).slice(0, 10)
      byEnd.set(periodEnd, {
        periodStart: String(p.period_start).slice(0, 10),
        periodEnd,
        days: Number(p.days),
        basis,
      })
    }
  }
  return [...byEnd.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
}

export async function buildShrink(periodEnd?: string): Promise<ShrinkPayload | null> {
  const available = await listPeriods()
  if (!available.length) return null

  const period = available.find(p => p.periodEnd === periodEnd) ?? available[0]

  const raw = await query<Raw[]>(`
    SELECT store, product_number, product_name, category_name, package_type, price,
           qty_beginning, qty_received, qty_issue, qty_book, qty_physical, qty_variance,
           CONVERT(char(10), period_start, 23) period_start,
           CONVERT(char(10), period_end, 23)   period_end
    FROM ${TABLE[period.basis]}
    WHERE period_end = '${period.periodEnd}' AND ${REAL_PERIOD}`)
  if (!raw.length) return null

  // A line with no opening stock, no receipt, no usage and no count is a blank
  // template row for a product the store does not carry. It contributes nothing
  // to any total, but left in it inflates the row count and makes a store look
  // like it counted 166 items when it counted 134.
  let emptyLines = 0

  const rows: ShrinkRow[] = []
  for (const r of raw) {
    const price = n(r.price)
    const beginning = n(r.qty_beginning)
    const received = n(r.qty_received)
    const physical = n(r.qty_physical)
    const theoretical = n(r.qty_issue)
    const book = n(r.qty_book)
    const variance = n(r.qty_variance)

    if (!beginning && !received && !physical && !theoretical) { emptyLines++; continue }

    const orphan = unsourced(beginning, received, physical)
    // Tiers grade OUR usage model, so they mean nothing on a reported period —
    // there every row is CrunchTime's own arithmetic. An unsourced count is
    // untrustworthy on either source, so it is demoted regardless.
    const tier: Tier = orphan ? 'D' : period.basis === 'reported' ? 'A' : tierOf(r.product_number)
    const tierNote = orphan
      ? 'counted stock with no opening balance and no delivery — likely a transfer or a missed prior count'
      : period.basis === 'reported' ? null : tierReason(r.product_number)

    rows.push({
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
      tier,
      tierNote,
      unsourced: orphan,
    })
  }
  if (!rows.length) return null

  // Biggest dollar impact first, losses before overages at equal magnitude.
  rows.sort((a, b) => Math.abs(b.varianceDollars) - Math.abs(a.varianceDollars))

  const byStore = new Map<string, ShrinkRow[]>()
  for (const r of rows) {
    if (!byStore.has(r.store)) byStore.set(r.store, [])
    byStore.get(r.store)!.push(r)
  }

  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodDays: period.days,
    usageBasis: period.basis,
    rows,
    stores: [...byStore.entries()]
      .map(([s, rs]) => summarise(s, rs))
      .sort((a, b) => b.shrinkDollars - a.shrinkDollars),
    totals: summarise('All', rows),
    availablePeriods: available,
    emptyLines,
    generatedAt: new Date().toISOString(),
  }
}
