import { requireHubToken } from '@/lib/hub-guard'
import { readFreshness } from '@/lib/core/freshnessRead'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/hub/feeds — every data source graded for freshness, for the Nexus feed watch.
 * Bearer HUB_TOKEN only (lib/hub-guard.ts). The same reading as /api/health/data; the hub
 * decides which stale sources need Sam (each source carries its area and whether it is
 * event-driven, from core/freshness.ts).
 *
 * Why freshness and not the Azure jobs' status: every job reports Succeeded on nights its
 * data stops moving (a page that changed, a login that lapsed, a manual pull nobody ran),
 * so the only trustworthy signal is whether the data itself advanced.
 */
export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied
  try {
    return Response.json(await readFreshness(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[hub/feeds]', err)
    return Response.json({ error: 'freshness unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
