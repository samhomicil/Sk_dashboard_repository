import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import type { Store } from '@/lib/types'
import { requireStore } from '@/lib/store-guard'
import { CHECKLIST_SINCE } from '@/lib/core/targets'
import type { SopData } from '@/components/checklistTypes'

// Checklist completion from Crunchtime Ops Execution (the stores left Jolt in Oct 2026).
// smoothieking.opsx_projects holds every scheduled checklist run, each due at all three
// stores; opsx_submissions holds what each store submitted and which run it fulfilled. Both
// are reloaded nightly by the opsx-extractor (Container Apps job jolt-daily).
//
// Per store per checklist over [start, end] by due date, counted from the store's
// CHECKLIST_SINCE day: on time = first submission by the run's due time, late = after it,
// missed = never submitted. A run not yet due and not yet done is left out, not missed.

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
const STORE_LABEL: Record<string, string> = {
  Pines: 'Smoothie King West Pines',
  Miramar: 'Smoothie King Miramar',
  Margate: 'Smoothie King Margate',
}
const ISO = /^\d{4}-\d{2}-\d{2}$/

interface Raw { store: string; list_name: string; total: number; on_time: number; late: number; missed: number }

function counts(items: { total: number; on_time: number; late: number; missed: number }[]) {
  const t = items.reduce((a, r) => ({
    total: a.total + Number(r.total), on_time: a.on_time + Number(r.on_time),
    late: a.late + Number(r.late), missed: a.missed + Number(r.missed),
  }), { total: 0, on_time: 0, late: 0, missed: 0 })
  const complete = t.on_time + t.late
  const rate = (n: number) => (t.total ? n / t.total : 0)
  return {
    total: t.total, on_time: t.on_time, late: t.late, missed: t.missed, complete,
    complete_rate: rate(complete), on_time_rate: rate(t.on_time),
    late_rate: rate(t.late), missed_rate: rate(t.missed),
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const scoped = await requireStore(sp.get('store')); if (scoped instanceof Response) return scoped
  const store = scoped as Store
  const start = sp.get('start'), end = sp.get('end')
  const window = start && end && ISO.test(start) && ISO.test(end) ? `AND p.due_date BETWEEN '${start}' AND '${end}'` : ''
  const stores = Object.entries(CHECKLIST_SINCE)
    .filter(([s]) => store === 'all' || DB_STORE[store] === s)
    .map(([s, since]) => `('${s}', '${since}')`).join(', ')
  if (!stores) return Response.json({ window: null, locations: [] } satisfies SopData)
  try {
    const runs = `
      SELECT p.project_id, p.checklist, p.due_date, p.date_due_utc, s.store
        FROM smoothieking.opsx_projects p
        CROSS JOIN (VALUES ${stores}) s(store, since)
       WHERE p.num_tasks > 0 AND p.due_date >= s.since ${window}`
    const raw = await query<Raw[]>(`
      WITH runs AS (${runs}),
      done AS (SELECT project_id, store, MIN(submitted_utc) AS first_submitted
                 FROM smoothieking.opsx_submissions WHERE project_id IS NOT NULL GROUP BY project_id, store)
      SELECT r.store, r.checklist AS list_name, COUNT(*) AS total,
             SUM(CASE WHEN d.first_submitted <= r.date_due_utc THEN 1 ELSE 0 END) AS on_time,
             SUM(CASE WHEN d.first_submitted >  r.date_due_utc THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN d.project_id IS NULL THEN 1 ELSE 0 END) AS missed
        FROM runs r LEFT JOIN done d ON d.project_id = r.project_id AND d.store = r.store
       WHERE d.project_id IS NOT NULL OR r.date_due_utc < SYSUTCDATETIME()
       GROUP BY r.store, r.checklist`)
    const win = await query<{ start: string | null; end: string | null }[]>(`
      WITH runs AS (${runs})
      SELECT CONVERT(char(10), MIN(due_date), 23) AS [start], CONVERT(char(10), MAX(due_date), 23) AS [end]
        FROM runs WHERE date_due_utc < SYSUTCDATETIME()`)

    const byStore = new Map<string, Raw[]>()
    for (const r of raw) byStore.set(r.store, [...(byStore.get(r.store) ?? []), r])
    const locations = [...byStore.entries()].map(([s, items]) => ({
      store: s,
      label: STORE_LABEL[s] ?? s,
      ...counts(items),
      lists: items.map(i => ({ list_name: i.list_name, ...counts([i]) }))
        .sort((a, b) => a.complete_rate - b.complete_rate),
    })).sort((a, b) => a.complete_rate - b.complete_rate)   // worst first
    const w = win[0]
    return Response.json({ window: w?.start && w?.end ? { start: w.start, end: w.end } : null, locations } satisfies SopData)
  } catch (err) {
    return Response.json({ window: null, locations: [], error: String(err) })
  }
}
