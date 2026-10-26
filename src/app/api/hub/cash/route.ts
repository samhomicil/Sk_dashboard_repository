import { requireHubToken } from '@/lib/hub-guard'
import { getPrisma } from '@/lib/prisma'
import { getLiveBalances } from '@/lib/bills/balances'
import { STORES, HUB_CASH_DAYS, HUB_OUTFLOW_ITEM_MIN } from '@/lib/core/targets'
import { SOURCES, grade } from '@/lib/core/freshness'
import { etToday } from '@/lib/core/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/hub/cash — each store's cash position and the next HUB_CASH_DAYS of the cash
 * forecast, for the Nexus agent hub. Bearer HUB_TOKEN only (lib/hub-guard.ts).
 *
 * Reports what the forecast says and recomputes nothing: every balance, inflow and outflow
 * is a sk_bills.Forecast row as cash-forecast/forecast.py wrote it (the rows the Cash Flow
 * screen draws), and the bank balance is lib/bills/balances getLiveBalances, the one reader
 * of sk_bills.QbBalance. This route only picks rows: the days from today on, the outflow
 * lines of HUB_OUTFLOW_ITEM_MIN or more, the first day below zero and the lowest day.
 *
 * stale is true for any of staleReasons:
 *   balance            the bank balance is older than the app's OPENBUDGET_STALE_HOURS (24 h)
 *   forecast_flagged   forecast.py marked the store stale (its anchor balance was old)
 *   forecast_old       the forecast's as_of date is past the freshness registry's maxAgeDays
 */

type Row = {
  store: string; d: string; inflow: number; outflow: number; balance: number
  as_of: string; bal_src: string | null; stale: boolean | number | null
  updatedAt: Date | null; detail: string | null
}
type Line = { label?: unknown; amt?: unknown; kind?: unknown; note?: unknown }
type Item = { label: string; amount: number; note: string | null }
type Day = { date: string; balance: number; inflow: number; outflow: number; items: Item[] }

const cents = (n: unknown) => Math.round(Number(n || 0) * 100) / 100

/** The day's outflow lines of HUB_OUTFLOW_ITEM_MIN or more, largest first. */
function bigOutflows(detail: string | null): Item[] {
  if (!detail) return []
  let lines: Line[]
  try { lines = JSON.parse(detail) } catch { return [] }
  if (!Array.isArray(lines)) return []
  return lines
    .filter(l => l?.kind === 'out' && typeof l.amt === 'number' && l.amt >= HUB_OUTFLOW_ITEM_MIN)
    .map(l => ({ label: String(l.label ?? ''), amount: cents(l.amt), note: l.note == null ? null : String(l.note) }))
    .sort((a, b) => b.amount - a.amount)
}

const point = (d: Day | undefined) => (d ? { date: d.date, balance: d.balance, items: d.items } : null)

export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied

  const db = getPrisma()
  if (!db) return Response.json({ error: 'db not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })

  const today = etToday()
  let balances: Awaited<ReturnType<typeof getLiveBalances>>, rows: Row[]
  try {
    [balances, rows] = await Promise.all([
      getLiveBalances(),
      db.$queryRawUnsafe<Row[]>(`
        SELECT store, CONVERT(char(10), d, 23) AS d, inflow, outflow, balance,
               CONVERT(char(10), as_of, 23) AS as_of, bal_src, stale, updatedAt, detail
          FROM sk_bills.Forecast WHERE d >= '${today}' ORDER BY store, d`),
    ])
  } catch (err) {
    console.error('[hub/cash]', err)
    return Response.json({ error: 'query failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  const forecastContract = SOURCES.find(s => s.table === 'sk_bills.Forecast')!

  const stores = STORES.map(st => {
    const mine = rows.filter(r => r.store === st.name)
    const days: Day[] = mine.slice(0, HUB_CASH_DAYS).map(r => ({
      date: r.d, balance: cents(r.balance), inflow: cents(r.inflow), outflow: cents(r.outflow),
      items: bigOutflows(r.detail),
    }))
    let lowest: Day | undefined
    for (const d of days) if (!lowest || d.balance < lowest.balance) lowest = d

    const bank = balances.find(b => b.store === st.name)
    const first = mine[0]
    const updatedAt = mine.reduce<Date | null>((m, r) =>
      r.updatedAt && (!m || r.updatedAt > m) ? r.updatedAt : m, null)
    const forecast = first ? {
      asOf: first.as_of,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      balanceSource: first.bal_src,
      flaggedStale: mine.some(r => Boolean(r.stale)),
    } : null

    const staleReasons: string[] = []
    if (!bank || bank.stale) staleReasons.push('balance')
    if (forecast?.flaggedStale) staleReasons.push('forecast_flagged')
    if (!forecast || grade(forecastContract, forecast.asOf, today).health !== 'ok') staleReasons.push('forecast_old')

    return {
      store: st.name, key: st.key,
      balance: bank ? {
        checking: cents(bank.checking), cashTotal: cents(bank.cashTotal),
        asOf: bank.updatedAt, ageHours: Math.round(bank.ageHours * 10) / 10, stale: bank.stale,
      } : null,
      forecast,
      days,
      firstBelowZero: point(days.find(d => d.balance < 0)),
      lowest: point(lowest),
      stale: staleReasons.length > 0,
      staleReasons,
    }
  })

  return Response.json(
    { today, horizonDays: HUB_CASH_DAYS, outflowItemMin: HUB_OUTFLOW_ITEM_MIN, stores },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
