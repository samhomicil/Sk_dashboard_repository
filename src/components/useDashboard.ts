'use client'

import { useState, useEffect, useCallback } from 'react'
import { resolveDateRange } from '@/lib/dates'
import type { Store, Period, DateRange, KpiData, TrendPoint, StoreRow, EmployeeRow, ProductRow, CategoryRow, ChannelRow, QuarterRow, DailyData, DailyRangeData, StaffingData } from '@/lib/types'

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
  daily:       DailyData | null
  dailyRange:  DailyRangeData | null
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
    products: [], categories: [], channels: [], quarters: [], staffing: null, daily: null, dailyRange: null,
    loading: true, error: null, refreshedAt: null, hasCache: false,
  })

  const fetchAll = useCallback(async (s: DashboardState) => {
    setData(prev => ({ ...prev, loading: true, error: null }))

    const p: Record<string, string> = {
      store:   s.store,
      period:  s.period,
      start:   s.dates.start,
      end:     s.dates.end,
      pyStart: s.dates.pyStart,
      pyEnd:   s.dates.pyEnd,
    }

    try {
      const isCustom = s.period === 'custom'
      const [kpisRes, trendRes, storesRes, empRes, prodRes, catRes, chRes, qRes, heatRes, metaRes, dailyRes, dailyRangeRes] = await Promise.all([
        fetch('/api/kpis'        + qs(p)).then(r => r.json()),
        fetch('/api/trend'       + qs(p)).then(r => r.json()),
        fetch('/api/stores'      + qs(p)).then(r => r.json()),
        fetch('/api/employees'   + qs(p)).then(r => r.json()),
        fetch('/api/products'    + qs(p)).then(r => r.json()),
        fetch('/api/categories'  + qs(p)).then(r => r.json()),
        fetch('/api/channels'    + qs(p)).then(r => r.json()),
        fetch(`/api/quarters?store=${s.store}&year=${new Date().getFullYear()}`).then(r => r.json()),
        fetch('/api/heatmap'     + qs(p)).then(r => r.json()),
        fetch('/api/meta').then(r => r.json()),
        fetch(`/api/daily?store=${s.store}`).then(r => r.json()),
        isCustom
          ? fetch(`/api/daily?store=${s.store}&start=${s.dates.start}&end=${s.dates.end}&pyStart=${s.dates.pyStart}&pyEnd=${s.dates.pyEnd}`).then(r => r.json())
          : Promise.resolve(null),
      ])

      setData({
        kpis:        kpisRes,
        trend:       Array.isArray(trendRes)  ? trendRes  : [],
        stores:      Array.isArray(storesRes) ? storesRes : [],
        employees:   Array.isArray(empRes)    ? empRes    : [],
        products:    Array.isArray(prodRes)   ? prodRes   : [],
        categories:  Array.isArray(catRes)    ? catRes    : [],
        channels:    Array.isArray(chRes)     ? chRes     : [],
        quarters:    Array.isArray(qRes)      ? qRes      : [],
        staffing:    heatRes?.pines ? heatRes : null,
        daily:       dailyRes?.thisWeek ? dailyRes : null,
        dailyRange:  dailyRangeRes?.current ? dailyRangeRes : null,
        refreshedAt: metaRes?.refreshedAt ?? null,
        hasCache:    metaRes?.hasCache ?? false,
        loading: false,
        error: null,
      })
    } catch (err) {
      setData(prev => ({ ...prev, loading: false, error: String(err) }))
    }
  }, [])

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
