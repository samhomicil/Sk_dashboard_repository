import { requireHubToken } from '@/lib/hub-guard'
import { query, queryLive } from '@/lib/db'
import { STORES } from '@/lib/core/targets'
import { NET_SALES, ORDERS, latestRunSql } from '@/lib/core/sources'
import { refreshStatus, type RunProbe } from '@/lib/core/intraday'
import { etToday, etNowMinutes, isoAdd, lastCompleteDay } from '@/lib/core/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/hub/sales — net sales and orders per store and in total, for the Nexus agent hub.
 * Bearer HUB_TOKEN only (lib/hub-guard.ts).
 *
 *   today      so far, as of the last successful 30-minute Brink pull (the Now screen's day)
 *   yesterday  the last finished day (the Scorecard's daily row)
 *   lastYear   the same weekday 52 weeks before yesterday (364 days), yesterday's comparison
 *
 * NET_SALES and ORDERS from core/sources over smoothieking.sales, by closed_datetime date
 * (ET wall clock), as /api/daily and /api/now read it. Today is never served from a cache
 * older than the last pull: the run probe is read live and its id is written into today's
 * SQL, so the cached copy turns over the moment a new pull lands (the /api/now approach).
 */

type Row = { store: string; d?: string; net: number; orders: number }
type Totals = { net: number; orders: number }

const cents = (n: unknown) => Math.round(Number(n || 0) * 100) / 100
const zero = (): Totals => ({ net: 0, orders: 0 })
const change = (now: Totals, then: Totals) => (then.net > 0 ? Math.round((now.net / then.net - 1) * 10000) / 10000 : null)

export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied

  const today = etToday()
  const now = etNowMinutes()
  const tomorrow = isoAdd(today, 1)
  const yesterday = lastCompleteDay()
  const lastYear = isoAdd(yesterday, -364)

  try {
    const [run] = await queryLive<RunProbe[]>(latestRunSql(today))
    const status = refreshStatus(run, today, now)
    const tag = `/* intraday run ${run?.last_id ?? 0} */`

    const [todayRows, pastRows] = await Promise.all([
      query<Row[]>(`
        SELECT store, ${NET_SALES} AS net, ${ORDERS} AS orders FROM smoothieking.sales
         WHERE closed_datetime >= '${today}' AND closed_datetime < '${tomorrow}'
         GROUP BY store ${tag}`),
      query<Row[]>(`
        SELECT store, CONVERT(char(10), closed_datetime, 23) AS d, ${NET_SALES} AS net, ${ORDERS} AS orders
          FROM smoothieking.sales
         WHERE (closed_datetime >= '${yesterday}' AND closed_datetime < '${today}')
            OR (closed_datetime >= '${lastYear}' AND closed_datetime < '${isoAdd(lastYear, 1)}')
         GROUP BY store, CONVERT(char(10), closed_datetime, 23)`),
    ])

    const pick = (rows: Row[], store: string, d?: string): Totals => {
      const r = rows.find(x => x.store === store && (d == null || x.d === d))
      return r ? { net: cents(r.net), orders: Number(r.orders) || 0 } : zero()
    }
    const stores = STORES.map(st => {
      const t = pick(todayRows, st.name), y = pick(pastRows, st.name, yesterday), ly = pick(pastRows, st.name, lastYear)
      return { store: st.name, key: st.key, today: t, yesterday: y, lastYear: ly, yesterdayVsLastYear: change(y, ly) }
    })
    const sum = (k: 'today' | 'yesterday' | 'lastYear') => stores.reduce((a, s) =>
      ({ net: cents(a.net + s[k].net), orders: a.orders + s[k].orders }), zero())
    const total = { today: sum('today'), yesterday: sum('yesterday'), lastYear: sum('lastYear') }

    const hhmm = (m: number | null) =>
      m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return Response.json({
      timezone: 'America/New_York',
      today: {
        date: today,
        asOf: run?.ok_at ?? null,            // the last successful pull today, ET wall clock
        runId: run?.last_id ?? null,
        inWindow: status.inWindow,
        refreshWindow: { from: hhmm(status.window.from), to: hhmm(status.window.to) },
        ageMinutes: status.ageMin,
        stale: status.stale,
        lastRunFailed: status.lastFailed,
      },
      yesterday: { date: yesterday },
      lastYear: { date: lastYear, rule: 'same weekday 52 weeks before yesterday (364 days)' },
      stores,
      total: { ...total, yesterdayVsLastYear: change(total.yesterday, total.lastYear) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[hub/sales]', err)
    return Response.json({ error: 'query failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
