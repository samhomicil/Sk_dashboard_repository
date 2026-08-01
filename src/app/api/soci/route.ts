import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import type { Store } from '@/lib/types'

// SOCi reputation + social — pulled from smoothieking.soci_daily by /Users/sam/soci-extractor.
// Read-only daily snapshot. SOCi issues one login per account and only Margate is connected,
// so this returns data only when the selected store is Margate (or 'all').
//
// Values: avg_rating 0..5, rev_* are lifetime review counts, win_new_reviews = new reviews in
// the trailing win_days window, resp_open_* = reviews still awaiting a reply by age bucket,
// soc_* = social-publishing task counts, eng_avg_sentiment -1..1.

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }

interface SociRow {
  snapshot_date: string
  avg_rating: number | null
  rev_positive: number | null
  rev_neutral: number | null
  rev_negative: number | null
  rev_gmb: number | null
  rev_yelp: number | null
  rev_total: number | null
  win_days: number | null
  win_new_reviews: number | null
  resp_open_lt24: number | null
  resp_open_24_48: number | null
  resp_open_48_72: number | null
  resp_open_gt72: number | null
  soc_total: number | null
  soc_sent: number | null
  soc_failed: number | null
  soc_unpublished: number | null
  eng_total: number | null
  eng_avg_sentiment: number | null
}

export interface SociData {
  store: string
  snapshotDate: string
  avgRating: number | null
  reviews: { total: number; positive: number; neutral: number; negative: number; gmb: number; yelp: number }
  windowDays: number
  newReviews: number
  awaitingReply: number   // reviews open > 24h (24-48 + 48-72 + >72)
  social: { total: number; sent: number; failed: number; unpublished: number }
  engagementSentiment: number | null
  connected: boolean
}

export async function GET(req: NextRequest) {
  const store = (req.nextUrl.searchParams.get('store') || 'all').toLowerCase() as Store

  const empty: SociData = {
    store: 'Margate', snapshotDate: '', avgRating: null,
    reviews: { total: 0, positive: 0, neutral: 0, negative: 0, gmb: 0, yelp: 0 },
    windowDays: 30, newReviews: 0, awaitingReply: 0,
    social: { total: 0, sent: 0, failed: 0, unpublished: 0 },
    engagementSentiment: null, connected: false,
  }

  // Only Margate is connected; hide the feed for other single-store views.
  if (store !== 'all' && store !== 'margate') return Response.json(empty)

  try {
    const rows = await query<SociRow[]>(`
      SELECT TOP 1
        CONVERT(char(10), snapshot_date, 23) AS snapshot_date,
        avg_rating, rev_positive, rev_neutral, rev_negative, rev_gmb, rev_yelp, rev_total,
        win_days, win_new_reviews, resp_open_lt24, resp_open_24_48, resp_open_48_72, resp_open_gt72,
        soc_total, soc_sent, soc_failed, soc_unpublished, eng_total, eng_avg_sentiment
      FROM smoothieking.soci_daily
      WHERE store = '${DB_STORE.margate}'
      ORDER BY snapshot_date DESC`)

    if (rows.length === 0) return Response.json(empty)
    const r = rows[0]
    const n = (v: number | null | undefined) => Number(v ?? 0)

    return Response.json({
      store: 'Margate',
      snapshotDate: r.snapshot_date,
      avgRating: r.avg_rating,
      reviews: {
        total: n(r.rev_total), positive: n(r.rev_positive), neutral: n(r.rev_neutral),
        negative: n(r.rev_negative), gmb: n(r.rev_gmb), yelp: n(r.rev_yelp),
      },
      windowDays: n(r.win_days) || 30,
      newReviews: n(r.win_new_reviews),
      awaitingReply: n(r.resp_open_24_48) + n(r.resp_open_48_72) + n(r.resp_open_gt72),
      social: {
        total: n(r.soc_total), sent: n(r.soc_sent),
        failed: n(r.soc_failed), unpublished: n(r.soc_unpublished),
      },
      engagementSentiment: r.eng_avg_sentiment,
      connected: true,
    } satisfies SociData)
  } catch (err) {
    return Response.json({ ...empty, error: String(err) })
  }
}
