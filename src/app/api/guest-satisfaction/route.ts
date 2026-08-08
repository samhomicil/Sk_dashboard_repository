import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { TARGETS } from '@/lib/config'
import type { Store } from '@/lib/types'

// SMG360 guest satisfaction, summarised for the Ops Health strip.
//
// Scores are top-box percentages, so a range is exactly recomputable from daily rows as
// SUM(topbox_count) / SUM(n_count) — which is what lets this honour the dashboard's own
// date range instead of SMG's fiscal periods. Verified: July's days sum to 25 responses /
// 22 top-box = 88%, matching SMG's own query for the same window.
//
// Falls back to the period-grained guest_feedback table until the daily backfill has run,
// so the strip degrades to "nearest period" rather than going blank.

// Every store now has its own rows: the extractor narrows the two-store ops login with
// SMG's hierarchy filter ({"<projectId>": ["<unitDimId>"]}), so Pines and Miramar separate.
const DB_STORE: Record<string, string> = {
  pines: 'Pines', miramar: 'Miramar', margate: 'Margate',
}
const STORES_IN: Record<string, number> = { pines: 1, miramar: 1, margate: 1, all: 3 }

// Cases are the exception: /api/report ignores the hierarchy filter that works on the card
// endpoints, so the two-store login still reports them combined. Splitting cases needs the
// rawdatareport path (its rows carry UNIT_ID). Until then they keep their own store map and
// the UI says the figure covers both.
const CASE_STORE: Record<string, string> = {
  pines: 'Pines+Miramar', miramar: 'Pines+Miramar', margate: 'Margate',
}
const caseFilter = (s: Store) =>
  s === 'all' ? '1=1' : `store = '${CASE_STORE[s] ?? ''}'`

const NEW_WINDOW_DAYS = 14                       // "new" bad reports worth chasing
const DAYS_PER_MONTH = 30.44
const CASE_GOAL_HOURS = 24            // SMG resolutionTimeGoal = 1440 minutes on every case type

function sf(store: Store, col = 'store') {
  return store === 'all' ? '1=1' : `${col} = '${DB_STORE[store] ?? ''}'`
}
function storeCount(store: Store) {
  return STORES_IN[store] ?? 1
}

export interface CaseSummary {
  opened: number
  resolved: number
  pending: number
  escalated: number
  overSla: number
  avgHours: number | null
  goalHours: number
}

export interface GuestSummary {
  connected: boolean
  source: 'daily' | 'period'
  combined: boolean
  scope: string
  range: { start: string; end: string } | null
  osat: number | null
  osatPrior: number | null
  responses: number
  goal: number
  pace: number | null
  newBad: number | null
  newBadSince: string | null
  worstMetric: { metric: string; value: number } | null
  cases: CaseSummary | null
  casesCombined: boolean
  dataThrough: string | null
  coverageFrom: string | null
}

const EMPTY: GuestSummary = {
  connected: false, source: 'daily', combined: false, scope: '', range: null, osat: null, osatPrior: null,
  responses: 0, goal: 0, pace: null, newBad: null, newBadSince: null,
  worstMetric: null, cases: null, casesCombined: false, dataThrough: null, coverageFrom: null,
}

function scopeLabel(store: Store) {
  if (store === 'all') return 'all three stores'
  return DB_STORE[store] ?? 'Margate'
}

