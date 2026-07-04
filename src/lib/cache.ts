import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { KpiData, TrendPoint, StoreRow, EmployeeRow, ProductRow, CategoryRow, ChannelRow, QuarterRow, Store, Period, DailyData, StaffingData } from './types'
import { readCacheFromDb } from './azure-cache'

export interface CachePeriodKpis {
  weekly:    KpiData
  monthly:   KpiData
  quarterly: KpiData
  ytd:       KpiData
}

export interface Cache {
  refreshedAt: string
  kpis:       Record<Store, CachePeriodKpis>
  trend:      Record<Store, { weekly: TrendPoint[], monthly: TrendPoint[] }>
  stores:     Record<Period, StoreRow[]>
  employees:  Record<Store, Record<Period, EmployeeRow[]>>
  heatmap:    Record<Store, unknown[]>
  staffing:   Record<Period, StaffingData>
  products:   Record<Store, Record<Period, ProductRow[]>>
  categories: Record<Store, Record<Period, CategoryRow[]>>
  channels:   Record<Store, Record<Period, ChannelRow[]>>
  quarters:   Record<Store, QuarterRow[]>
  daily:      Record<Store, DailyData>
}

const CACHE_PATH = join(process.cwd(), 'data', 'cache.json')

let _cache: Cache | null = null
let _cacheAt = 0
let _dbCachePromise: Promise<Cache | null> | null = null
let _dbCache: Cache | null = null

export function getCache(): Cache | null {
  if (!existsSync(CACHE_PATH)) return null
  const mtime = require('fs').statSync(CACHE_PATH).mtimeMs
  if (_cache && _cacheAt === mtime) return _cache
  _cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as Cache
  _cacheAt = mtime
  return _cache
}

export function invalidateCacheMemory() {
  _dbCache = null
  _dbCachePromise = null
}

export async function getCacheAsync(): Promise<Cache | null> {
  if (_dbCache) return _dbCache
  if (process.env.AZURE_SQL_SERVER) {
    if (!_dbCachePromise) {
      _dbCachePromise = readCacheFromDb().then(c => { if (c) _dbCache = c; return c })
    }
    const dbResult = await _dbCachePromise
    if (dbResult) return dbResult
  }
  return getCache()
}

export function cacheKpis(store: Store, period: Period): KpiData | null {
  const c = getCache()
  if (!c) return null
  return c.kpis[store]?.[period as keyof CachePeriodKpis] ?? null
}

export function cacheTrend(store: Store, period: Period): TrendPoint[] | null {
  const c = getCache()
  const variant = period === 'weekly' ? 'weekly' : 'monthly'
  return c?.trend[store]?.[variant] ?? null
}

export function cacheStores(period: Period): StoreRow[] | null {
  const c = getCache()
  return c?.stores[period] ?? null
}

export function cacheEmployees(store: Store, period: Period): EmployeeRow[] | null {
  const c = getCache()
  return c?.employees[store]?.[period as keyof CachePeriodKpis] ?? null
}

export function cacheHeatmap(store: Store): unknown[] | null {
  const c = getCache()
  return c?.heatmap[store] ?? null
}

export function cacheProducts(store: Store, period: Period): ProductRow[] | null {
  const c = getCache()
  return c?.products[store]?.[period as keyof CachePeriodKpis] ?? null
}

export function cacheCategories(store: Store, period: Period): CategoryRow[] | null {
  const c = getCache()
  return c?.categories?.[store]?.[period as keyof CachePeriodKpis] ?? null
}

export function cacheChannels(store: Store, period: Period): ChannelRow[] | null {
  const c = getCache()
  return c?.channels[store]?.[period as keyof CachePeriodKpis] ?? null
}

export function cacheQuarters(store: Store): QuarterRow[] | null {
  const c = getCache()
  return c?.quarters[store] ?? null
}

export function cacheDaily(store: Store): DailyData | null {
  const c = getCache()
  return c?.daily?.[store] ?? null
}

export function cacheStaffing(period: Period): StaffingData | null {
  const c = getCache()
  return c?.staffing?.[period as keyof CachePeriodKpis] ?? null
}

// Async versions — check Azure SQL cache first, fall back to bundled file
export async function cacheKpisAsync(store: Store, period: Period): Promise<KpiData | null> {
  const c = await getCacheAsync()
  return c?.kpis[store]?.[period as keyof CachePeriodKpis] ?? null
}

export async function cacheTrendAsync(store: Store, period: Period): Promise<TrendPoint[] | null> {
  const c = await getCacheAsync()
  const variant = period === 'weekly' ? 'weekly' : 'monthly'
  return c?.trend[store]?.[variant] ?? null
}

export async function cacheStoresAsync(period: Period): Promise<StoreRow[] | null> {
  const c = await getCacheAsync()
  return c?.stores[period] ?? null
}

export async function cacheEmployeesAsync(store: Store, period: Period): Promise<EmployeeRow[] | null> {
  const c = await getCacheAsync()
  return c?.employees[store]?.[period as keyof CachePeriodKpis] ?? null
}

export async function cacheHeatmapAsync(store: Store): Promise<unknown[] | null> {
  const c = await getCacheAsync()
  return c?.heatmap[store] ?? null
}

export async function cacheProductsAsync(store: Store, period: Period): Promise<ProductRow[] | null> {
  const c = await getCacheAsync()
  return c?.products[store]?.[period as keyof CachePeriodKpis] ?? null
}

export async function cacheCategoriesAsync(store: Store, period: Period): Promise<CategoryRow[] | null> {
  const c = await getCacheAsync()
  return c?.categories?.[store]?.[period as keyof CachePeriodKpis] ?? null
}

export async function cacheChannelsAsync(store: Store, period: Period): Promise<ChannelRow[] | null> {
  const c = await getCacheAsync()
  return c?.channels[store]?.[period as keyof CachePeriodKpis] ?? null
}

export async function cacheQuartersAsync(store: Store): Promise<QuarterRow[] | null> {
  const c = await getCacheAsync()
  return c?.quarters[store] ?? null
}

export async function cacheDailyAsync(store: Store): Promise<DailyData | null> {
  const c = await getCacheAsync()
  return c?.daily?.[store] ?? null
}

export async function cacheStaffingAsync(period: Period): Promise<StaffingData | null> {
  const c = await getCacheAsync()
  return c?.staffing?.[period as keyof CachePeriodKpis] ?? null
}
