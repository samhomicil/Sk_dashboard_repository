/**
 * DATA FRESHNESS CONTRACT — one registry for every source the app reads.
 *
 * Why this exists: a module can only be as accurate as the data under it, and a
 * stalled extractor is invisible — the surface renders a confident number over data
 * that stopped updating days ago. That has happened repeatedly and silently:
 * `netchef_usage` held one week while a trailing-8-week COGS average was computed
 * from it, and on 2026-08-04 an ad-hoc check found `walmart_spend` 8 days behind
 * (understating food cost in Overview, Budget AND Inventory at once) and
 * `guest_feedback` 8 days behind, with nothing anywhere reporting either.
 *
 * Every table the app queries MUST be declared here. `npm run check` fails the build
 * if a source is queried but undeclared, so the registry cannot silently fall behind
 * the code.
 *
 * `maxAgeDays` is the point at which the data is untrustworthy for its consumers —
 * NOT the ingest cadence. A weekly feed can be 8 days old and fine; a daily feed at
 * 3 days old is broken.
 */

export type Cadence = 'realtime' | 'daily' | 'weekly' | 'monthly' | 'on-demand'

export interface SourceContract {
  /** schema-qualified table/view as it appears in queries */
  table: string
  /** human name used in the UI */
  label: string
  /** the column that advances as new data lands */
  dateColumn: string
  /** how often the upstream job is expected to write */
  cadence: Cadence
  /** older than this and the data should not be trusted by its consumers */
  maxAgeDays: number
  /** what writes it — where to look when it goes stale */
  fedBy: string
  /** modules that break (quietly) when this is stale */
  consumers: string[]
  /** dates land in the future by design (a posted schedule), so don't age-check */
  forwardLooking?: boolean
  /**
   * A source still QUERIED but no longer FED — a fallback kept as insurance behind a
   * live one. It is declared here because the registry must account for every table
   * the app touches, but it makes no freshness promise, so it cannot raise a stale
   * warning about data nothing is waiting on.
   *
   * `why` says what superseded it, so a future reader can decide to delete it rather
   * than rediscover why it never updates.
   */
  standby?: { why: string }
}

