import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import type { Store } from '@/lib/types'

// Jolt completion (rolling 7-day tables kept fresh by the jolt-daily cloud job).
// Per-location rollup (Complete / On-Time / Late / Missed) with nested per-checklist
// detail. Queried live from Azure SQL so it reflects last night's refresh.
//
// status in jolt_list_instances: 'completed' = on-time, 'late' = completed late,
// 'incomplete' = missed. complete = on_time + late; total = complete + missed.

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
const STORE_LABEL: Record<string, string> = {
  Pines: 'Smoothie King West Pines',
  Miramar: 'Smoothie King Miramar',
  Margate: 'Smoothie King Margate',
}
function sf(store: Store) {
  return store === 'all' ? '1=1' : `store = '${DB_STORE[store] ?? ''}'`
}

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

function dateWhere(start: string | null, end: string | null) {
  // scheduled_date is a DATE; only filter when both bounds are valid ISO dates
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (start && end && iso.test(start) && iso.test(end)) {
    return `AND scheduled_date BETWEEN '${start}' AND '${end}'`
  }
  return ''
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const store = (sp.get('store') || 'all').toLowerCase() as Store
  const dw = dateWhere(sp.get('start'), sp.get('end'))
  try {
    const raw = await query<Raw[]>(`
      SELECT store, LTRIM(RTRIM(list_name)) AS list_name,
        COUNT(*) AS total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS on_time,
        SUM(CASE WHEN status='late'      THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN status='incomplete' THEN 1 ELSE 0 END) AS missed
      FROM smoothieking.jolt_list_instances
      WHERE ${sf(store)} ${dw}
      GROUP BY store, LTRIM(RTRIM(list_name))`)

    const win = await query<{ start: string; end: string }[]>(`
      SELECT CONVERT(char(10), MIN(scheduled_date), 23) AS [start],
             CONVERT(char(10), MAX(scheduled_date), 23) AS [end]
      FROM smoothieking.jolt_list_instances WHERE ${sf(store)} ${dw}`)

    // group by store, nest per-list rows
    const byStore = new Map<string, Raw[]>()
    for (const r of raw) {
      const arr = byStore.get(r.store) ?? []
      arr.push(r); byStore.set(r.store, arr)
    }
    const locations = [...byStore.entries()].map(([storeName, items]) => ({
      store: storeName,
      label: STORE_LABEL[storeName] ?? storeName,
      ...counts(items),
      lists: items
        .map(i => ({ list_name: i.list_name, ...counts([i]) }))
        .sort((a, b) => a.complete_rate - b.complete_rate),
    })).sort((a, b) => a.complete_rate - b.complete_rate) // worst first, like the ↑ sort

    return Response.json({ window: win[0] ?? null, locations })
  } catch (err) {
    return Response.json({ window: null, locations: [], error: String(err) })
  }
}
