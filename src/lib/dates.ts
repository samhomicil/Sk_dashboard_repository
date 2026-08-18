import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear,
  subWeeks, subYears, format, subMonths, subQuarters,
} from 'date-fns'
import type { DateRange, Period } from './types'

export function resolveDateRange(period: Period, customStart?: string, customEnd?: string): DateRange {
  const today = new Date()

  let start: Date, end: Date

  switch (period) {
    case 'weekly':
      start = startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 })
      end   = endOfWeek(subWeeks(today, 1), { weekStartsOn: 1 })
      break
    case 'monthly':
      start = startOfMonth(subMonths(today, today.getDate() === 1 ? 1 : 0))
      end   = today.getDate() === 1 ? endOfMonth(subMonths(today, 1)) : today
      break
    case 'quarterly':
      start = startOfQuarter(today)
      end   = today
      break
    case 'ytd':
      start = startOfYear(today)
      end   = today
      break
    case 'custom':
      if (customStart && customEnd) {
        start = new Date(customStart + 'T00:00:00')
        end   = new Date(customEnd   + 'T00:00:00')
      } else {
        end   = new Date(today); end.setDate(end.getDate() - 1)   // yesterday
        start = new Date(end);   start.setDate(start.getDate() - 13) // 14 days back
      }
      break
  }

  const pyStart = subYears(start, 1)
  const pyEnd   = subYears(end, 1)

  return {
    start:   format(start,   'yyyy-MM-dd'),
    end:     format(end,     'yyyy-MM-dd'),
    pyStart: format(pyStart, 'yyyy-MM-dd'),
    pyEnd:   format(pyEnd,   'yyyy-MM-dd'),
  }
}

export function weekLabel(isoDate: string): string {
  return format(new Date(isoDate + 'T00:00:00'), 'MM/dd')
}

/**
 * The period a surface shows when the URL does not name one.
 *
 * It lives here because it was previously written twice — Timeframe fell back to
 * 'quarterly' while the employees page fell back to 'weekly', both reading the same
 * ?period= param. With no param in the URL the control said "Quarterly · Jul 1 – Aug 17"
 * while the data underneath it was the week of Aug 10–16. A filter that disagrees with
 * the figures beside it is worse than either answer on its own.
 */
export const DEFAULT_PERIOD: Period = 'quarterly'
