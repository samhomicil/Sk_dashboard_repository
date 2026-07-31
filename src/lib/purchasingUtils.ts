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

// ── live, timeframe-windowed additions (inventory module) ──
export interface TopProductPriced extends TopProduct {
  lastPrice: number | null      // unit price on the most recent in-window order (line_total ÷ qty)
  lastPriceDate: string | null
}

export interface WeekPoint {
  week: string                  // ISO Monday
  pfg: number
  walmart: number
  sales: number
  costPct: number               // (pfg + walmart) ÷ sales, %
}

export interface CategoryWeekPoint {
  week: string
  category: string
  spend: number
}

export interface PurchasingLive {
  window: { start: string; end: string }
  refreshedAt: string
  vendorSplit: { pfgTotal: number; walmartTotal: number }
  categorySpend: CategorySpend[]
  categoryByStore: CategoryByStore[]
  topProducts: TopProductPriced[]
  topProductsByCategory: Record<string, TopProductPriced[]>
  pfgBrands: VendorBrand[]
  walmartCategories: { category: string; spend: number }[]
  monthlyTrend: MonthlySpend[]
  weeklyTrend: WeekPoint[]
  categoryTrend: CategoryWeekPoint[]
  priceTrend: { itemCode: string; week: string; price: number }[]   // weekly unit price for top items
}
