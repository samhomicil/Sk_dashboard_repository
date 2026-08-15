'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { resolveDateRange } from '@/lib/dates'
import { swrGet, swrSet } from '@/lib/swrCache'
import type { Store, Period, DateRange, KpiData, TrendPoint, StoreRow, EmployeeRow, ProductRow, CategoryRow, ChannelRow, QuarterRow, DailyData, DailyRangeData, StaffingData, Promotion } from '@/lib/types'
import type { SopData, SopQualityData } from './joltTypes'
import type { GuestSummary } from '@/app/api/guest-satisfaction/route'
import type { SociData } from '@/app/api/soci/route'

interface DashboardState {
  store:    Store
  period:   Period
  dates:    DateRange
  customStart?: string
  customEnd?:   string
}

interface DashboardData {
  kpis:        KpiData | null
  trend:       TrendPoint[]
  stores:      StoreRow[]
  employees:   EmployeeRow[]
  products:    ProductRow[]
  categories:  CategoryRow[]
  channels:    ChannelRow[]
  quarters:    QuarterRow[]
  staffing:    StaffingData | null
  promotions:  Promotion[]
  unitsWindow: { start: string; end: string } | null
  daily:       DailyData | null
  dailyRange:  DailyRangeData | null
  jolt:        SopData | null
  joltQuality: SopQualityData | null
  guestSat:    GuestSummary | null
  soci:        SociData | null
  loading:     boolean
  error:       string | null
  refreshedAt: string | null
  hasCache:    boolean
}

function qs(params: Record<string, string>) {
  return '?' + new URLSearchParams(params).toString()
}

export function useDashboard() {
  const [state, setState] = useState<DashboardState>({
    store:  'all',
    period: 'weekly',
    dates:  resolveDateRange('weekly'),
  })

  const [data, setData] = useState<DashboardData>({
    kpis: null, trend: [], stores: [], employees: [],
    products: [], categories: [], channels: [], quarters: [], staffing: null, promotions: [], unitsWindow: null, daily: null, dailyRange: null, jolt: null, joltQuality: null, guestSat: null, soci: null,
    loading: true, error: null, refreshedAt: null, hasCache: false,
  })

  const seq = useRef(0)

  const dashKey = (store: Store, s: DashboardState) =>
    'dash:' + JSON.stringify([store, s.period, s.dates.start, s.dates.end])

  // One request for the whole Overview (the server fans out in-process), so a
  // filter change costs a single round trip instead of 17.
  const fetchCombo = useCallback(async (store: Store, s: DashboardState): Promise<Omit<DashboardData, 'loading' | 'error'>> => {
    const p: Record<string, string> = {
      store,
      period:  s.period,
      start:   s.dates.start,
      end:     s.dates.end,
      pyStart: s.dates.pyStart,
      pyEnd:   s.dates.pyEnd,
    }
    const r = await fetch('/api/dashboard' + qs(p)).then(r => r.json())
    const heatRes = r.heatmap
    const next: Omit<DashboardData, 'loading' | 'error'> = {
      kpis:        r.kpis ?? null,
      trend:       Array.isArray(r.trend)      ? r.trend      : [],
      stores:      Array.isArray(r.stores)     ? r.stores     : [],
      employees:   Array.isArray(r.employees)  ? r.employees  : [],
      products:    Array.isArray(r.products)   ? r.products   : [],
      categories:  Array.isArray(r.categories) ? r.categories : [],
      channels:    Array.isArray(r.channels)   ? r.channels   : [],
      quarters:    Array.isArray(r.quarters)   ? r.quarters   : [],
      staffing:    heatRes?.pines ? heatRes : null,
      promotions:  Array.isArray(r.promotions) ? r.promotions : [],
      unitsWindow: heatRes?.unitsWindowStart && heatRes?.unitsWindowEnd
        ? { start: heatRes.unitsWindowStart, end: heatRes.unitsWindowEnd }
        : null,
      daily:       r.daily?.thisWeek ? r.daily : null,
      dailyRange:  r.dailyRange?.current ? r.dailyRange : null,
      jolt:        r.jolt?.locations ? r.jolt : null,
      joltQuality: r.joltQuality?.locations ? r.joltQuality : null,
      guestSat:    r.guestSat?.connected ? r.guestSat : null,
      soci:        r.soci?.connected ? r.soci : null,
      refreshedAt: r.meta?.refreshedAt ?? null,
      hasCache:    r.meta?.hasCache ?? false,
    }
    swrSet(dashKey(store, s), next)
    return next
  }, [])

  const fetchAll = useCallback(async (s: DashboardState) => {
    const cached = swrGet<Omit<DashboardData, 'loading' | 'error'>>(dashKey(s.store, s))
    // A combo we've already shown renders instantly; the fetch below revalidates it.
    if (cached) setData({ ...cached, loading: false, error: null })
    else setData(prev => ({ ...prev, loading: true, error: null }))
    const ticket = ++seq.current

    try {
      const next = await fetchCombo(s.store, s)
      // A newer filter change may have superseded this request; don't clobber it.
      if (ticket === seq.current) setData({ ...next, loading: false, error: null })

      // Prewarm the other store tabs for this window in the background so the
      // first flip to them is instant too (server + client caches both warm up).
      if (s.period !== 'custom') {
        const others = (['all', 'pines', 'miramar', 'margate'] as Store[])
          .filter(st => st !== s.store && !swrGet(dashKey(st, s)))
        others.forEach(st => { fetchCombo(st, s).catch(() => {}) })
      }
    } catch (err) {
      if (ticket === seq.current) setData(prev => ({ ...prev, loading: false, error: String(err) }))
    }
  }, [fetchCombo])

  useEffect(() => {
    fetchAll(state)
  }, [state, fetchAll])

  function setStore(store: Store) {
    setState(prev => ({ ...prev, store }))
  }

  function setPeriod(period: Period) {
    const dates = resolveDateRange(period, state.customStart, state.customEnd)
    setState(prev => ({ ...prev, period, dates }))
  }

  function setCustomRange(start: string, end: string) {
    const dates = resolveDateRange('custom', start, end)
    setState(prev => ({ ...prev, period: 'custom', dates, customStart: start, customEnd: end }))
  }

  function reload() { fetchAll(state) }

  return { state, data, setStore, setPeriod, setCustomRange, reload }
}
