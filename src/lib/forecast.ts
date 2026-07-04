import { addWeeks, addMonths, format, differenceInDays } from 'date-fns'
import { TARGETS } from './config'
import type { TrendPoint } from './types'

interface HistoricalWeek {
  weekStart: string
  sales: number
}

export function buildForecast(
  actuals: HistoricalWeek[],           // sorted asc, current period last
  pyActuals: HistoricalWeek[],         // same weeks prior year
  forecastCount: number,               // how many future weeks to project
  periodStart: Date,
  periodEnd: Date,
): TrendPoint[] {
  const today = new Date()
  const pyMap = new Map(pyActuals.map(w => [w.weekStart, w.sales]))

  // Build L4W average from last 4 actual weeks
  const last4 = actuals.slice(-4)
  const l4wAvg = last4.length
    ? last4.reduce((s, w) => s + w.sales, 0) / last4.length
    : 0

  // Compute L4W weekly slope (linear regression over last 4)
  let trendSlope = 0
  if (last4.length >= 2) {
    const n = last4.length
    const sumX = (n * (n - 1)) / 2
    const sumY = last4.reduce((s, w) => s + w.sales, 0)
    const sumXY = last4.reduce((s, w, i) => s + i * w.sales, 0)
    const sumX2 = last4.reduce((s, _, i) => s + i * i, 0)
    trendSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  }

  // Run-rate: total actuals / elapsed days × 7 = weekly run rate
  const daysElapsed = Math.max(1, differenceInDays(today, periodStart))
  const daysTotal = Math.max(1, differenceInDays(periodEnd, periodStart) + 1)
  const totalActuals = actuals.reduce((s, w) => s + w.sales, 0)
  const runRateWeekly = (totalActuals / daysElapsed) * 7

  const points: TrendPoint[] = actuals.map(w => {
    const dt = new Date(w.weekStart + 'T00:00:00')
    const isCurrent = dt <= today && addWeeks(dt, 1) > today
    const pyS = pyMap.get(w.weekStart) ?? null
    return {
      weekStart: format(dt, 'MM/dd'),
      sales: w.sales,
      salesPY: pyS,
      salesTarget: pyS !== null ? Math.round(pyS * (1 + TARGETS.salesGrowthYoY)) : 0,
      salesForecast: null,
      isCurrent,
      isForecast: false,
    }
  })

  // Project future weeks
  const lastActualDate = actuals.length
    ? new Date(actuals[actuals.length - 1].weekStart + 'T00:00:00')
    : periodStart

  for (let i = 1; i <= forecastCount; i++) {
    const fwDate = addWeeks(lastActualDate, i)
    const fwKey = format(fwDate, 'yyyy-MM-dd')
    const pyS = pyMap.get(fwKey) ?? pyMap.get(format(fwDate, 'yyyy-MM-dd')) ?? l4wAvg
    const historical = pyS
    const trendForecast = l4wAvg + trendSlope * i
    const blended = Math.round((historical + runRateWeekly + trendForecast) / 3)
    points.push({
      weekStart: format(fwDate, 'MM/dd'),
      sales: null,
      salesPY: pyS || null,
      salesTarget: pyS ? Math.round(pyS * (1 + TARGETS.salesGrowthYoY)) : Math.round(blended * (1 + TARGETS.salesGrowthYoY)),
      salesForecast: blended,
      isCurrent: false,
      isForecast: true,
    })
  }

  return points
}

export function projectPeriodEnd(
  actualsToDate: number,
  daysElapsed: number,
  daysTotal: number,
  pyTotal: number,
  l4wWeeklyAvg: number,
): { runRate: number; historical: number; trend: number; blended: number } {
  const daysRemaining = daysTotal - daysElapsed
  const dailyRate = actualsToDate / Math.max(1, daysElapsed)
  const runRate   = Math.round(actualsToDate + dailyRate * daysRemaining)
  const historical = Math.round(pyTotal * (actualsToDate / (pyTotal * (daysElapsed / daysTotal) || 1)))
  const trend     = Math.round(actualsToDate + (l4wWeeklyAvg / 7) * daysRemaining)
  const blended   = Math.round((runRate + trend) / 2)
  return { runRate, historical: pyTotal, trend, blended }
}
