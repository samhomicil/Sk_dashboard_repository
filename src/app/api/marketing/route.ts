import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { requireStore } from '@/lib/store-guard'
import { etToday, isoAdd } from '@/lib/core/dates'
import type { Store } from '@/lib/types'

// The promotions calendar behind the Marketing tab: SK corporate Healthy Rewards
// offers (loaded period by period from the Blend's "Marketing Initiatives" PDFs) plus
// any internal LSM promos, from smoothieking.vw_marketing_promotions.
//
// Window: anything still running or starting within the next 90 days, plus the last
// 60 days so a manager can see what just ended. Store scope is applied in JS against
// the view's aggregated `stores` column, the same way cache-builder's fetchPromotions does.

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
const PAST_DAYS = 60
const AHEAD_DAYS = 90

export interface PromoRow {
  id: number
  source: string
  start: string
  end: string
  name: string
  description: string | null
  type: string
  value: number | null
  unit: string | null
  minPurchase: string | null
  product: string | null
  audience: string | null
  channel: string | null
  usageLimit: string | null
  loyaltyExclusive: boolean
  stores: string[]
}

export interface MarketingPayload {
  today: string
  from: string
  to: string
  promos: PromoRow[]
  error?: string
}

interface DbRow {
  promo_id: number; promo_source: string; start_date: string; end_date: string
  offer_name: string; offer_description: string | null; offer_type: string
  offer_value: number | string | null; offer_value_unit: string | null
  min_purchase_requirement: string | null; product_focus: string | null
  target_segment: string | null; channel: string | null; usage_limit: string | null
  is_loyalty_exclusive: boolean | number; stores: string | null
}

export async function GET(req: NextRequest) {
  const scoped = await requireStore(req.nextUrl.searchParams.get('store'))
  if (scoped instanceof Response) return scoped
  const store: Store = scoped

  const today = etToday()
  const from = isoAdd(today, -PAST_DAYS)
  const to = isoAdd(today, AHEAD_DAYS)
  const empty: MarketingPayload = { today, from, to, promos: [] }

  try {
    const rows = await query<DbRow[]>(`
      SELECT promo_id, promo_source,
             CONVERT(varchar(10), start_date, 23) AS start_date,
             CONVERT(varchar(10), end_date, 23)   AS end_date,
             offer_name, offer_description, offer_type, offer_value, offer_value_unit,
             min_purchase_requirement, product_focus, target_segment, channel, usage_limit,
             is_loyalty_exclusive, stores
      FROM smoothieking.vw_marketing_promotions
      WHERE start_date <= '${to}' AND end_date >= '${from}'
      ORDER BY start_date, promo_id`)

    const want = store === 'all' ? null : DB_STORE[store]
    const promos: PromoRow[] = rows
      .map(r => ({
        id: r.promo_id,
        source: r.promo_source,
        start: r.start_date,
        end: r.end_date,
        name: r.offer_name,
        description: r.offer_description,
        type: r.offer_type,
        value: r.offer_value == null ? null : Number(r.offer_value),
        unit: r.offer_value_unit,
        minPurchase: r.min_purchase_requirement,
        product: r.product_focus,
        audience: r.target_segment,
        channel: r.channel,
        usageLimit: r.usage_limit,
        loyaltyExclusive: Boolean(r.is_loyalty_exclusive),
        stores: (r.stores ?? '').split(',').map(s => s.trim()).filter(Boolean),
      }))
      .filter(p => !want || p.stores.includes(want))

    return Response.json({ ...empty, promos } satisfies MarketingPayload)
  } catch (err) {
    return Response.json({ ...empty, error: String(err) } satisfies MarketingPayload)
  }
}
