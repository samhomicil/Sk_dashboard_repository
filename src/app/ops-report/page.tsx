'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

/* ---------- contract types ---------- */
interface WxDay { icon: string; temp: string; condition: string }
interface WeekDay { day: string; date: string; type: 'ACTUAL' | 'PROJ'; weather: WxDay }
interface StoreData {
  key: string; name: string; otbBase: number; otbDirect: number
  sp: number[]; sa: number[]; hp: number[]; ha: number[]; lc: number[]; lcp: number[]
}
interface Holiday { date: string; day: string; name: string }
interface OpsPayload {
  weekLabel: string; today: string; cogsTarget: number; laborTarget: number; laborAmber: number
  holidays: Holiday[]; week: WeekDay[]; stores: StoreData[]; warnings: string[]
}

/* ---------- formatting ---------- */
const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const sMoney = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US')
const sPct = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1) + '%'
const sHrs = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1)
// green = good. overIsBad flips the sense (hours/labor over plan is bad).
const varClass = (n: number, overIsBad = false) =>
  Math.abs(n) < 1e-9 ? 'text-slate-400' : (overIsBad ? (n > 0 ? 'text-rose-600' : 'text-emerald-600') : (n < 0 ? 'text-rose-600' : 'text-emerald-600'))

/* ---------- derive (mirrors the report contract math) ---------- */
interface Day {
  day: string; type: 'ACTUAL' | 'PROJ'; weather: WxDay
  salesPlan: number; salesActual: number; hoursPlan: number; hoursActual: number
  laborCost: number; laborCostPlan: number
  salesVar: number; hoursVar: number; laborPctAct: number; laborPctPlan: number; anomaly: boolean
}
function makeDay(wk: WeekDay, sPlan: number, sAct: number, hPlan: number, hAct: number, lc: number, lcp: number): Day {
  const temp = parseInt(wk.weather.temp, 10)
  return {
    day: wk.day, type: wk.type, weather: wk.weather,
    salesPlan: sPlan, salesActual: sAct, hoursPlan: hPlan, hoursActual: hAct,
    laborCost: lc, laborCostPlan: lcp,
    salesVar: sAct - sPlan, hoursVar: hAct - hPlan,
    laborPctAct: sAct ? (lc / sAct) * 100 : 0,
    laborPctPlan: sPlan ? (lcp / sPlan) * 100 : 0,
    anomaly: (Number.isFinite(temp) && temp > 85) || /rain/i.test(wk.weather.condition),
  }
}

interface View { name: string; otbBase: number; otbDirect: number; days: Day[] }

// Insight wording mirrors the daily recap email (daily-recap/recap.py): labor is
// judged against the 22% target, PROJ overages dollarized as (est% − target) ×
// forecast and framed "trimmable before doors open"; actuals as "+N pts vs target".
function actionFor(d: Day, targetPct: number, amberPct: number): string {
  const est = d.laborPctAct
  if (d.type === 'PROJ') {
    if (est > targetPct + 0.5 && d.salesActual > 0) {
      const over = (est / 100 - targetPct / 100) * d.salesActual
      return `Est ${est.toFixed(0)}% labor — trim ~${money(over)} before doors open`
    }
    if (/rain/i.test(d.weather.condition)) return 'Rain in forecast — watch AM traffic'
    if (parseInt(d.weather.temp, 10) > 85) return 'Heat spike — protect peak, hold off-peak'
    return est > 0 ? `Est ${est.toFixed(0)}% labor — on target` : 'Normal schedule — no change'
  }
  // closed day
  if (est > amberPct) return `Labor ${est.toFixed(0)}% — +${(est - targetPct).toFixed(0)} pts vs ${targetPct.toFixed(0)}% target`
  if (est > targetPct) return `Labor ${est.toFixed(0)}% — slightly over ${targetPct.toFixed(0)}% target`
  return `Labor ${est.toFixed(0)}% — on target`
}
// Labor-% cell color: green ≤ target, amber ≤ target+3pts, red above (daily recap band).
function laborPctColor(pctAct: number, targetPct: number, amberPct: number): string {
  if (pctAct <= targetPct) return 'text-emerald-600'
  if (pctAct <= amberPct) return 'text-amber-700'
  return 'text-rose-600'
}

