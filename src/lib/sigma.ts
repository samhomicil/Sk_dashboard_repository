/**
 * Sigma Computing data access helpers.
 *
 * Sales come from Sales Mix v2 (inode 16djMxYA6BegwtQBHlmqTS).
 * COGS comes from Inventory v2 (inode nfS76ixg7sPelZxYJKlpi).
 *
 * Data is pre-fetched into data/sigma-daily.json (run `npm run sigma` to refresh
 * when Sigma API credentials are configured in .env.local).
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Store } from './types'

const SIGMA_PATH = join(process.cwd(), 'data', 'sigma-daily.json')

// Sigma location name → dashboard store key
const LOCATION_TO_STORE: Record<string, Store> = {
  '1392 - Pembroke Pines, FL': 'pines',
  '1892 - Miramar, FL':        'miramar',
  '2384 - Margate, FL':        'margate',
}

interface SaleRow    { date: string; location: string; net_sales: number; gross_sales: number; voids_amount: number; orders?: number }
interface CogsRow    { date: string; location: string; actual_cogs: number; theoretical_cogs: number }
interface ChannelRow { date: string; location: string; destination: string; orders: number; sales: number }
export interface EmployeeShiftRow {
  date: string; location_code: string; location: string
  first_name: string; last_name: string; position: string
  rate: number; hours: number; pay: number
}
interface SigmaFile  {
  refreshedAt: string; thruDate: string
  sales: SaleRow[]; cogs: CogsRow[]
  channels?: ChannelRow[]
  employees?: EmployeeShiftRow[]
}

let _cache: SigmaFile | null = null
let _cacheAt = 0

function load(): SigmaFile | null {
  if (!existsSync(SIGMA_PATH)) return null
  const mtime = require('fs').statSync(SIGMA_PATH).mtimeMs
  if (_cache && _cacheAt === mtime) return _cache
  _cache  = JSON.parse(readFileSync(SIGMA_PATH, 'utf-8')) as SigmaFile
  _cacheAt = mtime
  return _cache
}

function storeMatches(location: string, store: Store): boolean {
  if (store === 'all') return location in LOCATION_TO_STORE
  return LOCATION_TO_STORE[location] === store
}

export function sigmaThruDate(): string | null {
  return load()?.thruDate ?? null
}

// Most recent date where actual_cogs > 0 for a given store
export function sigmaCogsActualThruDate(store: Store): string | null {
  const d = load()
  if (!d) return null
  let maxDate = ''
  for (const r of d.cogs) {
    if (r.actual_cogs > 0 && storeMatches(r.location, store) && r.date > maxDate) {
      maxDate = r.date
    }
  }
  return maxDate || null
}

export interface SigmaSalesSummary {
  net_sales: number
  gross_sales: number
  voids_amount: number
}

export function sigmaSales(store: Store, start: string, end: string): SigmaSalesSummary {
  const d = load()
  if (!d) return { net_sales: 0, gross_sales: 0, voids_amount: 0 }
  let net = 0, gross = 0, voids = 0
  for (const r of d.sales) {
    if (r.date >= start && r.date <= end && storeMatches(r.location, store)) {
      net   += r.net_sales
      gross += r.gross_sales
      voids += r.voids_amount
    }
  }
  return {
    net_sales:    Math.round(net   * 100) / 100,
    gross_sales:  Math.round(gross * 100) / 100,
    voids_amount: Math.round(voids * 100) / 100,
  }
}

export interface SigmaCogsSummary {
  actual_cogs: number
  theoretical_cogs: number
}

export function sigmaCogs(store: Store, start: string, end: string): SigmaCogsSummary {
  const d = load()
  if (!d) return { actual_cogs: 0, theoretical_cogs: 0 }
  let actual = 0, theoretical = 0
  for (const r of d.cogs) {
    if (r.date >= start && r.date <= end && storeMatches(r.location, store)) {
      actual      += r.actual_cogs
      theoretical += r.theoretical_cogs
    }
  }
  return {
    actual_cogs:      Math.round(actual * 100) / 100,
    theoretical_cogs: Math.round(theoretical * 100) / 100,
  }
}

// Weekly sales grouped by week-start (YYYY-MM-DD) for the trend chart
export function sigmaWeeklySales(store: Store, start: string, end: string): Map<string, number> {
  const d = load()
  const out = new Map<string, number>()
  if (!d) return out
  for (const r of d.sales) {
    if (r.date < start || r.date > end) continue
    if (!storeMatches(r.location, store)) continue
    // Compute Monday of the week
    const dt  = new Date(r.date + 'T00:00:00')
    const dow = dt.getDay() // 0=Sun
    const diff = dow === 0 ? -6 : 1 - dow
    dt.setDate(dt.getDate() + diff)
    const wk = dt.toISOString().slice(0, 10)
    out.set(wk, (out.get(wk) ?? 0) + r.net_sales)
  }
  return out
}

// Monthly sales grouped by "YYYY-MM" for the trend chart
export function sigmaMonthSales(store: Store, start: string, end: string): Map<string, number> {
  const d = load()
  const out = new Map<string, number>()
  if (!d) return out
  for (const r of d.sales) {
    if (r.date < start || r.date > end) continue
    if (!storeMatches(r.location, store)) continue
    const month = r.date.slice(0, 7) // "YYYY-MM"
    out.set(month, (out.get(month) ?? 0) + r.net_sales)
  }
  return out
}

// Order counts (check counts) from Sigma — falls back to 0 for dates without data
export function sigmaOrders(store: Store, start: string, end: string): number {
  const d = load()
  if (!d) return 0
  let total = 0
  for (const r of d.sales) {
    if (r.date >= start && r.date <= end && storeMatches(r.location, store)) {
      total += r.orders ?? 0
    }
  }
  return total
}

export interface SigmaDailyRow {
  net_sales:    number
  gross_sales:  number
  voids_amount: number
  orders:       number
}

// Full per-day sales detail (net, gross, voids, orders) — for daily table and custom-period KPIs
export function sigmaDailyFull(store: Store, start: string, end: string): Map<string, SigmaDailyRow> {
  const d = load()
  const out = new Map<string, SigmaDailyRow>()
  if (!d) return out
  for (const r of d.sales) {
    if (r.date < start || r.date > end) continue
    if (!storeMatches(r.location, store)) continue
    const prev = out.get(r.date)
    if (prev) {
      prev.net_sales    += r.net_sales
      prev.gross_sales  += r.gross_sales
      prev.voids_amount += r.voids_amount
      prev.orders       += r.orders ?? 0
    } else {
      out.set(r.date, {
        net_sales:    r.net_sales,
        gross_sales:  r.gross_sales,
        voids_amount: r.voids_amount,
        orders:       r.orders ?? 0,
      })
    }
  }
  return out
}

// Daily sales map for sparklines
export function sigmaDailySales(store: Store, start: string, end: string): Map<string, number> {
  const d = load()
  const out = new Map<string, number>()
  if (!d) return out
  for (const r of d.sales) {
    if (r.date >= start && r.date <= end && storeMatches(r.location, store)) {
      out.set(r.date, (out.get(r.date) ?? 0) + r.net_sales)
    }
  }
  return out
}

// Channel breakdown (sales by destination) for a store and date range
export function sigmaChannels(store: Store, start: string, end: string): Map<string, number> {
  const d = load()
  const out = new Map<string, number>()
  if (!d?.channels) return out
  for (const r of d.channels) {
    if (r.date >= start && r.date <= end && storeMatches(r.location, store)) {
      out.set(r.destination, (out.get(r.destination) ?? 0) + r.sales)
    }
  }
  return out
}

// ── EE% and Heatmap data ─────────────────────────────────────────────

const EE_PERIODS_PATH = join(process.cwd(), 'data', 'ee-periods.json')
const EMP_KEY_MAP_PATH = join(process.cwd(), 'data', 'employee-key-map.json')
const HEATMAP_PATH     = join(process.cwd(), 'data', 'heatmap-daily.json')

interface EEEntry { ee: number; sm: number; sales?: number }
interface EEChannelSplit { inStore: EEEntry; digital: EEEntry }
interface EEPeriod {
  start: string; end: string
  byEmpKey:    Record<string, EEEntry>
  storeTotals: Record<string, EEEntry>
  channelEE?:  Record<string, EEChannelSplit>
}
interface EEPeriodsFile { weekly: EEPeriod; monthly: EEPeriod; quarterly: EEPeriod; ytd: EEPeriod }
interface EmpKeyEntry   { first_name: string; last_name: string; loc_code: string }
interface HeatRow       { dow: number; hour: number; avg_txn: number; avg_units?: number; days: number }
interface HeatFile      {
  pines: HeatRow[]; miramar: HeatRow[]; margate: HeatRow[]
  unitsWindowStart?: string; unitsWindowEnd?: string
}

let _eePeriods:  EEPeriodsFile | null = null
let _empRevMap:  Map<string, number>  | null = null

function loadEEPeriods(): EEPeriodsFile | null {
  if (_eePeriods) return _eePeriods
  if (!existsSync(EE_PERIODS_PATH)) return null
  _eePeriods = JSON.parse(readFileSync(EE_PERIODS_PATH, 'utf-8'))
  return _eePeriods
}

function getEmpRevMap(): Map<string, number> {
  if (_empRevMap) return _empRevMap
  _empRevMap = new Map()
  if (!existsSync(EMP_KEY_MAP_PATH)) return _empRevMap
  const raw = JSON.parse(readFileSync(EMP_KEY_MAP_PATH, 'utf-8')) as Record<string, EmpKeyEntry>
  for (const [key, val] of Object.entries(raw)) {
    // Name-only key (emp_key is per person, not per store — handles cross-store shifts)
    _empRevMap.set(`${val.first_name.toLowerCase()}|${val.last_name.toLowerCase()}`, Number(key))
    // Name+loc fallback for disambiguation if two employees share a name
    _empRevMap.set(`${val.first_name.toLowerCase()}|${val.last_name.toLowerCase()}|${val.loc_code}`, Number(key))
  }
  return _empRevMap
}

// Reverse-lookup emp_key by name (loc_code used only for disambiguation)
export function sigmaEmpKey(firstName: string, lastName: string, locCode: string): number | null {
  const rev = getEmpRevMap()
  const nameKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`
  const fullKey = `${nameKey}|${locCode}`
  return rev.get(fullKey) ?? rev.get(nameKey) ?? null
}

// All emp_keys for a person across all stores (multi-store employees have one key per loc)
export function sigmaAllEmpKeys(firstName: string, lastName: string): number[] {
  if (!existsSync(EMP_KEY_MAP_PATH)) return []
  const raw = JSON.parse(readFileSync(EMP_KEY_MAP_PATH, 'utf-8')) as Record<string, EmpKeyEntry>
  const nameKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`
  return Object.entries(raw)
    .filter(([, v]) => `${v.first_name.toLowerCase()}|${v.last_name.toLowerCase()}` === nameKey)
    .map(([k]) => Number(k))
}

// Return the home loc_code for a given emp_key (from key map)
export function sigmaEmpHomeLocCode(empKey: number): string | null {
  if (!existsSync(EMP_KEY_MAP_PATH)) return null
  const raw = JSON.parse(readFileSync(EMP_KEY_MAP_PATH, 'utf-8')) as Record<string, { loc_code: string }>
  return raw[String(empKey)]?.loc_code ?? null
}

// EE data for the period whose start date matches
export function sigmaEEByDate(start: string): {
  byEmpKey:   Map<number, EEEntry>
  storeTotals: Record<string, EEEntry>
  channelEE:   Record<string, EEChannelSplit>
} {
  const emptyCh: EEChannelSplit = { inStore:{ee:0,sm:0}, digital:{ee:0,sm:0} }
  const empty = { byEmpKey: new Map<number, EEEntry>(), storeTotals: { pines:{ee:0,sm:0}, miramar:{ee:0,sm:0}, margate:{ee:0,sm:0} }, channelEE: { pines:emptyCh, miramar:emptyCh, margate:emptyCh } }
  const data = loadEEPeriods()
  if (!data) return empty
  for (const p of Object.values(data) as EEPeriod[]) {
    if (p.start === start) {
      return {
        byEmpKey:    new Map(Object.entries(p.byEmpKey).map(([k, v]) => [Number(k), v])),
        storeTotals: p.storeTotals,
        channelEE:   p.channelEE ?? { pines:emptyCh, miramar:emptyCh, margate:emptyCh },
      }
    }
  }
  return empty
}

// Daily EE% (ee/sm) for a store on a specific date — from ee-daily.json
const LABOR_DAILY_PATH = join(process.cwd(), 'data', 'labor-daily.json')
interface LaborDailyRow  { date: string; labor: number; hours: number }
interface LaborDailyFile { pines: LaborDailyRow[]; miramar: LaborDailyRow[]; margate: LaborDailyRow[]; thruDate?: string }

function loadLaborDailyRows(data: LaborDailyFile, store: Store): LaborDailyRow[] {
  if (store === 'pines')   return data.pines
  if (store === 'miramar') return data.miramar
  if (store === 'margate') return data.margate
  return [...data.pines, ...data.miramar, ...data.margate]
}

export function sigmaLaborDay(store: Store, date: string): { labor: number; hours: number } {
  if (!existsSync(LABOR_DAILY_PATH)) return { labor: 0, hours: 0 }
  const data = JSON.parse(readFileSync(LABOR_DAILY_PATH, 'utf-8')) as LaborDailyFile
  if (store === 'all') {
    const rows = loadLaborDailyRows(data, 'all').filter(r => r.date === date)
    return { labor: rows.reduce((s, r) => s + r.labor, 0), hours: rows.reduce((s, r) => s + r.hours, 0) }
  }
  const row = loadLaborDailyRows(data, store).find(r => r.date === date)
  return { labor: row?.labor ?? 0, hours: row?.hours ?? 0 }
}

export function sigmaLaborRange(store: Store, start: string, end: string): number {
  if (!existsSync(LABOR_DAILY_PATH)) return 0
  const data = JSON.parse(readFileSync(LABOR_DAILY_PATH, 'utf-8')) as LaborDailyFile
  return loadLaborDailyRows(data, store)
    .filter(r => r.date >= start && r.date <= end)
    .reduce((s, r) => s + r.labor, 0)
}

export function sigmaLaborData(store: Store, start: string, end: string): { labor: number; hours: number } {
  if (!existsSync(LABOR_DAILY_PATH)) return { labor: 0, hours: 0 }
  const data = JSON.parse(readFileSync(LABOR_DAILY_PATH, 'utf-8')) as LaborDailyFile
  const rows = loadLaborDailyRows(data, store).filter(r => r.date >= start && r.date <= end)
  return { labor: rows.reduce((s, r) => s + r.labor, 0), hours: rows.reduce((s, r) => s + r.hours, 0) }
}

const EE_DAILY_PATH = join(process.cwd(), 'data', 'ee-daily.json')
interface EEDailyRow  { date: string; sm: number; ee: number }
interface EEDailyFile { pines: EEDailyRow[]; miramar: EEDailyRow[]; margate: EEDailyRow[]; weekStart?: string; thruDate?: string }

function loadEEDailyStoreRows(data: EEDailyFile, store: Store): EEDailyRow[] {
  if (store === 'pines')   return data.pines
  if (store === 'miramar') return data.miramar
  if (store === 'margate') return data.margate
  return [...data.pines, ...data.miramar, ...data.margate]
}

export function sigmaEEDailyPct(store: Store, date: string): number | null {
  if (!existsSync(EE_DAILY_PATH)) return null
  const data = JSON.parse(readFileSync(EE_DAILY_PATH, 'utf-8')) as EEDailyFile
  if (store === 'all') {
    const allRows = loadEEDailyStoreRows(data, 'all')
    const sm = allRows.filter(r => r.date === date).reduce((s, r) => s + r.sm, 0)
    const ee = allRows.filter(r => r.date === date).reduce((s, r) => s + r.ee, 0)
    return sm > 0 ? ee / sm : null
  }
  const row = loadEEDailyStoreRows(data, store).find(r => r.date === date)
  return row && row.sm > 0 ? row.ee / row.sm : null
}

// Aggregate EE% for a store across a date range from ee-daily.json
export function sigmaEERange(store: Store, start: string, end: string): { ee: number; sm: number } {
  if (!existsSync(EE_DAILY_PATH)) return { ee: 0, sm: 0 }
  const data = JSON.parse(readFileSync(EE_DAILY_PATH, 'utf-8')) as EEDailyFile
  const rows = loadEEDailyStoreRows(data, store).filter(r => r.date >= start && r.date <= end)
  return { sm: rows.reduce((s, r) => s + r.sm, 0), ee: rows.reduce((s, r) => s + r.ee, 0) }
}

export interface HeatCell { hourNum: number; day: number; uplh: number; rawUnits: number; staff: number }

// The units-sold benchmark backing the heatmap is a rolling ~90-day average,
// refreshed independently of the selected dashboard period — surfaced so the
// UI can label what window the numbers actually reflect.
export function sigmaHeatmapWindow(): { start: string; end: string } | null {
  if (!existsSync(HEATMAP_PATH)) return null
  const data = JSON.parse(readFileSync(HEATMAP_PATH, 'utf-8')) as HeatFile
  if (!data.unitsWindowStart || !data.unitsWindowEnd) return null
  return { start: data.unitsWindowStart, end: data.unitsWindowEnd }
}

export function sigmaHeatmap(store: Store): HeatCell[] {
  if (!existsSync(HEATMAP_PATH)) return []
  const data = JSON.parse(readFileSync(HEATMAP_PATH, 'utf-8')) as HeatFile
  const STAFF = 2

  let rows: HeatRow[]
  if (store === 'pines')   rows = data.pines
  else if (store === 'miramar') rows = data.miramar
  else if (store === 'margate') rows = data.margate
  else {
    // All: combine pines + miramar by averaging per (dow, hour)
    const agg = new Map<string, {sum: number; n: number}>()
    for (const r of [...data.pines, ...data.miramar]) {
      const k = `${r.dow}|${r.hour}`
      const e = agg.get(k)
      const v = r.avg_units ?? 0
      if (e) { e.sum += v; e.n++ }
      else agg.set(k, { sum: v, n: 1 })
    }
    return Array.from(agg.entries())
      .map(([k, v]) => {
        const [dow, hour] = k.split('|').map(Number)
        const avg = v.sum / v.n
        return { hourNum: hour, day: dow, uplh: Math.round(avg / STAFF * 10) / 10, rawUnits: Math.round(avg * 10) / 10, staff: STAFF }
      })
      .filter(c => c.hourNum >= 7 && c.hourNum <= 21)
  }

  return rows
    .filter(r => r.hour >= 7 && r.hour <= 21)
    .map(r => ({
      hourNum:  r.hour,
      day:      r.dow,
      uplh:     Math.round((r.avg_units ?? 0) / STAFF * 10) / 10,
      rawUnits: Math.round((r.avg_units ?? 0) * 10) / 10,
      staff:    STAFF,
    }))
}

// Labor Actual V2 location code → store key
const LABOR_CODE_TO_STORE: Record<string, Store> = {
  '1392': 'pines',
  '1892': 'miramar',
  '2384': 'margate',
}

function laborStoreMatches(row: EmployeeShiftRow, store: Store): boolean {
  const mapped = LABOR_CODE_TO_STORE[row.location_code]
    ?? (LOCATION_TO_STORE[row.location] as Store | undefined)
  if (!mapped) return false
  return store === 'all' || mapped === store
}

// Employee shifts from Sigma [Labor] Actual V2 for a given period
export function sigmaEmployees(store: Store, start: string, end: string): EmployeeShiftRow[] {
  const d = load()
  if (!d?.employees?.length) return []
  return d.employees.filter(r => r.date >= start && r.date <= end && laborStoreMatches(r, store))
}
