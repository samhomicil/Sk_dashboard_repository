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
