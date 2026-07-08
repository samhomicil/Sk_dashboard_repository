import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import type {
  PurchasingPayload, CategorySpend, CategoryByStore, TopProduct, VendorBrand, MonthlySpend,
} from './purchasingUtils'
export type { CategorySpend, CategoryByStore, TopProduct, VendorBrand, MonthlySpend, PurchasingPayload }
export { storeTotal } from './purchasingUtils'

const PATH = join(process.cwd(), 'data', 'purchasing.json')

let _cache: PurchasingPayload | null = null
let _cacheAt = 0

function load(): PurchasingPayload | null {
  if (!existsSync(PATH)) return null
  const mtime = statSync(PATH).mtimeMs
  if (_cache && _cacheAt === mtime) return _cache
  _cache   = JSON.parse(readFileSync(PATH, 'utf-8')) as PurchasingPayload
  _cacheAt = mtime
  return _cache
}

export function getPurchasingOverview(): PurchasingPayload | null {
  return load()
}

export function getPurchasingByCategory(): {
  refreshedAt: string; categorySpend: CategorySpend[]; topProducts: TopProduct[]
  topProductsByCategory: Record<string, TopProduct[]>
} | null {
  const d = load()
  if (!d) return null
  return {
    refreshedAt: d.refreshedAt, categorySpend: d.categorySpend, topProducts: d.topProducts,
    topProductsByCategory: d.topProductsByCategory,
  }
}

export function getPurchasingByStore(): {
  refreshedAt: string; categoryByStore: CategoryByStore[]
} | null {
  const d = load()
  if (!d) return null
  return { refreshedAt: d.refreshedAt, categoryByStore: d.categoryByStore }
}

export function getPurchasingByVendor(): {
  refreshedAt: string
  vendorSplit: PurchasingPayload['vendorSplit']
  pfgBrands: VendorBrand[]
  walmartCategories: PurchasingPayload['walmartCategories']
} | null {
  const d = load()
  if (!d) return null
  return {
    refreshedAt: d.refreshedAt, vendorSplit: d.vendorSplit,
    pfgBrands: d.pfgBrands, walmartCategories: d.walmartCategories,
  }
}
