import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import type { Store } from '@/lib/types'

// Jolt photo-quality — did the SOP get done to standard, not just "a photo was uploaded"?
// Verdicts come from the daily in-flight vision scorer (smoothieking.jolt_image_quality).
// The photo itself is never stored; only the verdict row.
//
// verdict: pass | fail | neutral | cant_determine
//   quality_rate = pass / (pass + fail)   — neutral (stocking) & cant_determine excluded.

const DB_STORE: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' }
const STORE_LABEL: Record<string, string> = {
  Pines: 'Smoothie King West Pines',
  Miramar: 'Smoothie King Miramar',
  Margate: 'Smoothie King Margate',
}
function sf(store: Store) {
  return store === 'all' ? '1=1' : `store = '${DB_STORE[store] ?? ''}'`
}
function dateWhere(start: string | null, end: string | null) {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (start && end && iso.test(start) && iso.test(end)) {
    return `AND CAST(captured_datetime AS date) BETWEEN '${start}' AND '${end}'`
  }
  return ''
}

interface Raw {
  store: string; list_name: string; scored: number
  pass: number; fail: number; neutral: number; cant: number; flagged: number
}

function counts(items: Raw[]) {
  const t = items.reduce((a, r) => ({
    scored: a.scored + Number(r.scored), pass: a.pass + Number(r.pass),
    fail: a.fail + Number(r.fail), neutral: a.neutral + Number(r.neutral),
    cant: a.cant + Number(r.cant), flagged: a.flagged + Number(r.flagged),
  }), { scored: 0, pass: 0, fail: 0, neutral: 0, cant: 0, flagged: 0 })
  const graded = t.pass + t.fail
  return { ...t, graded, quality_rate: graded ? t.pass / graded : 0 }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const store = (sp.get('store') || 'all').toLowerCase() as Store
  const dw = dateWhere(sp.get('start'), sp.get('end'))
  try {
    const raw = await query<Raw[]>(`
      SELECT store, LTRIM(RTRIM(list_name)) AS list_name,
        COUNT(*) AS scored,
        SUM(CASE WHEN verdict='pass' THEN 1 ELSE 0 END) AS [pass],
        SUM(CASE WHEN verdict='fail' THEN 1 ELSE 0 END) AS fail,
        SUM(CASE WHEN verdict='neutral' THEN 1 ELSE 0 END) AS neutral,
        SUM(CASE WHEN verdict='cant_determine' THEN 1 ELSE 0 END) AS cant,
        SUM(CASE WHEN verdict='fail' OR is_duplicate=1 THEN 1 ELSE 0 END) AS flagged
      FROM smoothieking.jolt_image_quality
      WHERE ${sf(store)} ${dw}
      GROUP BY store, LTRIM(RTRIM(list_name))`)

    // flagged-photo feed: the specific failures/dupes, worst context first
    const feed = await query<{
      store: string; list_name: string; item_name: string; captured_by: string
      captured_datetime: string; verdict: string; reason: string; flags: string
      quality_score: number | null; is_duplicate: number
    }[]>(`
      SELECT TOP 60 store, LTRIM(RTRIM(list_name)) AS list_name, item_name, captured_by,
        CONVERT(char(16), captured_datetime, 120) AS captured_datetime,
        verdict, reason, flags, quality_score, is_duplicate
      FROM smoothieking.jolt_image_quality
      WHERE ${sf(store)} ${dw} AND (verdict='fail' OR is_duplicate=1)
      ORDER BY captured_datetime DESC`)

    const win = await query<{ start: string; end: string }[]>(`
      SELECT CONVERT(char(10), MIN(captured_datetime), 23) AS [start],
             CONVERT(char(10), MAX(captured_datetime), 23) AS [end]
      FROM smoothieking.jolt_image_quality WHERE ${sf(store)} ${dw}`)

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
        .sort((a, b) => a.quality_rate - b.quality_rate),
    })).sort((a, b) => a.quality_rate - b.quality_rate) // worst first

    return Response.json({ window: win[0] ?? null, locations, feed })
  } catch (err) {
    return Response.json({ window: null, locations: [], feed: [], error: String(err) })
  }
}