export const SOURCES: SourceContract[] = [
  // ── Sales / POS ────────────────────────────────────────────────────────────
  { table: 'smoothieking.sales', label: 'POS sales', dateColumn: 'closed_datetime',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'Brink extractor',
    consumers: ['Overview', 'Weekly Ops', 'Budget', 'Cash Flow', 'Menu Mix', 'Inventory'] },
  { table: 'smoothieking.tillhistory', label: 'Tills & tips', dateColumn: 'till_date',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'Brink extractor',
    consumers: ['Cash Flow', 'Budget', 'payroll model'] },
  // The menu taxonomy: item -> Smoothies / Smoothie Bowls / Food / Retail / Modifiers,
  // derived from Brink's Product Mix by Item Group. A catalogue, not a transaction
  // feed — it only moves when the menu does, so a fortnight is not stale. It replaced
  // data/menu-mix.json, a hand-refreshed Sigma export that silently went two months
  // out of date and blanked the category and product panels.
  { table: 'smoothieking.menu_item_category', label: 'Menu taxonomy', dateColumn: 'synced_at',
    cadence: 'weekly', maxAgeDays: 14, fedBy: 'Brink extractor (run_pmix.py)',
    consumers: ['Overview category mix', 'Overview top products'] },

  // ── Labor ──────────────────────────────────────────────────────────────────
  { table: 'smoothieking.labor', label: 'Labor actuals', dateColumn: 'shift_date',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'Brink timecard extractor',
    consumers: ['Overview', 'Weekly Ops', 'Budget', 'Cash Flow', 'Employees'] },
  { table: 'smoothieking.labor_schedule', label: 'Posted schedule', dateColumn: 'work_date',
    cadence: 'daily', maxAgeDays: 3, fedBy: 'Brink schedule extractor', forwardLooking: true,
    consumers: ['Weekly Ops', 'Budget', 'payroll model'] },

  // ── Employee module ────────────────────────────────────────────────────────
  // Same Brink feed as labor, so the same 2-day contract. Break records drive minor-hour
  // compliance, which is a legal exposure rather than a reporting nicety — a stale feed
  // there means a violation goes unflagged, not just a number going soft.
  { table: 'smoothieking.employee_breaks', label: 'Employee breaks', dateColumn: 'business_date',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'Brink timecard extractor',
    consumers: ['Employees', 'minor-hour compliance'] },
  { table: 'smoothieking.employee_sales', label: 'Per-employee sales', dateColumn: 'business_date',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'Brink extractor',
    consumers: ['Employees'] },
  { table: 'smoothieking.labor_edits', label: 'Timecard edits', dateColumn: 'business_date',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'Brink timecard extractor',
    consumers: ['Employees', 'labor audit'] },
  { table: 'smoothieking.manager_overrides', label: 'Manager overrides', dateColumn: 'approval_time',
    cadence: 'daily', maxAgeDays: 3, fedBy: 'Brink extractor',
    consumers: ['Employees', 'labor audit'] },
  // Reference data, not a feed: rows change when someone is hired or aliased, so age is
  // not a health signal. Generous contracts so they never raise a false alarm, but they
  // stay registered — an unregistered table is one nobody notices has stopped updating.
  { table: 'smoothieking.vw_employee_dim', label: 'Employee roster (view)', dateColumn: 'hired_date',
    cadence: 'weekly', maxAgeDays: 400, fedBy: 'Brink HR sync',
    consumers: ['Employees'] },
  { table: 'smoothieking.employee_hr_netchef', label: 'NetChef HR records', dateColumn: 'date_of_birth',
    cadence: 'weekly', maxAgeDays: 40000, fedBy: 'netchef sync_hr',
    consumers: ['Employees', 'minor-hour compliance'] },
  { table: 'smoothieking.employee_alias', label: 'Employee name aliases', dateColumn: 'created_at',
    cadence: 'weekly', maxAgeDays: 400, fedBy: 'manual mapping',
    consumers: ['Employees', 'Weekly Ops'] },

  // ── Food ───────────────────────────────────────────────────────────────────
  { table: 'smoothieking.pfs_invoices', label: 'PFG invoices', dateColumn: 'invoice_date',
    cadence: 'weekly', maxAgeDays: 6, fedBy: 'pfg-portal extractor',
    consumers: ['Budget', 'Inventory', 'Cash Flow', 'Weekly Ops'] },
  { table: 'smoothieking.pfg_compat', label: 'PFG (view alias)', dateColumn: 'order_date',
    cadence: 'weekly', maxAgeDays: 6, fedBy: 'view over pfs_invoices',
    consumers: ['Inventory'] },
  { table: 'smoothieking.walmart_spend', label: 'Walmart spend', dateColumn: 'order_date',
    cadence: 'daily', maxAgeDays: 4, fedBy: 'walmart-extractor',
    consumers: ['Overview', 'Budget', 'Inventory'] },

  // ── Inventory / COGS ───────────────────────────────────────────────────────
  { table: 'smoothieking.netchef_usage_api', label: 'Recipe usage (COGS)', dateColumn: 'period_end',
    cadence: 'weekly', maxAgeDays: 10, fedBy: 'netchef-extractor',
    consumers: ['Overview', 'Weekly Ops', 'Budget', 'Inventory'] },
  { table: 'smoothieking.netchef_onhand', label: 'On-hand inventory', dateColumn: 'as_of',
    cadence: 'daily', maxAgeDays: 3, fedBy: 'netchef-extractor',
    consumers: ['Inventory', 'Shrink'] },
  // The full weekly physical inventory. core/onHand anchors the nightly count chain to
  // it, so if this goes stale every on-hand figure quietly drifts on recipe usage alone
  // — with no count to re-anchor it, an "estimated" line only gets softer.
  { table: 'smoothieking.netchef_usage', label: 'Weekly physical inventory (count anchor)',
    dateColumn: 'period_end', cadence: 'weekly', maxAgeDays: 14, fedBy: 'netchef-extractor',
    consumers: ['Order Guide', 'Inventory'] },

  // ── Guest ──────────────────────────────────────────────────────────────────
  { table: 'smoothieking.guest_daily', label: 'Guest scores (daily)', dateColumn: 'survey_date',
    cadence: 'daily', maxAgeDays: 3, fedBy: 'smg-extractor',
    consumers: ['Overview', 'Guest Voice'] },
  { table: 'smoothieking.guest_feedback', label: 'Guest surveys (period)', dateColumn: 'period_end',
    cadence: 'on-demand', maxAgeDays: 10, fedBy: 'smg-extractor main.py (not scheduled)',
    consumers: ['Guest Voice (fallback only)'],
    standby: {
      why: 'Superseded by guest_daily, which is per-store and current. This table is the '
         + 'older single-store period grain and is only read when the daily table has no '
         + 'rows for a range, so Guest Voice degrades to "nearest period" instead of going '
         + 'blank. Nothing schedules it — run_cloud.py never calls main.py — so it has sat '
         + 'at 2026-07-28 since the manual runs stopped, raising a stale warning about data '
         + 'no live surface reads. Delete both this and the fallback branch in '
         + 'api/guest-satisfaction when the daily table has proven itself.',
    } },
  { table: 'smoothieking.guest_comments', label: 'Guest comments', dateColumn: 'received_date',
    cadence: 'daily', maxAgeDays: 5, fedBy: 'smg-extractor', consumers: ['Guest Voice'] },
  { table: 'smoothieking.guest_cases', label: 'Guest cases', dateColumn: 'case_date',
    cadence: 'daily', maxAgeDays: 5, fedBy: 'smg-extractor', consumers: ['Guest Voice'] },

  // ── Ops / SOPs / social ────────────────────────────────────────────────────
  { table: 'smoothieking.jolt_list_instances', label: 'Jolt SOP lists', dateColumn: 'scheduled_date',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'jolt-extractor', forwardLooking: true,
    consumers: ['Ops / SOPs'] },
  { table: 'smoothieking.jolt_image_quality', label: 'Jolt photo scores', dateColumn: 'captured_datetime',
    cadence: 'daily', maxAgeDays: 4, fedBy: 'jolt-extractor', consumers: ['Ops / SOPs'] },
  { table: 'smoothieking.soci_daily', label: 'SOCi social (daily)', dateColumn: 'snapshot_date',
    cadence: 'daily', maxAgeDays: 4, fedBy: 'soci-extractor', consumers: ['Guest Voice'] },
  { table: 'smoothieking.soci_reviews', label: 'SOCi reviews', dateColumn: 'review_date',
    cadence: 'daily', maxAgeDays: 7, fedBy: 'soci-extractor', consumers: ['Guest Voice'] },

  // ── Marketing ──────────────────────────────────────────────────────────────
  { table: 'smoothieking.vw_marketing_promotions', label: 'Promotions', dateColumn: 'end_date',
    cadence: 'on-demand', maxAgeDays: 400, fedBy: 'manual entry', forwardLooking: true,
    consumers: ['Marketing', 'forecast holiday factor'] },

  // ── Derived / app-owned ────────────────────────────────────────────────────
  { table: 'smoothieking.dashboard_cache', label: 'Dashboard cache', dateColumn: 'refreshed_at',
    cadence: 'daily', maxAgeDays: 2, fedBy: '/api/ingest-refresh (6am cloud routine)',
    consumers: ['Overview', 'Menu Mix', 'heatmap'] },
  { table: 'sk_bills.Forecast', label: 'Cash forecast', dateColumn: 'as_of',
    cadence: 'daily', maxAgeDays: 2, fedBy: 'cash-forecast/forecast.py --write (MANUAL today)',
    consumers: ['Cash Flow'] },
  { table: 'sk_bills.QbBalance', label: 'Bank balances', dateColumn: 'updatedAt',
    cadence: 'daily', maxAgeDays: 2, fedBy: '/api/sync (OpenBudget, 06:00 UTC cron)',
    consumers: ['Cash Flow', 'Bills'] },
  { table: 'sk_bills.Sales', label: 'Monthly sales base', dateColumn: 'updatedAt',
    cadence: 'monthly', maxAgeDays: 40, fedBy: 'bills app', consumers: ['Bills', 'Budget'] },
  { table: 'sk_bills.Bill', label: 'Bill schedule', dateColumn: 'updatedAt',
    cadence: 'on-demand', maxAgeDays: 400, fedBy: 'manual entry in the bills app',
    consumers: ['Bills', 'Budget', 'Cash Flow'] },
]

