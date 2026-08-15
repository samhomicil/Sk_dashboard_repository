/**
 * Jolt payload shapes, shared by useDashboard and JoltPanel.
 *
 * They used to live beside the two card components that rendered them. JoltPanel
 * merges those into one table, so the types outlived their files and moved here
 * rather than leaving two components alive purely to export an interface.
 */

/* ── completion (/api/jolt) ───────────────────────────────────────────────── */
interface SopCounts {
  total: number; on_time: number; late: number; missed: number; complete: number
  complete_rate: number; on_time_rate: number; late_rate: number; missed_rate: number
}
interface SopListRow extends SopCounts { list_name: string }
interface SopLocationRow extends SopCounts { store: string; label: string; lists: SopListRow[] }
export interface SopData {
  window: { start: string; end: string } | null
  locations: SopLocationRow[]
}


/* ── photo quality (/api/jolt-quality) ────────────────────────────────────── */
interface QualCounts {
  scored: number; pass: number; fail: number; neutral: number; cant: number
  flagged: number; graded: number; quality_rate: number
}
interface QualListRow extends QualCounts { list_name: string }
interface QualLocationRow extends QualCounts { store: string; label: string; lists: QualListRow[] }
interface FeedItem {
  store: string; list_name: string; item_name: string; captured_by: string
  captured_datetime: string; verdict: string; reason: string; flags: string
  quality_score: number | null; is_duplicate: number
}
export interface SopQualityData {
  window: { start: string; end: string } | null
  locations: QualLocationRow[]
  feed: FeedItem[]
}

