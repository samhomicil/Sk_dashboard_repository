/**
 * Checklist completion payload (/api/checklists), shared by useDashboard and ChecklistPanel.
 * Same shape the Jolt panel used, so the table and its maths carried over unchanged when the
 * stores moved their checklists to Ops Execution (Oct 2026).
 */
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
