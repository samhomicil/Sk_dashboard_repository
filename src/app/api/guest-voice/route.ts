import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { TARGETS } from '@/lib/config'
import type { Store } from '@/lib/types'

// Detail behind the Ops Health "Guest Voice" tiles.
//
// One wrinkle drives the shape of this file: comments and scores split by store
// differently. Comment rows carry the unit that produced them, so Pines and Miramar are
// separable. Scores come from card queries against a login covering both and cannot be
// filtered by unit, so they share a 'Pines+Miramar' row. Each section resolves its own
// store filter and the page labels which is which.

const SCORE_STORE: Record<string, string> = {
  pines: 'Pines+Miramar', miramar: 'Pines+Miramar', margate: 'Margate',
}
const COMMENT_STORE: Record<string, string> = {
  pines: 'Pines', miramar: 'Miramar', margate: 'Margate',
}
const STORES_IN: Record<string, number> = { pines: 2, miramar: 2, margate: 1, all: 3 }
const DAYS_PER_MONTH = 30.44
const MIN_N = 10          // SMG's own display threshold
const NEW_DAYS = 14       // "new" bad reports worth chasing

const sf = (s: Store) => (s === 'all' ? '1=1' : `store = '${SCORE_STORE[s] ?? ''}'`)
const cf = (s: Store) => (s === 'all' ? '1=1' : `store = '${COMMENT_STORE[s] ?? ''}'`)
const COMMENT_DATE = 'COALESCE(visit_datetime, received_date)'
const iso = /^\d{4}-\d{2}-\d{2}$/
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const shift = (base: string, days: number) => ymd(new Date(Date.parse(base) + days * 86_400_000))

export interface ScoreRow { metric: string; value: number | null; n: number; prior: number | null }
export interface RangeRow { label: string; days: number; surveys: number; osat: number | null; goal: number }
export interface WeekRow { start: string; end: string; n: number; osat: number | null }
export interface DayRow { date: string; n: number; topbox: number; osat: number | null }
export interface LeafRow { leaf: string; mentions: number; positive: number }
export interface CommentRow {
  store: string; source: string; when: string | null; question: string | null
  text: string; sentiment: number; osat: number | null; themes: string | null
}
export interface ThemeRow {
  theme: string; mentions: number; negative: number; positive: number
  leaves: LeafRow[]; comments: CommentRow[]
}
export interface ReviewRow {
  site: string; when: string | null; rating: number | null
  reviewer: string | null; text: string | null; replied: boolean
}
export interface GuestVoiceDetail {
  range: { start: string; end: string } | null
  scoreScope: string; commentScope: string; combinedScores: boolean
  minN: number; newDays: number
  osat: ScoreRow | null
  scores: ScoreRow[]
  ranges: RangeRow[]
  weekly: WeekRow[]
  daily: DayRow[]
  themes: ThemeRow[]
  newBad: CommentRow[]
  reviews: ReviewRow[]
  counts: { comments: number; negative: number }
}

