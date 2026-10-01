import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear,
  subWeeks, subYears, format, subMonths, subQuarters, subDays,
} from 'date-fns'
import type { DateRange, Period } from './types'

export function resolveDateRange(period: Period, customStart?: string, customEnd?: string): DateRange {
  const today = new Date()
  const yesterday = subDays(today, 1)

  let start: Date, end: Date

  switch (period) {
    case 'weekly':
      start = startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 })
      end   = endOfWeek(subWeeks(today, 1), { weekStartsOn: 1 })
      break
    // Month / quarter / YTD run to the LAST FINISHED day, never today: with Brink pulled
    // every 30 min, today is a partial day and would read as a complete one against a full
    // prior-year day. Anchoring on yesterday also handles the 1st of a month/quarter/year
    // (the period that just closed). Today lives on the Now page. (core/dates lastCompleteDay)
    case 'monthly':
      start = startOfMonth(yesterday)
      end   = yesterday
      break
    case 'quarterly':
      start = startOfQuarter(yesterday)
      end   = yesterday
      break
    case 'ytd':
      start = startOfYear(yesterday)
      end   = yesterday
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
