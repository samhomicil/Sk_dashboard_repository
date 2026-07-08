import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import {
  daysOfSupply, parPolicy, varianceFlag, buildRecommendation,
  STORE_KEYS,
} from './inventoryWatchlistUtils'
import type { ItemFamily, WatchlistRow, WatchlistPayload, StoreKey } from './inventoryWatchlistUtils'
export type { ItemFamily, WatchlistRow, WatchlistPayload, StoreKey }
export {
  PFS_LEAD_TIME_DAYS, FAST_MOVER_THRESHOLD_DAYS, STORE_KEYS, STORE_DISPLAY,
} from './inventoryWatchlistUtils'

const MAP_PATH   = join(process.cwd(), 'data', 'inventory-item-map.json')
const THEO_PATH  = join(process.cwd(), 'data', 'inventory-theoretical.json')
const PURCH_PATH = join(process.cwd(), 'data', 'purchasing.json')

// Dry Grocery has 63 distinct item codes total (verified via SQL) — the 6 pilot
// items are a deliberately small starting slice, not full-category coverage.
const CATEGORY_TOTALS: Record<string, number> = { 'Dry Grocery': 63 }
const PILOT_CATEGORY = 'Dry Grocery'

interface ItemMapFile { items: ItemFamily[] }
interface TheoreticalRow {
  itemFamilyId: string; store: StoreKey; periodEnd: string
  theoreticalQty: number; actualQty: number; varianceQty: number; purchasesQty: number
}
interface TheoreticalFile { refreshedAt: string; periodStart: string; rows: TheoreticalRow[] }
interface PurchTopProduct { itemCode: string; spend: number; qty: number }
interface PurchasingFile { refreshedAt: string; topProductsByCategory: Record<string, PurchTopProduct[]> }

let _cache: WatchlistPayload | null = null
let _cacheKey = ''

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function weeksBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T00:00:00')
  const end   = new Date(endISO   + 'T00:00:00')
  const days  = Math.max(1, (end.getTime() - start.getTime()) / 86400000)
  return days / 7
}

// unit cost lookup: match any of an item family's PFG codes against the
// (already-computed) top-products-by-category list. Falls back to null if the
// item didn't land in that category's top 8 by spend — acceptable for a pilot
// list of already-known-significant items.
function unitCostFor(codes: string[], unitSize: number, byCategory: Record<string, PurchTopProduct[]>): number | null {
  const all = Object.values(byCategory).flat()
  for (const code of codes) {
    const match = all.find(p => p.itemCode === code)
    if (match && match.qty > 0) return match.spend / match.qty / unitSize
  }
  return null
}

function build(): WatchlistPayload | null {
  const mapFile   = readJson<ItemMapFile>(MAP_PATH)
  const theoFile  = readJson<TheoreticalFile>(THEO_PATH)
  const purchFile = readJson<PurchasingFile>(PURCH_PATH)
  if (!mapFile || !theoFile) return null

  const theoByKey = new Map<string, TheoreticalRow>()
  for (const r of theoFile.rows) theoByKey.set(`${r.itemFamilyId}|${r.store}`, r)

  const rows: WatchlistRow[] = []
  for (const item of mapFile.items) {
    for (const store of STORE_KEYS) {
      const theo = theoByKey.get(`${item.itemFamilyId}|${store}`)
      if (!theo) continue

      const weeks   = weeksBetween(theoFile.periodStart, theo.periodEnd)
      const weekly  = theo.theoreticalQty / weeks
      const days    = daysOfSupply(weekly, item.unitSize)
      const { par, reorderTrigger } = parPolicy(days)
      const { flag, pct } = varianceFlag(theo.varianceQty, theo.theoreticalQty)

      let dataQualityFlag: string | null = null
      if (theo.actualQty < 0) {
        dataQualityFlag = 'Actual quantity came back negative — almost certainly a stale or corrected physical count, not real usage. Treat variance here with caution.'
      }

      const unitCostPerUnit = purchFile
        ? unitCostFor(item.pfgItemCodes, item.unitSize, purchFile.topProductsByCategory)
        : null

      const base = {
        itemFamilyId: item.itemFamilyId, displayName: item.displayName, store,
        weeklyTheoreticalQty: weekly, daysOfSupply: days, par, reorderTrigger,
        varianceQty: theo.varianceQty, variancePct: pct, varianceFlag: flag,
        dataQualityFlag, unitCostPerUnit,
      }
      rows.push({ ...base, recommendation: buildRecommendation(base) })
    }
  }

  const mappedCodes = new Set(mapFile.items.flatMap(i => i.pfgItemCodes))

  return {
    refreshedAt:     theoFile.refreshedAt,
    theoreticalAsOf: theoFile.rows.reduce((max, r) => r.periodEnd > max ? r.periodEnd : max, theoFile.periodStart),
    coverageMapped:  mappedCodes.size,
    coverageTotal:   CATEGORY_TOTALS[PILOT_CATEGORY] ?? mappedCodes.size,
    rows,
  }
}

export function getWatchlist(): WatchlistPayload | null {
  const mtimes = [MAP_PATH, THEO_PATH, PURCH_PATH]
    .filter(existsSync)
    .map(p => statSync(p).mtimeMs)
    .join('|')
  if (_cache && _cacheKey === mtimes) return _cache
  _cache    = build()
  _cacheKey = mtimes
  return _cache
}