const iso = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const store = (sp.get('store') || 'all').toLowerCase() as Store
  const start = sp.get('start')
  const end = sp.get('end')
  if (!start || !end || !iso.test(start) || !iso.test(end)) return Response.json(EMPTY)

  const days = Math.max(
    1,
    Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1,
  )
  const priorEnd = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10)
  const priorStart = new Date(Date.parse(start) - days * 86_400_000).toISOString().slice(0, 10)
  const newSince = new Date(Date.parse(end) - (NEW_WINDOW_DAYS - 1) * 86_400_000)
    .toISOString().slice(0, 10)

  const goal = (TARGETS.surveysPerStoreMonth * storeCount(store) * days) / DAYS_PER_MONTH

  // Guest-recovery cases ("incidents"): opened in the window, and how many blew the
  // 24h callback goal. Every case type carries resolutionTimeGoal = 1440 minutes.
  // How far the loaded data actually runs — so a stale or partly-backfilled table can say
  // so rather than quietly reporting a short window as if it were the whole range.
  async function coverage() {
    return query<{ lo: string; hi: string }[]>(`
      SELECT CONVERT(char(10), MIN(survey_date), 23) AS lo,
             CONVERT(char(10), MAX(survey_date), 23) AS hi
      FROM smoothieking.guest_daily WHERE ${sf(store)}`)
      .then(r => ({ from: r[0]?.lo ?? null, through: r[0]?.hi ?? null }))
      .catch(() => ({ from: null, through: null }))
  }

  async function caseSummary(from: string, to: string): Promise<CaseSummary | null> {
    return query<{
      opened: number; resolved: number; pending: number
      escalated: number; over_sla: number; hours_sum: number
    }[]>(`
      SELECT ISNULL(SUM(opened), 0) AS opened, ISNULL(SUM(resolved), 0) AS resolved,
             ISNULL(SUM(unresolved) + SUM(inprogress), 0) AS pending,
             ISNULL(SUM(escalated), 0) AS escalated,
             ISNULL(SUM(CASE WHEN hours_sum / NULLIF(opened, 0) > ${CASE_GOAL_HOURS}
                             THEN opened ELSE 0 END), 0) AS over_sla,
             ISNULL(SUM(hours_sum), 0) AS hours_sum
      FROM smoothieking.guest_cases
      WHERE ${caseFilter(store)} AND case_date BETWEEN '${from}' AND '${to}'`)
      .then(r => {
        const c = r[0]
        if (!c) return null
        const opened = Number(c.opened)
        return {
          opened,
          resolved: Number(c.resolved),
          pending: Number(c.pending),
          escalated: Number(c.escalated),
          overSla: Number(c.over_sla),
          avgHours: opened ? Number(c.hours_sum) / opened : null,
          goalHours: CASE_GOAL_HOURS,
        }
      })
      .catch(() => null)
  }

  try {
    const daily = await query<{ n: number; topbox: number }[]>(`
      SELECT ISNULL(SUM(n_count), 0) AS n, ISNULL(SUM(topbox_count), 0) AS topbox
      FROM smoothieking.guest_daily
      WHERE ${sf(store)} AND metric = 'Overall Satisfaction'
        AND survey_date BETWEEN '${start}' AND '${end}'`).catch(() => null)

    // ---- daily path: exact for any window --------------------------------
    if (daily && Number(daily[0]?.n) > 0) {
      const cur = daily[0]
      const prior = await query<{ n: number; topbox: number }[]>(`
        SELECT ISNULL(SUM(n_count), 0) AS n, ISNULL(SUM(topbox_count), 0) AS topbox
        FROM smoothieking.guest_daily
        WHERE ${sf(store)} AND metric = 'Overall Satisfaction'
          AND survey_date BETWEEN '${priorStart}' AND '${priorEnd}'`)

      const worst = await query<{ metric: string; value: number }[]>(`
        SELECT TOP 1 metric,
               CAST(SUM(topbox_count) AS float) / NULLIF(SUM(n_count), 0) AS value
        FROM smoothieking.guest_daily
        WHERE ${sf(store)} AND metric <> 'Overall Satisfaction'
          AND survey_date BETWEEN '${start}' AND '${end}'
        GROUP BY metric
        HAVING SUM(n_count) >= 10
        ORDER BY value ASC`)

      // null, not 0, when the comments table isn't loaded — a green "nothing outstanding"
      // that actually means "we didn't look" is worse than showing nothing.
      const bad = await query<{ n: number }[]>(`
        SELECT COUNT(*) AS n FROM smoothieking.guest_comments
        WHERE ${sf(store)} AND sentiment < 0 AND source = 'Survey'
          AND CONVERT(date, COALESCE(visit_datetime, received_date))
              BETWEEN '${newSince}' AND '${end}'`).catch(() => null)

      const n = Number(cur.n)
      const pn = Number(prior[0]?.n ?? 0)
      return Response.json({
        connected: true,
        source: 'daily',
        combined: false,
        scope: scopeLabel(store),
        range: { start, end },
        osat: n ? Number(cur.topbox) / n : null,
        osatPrior: pn ? Number(prior[0].topbox) / pn : null,
        responses: n,
        goal,
        pace: goal ? n / goal : null,
        newBad: bad ? Number(bad[0]?.n ?? 0) : null,
        newBadSince: newSince,
        worstMetric: worst[0]?.value != null
          ? { metric: worst[0].metric, value: Number(worst[0].value) } : null,
        cases: await caseSummary(start, end),
        casesCombined: store === 'pines' || store === 'miramar',
        ...await coverage().then(c => ({ coverageFrom: c.from, dataThrough: c.through })),
      } satisfies GuestSummary)
    }

    // ---- fallback: nearest fiscal period from the period table ------------
    const periods = await query<{ ps: string; pe: string }[]>(`
      SELECT DISTINCT TOP 2 CONVERT(char(10), period_start, 23) AS ps,
                            CONVERT(char(10), period_end, 23)   AS pe
      FROM smoothieking.guest_feedback
      WHERE ${sf(store)} AND comparison = 'Current Period' AND unit = 'percent'
        AND period_end <= '${end}'
      ORDER BY ps DESC`)
    if (periods.length === 0) return Response.json(EMPTY)

    const scores = await query<{ metric: string; value: number; n: number }[]>(`
      SELECT metric, AVG(value) AS value, MAX(n_count) AS n
      FROM smoothieking.guest_feedback
      WHERE ${sf(store)} AND comparison = 'Current Period' AND unit = 'percent'
        AND period_start = '${periods[0].ps}'
      GROUP BY metric`)
    const osatRow = scores.find(s => s.metric === 'Overall Satisfaction')
    const worst = scores
      .filter(s => s.metric !== 'Overall Satisfaction' && s.value != null)
      .sort((a, b) => a.value - b.value)[0]

    let priorOsat: number | null = null
    if (periods[1]) {
      const p = await query<{ value: number }[]>(`
        SELECT AVG(value) AS value FROM smoothieking.guest_feedback
        WHERE ${sf(store)} AND comparison = 'Current Period' AND metric = 'Overall Satisfaction'
          AND period_start = '${periods[1].ps}'`)
      priorOsat = p[0]?.value ?? null
    }

    const n = Number(osatRow?.n ?? 0)
    return Response.json({
      connected: true,
      source: 'period',
      combined: false,
      scope: scopeLabel(store),
      range: { start: periods[0].ps, end: periods[0].pe },
      osat: osatRow?.value ?? null,
      osatPrior: priorOsat,
      responses: n,
      goal: TARGETS.surveysPerStoreMonth * storeCount(store),
      pace: n ? n / (TARGETS.surveysPerStoreMonth * storeCount(store)) : null,
      newBad: null,
      newBadSince: null,
      worstMetric: worst ? { metric: worst.metric, value: worst.value } : null,
      cases: await caseSummary(start, end),
      casesCombined: store === 'pines' || store === 'miramar',
      ...await coverage().then(c => ({ coverageFrom: c.from, dataThrough: c.through })),
    } satisfies GuestSummary)
  } catch (err) {
    return Response.json({ ...EMPTY, error: String(err) })
  }
}
