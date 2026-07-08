// Client-safe types and pure helpers for purchasing/inventory data (no fs/node imports)

export interface CategorySpend {
  category: string
  spend:    number
  lines:    number
  pct:      number
}

export interface CategoryByStore {
  category: string
  pines:    number
  miramar:  number
  margate:  number
}

export interface TopProduct {
  itemCode:    string
  description: string
  brand:       string
  category:    string
  spend:       number
  qty:         number
  pines:       number
  miramar:     number
  margate:     number
}

export interface VendorBrand {
  brand: string
  spend: number
  pct:   number
}

export interface MonthlySpend {
  month:        string
  pfgSpend:     number
  walmartSpend: number
}

export interface PurchasingPayload {
  refreshedAt:       string
  vendorSplit:       { pfgTotal: number; walmartTotal: number }
  categorySpend:     CategorySpend[]
  categoryByStore:   CategoryByStore[]
  topProducts:       TopProduct[]
  topProductsByCategory: Record<string, TopProduct[]>
  pfgBrands:         VendorBrand[]
  walmartCategories: { category: string; spend: number }[]
  monthlyTrend:      MonthlySpend[]
}

export function storeTotal(row: CategoryByStore): number {
  return row.pines + row.miramar + row.margate
}
