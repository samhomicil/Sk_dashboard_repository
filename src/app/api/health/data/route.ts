import { readFreshness } from '@/lib/core/freshnessRead'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Data freshness for every source the app reads, graded against the contract in
 * core/freshness.ts (read by lib/core/freshnessRead, which the Nexus feed watch shares).
 * Session-gated but not owner-only: a manager whose numbers are built on a stalled feed
 * needs to know that as much as an owner does.
 */
export async function GET() {
  return Response.json(await readFreshness())
}
