// Faithful port of the daily-recap holiday engine (daily-recap/recap.py), kept
// identical so the dashboard's Weekly Ops forecast holiday-adjusts exactly the
// same way the daily email does. All inputs/outputs are ISO 'YYYY-MM-DD' strings.
// Weekday convention matches Python's date.weekday(): Mon=0 .. Sun=6.

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function pyWeekday(iso: string): number {
  return (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7 // JS Sun=0 -> Mon=0..Sun=6
}
function addDays(iso: string, n: number): string {
  const dt = new Date(iso + 'T12:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const d0 = ymd(year, month, 1)
  return addDays(d0, (((weekday - pyWeekday(d0)) % 7) + 7) % 7 + 7 * (n - 1))
}
function lastWeekday(year: number, month: number, weekday: number): string {
  const d0 = month === 12 ? ymd(year, 12, 31) : addDays(ymd(year, month + 1, 1), -1)
  return addDays(d0, -((((pyWeekday(d0) - weekday) % 7) + 7) % 7))
}
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mo = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return ymd(y, mo, day)
}

export function holidaysForYear(y: number): Record<string, string> {
  const thx = nthWeekday(y, 11, 3, 4) // 4th Thursday of Nov (Thu = weekday 3)
  return {
    [ymd(y, 1, 1)]: "New Year's Day", [ymd(y, 2, 14)]: "Valentine's Day",
    [easter(y)]: 'Easter', [nthWeekday(y, 5, 6, 2)]: "Mother's Day",
    [lastWeekday(y, 5, 0)]: 'Memorial Day', [nthWeekday(y, 6, 6, 3)]: "Father's Day",
    [ymd(y, 7, 4)]: 'Independence Day', [nthWeekday(y, 9, 0, 1)]: 'Labor Day',
    [ymd(y, 10, 31)]: 'Halloween', [thx]: 'Thanksgiving', [addDays(thx, 1)]: 'Black Friday',
    [ymd(y, 12, 24)]: 'Christmas Eve', [ymd(y, 12, 25)]: 'Christmas Day', [ymd(y, 12, 31)]: "New Year's Eve",
  }
}

export function holidayName(iso: string): string | null {
  return holidaysForYear(Number(iso.slice(0, 4)))[iso] ?? null
}

// Same-named holiday one year earlier (handles floating dates).
export function priorYearHoliday(iso: string): { date: string | null; name: string | null } {
  const name = holidayName(iso)
  if (!name) return { date: null, name: null }
  for (const [pd, pn] of Object.entries(holidaysForYear(Number(iso.slice(0, 4)) - 1))) {
    if (pn === name) return { date: pd, name }
  }
  return { date: null, name }
}