function buildViews(data: OpsPayload): Record<string, View> {
  const views: Record<string, View> = {}
  for (const s of data.stores) {
    views[s.key] = {
      name: s.name, otbBase: s.otbBase, otbDirect: s.otbDirect,
      days: data.week.map((wk, i) => makeDay(wk, s.sp[i], s.sa[i], s.hp[i], s.ha[i], s.lc[i], s.lcp[i])),
    }
  }
  views.all = {
    name: 'All stores',
    otbBase: data.stores.reduce((a, s) => a + s.otbBase, 0),
    otbDirect: data.stores.reduce((a, s) => a + s.otbDirect, 0),
    days: data.week.map((wk, i) => {
      let sp = 0, sa = 0, hp = 0, ha = 0, lc = 0, lcp = 0
      for (const s of data.stores) {
        sp += s.sp[i]; sa += s.sa[i]; hp += s.hp[i]; ha += s.ha[i]; lc += s.lc[i]; lcp += s.lcp[i]
      }
      return makeDay(wk, sp, sa, hp, ha, lc, lcp)
    }),
  }
  return views
}

/* ---------- small UI atoms ---------- */
function Stat({ lab, val, sub, delta, tone }: { lab: string; val: string; sub?: string; delta: string; tone: 'pos' | 'neg' | 'warn' | 'neutral' }) {
  const toneCls = {
    pos: 'bg-emerald-50 text-emerald-700', neg: 'bg-rose-50 text-rose-600',
    warn: 'bg-amber-50 text-amber-700', neutral: 'bg-slate-100 text-slate-500',
  }[tone]
  return (
    <div className="card">
      <p className="text-[10.5px] uppercase tracking-wide text-slate-400 mb-2">{lab}</p>
      <p className="text-xl font-bold text-slate-800 tabular-nums leading-none">
        {val}{sub && <span className="text-[12.5px] font-normal text-slate-400 ml-1">{sub}</span>}
      </p>
      <div className="mt-2.5">
        <span className={`inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-0.5 rounded-full ${toneCls}`}>{delta}</span>
      </div>
    </div>
  )
}

/* ---------- page ---------- */
const STORE_ORDER = ['all', 'pines', 'miramar', 'margate']
const STORE_LABEL: Record<string, string> = { all: 'All', pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }

