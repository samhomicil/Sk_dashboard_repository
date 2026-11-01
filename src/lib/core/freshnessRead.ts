import 'server-only'
import { query } from '@/lib/db'
import { SOURCES, grade, latestDateSql, type SourceStatus } from '@/lib/core/freshness'
import { etToday } from '@/lib/core/dates'

/**
 * Every source graded against its contract in core/freshness.ts: the one reading behind
 * /api/health/data (signed-in users) and /api/hub/feeds (the Nexus feed watch), so the
 * two can never disagree about what is stale.
 *
 * One UNION ALL round trip rather than one query per source. A source that errors reports
 * `unknown` rather than failing the whole reading: a broken table shouldn't hide the
 * health of the others.
 */
export async function readFreshness() {
  let rows: { t: string; d: string | null }[] = []
  try {
    rows = await query<{ t: string; d: string | null }[]>(latestDateSql())
  } catch {
    // fall back to per-source so one bad table can't blind the whole check
    rows = []
    for (const s of SOURCES) {
      try {
        const r = await query<{ d: string | null }[]>(
          `SELECT CONVERT(char(10), MAX(CAST([${s.dateColumn}] AS date)), 23) AS d FROM ${s.table}`)
        rows.push({ t: s.table, d: r[0]?.d ?? null })
      } catch { rows.push({ t: s.table, d: null }) }
    }
  }

  const today = etToday()
  const latest = new Map(rows.map(r => [r.t, r.d]))
  const sources: SourceStatus[] = SOURCES
    .map(s => grade(s, latest.get(s.table) ?? null, today))
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))

  const stale = sources.filter(s => s.health === 'stale')
  const unknown = sources.filter(s => s.health === 'unknown')
  // Which modules are currently reading from something stale — the number a person
  // actually needs, since nobody thinks in table names.
  const affected = [...new Set(stale.flatMap(s => s.consumers))].sort()

  return {
    ok: stale.length === 0 && unknown.length === 0,
    checkedAt: new Date().toISOString(),
    today,
    counts: { total: sources.length, ok: sources.length - stale.length - unknown.length,
              stale: stale.length, unknown: unknown.length },
    affectedModules: affected,
    sources,
  }
}
