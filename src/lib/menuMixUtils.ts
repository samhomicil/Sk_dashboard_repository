// Client-safe types and pure functions for menu mix (no fs/node imports)

export interface ProductSummary {
  product:     string
  subcategory: string
  qty:         number
  sales:       number
  cogsPct:     number | null
  avgPrice:    number | null
}

export interface CategorySummary {
  subcategory: string
  qty:         number
  sales:       number
  pctOfTotal:  number
}

export interface MenuMixPayload {
  refreshedAt:  string
  thruDate:     string
  days:         number
  period:       string
  store:        string
  categories:   CategorySummary[]
  products:     Record<string, ProductSummary[]>
  modifiers:    ProductSummary[]
}

export interface DaypartRow {
  name:  string
  sales: number
  qty:   number
}

export interface WeekdayRow {
  dow:   number
  sales: number
  qty:   number
  days:  number
}

export interface EeRow {
  dow: number
  sm:  number
  ee:  number
}

export interface DaypartCategoryRow {
  subcategory: string
  sales:       number
  qty:         number
}

export interface DaypartProductRow {
  subcategory: string
  product:     string
  sales:       number
  qty:         number
}

export interface DaypartPayload {
  refreshedAt: string
  windowStart: string
  windowEnd:   string
  daypart:     DaypartRow[]
  weekday:     WeekdayRow[]
  categories:  Record<string, DaypartCategoryRow[]>
  products:    Record<string, DaypartProductRow[]>
  ee:          EeRow[]
  weekdayByStore?: Record<'pines' | 'miramar' | 'margate', WeekdayRow[]>
  eeByStore?:      Record<'pines' | 'miramar' | 'margate', EeRow[]>
}

export function parseSize(product: string): string {
  const m = product.match(/^(\d+OZ|KIDS|44OZ)/i)
  return m ? m[1].toUpperCase() : product.split(' ')[0]
}

export function parseFlavor(product: string): string {
  return product
    .replace(/^\d+OZ\s*-\s*/i, '')
    .replace(/^KIDS\s*-\s*/i, '')
    .replace(/^BOWL\s*-\s*/i, '')
    .replace(/^RETAIL\s*-\s*/i, '')
    .replace(/^CHOICE\s*-\s*/i, '')
    .replace(/^Add On\s*-\s*/i, '')
    .replace(/^Sub\s*-\s*/i, '')
    .trim() || product
}

export function blendedCogs(prods: ProductSummary[]): number | null {
  let rev = 0, cost = 0
  for (const p of prods) if (p.cogsPct != null) { rev += p.sales; cost += p.sales * p.cogsPct }
  return rev > 0 ? cost / rev : null
}
