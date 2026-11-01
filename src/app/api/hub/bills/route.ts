import { requireHubToken } from '@/lib/hub-guard'
import { billsSummary } from '@/lib/bills/summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/hub/bills — what the Nexus bills agent reads about bills and payments.
 * Bearer HUB_TOKEN only (lib/hub-guard.ts). The body is lib/bills/summary.ts, shared with
 * the CFO connector's /api/bills/summary; see that file for what each list means.
 */
export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied
  const noStore = { 'Cache-Control': 'no-store' }
  try {
    return Response.json(await billsSummary(), { headers: noStore })
  } catch (e) {
    return Response.json({ error: 'bills unavailable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: noStore })
  }
}
