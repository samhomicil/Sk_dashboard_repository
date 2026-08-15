/**
 * WEEKLY OPS — derivation.
 *
 * Lifted VERBATIM out of the old page.tsx during the redesign, so the rebuild
 * could not quietly move a number. Every formula, rounding and threshold here is
 * the one that was already shipping; the redesign changed the markup around it and
 * nothing in this file's arithmetic.
 *
 * Thresholds arrive in the payload (`laborTarget`, `laborAmber`, per-store
 * `cogsTarget`) — /api/ops-week reads them from src/lib/core/targets.ts. Nothing
 * here decides what good looks like.
 */

/* ---------- contract types ---------- */
export interface WxDay { temp: string; condition: string }
export interface WeekDay { day: string; date: string; type: 'ACTUAL' | 'PROJ'; weather: WxDay }
export interface OrderSplit { day: string; covers: string; target: number }
export interface StoreData {
  key: string; name: string; otbBase: number; otbDirect: number; cogsRate: number; cogsTarget: number; orders: OrderSplit[]
  sp: number[]; sa: number[]; py: number[]; hp: number[]; ha: number[]; lc: number[]; lcp: number[]
}
export interface Holiday { date: string; day: string; name: string }
export interface OpsPayload {
  weekMode?: 'this' | 'next'
  weekLabel: string; today: string; cogsTarget: number; cogsWeeks?: number; laborTarget: number; laborAmber: number
  // The window the COGS rate was actually measured over. A rate shown without its dates
  // is how a 14-day-old figure got read as current.
  cogsWindow?: { start: string; end: string; days: number; grain: string; unpriced: number } | null
  holidays: Holiday[]; week: WeekDay[]; stores: StoreData[]; warnings: string[]
}

/* ---------- formatting ---------- */
export const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
export const sMoney = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US')
export const sPct = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1) + '%'
export const sHrs = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1)

/** 'Aug 3' from an ISO date — COGS windows are shown inline, so keep it short. */
export function shortDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/* ---------- day model ---------- */
export interface Day {
  day: string; type: 'ACTUAL' | 'PROJ'; weather: WxDay
  salesPlan: number; salesActual: number; salesPY: number; hoursPlan: number; hoursActual: number
  laborCost: number; laborCostPlan: number
  salesVar: number; hoursVar: number; yoyPct: number; laborPctAct: number; laborPctPlan: number; anomaly: boolean
}

function makeDay(wk: WeekDay, sPlan: number, sAct: number, sPY: number, hPlan: number, hAct: number, lc: number, lcp: number): Day {
  const temp = parseInt(wk.weather.temp, 10)
  return {
    day: wk.day, type: wk.type, weather: wk.weather,
    salesPlan: sPlan, salesActual: sAct, salesPY: sPY, hoursPlan: hPlan, hoursActual: hAct,
    laborCost: lc, laborCostPlan: lcp,
    salesVar: sAct - sPlan, hoursVar: hAct - hPlan,
    yoyPct: sPY ? ((sAct - sPY) / sPY) * 100 : 0,
    laborPctAct: sAct ? (lc / sAct) * 100 : 0,
    laborPctPlan: sPlan ? (lcp / sPlan) * 100 : 0,
    anomaly: (Number.isFinite(temp) && temp > 85) || /rain/i.test(wk.weather.condition),
  }
}

export interface View { name: string; otbBase: number; otbDirect: number; cogsRate: number; cogsTarget: number; orders: OrderSplit[]; days: Day[] }

/**
 * Merge per-store order splits into one cycle view (All): same delivery day →
 * summed target. Keeps encounter order (Tue then Fri) and blends the coverage label.
 */
function mergeOrders(stores: StoreData[]): OrderSplit[] {
  const by = new Map<string, OrderSplit>()
  for (const s of stores) for (const o of s.orders) {
    const cur = by.get(o.day)
    if (cur) cur.target += o.target
    else by.set(o.day, { ...o })
  }
  return [...by.values()]
}