const EMPTY: GuestVoiceDetail = {
  range: null, scoreScope: '', commentScope: '', combinedScores: false,
  minN: MIN_N, newDays: NEW_DAYS, osat: null, scores: [], ranges: [], weekly: [],
  daily: [], themes: [], newBad: [], reviews: [], counts: { comments: 0, negative: 0 },
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const store = (sp.get('store') || 'all').toLowerCase() as Store
  const start = sp.get('start')
  const end = sp.get('end')
  if (!start || !end || !iso.test(start) || !iso.test(end)) return Response.json(EMPTY)

  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1)
  const priorEnd = shift(start, -1)
  const priorStart = shift(start, -days)
  const combined = store === 'pines' || store === 'miramar'
  const storeCount = STORES_IN[store] ?? 1

  try {
    // --- every metric for the range, previous window alongside -----------------------
    const scores = await query<ScoreRow[]>(`
      SELECT cur.metric,
             CAST(cur.tb AS float) / NULLIF(cur.n, 0) AS value, cur.n,
             CAST(pri.tb AS float) / NULLIF(pri.n, 0) AS prior
      FROM (SELECT metric, SUM(n_count) n, SUM(topbox_count) tb FROM smoothieking.guest_daily
            WHERE ${sf(store)} AND survey_date BETWEEN '${start}' AND '${end}' GROUP BY metric) cur
      LEFT JOIN (SELECT metric, SUM(n_count) n, SUM(topbox_count) tb FROM smoothieking.guest_daily
            WHERE ${sf(store)} AND survey_date BETWEEN '${priorStart}' AND '${priorEnd}' GROUP BY metric) pri
        ON pri.metric = cur.metric
      ORDER BY value ASC`).catch(() => [])

    // --- the same measure at 7/14/30/90 days, so a thin window is obvious ------------
    const ranges: RangeRow[] = []
    for (const d of [7, 14, 30, 90]) {
      const from = shift(end, -(d - 1))
      const r = await query<{ n: number; tb: number }[]>(`
        SELECT ISNULL(SUM(n_count), 0) n, ISNULL(SUM(topbox_count), 0) tb
        FROM smoothieking.guest_daily
        WHERE ${sf(store)} AND metric = 'Overall Satisfaction'
          AND survey_date BETWEEN '${from}' AND '${end}'`).catch(() => null)
      const n = Number(r?.[0]?.n ?? 0)
      ranges.push({
        label: `Last ${d}d`, days: d, surveys: n,
        osat: n ? Number(r![0].tb) / n : null,
        goal: (TARGETS.surveysPerStoreMonth * storeCount * d) / DAYS_PER_MONTH,
      })
    }

    // --- weekly buckets inside the range, plus the daily rows behind them ------------
    const daily = await query<DayRow[]>(`
      SELECT CONVERT(char(10), survey_date, 23) AS date,
             SUM(n_count) AS n, SUM(topbox_count) AS topbox,
             CAST(SUM(topbox_count) AS float) / NULLIF(SUM(n_count), 0) AS osat
      FROM smoothieking.guest_daily
      WHERE ${sf(store)} AND metric = 'Overall Satisfaction'
        AND survey_date BETWEEN '${start}' AND '${end}'
      GROUP BY survey_date HAVING SUM(n_count) > 0
      ORDER BY survey_date`).catch(() => [])

    const weekly: WeekRow[] = []
    for (const row of daily) {
      const d = new Date(row.date + 'T00:00:00Z')
      const monday = ymd(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000))
      let w = weekly.find(x => x.start === monday)
      if (!w) {
        w = { start: monday, end: shift(monday, 6), n: 0, osat: null }
        weekly.push(w)
      }
      w.n += Number(row.n)
      w.osat = (w.osat ?? 0) + Number(row.topbox)   // running top-box, divided below
    }
    for (const w of weekly) w.osat = w.n ? (w.osat ?? 0) / w.n : null
    weekly.sort((a, b) => a.start.localeCompare(b.start))

    // --- comments, and the themes they carry ------------------------------------------
    const comments = await query<CommentRow[]>(`
      SELECT TOP 400 store, source,
             CONVERT(char(16), ${COMMENT_DATE}, 120) AS [when],
             question, comment_text AS text, sentiment, osat, themes,
             leaf_topics AS leaves
      FROM smoothieking.guest_comments
      WHERE ${cf(store)} AND CAST(${COMMENT_DATE} AS date) BETWEEN '${start}' AND '${end}'
      ORDER BY sentiment ASC, ${COMMENT_DATE} DESC`).catch(() => []) as (CommentRow & { leaves?: string })[]

    // Themes are assembled here rather than in SQL: each needs its leaf sub-topics and the
    // comments behind it, and STRING_SPLIT can't carry both without three round trips.
    const split = (s?: string | null) =>
      (s ?? '').split(',').map(x => x.trim()).filter(Boolean)

    const themeMap = new Map<string, ThemeRow>()
    const leafTally = new Map<string, Map<string, { n: number; pos: number }>>()
    for (const c of comments) {
      if (c.source !== 'Survey') continue
      for (const t of split(c.themes)) {
        let row = themeMap.get(t)
        if (!row) {
          row = { theme: t, mentions: 0, negative: 0, positive: 0, leaves: [], comments: [] }
          themeMap.set(t, row)
          leafTally.set(t, new Map())
        }
        row.mentions += 1
        if (c.sentiment < 0) row.negative += 1
        else if (c.sentiment > 0) row.positive += 1
        if (row.comments.length < 12) row.comments.push(c)
        const leaves = leafTally.get(t)!
        for (const l of split(c.leaves)) {
          const cur = leaves.get(l) ?? { n: 0, pos: 0 }
          cur.n += 1
          if (c.sentiment > 0) cur.pos += 1
          leaves.set(l, cur)
        }
      }
    }
    const themes = [...themeMap.values()].map(t => ({
      ...t,
      leaves: [...(leafTally.get(t.theme) ?? new Map())]
        .map(([leaf, v]) => ({ leaf, mentions: v.n, positive: v.pos }))
        .sort((a, b) => b.mentions - a.mentions),
    })).sort((a, b) => b.negative - a.negative || b.mentions - a.mentions)

    // --- attention band: negatives inside the trailing NEW_DAYS ----------------------
    const newSince = shift(end, -(NEW_DAYS - 1))
    const newBad = comments.filter(c =>
      c.sentiment < 0 && c.when && c.when.slice(0, 10) >= newSince)

    const reviews = store === 'all' || store === 'margate'
      ? await query<ReviewRow[]>(`
          SELECT site, CONVERT(char(16), review_date, 120) AS [when], rating, reviewer,
                 review_text AS text, CAST(replied AS int) AS replied
          FROM smoothieking.soci_reviews
          WHERE store = 'Margate' AND CAST(review_date AS date) BETWEEN '${start}' AND '${end}'
          ORDER BY review_date DESC`).catch(() => [])
      : []

    return Response.json({
      range: { start, end },
      scoreScope: store === 'all' ? 'all stores' : combined ? 'Pines + Miramar combined' : 'Margate',
      commentScope: store === 'all' ? 'all stores' : COMMENT_STORE[store],
      combinedScores: combined,
      minN: MIN_N, newDays: NEW_DAYS,
      osat: scores.find(s => s.metric === 'Overall Satisfaction') ?? null,
      scores: scores.filter(s => s.metric !== 'Overall Satisfaction'),
      ranges, weekly, daily, themes, newBad,
      reviews: reviews.map(r => ({ ...r, replied: Boolean(r.replied) })),
      counts: {
        comments: comments.length,
        negative: comments.filter(c => Number(c.sentiment) < 0).length,
      },
    } satisfies GuestVoiceDetail)
  } catch (err) {
    return Response.json({ ...EMPTY, error: String(err) })
  }
}