export type Health = 'ok' | 'stale' | 'unknown'

export interface SourceStatus extends SourceContract {
  latest: string | null
  ageDays: number | null
  health: Health
}

/** Grade one source against its contract. `latest` is the max of its dateColumn. */
export function grade(c: SourceContract, latest: string | null, today: string): SourceStatus {
  if (!latest) return { ...c, latest: null, ageDays: null, health: 'unknown' }
  const ms = Date.parse(today + 'T00:00:00Z') - Date.parse(latest + 'T00:00:00Z')
  const ageDays = Math.round(ms / 86_400_000)
  // A forward-looking source (posted schedule, promo calendar) is healthy while its
  // newest row is still in the future; it only ages once the horizon has passed.
  // A standby source is never graded stale: nothing waits on it, and a warning about
  // data no consumer reads is noise that teaches people to ignore the panel.
  const health: Health = c.standby ? 'ok' : ageDays <= c.maxAgeDays ? 'ok' : 'stale'
  return { ...c, latest, ageDays, health }
}

/** The SQL that reads every source's latest date in one round trip. */
export function latestDateSql(): string {
  return SOURCES.map(s =>
    `SELECT '${s.table}' AS t, CONVERT(char(10), MAX(CAST([${s.dateColumn}] AS date)), 23) AS d FROM ${s.table}`,
  ).join(' UNION ALL ')
}
