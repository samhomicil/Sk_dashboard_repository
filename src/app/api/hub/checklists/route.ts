import { requireHubToken } from '@/lib/hub-guard'
import { query } from '@/lib/db'
import { STORES, CHECKLIST_SINCE, SOP_COMPLETE_TARGET } from '@/lib/core/targets'
import { dateParams } from '@/lib/core/params'
import { etToday, lastCompleteDay } from '@/lib/core/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/hub/checklists?date=YYYY-MM-DD — one day's checklist completion per store, for
 * the Nexus agent hub. Bearer HUB_TOKEN only (lib/hub-guard.ts). date defaults to yesterday
 * (ET), the last finished day.
 *
 * The nightly recap's rule, line for line (daily-recap/recap.py checklist_completion):
 * smoothieking.opsx_daily, the view over Ops Execution's opsx_projects + opsx_submissions
 * that /api/checklists also counts from. A store counts from its CHECKLIST_SINCE day and
 * only when lists were due; otherwise counted is false and the rates are null. rate is
 * lists done ÷ lists due (temp logs are part of both, and reported separately too), and
 * below_target compares it with SOP_COMPLETE_TARGET.
 */

type Row = {
  store: string; lists_due: number; lists_done: number; lists_on_time: number
  temp_due: number; temp_done: number
}

export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied

  const d = dateParams(new URL(req.url).searchParams, ['date']); if (d instanceof Response) return d
  const date = d.date || lastCompleteDay()

  let rows: Row[]
  try {
    rows = await query<Row[]>(`
      SELECT store, lists_due, lists_done, lists_on_time, temp_due, temp_done
        FROM smoothieking.opsx_daily WHERE due_date = '${date}'`)
  } catch (err) {
    console.error('[hub/checklists]', err)
    return Response.json({ error: 'query failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }

  const stores = STORES.map(st => {
    const since = CHECKLIST_SINCE[st.name] ?? null
    const r = rows.find(x => x.store === st.name)
    const n = (v: unknown) => Number(v) || 0
    const due = n(r?.lists_due)
    const counted = since != null && date >= since && due > 0
    const rate = counted ? n(r?.lists_done) / due : null
    return {
      store: st.name, key: st.key, since, counted,
      reason: counted ? null : since == null || date < since ? 'before Ops Execution start' : 'no lists due',
      lists_due: due, lists_done: n(r?.lists_done), lists_on_time: n(r?.lists_on_time),
      temp_due: n(r?.temp_due), temp_done: n(r?.temp_done),
      rate, below_target: rate == null ? null : rate < SOP_COMPLETE_TARGET,
    }
  })

  return Response.json(
    // dayComplete false = today or later: lists not yet due still count as not done.
    { date, dayComplete: date < etToday(), target: SOP_COMPLETE_TARGET, stores },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
