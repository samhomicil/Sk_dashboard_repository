import { requireOwner } from '@/lib/owner-guard'
import { billsSummary } from '@/lib/bills/summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/bills/summary — what's past due, what's due in the next 7 days, what the bank
 * already paid that Pulse hasn't marked, and bank debits that matched no bill. For the
 * Store questions connector's `bills_due` module (the CFO project in Claude), so Sam's
 * phone answers from the same lib/bills/summary.ts the Nexus bills agent alerts from.
 *
 * Owner only, twice: proxy.ts gates the /api/bills prefix, and requireOwner() here
 * accepts an owner session or the owner agent token, never the manager one.
 */
export async function GET() {
  const gate = await requireOwner(); if (gate) return gate
  const noStore = { 'Cache-Control': 'no-store' }
  try {
    return Response.json(await billsSummary(), { headers: noStore })
  } catch (e) {
    return Response.json({ error: 'bills unavailable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: noStore })
  }
}
