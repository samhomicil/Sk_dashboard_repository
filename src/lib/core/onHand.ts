// Blended on-hand — the single source of truth for "what is actually on the shelf".
//
// WHY THIS EXISTS. Reading netchef_onhand.on_hand_qty directly is wrong in two ways
// that were both live in production:
//
//   1. The nightly HOT LIST posts as a TEMPLATE: every line is written every night,
//      defaulting to 0. A manager who skips an item leaves a 0 behind, and NetChef
//      cannot distinguish "counted zero" from "not counted" — verified against
//      /inventory/physicalinventorystandard (every field on all 340 zero lines is
//      identical: userId MANAGER, inventoryType Template (Corporate)).
//      Consequence: `beginning + received - physical` reads a skipped line as
//      "everything on the shelf was consumed today". Pines received 72 flatbread on
//      Aug 7 and counted 0, which produced 72 units of one-day usage.
//
//   2. Because a skipped count also becomes the NEXT night's opening balance,
//      on_hand_qty goes negative (-11 Pines / -19 Miramar flatbread on 2026-08-09)
//      and flows straight into `orderUpTo - onHand`, inflating the order again.
//
// So on-hand is resolved per line with explicit provenance, and every consumer must
// carry that provenance through to the UI. Three states, and the distinction matters:
//
//   counted    a number was entered. Used exactly as entered, INCLUDING a real zero.
//   estimated  the line was blank. Carried forward as last count + received - usage.
//   disputed   a number was entered that the books cannot account for. STILL USED —
//              it is the only direct observation of the shelf — and flagged.
//
// A disputed count is never discarded and never allowed to poison the chain. Rejecting
// it cascades: the theoretical decays toward zero and every later count then looks
// impossible. It is also frequently legitimate, because transfers between stores are
// recorded NOWHERE in NetChef (qty_in_transit is 0 across all 11,126 rows), so stock
// really can appear without a receipt.

import { query } from '../db'

export type OnHandBasis = 'counted' | 'estimated' | 'disputed'

/** How far above book a count may run before we flag (not reject) it. */
export const DISPUTE_MULTIPLE = 3
/** …and by how many units, so tiny items don't trip the multiple. */
export const DISPUTE_MIN_UNITS = 15
/** A carried-forward estimate below this is treated as an empty shelf, not an estimate. */
const EMPTY_FLOOR = 1.0

export interface NightSample {
  date: string
  basis: OnHandBasis
  /** what the blend settled on for that night */
  value: number
  /** what the manager actually entered (0 when blank) */
  entered: number
  /** beginning + received − usage for that night */
  book: number
  received: number
}

export interface OnHandLine {
  store: string
  productNumber: string
  productName: string
  unit: string | null
  price: number | null
  /** resolved on-hand for the latest night, floored at 0 */
  onHand: number
  /** mean daily recipe usage across the nights sampled */
  dailyUsage: number
  basis: OnHandBasis
  nights: NightSample[]
  /** last night a number was genuinely entered */
  lastCountDate: string | null
  /** 'nightly' | 'weekly' — which kind of count that was */
  lastCountKind: 'nightly' | 'weekly' | null
  /** nights since that count; 0 = counted last night */
  staleNights: number | null
  /** the full weekly inventory this chain is anchored to */
  anchor: number
  anchorDate: string | null
  /**
   * True when a real number was entered on at least one night in the window, i.e. the
   * item is actually on the nightly HOT LIST. Only ~115 of 408 products are; for the
   * rest every night is a template zero and the carried book is the ONLY signal, so
   * callers must not treat a zero here as "out of stock" — fall back to the perpetual
   * book in netchef_onhand instead.
   */
  nightlyTracked: boolean
}

interface NightRow {
  store: string; product_number: string; product_name: string; package_type: string | null
  price: number | null; period_end: string
  qty_received: number; qty_issue: number; qty_physical: number
}
interface AnchorRow { store: string; product_number: string; qty_physical: number; period_end: string }

