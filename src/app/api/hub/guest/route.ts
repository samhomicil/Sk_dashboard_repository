import { requireHubToken } from '@/lib/hub-guard'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/hub/guest — open SMG guest-recovery cases per store, for the Nexus agent hub.
 * Bearer HUB_TOKEN only (lib/hub-guard.ts).
 *
 * smoothieking.guest_cases holds one row per SMG reporting store per day the cases were
 * opened: opened / resolved / unresolved / inprogress counts, re-captured by the smg-daily
 * job. Open = unresolved + inprogress, summed over every day — the Guest Voice screen's
 * "pending", without its date window, because an open case stays open whatever day it
 * started. The job re-pulls only its trailing 30 days, so a day older than that keeps the
 * status of its last capture; each open day therefore carries its own captured_at.
 *
 * Stores are reported as the table names them. SMG returns cases for the two-store
 * Pines + Miramar login combined, so that row is 'Pines+Miramar' (combined: true), not two
 * stores — see api/guest-voice CASE_STORE. captured_at is the job's clock as stored (no zone).
 */

type OpenRow = { store: string; d: string; unresolved: number; inprogress: number; captured_at: string | null }
type LatestRow = { store: string; captured_at: string | null }

export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied

  try {
    const [open, latest] = await Promise.all([
      query<OpenRow[]>(`
        SELECT store, CONVERT(char(10), case_date, 23) AS d, unresolved, inprogress,
               CONVERT(varchar(19), captured_at, 120) AS captured_at
          FROM smoothieking.guest_cases WHERE unresolved > 0 OR inprogress > 0
         ORDER BY store, case_date`),
      query<LatestRow[]>(`
        SELECT store, CONVERT(varchar(19), MAX(captured_at), 120) AS captured_at
          FROM smoothieking.guest_cases GROUP BY store`),
    ])

    const stores = latest.map(l => {
      const days = open.filter(r => r.store === l.store).map(r => ({
        date: r.d, unresolved: Number(r.unresolved) || 0, inprogress: Number(r.inprogress) || 0,
        capturedAt: r.captured_at,
      }))
      const unresolved = days.reduce((s, d) => s + d.unresolved, 0)
      const inprogress = days.reduce((s, d) => s + d.inprogress, 0)
      const covers = l.store.split('+').map(s => s.trim())
      return {
        store: l.store,
        combined: covers.length > 1,
        covers,
        label: covers.length > 1 ? `${covers.join(' + ')} (combined in SMG)` : l.store,
        open: unresolved + inprogress, unresolved, inprogress,
        oldestOpen: days[0]?.date ?? null,
        days,
        latestCapturedAt: l.captured_at,
      }
    }).sort((a, b) => a.store.localeCompare(b.store))

    const latestCapturedAt = stores.reduce<string | null>((m, s) =>
      s.latestCapturedAt && (!m || s.latestCapturedAt > m) ? s.latestCapturedAt : m, null)
    return Response.json({ latestCapturedAt, stores }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[hub/guest]', err)
    return Response.json({ error: 'query failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
