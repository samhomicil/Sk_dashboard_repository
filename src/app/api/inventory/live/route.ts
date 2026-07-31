import { buildPurchasingLive } from '@/lib/purchasing-live'
import { resolveDateRange } from '@/lib/dates'
import type { Period } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PERIODS = new Set<Period>(['weekly', 'monthly', 'quarterly', 'ytd', 'custom'])

export async function GET(req: Request) {
  const url = new URL(req.url)
  let start = url.searchParams.get('start') ?? ''
  let end = url.searchParams.get('end') ?? ''
  // Accept either an explicit start/end or a shared Period keyword (matches the rest of
  // the dashboard's date model). Default = quarterly.
  if (!start || !end) {
    const p = url.searchParams.get('period')
    const period: Period = PERIODS.has(p as Period) ? (p as Period) : 'quarterly'
    const r = resolveDateRange(period, start || undefined, end || undefined)
    start = r.start; end = r.end
  }
  try {
    const data = await buildPurchasingLive(start, end)
    return Response.json(data, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 503 })
  }
}
