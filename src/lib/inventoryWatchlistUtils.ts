// Client-safe types and pure logic for the Inventory Watchlist (Tier 2).
// Par/reorder rule validated by hand on Gladiator earlier: par 2 / reorder-at-1
// when a unit (bag/case) lasts under 30 days; par 1 / reorder-on-open above that,
// since PFS's confirmed ~3-4 day lead time makes a second unit idle capital, not
// safety margin, once the item is that slow-moving.

export const PFS_LEAD_TIME_DAYS = 4
export const FAST_MOVER_THRESHOLD_DAYS = 30
export const VARIANCE_FLAG_THRESHOLD_PCT = 0.15 // |variance| / theoretical beyond this gets flagged

export type StoreKey = 'pines' | 'miramar' | 'margate'
export const STORE_KEYS: StoreKey[] = ['pines', 'miramar', 'margate']
export const STORE_DISPLAY: Record<StoreKey, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }

export interface ItemFamily {
  itemFamilyId:      string
  displayName:       string
  sigmaProductNames: string[]
  pfgItemCodes:      string[]
  unitSize:          number
  unitOfMeasure:     string
}

export interface WatchlistRow {
  itemFamilyId:         string
  displayName:          string
  store:                StoreKey
  weeklyTheoreticalQty: number
  daysOfSupply:         number | null
  par:                  number
  reorderTrigger:       string
  varianceQty:          number
  variancePct:          number | null
  varianceFlag:         'overage' | 'shortfall' | 'ok'
  dataQualityFlag:      string | null
  unitCostPerUnit:      number | null
  recommendation:       string
}

export interface WatchlistPayload {
  refreshedAt:      string
  theoreticalAsOf:  string
  coverageMapped:   number
  coverageTotal:    number
  rows:             WatchlistRow[]
}

export function daysOfSupply(weeklyQty: number, unitSize: number): number | null {
  if (weeklyQty <= 0) return null
  return (unitSize / weeklyQty) * 7
}

export function parPolicy(days: number | null): { par: number; reorderTrigger: string } {
  if (days === null) return { par: 1, reorderTrigger: 'Insufficient usage data — monitor before setting a par' }
  return days < FAST_MOVER_THRESHOLD_DAYS
    ? { par: 2, reorderTrigger: 'Order when down to 1 unit' }
    : { par: 1, reorderTrigger: 'Order the moment the last unit is opened' }
}

export function varianceFlag(varianceQty: number, theoreticalQty: number): { flag: WatchlistRow['varianceFlag']; pct: number | null } {
  if (theoreticalQty <= 0) return { flag: 'ok', pct: null }
  const pctOfTheo = varianceQty / theoreticalQty
  if (pctOfTheo <= -VARIANCE_FLAG_THRESHOLD_PCT) return { flag: 'overage',   pct: pctOfTheo }
  if (pctOfTheo >=  VARIANCE_FLAG_THRESHOLD_PCT) return { flag: 'shortfall', pct: pctOfTheo }
  return { flag: 'ok', pct: pctOfTheo }
}

export function buildRecommendation(row: Omit<WatchlistRow, 'recommendation'>): string {
  const store = STORE_DISPLAY[row.store]
  const parts: string[] = []
  if (row.daysOfSupply !== null) {
    parts.push(`${store}: ${row.reorderTrigger.toLowerCase()} (~${row.daysOfSupply.toFixed(0)} days of supply per unit, par ${row.par}).`)
  } else {
    parts.push(`${store}: not enough usage data to set a reorder point yet.`)
  }
  if (row.dataQualityFlag) {
    parts.push(row.dataQualityFlag)
  } else if (row.varianceFlag === 'overage' && row.variancePct !== null) {
    parts.push(`Actual usage is running ${Math.abs(row.variancePct * 100).toFixed(0)}% over theoretical — worth a quick check.`)
  } else if (row.varianceFlag === 'shortfall' && row.variancePct !== null) {
    parts.push(`Actual usage is running ${Math.abs(row.variancePct * 100).toFixed(0)}% under theoretical — could be a stale count or genuine under-use.`)
  }
  return parts.join(' ')
}