export function buildViews(data: OpsPayload): Record<string, View> {
  const views: Record<string, View> = {}
  for (const s of data.stores) {
    views[s.key] = {
      name: s.name, otbBase: s.otbBase, otbDirect: s.otbDirect, cogsRate: s.cogsRate, cogsTarget: s.cogsTarget, orders: s.orders,
      days: data.week.map((wk, i) => makeDay(wk, s.sp[i], s.sa[i], s.py[i], s.hp[i], s.ha[i], s.lc[i], s.lcp[i])),
    }
  }
  const wsum = data.stores.reduce((a, s) => a + s.sa.reduce((x, y) => x + y, 0), 0)
  views.all = {
    name: 'All stores',
    otbBase: data.stores.reduce((a, s) => a + s.otbBase, 0),
    otbDirect: data.stores.reduce((a, s) => a + s.otbDirect, 0),
    cogsRate: wsum > 0 ? data.stores.reduce((a, s) => a + s.cogsRate * s.sa.reduce((x, y) => x + y, 0), 0) / wsum : 0,
    cogsTarget: wsum > 0 ? data.stores.reduce((a, s) => a + s.cogsTarget * s.sa.reduce((x, y) => x + y, 0), 0) / wsum : data.cogsTarget,
    orders: mergeOrders(data.stores),
    days: data.week.map((wk, i) => {
      let sp = 0, sa = 0, py = 0, hp = 0, ha = 0, lc = 0, lcp = 0
      for (const s of data.stores) {
        sp += s.sp[i]; sa += s.sa[i]; py += s.py[i]; hp += s.hp[i]; ha += s.ha[i]; lc += s.lc[i]; lcp += s.lcp[i]
      }
      return makeDay(wk, sp, sa, py, hp, ha, lc, lcp)
    }),
  }
  return views
}

/**
 * Insight wording mirrors the daily recap email (daily-recap/recap.py): labor is
 * judged against the 22% target, PROJ overages dollarized as (est% − target) ×
 * forecast and framed "trimmable before doors open"; actuals as "+N pts vs target".
 */
export function actionFor(d: Day, targetPct: number, amberPct: number): string {
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

/**
 * Bullet-bar band on the cost panel: good ≤ target, warn within 2 points of it,
 * bad beyond. Verbatim from the old page's Bullet component, and the same band the
 * reference kit's bullet() uses. Distinct from laborTone below, which grades a
 * labor % against the payload's amber band — two different panels, two bands, both
 * pre-existing.
 */
export function bulletTone(actual: number, target: number): 'good' | 'warn' | 'bad' {
  if (actual <= target) return 'good'
  if (actual <= target + 2) return 'warn'
  return 'bad'
}

/** Labor-% band: good ≤ target, warn ≤ target+3pts, bad above (daily recap band). */
export function laborTone(pctAct: number, targetPct: number, amberPct: number): 'good' | 'warn' | 'bad' {
  if (pctAct <= targetPct) return 'good'
  if (pctAct <= amberPct) return 'warn'
  return 'bad'
}

/* ---------- week summary ---------- */

/**
 * Every figure the screen prints, computed once here so the tiles, the take, the
 * flags and the table cannot disagree about any of them. Verbatim from the old
 * ReportBody.
 */
export function summarize(data: OpsPayload, v: View) {
  const days = v.days
  const isNext = data.weekMode === 'next'   // planning view: no actuals, everything forecast

  // Totals
  const T = days.reduce((a, d) => ({
    splan: a.splan + d.salesPlan, sact: a.sact + d.salesActual, spy: a.spy + d.salesPY, hplan: a.hplan + d.hoursPlan,
    hact: a.hact + d.hoursActual, lcost: a.lcost + d.laborCost, lcostPlan: a.lcostPlan + d.laborCostPlan,
  }), { splan: 0, sact: 0, spy: 0, hplan: 0, hact: 0, lcost: 0, lcostPlan: 0 })
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

  // Cost vs plan — recipe (theoretical) COGS + projected labor against targets.
  // COGS = Σ(recipe usage × unit cost) ÷ net sales for the NetChef inventory week;
  // labor uses the projected full-week %. Prime = COGS + labor (the 47% ceiling).
  const projSales = T.sact
  const cogsPct = v.cogsRate * 100
  const cogsTargetPct = v.cogsTarget * 100          // derived per-store run-rate target
  const cogsDrift = cogsPct - cogsTargetPct
  const cogsAct$ = v.cogsRate * projSales
  const cogsPlan$ = v.cogsTarget * projSales         // the food BUDGET dollars for the week
  const laborPct = tPctAct                       // projected full-week labor %
  const laborTargetPct = data.laborTarget * 100
  const laborPlan$ = data.laborTarget * projSales
  const primePct = cogsPct + laborPct
  const primeTargetPct = cogsTargetPct + laborTargetPct
  const primeAct$ = cogsAct$ + T.lcost
  const primePlan$ = cogsPlan$ + laborPlan$

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

  return {
    days, isNext, T, tSalesVar, tHrsVar, tPctPlan, tPctAct,
    mw, mwSalesVar, mwSalesPct, mwLaborVar, mwLaborPct, paceAct, paceTarget, paceDrift,
    projSales, cogsPct, cogsTargetPct, cogsDrift, cogsAct$, cogsPlan$,
    laborPct, laborTargetPct, laborPlan$, primePct, primeTargetPct, primeAct$, primePlan$,
    transferPct, targetPct, amberPct, focus, hotDays, rainDays,
  }
}

export type Summary = ReturnType<typeof summarize>
