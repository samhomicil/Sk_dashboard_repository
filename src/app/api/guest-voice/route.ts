import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import type { Store } from '@/lib/types'

// Detail behind the Ops Health "Guest Voice" tiles.
//
// One wrinkle drives the shape of this file: comments and scores split by store
// differently. Comment rows carry the unit that produced them, so Pines and Miramar are
// separable. Scores come from card queries against a login that covers both and cannot be
// filtered by unit, so they share a 'Pines+Miramar' row. Each section therefore resolves
// its own store filter, and the page says which is which.

const SCORE_STORE: Record<string, string> = {
  pines: 'Pines+Miramar', miramar: 'Pines+Miramar', margate: 'Margate',
}
const COMMENT_STORE: Record<string, string> = {
  pines: 'Pines', miramar: 'Miramar', margate: 'Margate',
}

function scoreFilter(store: Store) {
  return store === 'all' ? '1=1' : `store = '${SCORE_STORE[store] ?? ''}'`
}
function commentFilter(store: Store) {
  return store === 'all' ? '1=1' : `store = '${COMMENT_STORE[store] ?? ''}'`
}
// Comments have a visit time on survey rows and only a received date elsewhere.
const COMMENT_DATE = 'COALESCE(visit_datetime, received_date)'

export interface ScoreRow { metric: string; value: number | null; n: number; prior: number | null }
export interface ThemeRow { theme: string; mentions: number; negative: number; positive: number }
export interface CommentRow {
  store: string; source: string; when: string | null; question: string | null
  text: string; sentiment: number; osat: number | null; themes: string | null
}
export interface ReviewRow {
  site: string; when: string | null; rating: number | null
  reviewer: string | null; text: string | null; replied: boolean
}
export interface GuestVoiceDetail {
  range: { start: string; end: string } | null
  scoreScope: string
  commentScope: string
  combinedScores: boolean
  scores: ScoreRow[]
  themes: ThemeRow[]
  comments: CommentRow[]
  reviews: ReviewRow[]
  counts: { comments: number; negative: number; reviews: number }
}

const EMPTY: GuestVoiceDetail = {
  range: null, scoreScope: '', commentScope: '', combinedScores: false,
  scores: [], themes: [], comments: [], reviews: [],
  counts: { comments: 0, negative: 0, reviews: 0 },
}

const iso = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const store = (sp.get('store') || 'all').toLowerCase() as Store
  const start = sp.get('start')
  const end = sp.get('end')
  if (!start || !end || !iso.test(start) || !iso.test(end)) return Response.json(EMPTY)

  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1)
  const priorEnd = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10)
  const priorStart = new Date(Date.parse(start) - days * 86_400_000).toISOString().slice(0, 10)

  const combined = store === 'pines' || store === 'miramar'

  try {
    // --- scores: every metric for the range, with the previous window alongside -------
    const scores = await query<ScoreRow[]>(`
      SELECT cur.metric,
             CAST(cur.topbox AS float) / NULLIF(cur.n, 0) AS value,
             cur.n,
             CAST(pri.topbox AS float) / NULLIF(pri.n, 0) AS prior
      FROM (
        SELECT metric, SUM(n_count) AS n, SUM(topbox_count) AS topbox
        FROM smoothieking.guest_daily
        WHERE ${scoreFilter(store)} AND survey_date BETWEEN '${start}' AND '${end}'
        GROUP BY metric
      ) cur
      LEFT JOIN (
        SELECT metric, SUM(n_count) AS n, SUM(topbox_count) AS topbox
        FROM smoothieking.guest_daily
        WHERE ${scoreFilter(store)} AND survey_date BETWEEN '${priorStart}' AND '${priorEnd}'
        GROUP BY metric
      ) pri ON pri.metric = cur.metric
      ORDER BY value ASC`).catch(() => [])

    // --- themes: counted from this window's own comments ------------------------------
    // STRING_SPLIT on a ", "-joined column leaves a leading space, which would split one
    // theme into two buckets — hence the trim.
    const themes = await query<ThemeRow[]>(`
      SELECT LTRIM(RTRIM(value)) AS theme,
             COUNT(*) AS mentions,
             SUM(CASE WHEN sentiment < 0 THEN 1 ELSE 0 END) AS negative,
             SUM(CASE WHEN sentiment > 0 THEN 1 ELSE 0 END) AS positive
      FROM smoothieking.guest_comments
      CROSS APPLY STRING_SPLIT(themes, ',')
      WHERE ${commentFilter(store)} AND source = 'Survey' AND themes <> ''
        AND CAST(${COMMENT_DATE} AS date) BETWEEN '${start}' AND '${end}'
      GROUP BY LTRIM(RTRIM(value))
      ORDER BY mentions DESC`).catch(() => [])

    // --- comments: negative first, they are the ones worth reading --------------------
    const comments = await query<CommentRow[]>(`
      SELECT TOP 200 store, source,
             CONVERT(char(16), ${COMMENT_DATE}, 120) AS [when],
             question, comment_text AS text, sentiment, osat, themes
      FROM smoothieking.guest_comments
      WHERE ${commentFilter(store)}
        AND CAST(${COMMENT_DATE} AS date) BETWEEN '${start}' AND '${end}'
      ORDER BY sentiment ASC, ${COMMENT_DATE} DESC`).catch(() => [])

    // --- reviews: Margate only, SOCi is not connected elsewhere -----------------------
    const reviews = store === 'all' || store === 'margate'
      ? await query<ReviewRow[]>(`
          SELECT site, CONVERT(char(16), review_date, 120) AS [when],
                 rating, reviewer, review_text AS text,
                 CAST(replied AS int) AS replied
          FROM smoothieking.soci_reviews
          WHERE store = 'Margate'
            AND CAST(review_date AS date) BETWEEN '${start}' AND '${end}'
          ORDER BY review_date DESC`).catch(() => [])
      : []

    return Response.json({
      range: { start, end },
      scoreScope: store === 'all' ? 'all stores' : combined ? 'Pines + Miramar combined' : 'Margate',
      commentScope: store === 'all' ? 'all stores' : COMMENT_STORE[store],
      combinedScores: combined,
      scores,
      themes,
      comments,
      reviews: reviews.map(r => ({ ...r, replied: Boolean(r.replied) })),
      counts: {
        comments: comments.length,
        negative: comments.filter(c => Number(c.sentiment) < 0).length,
        reviews: reviews.length,
      },
    } satisfies GuestVoiceDetail)
  } catch (err) {
    return Response.json({ ...EMPTY, error: String(err) })
  }
}