export default function OpsReportPage() {
  const [data, setData] = useState<OpsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState('all')

  useEffect(() => {
    fetch('/api/ops-week').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const views = useMemo(() => (data ? buildViews(data) : null), [data])
  const v = views?.[store]

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 lg:px-10 w-full max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
            Dashboard
          </Link>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">Weekly Operations Report</h1>
            {data && <p className="text-xs text-slate-400 mt-0.5">{v?.name === 'All stores' ? 'All stores' : v?.name} · {data.weekLabel} · mid-week snapshot (actual → today · forecast rest)</p>}
          </div>
        </div>
        {data && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {STORE_ORDER.map(k => (
              <button key={k} onClick={() => setStore(k)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${store === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {STORE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>)}</div>
      ) : !data || !v ? (
        <div className="card text-center text-slate-400 py-12">No ops data available — check the DB proxy / Azure connection.</div>
      ) : (
        <ReportBody data={data} v={v} />
      )}
    </div>
  )
}

function ReportBody({ data, v }: { data: OpsPayload; v: View }) {
  const days = v.days

  // Totals
  const T = days.reduce((a, d) => ({
    splan: a.splan + d.salesPlan, sact: a.sact + d.salesActual, hplan: a.hplan + d.hoursPlan,
    hact: a.hact + d.hoursActual, lcost: a.lcost + d.laborCost, lcostPlan: a.lcostPlan + d.laborCostPlan,
  }), { splan: 0, sact: 0, hplan: 0, hact: 0, lcost: 0, lcostPlan: 0 })
  const tSalesVar = T.sact - T.splan, tHrsVar = T.hact - T.hplan
  const tPctPlan = T.splan ? (T.lcostPlan / T.splan) * 100 : 0
  const tPctAct = T.sact ? (T.lcost / T.sact) * 100 : 0

  // Week-to-date (actual days only)
  const mw = days.filter(d => d.type === 'ACTUAL').reduce((a, d) => ({
    splan: a.splan + d.salesPlan, sact: a.sact + d.salesActual, lcost: a.lcost + d.laborCost, lcostPlan: a.lcostPlan + d.laborCostPlan,
  }), { splan: 0, sact: 0, lcost: 0, lcostPlan: 0 })
  const mwSalesVar = mw.sact - mw.splan, mwSalesPct = mw.splan ? (mwSalesVar / mw.splan) * 100 : 0
  const mwLaborVar = mw.lcost - mw.lcostPlan, mwLaborPct = mw.lcostPlan ? (mwLaborVar / mw.lcostPlan) * 100 : 0
  const paceAct = mw.sact ? (mw.lcost / mw.sact) * 100 : 0
  const paceTarget = mw.splan ? (mw.lcostPlan / mw.splan) * 100 : 0
  const paceDrift = paceAct - paceTarget

  // Thursday order — two-sided OTB
  const earlyShortfall = mw.splan - mw.sact
  const weekendUplift = days.filter(d => d.day === 'Fri' || d.day === 'Sat').reduce((s, d) => s + d.salesVar, 0)
  const trim = Math.max(earlyShortfall, 0) * data.cogsTarget
  const add = Math.max(weekendUplift, 0) * data.cogsTarget
  const cap = Math.round(v.otbBase - trim + add)
  const net = cap - v.otbBase
  const bandLow = Math.round(cap * 0.96)

  // Share of the store's produce need met by transfers rather than a direct order.
  const transferPct = v.otbBase > 0 ? Math.max(0, 100 * (1 - v.otbDirect / v.otbBase)) : 0

  const targetPct = data.laborTarget * 100
  const amberPct = (data.laborTarget + data.laborAmber) * 100

  // Biggest upcoming labor-trim opportunity — same "today's focus" logic/framing
  // as the daily recap: worst PROJ-day est-labor overage, dollarized on forecast.
  const focus = days
    .filter(d => d.type === 'PROJ' && d.salesActual > 0 && d.laborPctAct > targetPct + 0.5)
    .map(d => ({ day: d.day, est: d.laborPctAct, over: (d.laborPctAct / 100 - data.laborTarget) * d.salesActual }))
    .sort((a, b) => b.over - a.over)[0]

  const hotDays = days.filter(d => parseInt(d.weather.temp, 10) > 85).map(d => d.day)
  const rainDays = days.filter(d => /rain/i.test(d.weather.condition)).map(d => d.day)

  return (
    <div className="space-y-6">
      {data.warnings?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          {data.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* Summary KPIs */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-3">Summary · week to date</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat lab="Sales · to date" val={money(mw.sact)} sub={`/ ${money(mw.splan)}`}
            delta={`${sMoney(mwSalesVar)} · ${sPct(mwSalesPct)}`} tone={Math.abs(mwSalesVar) < 1 ? 'neutral' : mwSalesVar < 0 ? 'neg' : 'pos'} />
          <Stat lab="Labor cost · to date" val={money(mw.lcost)} sub={`/ ${money(mw.lcostPlan)}`}
            delta={`${sMoney(mwLaborVar)} · ${sPct(mwLaborPct)}`} tone={Math.abs(mwLaborVar) < 1 ? 'neutral' : mwLaborVar > 0 ? 'neg' : 'pos'} />
          <Stat lab="Labor % pacing" val={`${paceAct.toFixed(1)}%`} sub={`vs ${paceTarget.toFixed(1)}%`}
            delta={`${sPct(paceDrift)} pts`} tone={paceDrift > 0.05 ? 'warn' : paceDrift < -0.05 ? 'pos' : 'neutral'} />
          <Stat lab="Thursday order" val={money(cap)} sub={`typ. ${money(v.otbBase)}`}
            delta={`${net < 0 ? 'trim ' : net > 0 ? 'add ' : ''}${money(Math.abs(net))}`} tone={net < 0 ? 'warn' : net > 0 ? 'pos' : 'neutral'} />
        </div>
      </div>

      {/* Weekly detail table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">Weekly detail</p>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-800" />actual
            <span className="inline-block w-1.5 h-1.5 rounded-full border border-slate-400 ml-2" />forecast
          </span>
        </div>
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead>
                <tr className="text-slate-400">
                  <th rowSpan={2} className="text-left font-medium px-4 py-2.5">Day</th>
                  <th rowSpan={2} className="text-left font-medium px-3 py-2.5">Weather</th>
                  <th colSpan={3} className="text-center font-semibold text-teal-700 uppercase text-[10.5px] tracking-wide border-l border-slate-100 pt-2.5 pb-1">Sales</th>
                  <th colSpan={3} className="text-center font-semibold text-teal-700 uppercase text-[10.5px] tracking-wide border-l border-slate-100 pt-2.5 pb-1">Labor hours</th>
                  <th colSpan={2} className="text-center font-semibold text-teal-700 uppercase text-[10.5px] tracking-wide border-l border-slate-100 pt-2.5 pb-1">Labor %</th>
                  <th rowSpan={2} className="text-left font-medium px-3 py-2.5 border-l border-slate-100">Action</th>
                </tr>
                <tr className="text-slate-300 uppercase text-[10px]">
                  <th className="text-right font-medium px-3 pb-2 border-l border-slate-100">Plan</th><th className="text-right font-medium px-3 pb-2">Actual</th><th className="text-right font-medium px-3 pb-2">Var</th>
                  <th className="text-right font-medium px-3 pb-2 border-l border-slate-100">Plan</th><th className="text-right font-medium px-3 pb-2">Actual</th><th className="text-right font-medium px-3 pb-2">Var</th>
                  <th className="text-right font-medium px-3 pb-2 border-l border-slate-100">Tgt</th><th className="text-right font-medium px-3 pb-2">Act</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${d.type === 'PROJ' ? 'bg-slate-50/60' : ''}`}>
                    <td className="px-4 py-2 font-semibold text-slate-700">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${d.type === 'ACTUAL' ? 'bg-slate-800' : 'border border-slate-400'}`} />{d.day}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 ${d.anomaly ? 'text-amber-700' : 'text-slate-500'}`}>
                        <span className="text-[15px]">{d.weather.icon}</span>
                        <span className="font-semibold">{d.weather.temp}</span>
                        <span>{d.weather.condition}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 border-l border-slate-100">{money(d.salesPlan)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(d.salesActual)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${varClass(d.salesVar)}`}>{sMoney(d.salesVar)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 border-l border-slate-100">{d.hoursPlan.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{d.hoursActual.toFixed(1)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${varClass(d.hoursVar, true)}`}>{sHrs(d.hoursVar)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400 border-l border-slate-100">{d.laborPctPlan.toFixed(1)}%</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${laborPctColor(d.laborPctAct, targetPct, amberPct)}`}>{d.laborPctAct.toFixed(1)}%</td>
                    <td className={`px-3 py-2 border-l border-slate-100 ${d.anomaly ? 'text-amber-700' : 'text-slate-500'}`}>{actionFor(d, targetPct, amberPct)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-teal-50/60 font-bold text-slate-800">
                  <td className="px-4 py-2.5">TOTAL</td><td className="px-3 py-2.5 text-slate-300">—</td>
                  <td className="px-3 py-2.5 text-right tabular-nums border-l border-slate-100">{money(T.splan)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(T.sact)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${varClass(tSalesVar)}`}>{sMoney(tSalesVar)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums border-l border-slate-100">{T.hplan.toFixed(1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{T.hact.toFixed(1)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${varClass(tHrsVar, true)}`}>{sHrs(tHrsVar)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums border-l border-slate-100">{tPctPlan.toFixed(1)}%</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${laborPctColor(tPctAct, targetPct, amberPct)}`}>{tPctAct.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-slate-500 border-l border-slate-100">Full-week plan vs projected</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-3">Notes &amp; actions</p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="text-sm font-bold text-slate-700 mb-2.5">📊 Week in brief</h3>
            <p className="text-[12.5px] text-slate-500 leading-relaxed">
              Labor is pacing <b className={laborPctColor(paceAct, targetPct, amberPct)}>{paceAct.toFixed(1)}%</b> vs the {targetPct.toFixed(0)}% target
              {' '}({paceDrift > 0 ? '+' : ''}{paceDrift.toFixed(1)} pts, {sMoney(mwLaborVar)} week-to-date); sales are running <b className={mwSalesVar < 0 ? 'text-rose-600' : 'text-emerald-600'}>{sMoney(mwSalesVar)}</b> {mwSalesVar < 0 ? 'under' : 'over'} the staffing-implied plan.
              {focus
                ? <> Biggest lever ahead: <b>{focus.day}</b>&rsquo;s schedule runs an estimated <b>{focus.est.toFixed(0)}%</b> labor — about <b>{money(focus.over)}</b> over the {targetPct.toFixed(0)}% target, trimmable before doors open.</>
                : <> No upcoming day is projected over the {targetPct.toFixed(0)}% labor target — hold the schedule.</>}
              {hotDays.length > 0 && <> Heat ({hotDays.join(', ')}) lifts weekend demand — protect peak, hold off-peak.</>}
              {rainDays.length > 0 && <> Rain in the forecast on {rainDays.join(', ')} — watch AM traffic.</>}
              {data.holidays.length > 0 && <> {data.holidays.map(h => `${h.name} (${h.day})`).join(', ')} — forecast is holiday-adjusted from last year, same as the daily recap.</>}
            </p>
          </div>
          <div className="card border-l-[3px] border-l-teal-500">
            <h3 className="text-sm font-bold text-slate-700 mb-2.5">🛒 Thursday order</h3>
            <p className="text-[13.5px] font-semibold text-slate-700 mb-3 leading-snug">Cap Thursday&apos;s order near <b className="text-teal-700">{money(cap)}</b> — lock it before the 2 pm cutoff.</p>
            <div className="flex justify-between text-[12.5px] py-1.5 border-b border-slate-100"><span className="text-slate-500">Trim · early-week produce</span><span className="font-semibold text-rose-600">−{money(trim)}</span></div>
            <div className="flex justify-between text-[12.5px] py-1.5 border-b border-slate-100"><span className="text-slate-500">Add · weekend heat</span><span className="font-semibold text-emerald-600">+{money(add)}</span></div>
            <div className="flex justify-between text-[12.5px] py-1.5"><span className="text-slate-500">Cap vs typical</span><span className={`font-semibold ${net < 0 ? 'text-amber-700' : net > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>{sMoney(net)} vs {money(v.otbBase)}</span></div>
            {transferPct >= 15 && (
              <div className="mt-2 rounded-md bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-800 leading-snug">
                ~{Math.round(transferPct)}% of this need is met by <b>transfers</b>, not a direct order ({money(v.otbDirect)}/wk bought direct). The order/transfer split is decided on the <b>All</b> view.
              </div>
            )}
            <p className="mt-2.5 text-[11px] text-slate-400 leading-relaxed">
              Base = system PFG + Walmart weekly spend allocated by each store&apos;s sales share, so transfers don&apos;t distort a single store. Trim from slow produce (greens, non-berry fruit); protect berries and cups for Saturday. Safe band {money(bandLow)}–{money(v.otbBase)}.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between flex-wrap gap-2 text-[11.5px] text-slate-400 pt-2 border-t border-slate-200">
        <span>Same method as the daily recap: est. labor = scheduled cost ÷ forecast · {targetPct.toFixed(0)}% target / {amberPct.toFixed(0)}% amber · holiday-adjusted forecast · OTB at {(data.cogsTarget * 100).toFixed(0)}% COGS</span>
        <span>Live sales, schedule, labor &amp; purchasing feeds · weather via Open-Meteo</span>
      </div>
    </div>
  )
}
