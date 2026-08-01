import { DEFAULT_RATE } from './targets'

// Labor cost rules — shared by the ops-week report, the daily recap, and the
// owner budget view so they can never disagree.
//
//   rate      = each employee's MOST-RECENT rate (from labor, rate>0),
//               store-average fallback, then DEFAULT_RATE.
//   scheduled = Σ(sched_hours × that employee's own rate) — the labor forecast.
//   actual    = real total_pay on worked days.

export type EmpRateRow = { store: string; employee: string; rate: number }
export type SchedRow = { store: string; employee: string; h: number }

/** Build the rate lookup used everywhere: most-recent per employee, store-avg fallback. */
export function buildRateFor(empRates: EmpRateRow[]): (store: string, emp: string) => number {
  const empRate = new Map<string, number>()          // `${store}|${employee}` -> rate
  const storeRateList = new Map<string, number[]>()
  for (const r of empRates) {
    const rt = Number(r.rate) || 0
    empRate.set(`${r.store}|${r.employee}`, rt)
    if (!storeRateList.has(r.store)) storeRateList.set(r.store, [])
    storeRateList.get(r.store)!.push(rt)
  }
  const storeAvgRate = new Map<string, number>()
  for (const [st, list] of storeRateList) {
    storeAvgRate.set(st, list.length ? list.reduce((a, b) => a + b, 0) / list.length : DEFAULT_RATE)
  }
  return (store: string, emp: string): number =>
    empRate.get(`${store}|${emp}`) ?? storeAvgRate.get(store) ?? DEFAULT_RATE
}

/** Scheduled labor cost per `${store}|${date}` = Σ(hours × each employee's rate). */
export function scheduledCostByDay(
  sched: (SchedRow & { d: string })[],
  rateFor: (store: string, emp: string) => number,
): Map<string, number> {
  const cost = new Map<string, number>()
  for (const r of sched) {
    const k = `${r.store}|${r.d}`
    cost.set(k, (cost.get(k) ?? 0) + (Number(r.h) || 0) * rateFor(r.store, r.employee))
  }
  return cost
}
