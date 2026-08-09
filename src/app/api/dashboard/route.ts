import { NextRequest } from 'next/server'
import { GET as getKpis } from '../kpis/route'
import { GET as getTrend } from '../trend/route'
import { GET as getStores } from '../stores/route'
import { GET as getEmployees } from '../employees/route'
import { GET as getProducts } from '../products/route'
import { GET as getCategories } from '../categories/route'
import { GET as getChannels } from '../channels/route'
import { GET as getQuarters } from '../quarters/route'
import { GET as getHeatmap } from '../heatmap/route'
import { GET as getMeta } from '../meta/route'
import { GET as getDaily } from '../daily/route'
import { GET as getPromotions } from '../promotions/route'
import { GET as getJolt } from '../jolt/route'
import { GET as getJoltQuality } from '../jolt-quality/route'
import { GET as getGuestSat } from '../guest-satisfaction/route'
import { GET as getSoci } from '../soci/route'

export const dynamic = 'force-dynamic'

/**
 * One-shot payload for the Overview. The client used to fire 17 fetches per
 * filter change — 17 function invocations, each paying its own cold start and
 * SQL pool. This route invokes the same handlers in-process (one invocation,
 * one warm pool, shared per-instance caches) and returns the combined body.
 * Sub-handlers stay independently reachable; their logic lives with them.
 * Each section is isolated: one failing handler nulls its section instead of
 * failing the whole payload.
 */
const sub = async (h: (req: NextRequest) => Promise<Response> | Response, path: string, params: Record<string, string>) => {
  try {
    const res = await h(new NextRequest(`http://internal${path}?${new URLSearchParams(params)}`))
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const g = (k: string) => sp.get(k) ?? ''
  const store = g('store') || 'all'
  const period = g('period') || 'weekly'
  const base = { store, period, start: g('start'), end: g('end'), pyStart: g('pyStart'), pyEnd: g('pyEnd') }
  const range = { store, start: base.start, end: base.end }
  const isCustom = period === 'custom'

  const [kpis, trend, stores, employees, products, categories, channels, quarters, heatmap, meta, daily, dailyRange, promotions, jolt, joltQuality, guestSat, soci] = await Promise.all([
    sub(getKpis, '/api/kpis', base),
    sub(getTrend, '/api/trend', base),
    sub(getStores, '/api/stores', base),
    sub(getEmployees, '/api/employees', base),
    sub(getProducts, '/api/products', base),
    sub(getCategories, '/api/categories', base),
    sub(getChannels, '/api/channels', base),
    sub(getQuarters, '/api/quarters', { store, year: String(new Date().getFullYear()) }),
    sub(getHeatmap, '/api/heatmap', base),
    sub(getMeta, '/api/meta', {}),
    sub(getDaily, '/api/daily', { store }),
    isCustom
      ? sub(getDaily, '/api/daily', { store, start: base.start, end: base.end, pyStart: base.pyStart, pyEnd: base.pyEnd })
      : Promise.resolve(null),
    sub(getPromotions, '/api/promotions', { store }),
    sub(getJolt, '/api/jolt', range),
    sub(getJoltQuality, '/api/jolt-quality', range),
    sub(getGuestSat, '/api/guest-satisfaction', range),
    sub(getSoci, '/api/soci', range),
  ])

  return Response.json(
    { kpis, trend, stores, employees, products, categories, channels, quarters, heatmap, meta, daily, dailyRange, promotions, jolt, joltQuality, guestSat, soci },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