/**
 * Resolve on-hand for every product with nightly counts in [since, through].
 *
 * The chain is ANCHORED to the most recent full weekly inventory rather than seeded
 * from the first nightly row. Seeding from a nightly row is wrong whenever that night
 * was not a count night — its zeros propagate through the whole week.
 */
export async function buildOnHand(since: string, through: string): Promise<OnHandLine[]> {
  const [nights, anchors] = await Promise.all([
    query<NightRow[]>(`
      SELECT store, product_number, product_name, package_type, price,
             CONVERT(char(10), period_end, 23) period_end,
             qty_received, qty_issue, qty_physical
      FROM smoothieking.netchef_usage_api
      WHERE period_start = period_end
        AND period_end >= '${since}' AND period_end <= '${through}'`),
    // Latest full (multi-day) inventory period on or before the window.
    query<AnchorRow[]>(`
      SELECT u.store, u.product_number, u.qty_physical,
             CONVERT(char(10), u.period_end, 23) period_end
      FROM smoothieking.netchef_usage u
      WHERE u.period_start <> u.period_end
        AND u.period_end = (SELECT MAX(period_end) FROM smoothieking.netchef_usage
                            WHERE period_start <> period_end AND period_end <= '${since}')`),
  ])
  if (!nights.length) return []

  const anchorOf = new Map<string, AnchorRow>()
  for (const a of anchors) anchorOf.set(`${a.store}|${a.product_number}`, a)

  const byKey = new Map<string, NightRow[]>()
  for (const n of nights) {
    const k = `${n.store}|${n.product_number}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(n)
  }

  const out: OnHandLine[] = []
  for (const [key, rowsRaw] of byKey) {
    const rows = [...rowsRaw].sort((a, b) => a.period_end.localeCompare(b.period_end))
    const a = anchorOf.get(key)
    let carry = Number(a?.qty_physical) || 0
    const samples: NightSample[] = []
    const burns: number[] = []
    let lastCount: string | null = null
    let lastKind: OnHandLine['lastCountKind'] = a ? 'weekly' : null

    for (const r of rows) {
      const entered = Number(r.qty_physical) || 0
      const received = Number(r.qty_received) || 0
      const usage = Number(r.qty_issue) || 0
      if (usage > 0) burns.push(usage)
      const book = Math.max(carry + received - usage, 0)

      let basis: OnHandBasis
      if (entered > 0) {
        basis = (entered > Math.max(book, 1) * DISPUTE_MULTIPLE && entered - book > DISPUTE_MIN_UNITS)
          ? 'disputed' : 'counted'
        carry = entered                       // a count always re-anchors the chain
        lastCount = r.period_end; lastKind = 'nightly'
      } else if (book > EMPTY_FLOOR) {
        basis = 'estimated'                   // blank line → carry the theoretical
        carry = book
      } else {
        basis = 'counted'                     // a believable zero: books agree the shelf is empty
        carry = entered
        lastCount = r.period_end; lastKind = 'nightly'
      }
      samples.push({ date: r.period_end, basis, value: round2(carry), entered: round2(entered), book: round2(book), received: round2(received) })
    }

    const last = rows[rows.length - 1]
    const latest = samples[samples.length - 1]
    out.push({
      store: last.store,
      productNumber: last.product_number,
      productName: last.product_name,
      unit: last.package_type,
      price: last.price != null ? Number(last.price) : null,
      onHand: Math.max(round2(carry), 0),
      dailyUsage: burns.length ? round2(burns.reduce((x, y) => x + y, 0) / burns.length) : 0,
      basis: latest.basis,
      nights: samples,
      lastCountDate: lastCount ?? a?.period_end ?? null,
      lastCountKind: lastCount ? 'nightly' : lastKind,
      staleNights: lastCount ? daysBetween(lastCount, last.period_end) : null,
      anchor: round2(Number(a?.qty_physical) || 0),
      anchorDate: a?.period_end ?? null,
      nightlyTracked: samples.some(n => n.entered > 0),
    })
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
}
