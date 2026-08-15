'use client'

import { useState, useEffect, useRef } from 'react'
import { useDashboard } from './useDashboard'
import OverviewBar  from './OverviewBar'
import { Kpis, KpiTile, MetricTrend, type Metric, type Series } from './design/Kpi'
import { Page } from './design/shell'
import JoltPanel from './JoltPanel'
import ForecastBanner from './ForecastBanner'
import StoreBreakdown from './StoreBreakdown'
import OpsHealth    from './OpsHealth'
import SupplySpend  from './SupplySpend'
import Callouts     from './Callouts'
import QuarterTable from './QuarterTable'
import MixRow       from './MixRow'
import DailyTable   from './DailyTable'
import { TARGETS }  from '@/lib/config'
import type { KpiData, DailyRow } from '@/lib/types'

function pct(n: number, decimals = 1)  { return `${(n * 100).toFixed(decimals)}%` }
// "2026-08-12" -> "Aug 12". A raw ISO date in a KPI subline reads as debug output.
function asOf(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return isNaN(+d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function dol(n: number)                { return `$${Math.round(n).toLocaleString()}` }
function pillVsPY(v: number, py: number): { text: string; color: 'green' | 'red' } {
  if (!py) return { text: '—', color: 'gray' as never }
  const d = (v - py) / py
  return { text: `${d >= 0 ? '▲' : '▼'}${Math.abs(d * 100).toFixed(1)}% vs PY`, color: d >= 0 ? 'green' : 'red' }
}
function dot(val: number, target: number, lowerBetter = false): 'green' | 'yellow' | 'red' {
  const ok   = lowerBetter ? val <= target         : val >= target
  const warn = lowerBetter ? val <= target * 1.1   : val >= target * 0.85
  return ok ? 'green' : warn ? 'yellow' : 'red'
}
// The same three bands, named the way the design system names them. No new rule —
// the old KPI card carried a coloured dot AND a coloured pill for one judgement;
// the kit carries it once, on the delta.
const TONE = { green: 'good', yellow: 'warn', red: 'bad' } as const
const toneOf = (d: 'green' | 'yellow' | 'red' | 'none') => (d === 'none' ? undefined : TONE[d])
// "▲3.2% vs PY" -> a signed delta, which is the system's convention.
const signed = (p?: { text: string; color: 'green' | 'red' }) =>
  p ? p.text.replace('▲', '+').replace('▼', '-') : undefined

export default function Dashboard() {
  const { state, data, setStore, setPeriod, setCustomRange, reload } = useDashboard()

  const [refreshing, setRefreshing]   = useState(false)
  const [refreshMsg, setRefreshMsg]   = useState<string | null>(null)
  const baseRefreshedAt = useRef<string | null>(null)
  const pollTimer       = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current) }, [])

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg('Starting...')
    baseRefreshedAt.current = data.refreshedAt

    try {
      const json = await fetch('/api/refresh', { method: 'POST' }).then(r => r.json())

      if (json.status === 'deploying') {
        setRefreshMsg('Deploying — fresh data in ~2 min')
        setTimeout(() => { setRefreshing(false); setRefreshMsg(null) }, 8000)
        return
      }
      if (json.error) {
        setRefreshing(false)
        setRefreshMsg(json.error)
        return
      }

      setRefreshMsg('Refreshing... (1–2 min)')

      pollTimer.current = setInterval(async () => {
        try {
          const meta = await fetch('/api/meta').then(r => r.json())
          if (meta.refreshedAt && meta.refreshedAt !== baseRefreshedAt.current) {
            clearInterval(pollTimer.current!)
            setRefreshing(false)
            setRefreshMsg(null)
            reload()
          }
        } catch { /* ignore poll errors */ }
      }, 3000)

      setTimeout(() => {
        if (pollTimer.current) {
          clearInterval(pollTimer.current)
          pollTimer.current = null
          setRefreshing(false)
          setRefreshMsg('Timed out — run npm run ship locally if this keeps happening')
        }
      }, 180_000)

    } catch {
      setRefreshing(false)
      setRefreshMsg('Failed — is the proxy running?')
    }
  }
  const { kpis, stores, products, categories, channels, quarters, promotions, daily, dailyRange, jolt, joltQuality, guestSat, soci, loading, refreshedAt } = data
  const k = kpis as KpiData | null
  const isAll      = state.store === 'all'
  const isCustom   = state.period === 'custom'
  const showQuarters = state.period === 'quarterly' || state.period === 'ytd'

  // Build per-metric daily sparklines aligned Sun→Sat by day-of-week
  const DOW_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  // Per-metric daily series, aligned Sun->Sat by day-of-week. A day with no row
  // stays null: the chart leaves an empty slot rather than drawing through it,
  // because a closed Sunday is not a zero-sales Sunday.
  function buildSpark(metric: keyof DailyRow): Series | undefined {
    if (!daily) return undefined
    const byDay = (rows: DailyRow[]) => {
      const map = new Map(rows.map(r => [r.day, r]))
      return DOW_ORDER.map(d => map.get(d) ?? null)
    }
    const ty = byDay(daily.thisWeek)
    const py = byDay(daily.lastYear)
    return {
      labels: DOW_ORDER,
      ty: DOW_ORDER.map((_, i) => (ty[i] ? (ty[i]![metric] as number | null) : null)),
      py: DOW_ORDER.map((_, i) => (py[i] ? (py[i]![metric] as number | null) : null)),
    }
  }
  const spark = (m: keyof DailyRow) => (isCustom ? undefined : buildSpark(m))

  // Which KPI's trend is open. Nothing is open by default — a chart is the answer
  // to a question the reader asked, not the thing that greets them.
  const [openMetric, setOpenMetric] = useState<string | null>(null)

  const money = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)
  const pctAxis = (v: number) => `${(v * 100).toFixed(1)}%`

  // Every figure, delta and tone below is the one the old KPI cards carried. The
  // dot and the pill said the same thing twice; the kit says it once, on the delta.
  const METRICS: Metric[] = k ? [
    {
      key: 'sales', label: 'Sales', value: dol(k.sales),
      delta: k.salesPY ? signed(pillVsPY(k.sales, k.salesPY)) : undefined,
      tone: k.salesPY ? toneOf(k.sales >= k.salesPY * (1 + TARGETS.salesGrowthYoY) ? 'green' : k.sales >= k.salesPY ? 'yellow' : 'red') : undefined,
      sub: k.salesTarget ? `${k.sales >= k.salesTarget ? '✓' : '▼'} 10% tgt` : undefined,
      series: spark('sales'), fmt: money,
    },
    {
      key: 'orders', label: 'Orders', value: k.orders.toLocaleString(),
      delta: k.ordersPY ? signed(pillVsPY(k.orders, k.ordersPY)) : undefined,
      tone: k.ordersPY ? toneOf(k.orders >= k.ordersPY ? 'green' : 'red') : undefined,
      series: spark('orders'), fmt: v => Math.round(v).toLocaleString(),
    },
    {
      key: 'labor', label: 'Labor %', target: `tgt ${pct(TARGETS.laborPct)}`, value: pct(k.laborPct),
      delta: `${k.laborPct <= TARGETS.laborPct ? '-' : '+'}${Math.abs((k.laborPct - TARGETS.laborPct) * 100).toFixed(1)}pts vs tgt`,
      tone: toneOf(dot(k.laborPct, TARGETS.laborPct, true)),
      sub: `L4W: ${pct(k.laborPctL4W)}`,
      series: spark('laborPct'), fmt: pctAxis,
    },
    {
      key: 'cogs', label: 'COGS %', target: `tgt ${pct(TARGETS.cogsPct)}`,
      value: k.cogsActualPct != null ? pct(k.cogsActualPct) : '—',
      delta: k.cogsActualPct != null
        ? `${k.cogsActualPct <= TARGETS.cogsPct ? '-' : '+'}${Math.abs((k.cogsActualPct - TARGETS.cogsPct) * 100).toFixed(1)}pts vs tgt`
        : undefined,
      tone: k.cogsActualPct != null ? toneOf(dot(k.cogsActualPct, TARGETS.cogsPct, true)) : undefined,
      sub: k.cogsActualAsOf ? `as of ${asOf(k.cogsActualAsOf)}` : undefined,
    },
    {
      key: 'atv', label: 'ATV', value: `$${k.atv.toFixed(2)}`,
      delta: k.atvL4W ? `${k.atv >= k.atvL4W ? '+' : '-'}$${Math.abs(k.atv - k.atvL4W).toFixed(2)} vs L4W` : undefined,
      tone: k.atvL4W ? toneOf(k.atv >= k.atvL4W ? 'green' : 'yellow') : undefined,
      series: spark('atv'), fmt: v => `$${v.toFixed(2)}`,
    },
    {
      key: 'ee', label: 'EE %', target: `tgt ${pct(TARGETS.eePct)}`, value: pct(k.eePct),
      delta: `${k.eePct >= TARGETS.eePct ? '+' : '-'}${Math.abs((k.eePct - TARGETS.eePct) * 100).toFixed(1)}pts vs tgt`,
      tone: toneOf(dot(k.eePct, TARGETS.eePct)),
      sub: k.eeInStorePct > 0 || k.eeDigitalPct > 0 ? `In-store ${pct(k.eeInStorePct, 0)} · Digital ${pct(k.eeDigitalPct, 0)}` : undefined,
      series: spark('eePct'), fmt: pctAxis,
    },
  ] : []

  const openTrend = METRICS.find(m => m.key === openMetric && m.series)

  return (
    <Page>
      <OverviewBar
        store={state.store}
        period={state.period}
        dates={state.dates}
        onStore={setStore}
        onPeriod={setPeriod}
        onCustomRange={setCustomRange}
        refreshedAt={refreshedAt}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshMsg={refreshMsg}
      />

        {/* Forecast banner — period in progress */}
        {k && !k.periodComplete && k.salesForecast !== null && (
          <ForecastBanner kpis={k} period={state.period} />
        )}

        {data.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            Could not reach database. Make sure the proxy is running on port 5001.
            <br /><span className="text-xs opacity-70">{data.error}</span>
          </div>
        )}

        {/* KPI row — six tiles; selecting one opens its trend in place below. */}
        <Kpis>
          {METRICS.map(m => (
            <KpiTile key={m.key} m={m} selected={openMetric === m.key} onSelect={() => setOpenMetric(openMetric === m.key ? null : m.key)} />
          ))}
        </Kpis>
        {openTrend && <MetricTrend m={openTrend} onClose={() => setOpenMetric(null)} />}

        {/* Supply spend beside ops health — the kit's narrow/wide pair. */}
        <div className="sk-row4">
          <SupplySpend kpis={k} loading={loading} />
          <OpsHealth kpis={k} soci={soci} guest={guestSat} loading={loading} />
        </div>

        {/* Daily Table — custom period only */}
        {isCustom && (
          <DailyTable data={dailyRange} loading={loading} />
        )}

        {/* Store breakdown beside the callouts, as the kit pairs them. There is no
            separate trend panel here any more: selecting a KPI tile opens the trend
            for THAT metric, so a second chart restating one of them is redundant. */}
        {!isCustom && (
          <div className="sk-grid11">
            {isAll
              ? <StoreBreakdown stores={stores} kpis={k} period={state.period} loading={loading} />
              : <div />}
            <Callouts kpis={k} loading={loading} period={state.period} promotions={promotions} />
          </div>
        )}

        {/* Channel / category / product mix — the kit's 1:1:2 row. */}
        {!isCustom && <MixRow channels={channels} products={products} categories={categories} loading={loading} />}

        {/* Jolt — completion and photo quality in one table, as the kit has it.
            They were two panels, so answering "was it submitted AND done right?"
            for one store meant scrolling between them. */}
        <JoltPanel jolt={jolt} quality={joltQuality} />

        {/* Quarter table (quarterly + YTD tabs) */}
        {showQuarters && (
          <QuarterTable quarters={quarters} loading={loading} />
        )}

        {/* Moved OFF this screen, deliberately:
              - Food cost (COGS) panel: not in the kit at all. Food cost lives in
                the COGS KPI tile and in supply spend, and the panel restated both.
              - Staff schedule + employee pay table: the kit puts labour on
                Labor & crew, and both answer "who worked, when, and what did it
                cost" — which is what that page is already about. See /employees. */}


    </Page>
  )
}
