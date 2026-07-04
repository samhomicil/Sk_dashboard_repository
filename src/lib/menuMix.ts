import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { ProductSummary, CategorySummary, MenuMixPayload } from './menuMixUtils'
export type { ProductSummary, CategorySummary, MenuMixPayload }
export { parseSize, parseFlavor } from './menuMixUtils'

const PATH = join(process.cwd(), 'data', 'menu-mix.json')

interface MixRow {
  month: string; location: string; subcategory: string
  microcategory: string; product: string; qty: number; sales: number
}
interface ProductMeta {
  subcategory: string; cogsPct: number | null; avgPrice: number | null
}
interface MixFile {
  refreshedAt: string; thruDate: string
  mix: MixRow[]; productMeta: Record<string, ProductMeta>
}

let _cache: MixFile | null = null
let _cacheAt = 0

function load(): MixFile | null {
  if (!existsSync(PATH)) return null
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mtime = require('fs').statSync(PATH).mtimeMs as number
  if (_cache && _cacheAt === mtime) return _cache
  _cache   = JSON.parse(readFileSync(PATH, 'utf-8')) as MixFile
  _cacheAt = mtime
  return _cache
}

const LOCATION_TO_STORE: Record<string, string> = {
  '1392 - Pembroke Pines, FL': 'pines',
  '1892 - Miramar, FL':        'miramar',
  '2384 - Margate, FL':        'margate',
}

const PERIOD_MONTHS: Record<string, string[]> = {
  l7d:       ['2026-06'],
  mtd:       ['2026-06'],
  lastmonth: ['2026-05'],
  l90d:      ['2026-04', '2026-05', '2026-06'],
}

const PERIOD_DAYS: Record<string, number> = {
  l7d: 7, mtd: 26, lastmonth: 31, l90d: 90,
}

// POS placeholder entries that aren't real sellable products
const SKIP_PRODUCT = /add note/i

export function getMenuMix(period: string, store: string): MenuMixPayload | null {
  const d = load()
  if (!d) return null

  const months = PERIOD_MONTHS[period] ?? PERIOD_MONTHS['l90d']

  const rows = d.mix.filter(r => {
    if (!months.includes(r.month)) return false
    if (store !== 'all' && LOCATION_TO_STORE[r.location] !== store) return false
    if (SKIP_PRODUCT.test(r.product)) return false
    return true
  })

  const agg = new Map<string, { qty: number; sales: number; subcategory: string }>()
  for (const r of rows) {
    const key = `${r.subcategory}||${r.product}`
    const cur = agg.get(key) ?? { qty: 0, sales: 0, subcategory: r.subcategory }
    cur.qty   += r.qty
    cur.sales += r.sales
    agg.set(key, cur)
  }

  const byCategory: Record<string, ProductSummary[]> = {}
  const modifiers: ProductSummary[] = []

  for (const [key, v] of agg) {
    const product = key.split('||')[1]
    const meta    = d.productMeta[product]
    const row: ProductSummary = {
      product, subcategory: v.subcategory,
      qty:      Math.round(v.qty),
      sales:    Math.round(v.sales * 100) / 100,
      cogsPct:  meta?.cogsPct  ?? null,
      avgPrice: meta?.avgPrice ?? null,
    }
    if (v.subcategory === 'Modifiers') {
      modifiers.push(row)
    } else {
      if (!byCategory[v.subcategory]) byCategory[v.subcategory] = []
      byCategory[v.subcategory].push(row)
    }
  }

  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => b.sales - a.sales)
  }
  modifiers.sort((a, b) => b.qty - a.qty)

  const catTotals: Record<string, { qty: number; sales: number }> = {}
  for (const [sub, prods] of Object.entries(byCategory)) {
    catTotals[sub] = prods.reduce(
      (acc, p) => ({ qty: acc.qty + p.qty, sales: acc.sales + p.sales }),
      { qty: 0, sales: 0 }
    )
  }
  const coreTotal = Object.values(catTotals).reduce((s, v) => s + v.sales, 0)

  const categories: CategorySummary[] = Object.entries(catTotals)
    .map(([subcategory, { qty, sales }]) => ({
      subcategory, qty, sales,
      pctOfTotal: coreTotal > 0 ? sales / coreTotal : 0,
    }))
    .sort((a, b) => b.sales - a.sales)

  return {
    refreshedAt: d.refreshedAt,
    thruDate:    d.thruDate,
    days:        PERIOD_DAYS[period] ?? 90,
    period, store, categories,
    products: byCategory,
    modifiers,
  }
}
