'use client'

import { useState, useEffect, useRef } from 'react'
import { useDashboard } from './useDashboard'
import Header       from './Header'
import KpiCard, { type SparkPoint } from './KpiCard'
import ForecastBanner from './ForecastBanner'
import TrendChart   from './TrendChart'
import StoreBreakdown from './StoreBreakdown'
import OpsHealth    from './OpsHealth'
import Callouts     from './Callouts'
import QuarterTable from './QuarterTable'
import Heatmap      from './Heatmap'
import EmployeeTable from './EmployeeTable'
import BottomRow    from './BottomRow'
import DailyTable   from './DailyTable'
import { TARGETS }  from '@/lib/config'
import type { KpiData, DailyRow } from '@/lib/types'

function pct(n: number, decimals = 1)  { return `${(n * 100).toFixed(decimals)}%` }
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
  const { kpis, trend, stores, employees, products, categories, channels, quarters, staffing, unitsWindow, daily, dailyRange, loading, refreshedAt } = data
  const k = kpis as KpiData | null
  const isAll      = state.store === 'all'
  const isCustom   = state.period === 'custom'
  const showQuarters = state.period === 'quarterly' || state.period === 'ytd'

  // Build per-metric daily sparklines aligned Sun→Sat by day-of-week
  const DOW_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  function buildSpark(metric: keyof DailyRow): SparkPoint[] {
    if (!daily) return []
    const byDay = (rows: DailyRow[]) => {
      const map = new Map(rows.map(r => [r.day, r]))
      return DOW_ORDER.map(d => map.get(d) ?? null)
    }
    const ty = byDay(daily.thisWeek)
    const py = byDay(daily.lastYear)
    return DOW_ORDER.map((day, i) => ({
      day,
      v:  ty[i] ? (ty[i]![metric] as number | null) : null,
      py: py[i] ? (py[i]![metric] as number | null) : null,
    }))
  }
  const salesSpark    = isCustom ? [] : buildSpark('sales')
  const ordersSpark   = isCustom ? [] : buildSpark('orders')
  const eeSpark       = isCustom ? [] : buildSpark('eePct')
  const atvSpark      = isCustom ? [] : buildSpark('atv')
  const laborSpark    = isCustom ? [] : buildSpark('laborPct')
  const voidSpark     = isCustom ? [] : buildSpark('voidPct')
  const discountSpark = isCustom ? [] : buildSpark('discountPct')

  return (
    <div>
      <Header
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

      <div className="max-w-screen-2xl mx-auto px-4 py-5 space-y-4">

        {/* Forecast banner — period in progress */}
        {k && !k.periodComplete && k.salesForecast !== null && (
          <ForecastBanner kpis={k} period={state.period} />
        )}

        {data.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            ⚠️ Could not reach database. Make sure the proxy is running on port 5001.
            <br /><span className="text-xs opacity-70">{data.error}</span>
          </div>
        )}

        {/* KPI Row 1 — Sales, Orders, Labor, COGS, ATV, EE */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard
            label="Sales"
            value={k ? dol(k.sales) : '—'}
            dot={k && k.salesPY ? (k.sales >= k.salesPY * (1 + TARGETS.salesGrowthYoY) ? 'green' : k.sales >= k.salesPY ? 'yellow' : 'red') : 'none'}
            pill={k && k.salesPY ? pillVsPY(k.sales, k.salesPY) : undefined}
            pill2={k && k.salesTarget ? { text: `${k.sales >= k.salesTarget ? '✓' : '▼'} 10% tgt`, color: k.sales >= k.salesTarget ? 'green' : 'red' } : undefined}
            spark={salesSpark}
            sparkFmt="$"
            loading={loading}
          />
          <KpiCard
            label="Orders"
            value={k ? k.orders.toLocaleString() : '—'}
            dot={k && k.ordersPY ? (k.orders >= k.ordersPY ? 'green' : 'red') : 'none'}
            pill={k && k.ordersPY ? pillVsPY(k.orders, k.ordersPY) : undefined}
            spark={ordersSpark}
            sparkFmt="count"
            loading={loading}
          />
          <KpiCard
            label="Labor %"
            target={`tgt ${pct(TARGETS.laborPct)}`}
            value={k ? pct(k.laborPct) : '—'}
            dot={k ? dot(k.laborPct, TARGETS.laborPct, true) : 'none'}
            pill={k ? { text: `${k.laborPct <= TARGETS.laborPct ? '▼' : '▲'}${Math.abs((k.laborPct - TARGETS.laborPct) * 100).toFixed(1)}pts vs tgt`, color: k.laborPct <= TARGETS.laborPct ? 'green' : 'red' } : undefined}
            sub={k ? `L4W: ${pct(k.laborPctL4W)}` : undefined}
            tooltip={k && (k.laborCost > 0 || k.laborHours > 0) ? [k.laborCost > 0 ? `$${Math.round(k.laborCost).toLocaleString()}` : null, k.laborHours > 0 ? `${Math.round(k.laborHours)} hrs` : null].filter(Boolean).join(' · ') : undefined}
            spark={laborSpark}
            sparkFmt="%"
            loading={loading}
          />
          <KpiCard
            label="COGS % (Actual)"
            target={`tgt ${pct(TARGETS.cogsPct)}`}
            value={k?.cogsActualPct != null ? pct(k.cogsActualPct) : '—'}
            dot={k?.cogsActualPct != null ? dot(k.cogsActualPct, TARGETS.cogsPct, true) : 'none'}
            pill={k?.cogsActualPct != null
              ? { text: `${k.cogsActualPct <= TARGETS.cogsPct ? '▼' : '▲'}${Math.abs((k.cogsActualPct - TARGETS.cogsPct) * 100).toFixed(1)}pts vs tgt`, color: k.cogsActualPct <= TARGETS.cogsPct ? 'green' : 'red' }
              : undefined}
            sub={k?.cogsActualAsOf ? `as of ${k.cogsActualAsOf}` : undefined}
            loading={loading}
          />
          <KpiCard
            label="ATV"
            value={k ? `$${k.atv.toFixed(2)}` : '—'}
            dot={k && k.atvL4W ? (k.atv >= k.atvL4W ? 'green' : 'yellow') : 'none'}
            pill={k && k.atvL4W ? { text: `${k.atv >= k.atvL4W ? '▲' : '▼'}$${Math.abs(k.atv - k.atvL4W).toFixed(2)} vs L4W`, color: k.atv >= k.atvL4W ? 'green' : 'red' } : undefined}
            spark={atvSpark}
            sparkFmt="$2"
            loading={loading}
          />
          <KpiCard
            label="EE %"
            target={`tgt ${pct(TARGETS.eePct)}`}
            value={k ? pct(k.eePct) : '—'}
            dot={k ? dot(k.eePct, TARGETS.eePct) : 'none'}
            pill={k ? { text: `${k.eePct >= TARGETS.eePct ? '▲' : '▼'}${Math.abs((k.eePct - TARGETS.eePct) * 100).toFixed(1)}pts vs tgt`, color: k.eePct >= TARGETS.eePct ? 'green' : 'red' } : undefined}
            sub={k && (k.eeInStorePct > 0 || k.eeDigitalPct > 0) ? `In-store ${pct(k.eeInStorePct, 0)} · Digital ${pct(k.eeDigitalPct, 0)}` : undefined}
            spark={eeSpark}
            sparkFmt="%"
            loading={loading}
          />
        </div>

        {/* KPI Row 2 — Supply Spend + OpsHealth */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Supply Spend — PFS, Walmart, Amazon combined */}
          <div className="card">
            {loading ? <div className="skeleton h-20 w-full" /> : (
              <>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Supply Spend % of Sales</div>
                <div className="space-y-2">
                  {[
                    { label: 'PFS',     pct: k?.pfsPct,     l4w: k?.pfsPctL4W },
                    { label: 'Walmart', pct: k?.walmartPct, l4w: k?.walmartPctL4W },
                    { label: 'Amazon',  pct: null,          l4w: null },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-500 w-16">{row.label}</span>
                      <span className="text-sm font-bold text-slate-800 w-14 text-right">
                        {row.pct != null ? pct(row.pct) : <span className="text-slate-300">—</span>}
                      </span>
                      <span className="text-xs text-slate-400 w-20 text-right">
                        {row.l4w != null ? `L4W ${pct(row.l4w)}` : <span className="text-slate-200">no data</span>}
                      </span>
                    </div>
                  ))}
                  {/* Total supply spend */}
                  {k && (
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-1">
                      <span className="text-xs font-bold text-slate-600 w-16">Total</span>
                      <span className="text-sm font-bold text-slate-900 w-14 text-right">
                        {pct(k.pfsPct + k.walmartPct)}
                      </span>
                      <span className="text-xs text-slate-400 w-20 text-right">
                        {`L4W ${pct(k.pfsPctL4W + k.walmartPctL4W)}`}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="md:col-span-3">
            <OpsHealth kpis={k} loading={loading} />
          </div>
        </div>

        {/* Daily Table — custom period only */}
        {isCustom && (
          <DailyTable data={dailyRange} loading={loading} />
        )}

        {/* Store breakdown + Trend — hidden for custom */}
        {!isCustom && (
          <div className={`grid grid-cols-1 ${isAll ? 'md:grid-cols-3' : ''} gap-4`}>
            {isAll && (
              <StoreBreakdown stores={stores} kpis={k} period={state.period} loading={loading} />
            )}
            <div className={isAll ? 'md:col-span-2' : ''}>
              <TrendChart data={trend} loading={loading} isWeekly={state.period === 'weekly'} />
            </div>
          </div>
        )}

        {/* Quarter table (quarterly + YTD tabs) */}
        {showQuarters && (
          <QuarterTable quarters={quarters} loading={loading} />
        )}

        {/* Callouts + COGS panel — hidden for custom */}
        {!isCustom && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Callouts kpis={k} loading={loading} />
          <div className="card">
            <div className="flex items-center justify-between mb-0.5">
              <div className="text-sm font-bold text-slate-700">Food Cost (COGS)</div>
              {k?.cogsActualAsOf && (
                <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded px-1.5 py-0.5 font-medium">
                  last count: {k.cogsActualAsOf}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mb-4">Actual vs {pct(TARGETS.cogsPct)} target · theoretical via Sigma</div>
            {loading ? (
              <div className="skeleton h-32 w-full" />
            ) : k?.cogsActualPct != null ? (
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-xs text-slate-400">
                      Actual{k.cogsActualAsOf ? <span className="ml-1 text-amber-500">· thru {k.cogsActualAsOf}</span> : null}
                    </div>
                    <div className={`text-2xl font-bold ${k.cogsActualPct > TARGETS.cogsPct ? 'text-red-600' : 'text-emerald-600'}`}>
                      {pct(k.cogsActualPct)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Target</div>
                    <div className="text-2xl font-bold text-slate-600">{pct(TARGETS.cogsPct)}</div>
                    {k.cogsTheoreticalPct != null && (
                      <div className="text-[10px] text-slate-400">theo {pct(k.cogsTheoreticalPct)}</div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Variance vs target</span>
                    <span className={k.cogsActualPct <= TARGETS.cogsPct ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                      {k.cogsActualPct <= TARGETS.cogsPct ? '▼' : '▲'}{Math.abs((k.cogsActualPct - TARGETS.cogsPct) * 100).toFixed(1)}pts
                      {k.cogsActualPct <= TARGETS.cogsPct ? ' (favorable)' : ' (over target)'}
                    </span>
                  </div>
                  <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${k.cogsActualPct > TARGETS.cogsPct ? 'bg-red-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.min(100, (k.cogsActualPct / (TARGETS.cogsPct * 1.5)) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-300 mt-1">
                    <span>0%</span>
                    <span className="text-slate-400">{pct(TARGETS.cogsPct)} target</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                  <div>
                    <div className="text-xs text-slate-400">PFS Spend %</div>
                    <div className="text-base font-semibold text-slate-700">{pct(k.pfsPct)}</div>
                    <div className="text-xs text-slate-400">L4W {pct(k.pfsPctL4W)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Walmart %</div>
                    <div className="text-base font-semibold text-slate-700">{pct(k.walmartPct)}</div>
                    <div className="text-xs text-slate-400">L4W {pct(k.walmartPctL4W)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">No COGS data for this period</div>
            )}
          </div>
        </div>}

        {/* Staff Schedule — hidden for custom */}
        {!isCustom && <Heatmap data={staffing} store={state.store} period={state.period} dates={state.dates} unitsWindow={unitsWindow} loading={loading} />}

        {/* Employee Performance — hidden for custom */}
        {!isCustom && <EmployeeTable employees={employees} loading={loading} />}

        {/* Bottom row — hidden for custom */}
        {!isCustom && <BottomRow channels={channels} products={products} categories={categories} loading={loading} />}

      </div>
    </div>
  )
}
