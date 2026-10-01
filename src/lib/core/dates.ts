// ET-anchored date helpers shared across ops surfaces. Kept pure (no I/O).

export function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/**
 * The last FINISHED business day (yesterday, ET). Once Brink is pulled every 30 minutes
 * during open hours, today's rows are a partial day: anything that totals, averages or
 * compares a range must end here, never on today, or a 2 PM half-day reads as a complete
 * (and terrible) day against a full prior-year day. Today belongs to the Now page only.
 */
export function lastCompleteDay(): string {
  return isoAdd(etToday(), -1)
}

/**
 * Cap an inclusive [start, end] range (and its prior-year twin) at the last finished day.
 * The prior-year end moves back by the same number of days so the comparison stays
 * like-for-like.
 */
export function capToComplete(end: string, pyEnd?: string): { end: string; pyEnd?: string } {
  const last = lastCompleteDay()
  if (!end || end <= last) return { end, pyEnd }
  const over = Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(last + 'T12:00:00Z')) / 86400000)
  return { end: last, pyEnd: pyEnd ? isoAdd(pyEnd, -over) : pyEnd }
}

export function isoAdd(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function dowOf(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay()
}

export function monthDay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}
