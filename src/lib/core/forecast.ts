import { DELIVERY_DOWS, DOW, COGS_IMPROVEMENT, COGS_FLOOR, COGS_CAP } from './targets'
import { dowOf } from './dates'

// Sales-forecast + PFG order-split rules, shared across ops surfaces.
//   forecast = mean of the prior same-weekday net sales (sales days only),
//              × a last-year holiday factor when the day is a holiday.

export type SalesRow = { store: string; d: string; net: number }

/** Build the same-weekday forecaster from trailing history + optional holiday factors. */
export function buildForecaster(
  salesHist: SalesRow[],
  holidayFactor: Map<string, number> = new Map(),
): (store: string, date: string) => number {
  const histByStoreDow = new Map<string, number[]>()   // `${store}|${dow}` -> [nets]
  for (const r of salesHist) {
    const net = Number(r.net) || 0
    if (net <= 0) continue                              // sales days only
    const k = `${r.store}|${dowOf(r.d)}`
    if (!histByStoreDow.has(k)) histByStoreDow.set(k, [])
    histByStoreDow.get(k)!.push(net)
  }
  return (store: string, date: string): number => {
    const arr = histByStoreDow.get(`${store}|${dowOf(date)}`) ?? []
    if (!arr.length) return 0
    const base = arr.reduce((a, b) => a + b, 0) / arr.length
    const f = holidayFactor.get(`${store}|${date}`)
    return Math.round(f ? base * f : base)
  }
}

/**
 * Split a week's food budget across each PFG delivery. Each order stocks the days
 * from its delivery up to (not including) the next — cycling past Sunday — and its
 * target is `cogsTarget` × that window's projected sales, so the demand curve sizes
 * each order exactly like the order guide. `sa` = per-day sales aligned to weekDates.
 */
export function orderSplit(name: string, weekDates: string[], sa: number[], cogsTarget: number) {
  const dows = DELIVERY_DOWS[name]
  if (!dows) return []
  const idxDow = weekDates.map(dowOf)
  const dIdx = idxDow.map((dw, i) => (dows.includes(dw) ? i : -1)).filter(i => i >= 0).sort((a, b) => a - b)
  if (dIdx.length === 0) return []
  return dIdx.map((start, k) => {
    const next = dIdx[(k + 1) % dIdx.length]
    const days: number[] = []
    let d = start
    do { days.push(d); d = (d + 1) % 7 } while (d !== next)
    const target = Math.round(cogsTarget * days.reduce((t, i) => t + sa[i], 0))
    return { day: DOW[idxDow[start]], covers: `${DOW[idxDow[days[0]]]}–${DOW[idxDow[days[days.length - 1]]]}`, target }
  })
}

/** Derived per-store recipe-COGS target = trailing run-rate − improvement, clamped. */
export function deriveCogsTarget(rates: number[]): number {
  const baseline = rates.reduce((s, x) => s + x, 0) / rates.length
  return Math.round(Math.min(COGS_CAP, Math.max(COGS_FLOOR, baseline - COGS_IMPROVEMENT)) * 1000) / 1000
}
