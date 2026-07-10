export type Store = 'all' | 'pines' | 'miramar' | 'margate'
export type Period = 'weekly' | 'monthly' | 'quarterly' | 'ytd' | 'custom'
export type ForecastMethod = 'blended' | 'historical' | 'runrate' | 'trend'

export interface DateRange {
  start: string // ISO date YYYY-MM-DD
  end: string
  pyStart: string
  pyEnd: string
}

export interface KpiData {
  sales: number
  salesPY: number
  salesTarget: number    // PY × 1.10
  salesForecast: number | null  // null when period is complete
  orders: number
  ordersPY: number
  laborPct: number
  laborPctL4W: number
  laborCost: number
  laborHours: number
  cogsActualPct:      number | null
  cogsTheoreticalPct: number | null
  cogsActualAsOf:     string | null   // null = current period; date string = last available count date
  eePct: number
  eePctL4W: number
  eeInStorePct: number
  eeDigitalPct: number
  walmartPct: number
  walmartPctL4W: number
  atv: number
  atvL4W: number
  pfsPct: number
  pfsPctL4W: number
  voidPct: number
  voidPctL4W: number
  discountPct: number
  discountPctL4W: number
  tillVariance: number
  tillVarianceL4W: number
  periodComplete: boolean // false if current period is still in progress
  daysElapsed: number
  daysTotal: number
}

export interface TrendPoint {
  weekStart: string      // mm/dd
  sales: number | null   // null = future
  salesPY: number | null
  salesTarget: number    // PY × 1.10
  salesForecast: number | null // null = past (use actual)
  isCurrent: boolean
  isForecast: boolean
}

export interface StoreRow {
  store: string
  sales: number
  salesPY: number
  laborPct: number
  laborCost: number
  laborHours: number
  eePct: number
  orders: number
}

export interface EmployeeRow {
  name: string
  store: string
  role: string
  hours: number
  rate: number      // most recent hourly rate from DB
  totalPay: number  // sum of total_pay over rolling 90 days
  salesPerHour: number
  totalSales: number | null  // period sales attributed to this employee (from EE data)
  eePct: number | null
  voidPct: number
  discountPct: number
  atv: number
}

export interface HeatmapCell {
  hour: string
  day: number // 0=Sun
  txnPerEmp: number
  rawTxn: number
  staff: number
}

export interface StaffingEmployee { name: string; shiftEnd: string }
export interface StaffingCell {
  hourNum: number
  day: number      // 0=Sun
  count: number    // avg employees per occurrence of this dow in the period
  avgUnits: number // avg units sold for this (dow, hour) from rolling 90-day heatmap
  employees: StaffingEmployee[]
}
export interface StaffingData {
  pines:   StaffingCell[]
  miramar: StaffingCell[]
  margate: StaffingCell[]
}

export interface ProductRow {
  name: string
  qtyPerDay: number
  qtyPerDayL4W: number
  changePct: number
}

export interface CategoryRow {
  name: string
  sales: number
  pct: number   // 0–1 share of total positive sales
}

export interface ChannelRow {
  name: string
  pct: number
  pctPY: number      // prior-year channel share (for mix shift visibility)
  changePct: number  // dollar YoY growth rate
  children?: ChannelRow[]
}

export interface QuarterRow {
  quarter: string
  sales: number | null
  salesPY: number | null
  orders: number | null
  laborPct: number | null
  laborCost: number | null
  laborHours: number | null
  eePct: number | null
  cogsPct: number | null
  atv: number | null
  isCurrent: boolean
  isFuture: boolean
}

export interface Callout {
  level: 'red' | 'yellow' | 'green'
  metric: string
  text: string
}

export interface Promotion {
  offerName:      string
  startDate:      string // YYYY-MM-DD
  endDate:        string
  offerType:      string
  offerValue:     number | null
  offerValueUnit: string | null
  productFocus:   string | null
  description:    string
}

export interface DailyRow {
  date:        string        // YYYY-MM-DD
  day:         string        // 'Sun' | 'Mon' | ...
  sales:       number | null
  orders:      number | null
  eePct:       number | null
  voidPct:     number | null
  atv:         number | null
  discountPct: number | null
  laborCost:   number | null
  laborHours:  number | null
  laborPct:    number | null
}

export interface DailyData {
  thisWeek: DailyRow[]
  lastYear: DailyRow[]
}

export interface DailyRangeData {
  current: DailyRow[]
  py:      DailyRow[]
}
