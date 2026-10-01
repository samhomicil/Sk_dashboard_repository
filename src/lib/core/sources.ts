import 'server-only'

/**
 * Canonical spend / sales SQL — the SINGLE definition of each metric's source.
 *
 * Every module (Overview, Budget, Inventory, Ops-Week, Bills) MUST build these
 * numbers from here, so no two surfaces ever compute the same metric from a
 * different table or column. If a number needs to change, it changes once, here.
 *
 * FOOD is GOODS basis (pre-fee / pre-tax), so PFG and Walmart are apples-to-apples
 * and comparable to a food-cost % target:
 *   PFG     = smoothieking.pfs_invoices.ext_price, ALL invoice types
 *             (nets Credits/Adjustments, which are money back). `pfg_compat` is a
 *             view alias of this table (ext_price AS line_total) — same numbers.
 *   Walmart = smoothieking.walmart_spend.order_subtotal, taken once per order_id.
 *             The item-level columns (item_subtotal / item_net_total) are sparsely
 *             populated (~44% of orders blank) → summing them UNDERCOUNTS. The
 *             order-level order_subtotal is complete and is the goods figure.
 *   Sales   = smoothieking.sales.net_sales where voided=0 and is_modifier=0.
 *
 * Each builder takes a WHERE clause so callers supply their own window / store
 * filter, but the table + column + filter that define the metric live only here.
 */

// ── FOOD: PFG (goods, all invoice types) ────────────────────────────────────
export const pfgFood = {
  /** Scalar total. `where` must constrain invoice_date (+ optional store filter). */
  total: (where: string) =>
    `SELECT ISNULL(SUM(ext_price),0) AS v FROM smoothieking.pfs_invoices WHERE ${where}`,
  /** Per store + day (store = last 4 of store_number). */
  byStoreDay: (where: string) =>
    `SELECT RIGHT(store_number,4) AS store, CONVERT(char(10),invoice_date,23) AS d, SUM(ext_price) AS total
       FROM smoothieking.pfs_invoices WHERE ${where}
      GROUP BY RIGHT(store_number,4), invoice_date`,
  /** Per day, all stores. */
  byDay: (where: string) =>
    `SELECT CONVERT(char(10),invoice_date,23) AS d, SUM(ext_price) AS spend
       FROM smoothieking.pfs_invoices WHERE ${where}
      GROUP BY CONVERT(char(10),invoice_date,23)`,
}

// ── FOOD: Walmart (goods, distinct order) ───────────────────────────────────
export const wmtFood = {
  /** Scalar total. `where` must constrain order_date (+ optional store filter). */
  total: (where: string) =>
    `SELECT ISNULL(SUM(order_subtotal),0) AS v
       FROM (SELECT DISTINCT order_id, order_subtotal FROM smoothieking.walmart_spend WHERE ${where}) t`,
  /** Per day, all stores. */
  byDay: (where: string) =>
    `SELECT CONVERT(char(10),order_date,23) AS d, SUM(order_subtotal) AS spend
       FROM (SELECT DISTINCT order_id, order_date, order_subtotal FROM smoothieking.walmart_spend WHERE ${where}) t
      GROUP BY CONVERT(char(10),order_date,23)`,
}

// ── NET SALES ───────────────────────────────────────────────────────────────
/** The canonical net-sales measure inside smoothieking.sales. Sum this expression. */
export const NET_SALES = `SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END)`

/**
 * Labor hours + pay per store per day — read this, never smoothieking.labor, for any
 * hours or labor-cost aggregate. It is a database VIEW so the daily recap email (Python)
 * reads the identical definition. Owners are never labor hours; the salaried manager
 * counts only on days he is scheduled, at his scheduled hours (his clocked hours are not
 * usable — Brink auto-closes his shift ~1:15am). Sam, 2026-09-30. Columns: store,
 * d (date), hours, pay, plus the parts (crew_hrs, salaried_sched_hrs, …) for audit.
 */
export const LABOR_DAILY = 'smoothieking.vw_labor_hours_daily'

/**
 * Shifts on the floor (store, employee, role, d, shift_start, shift_end, basis) — the
 * staffing heatmap's source, with the same rule as LABOR_DAILY: no owners; the salaried
 * manager only on scheduled days, at his scheduled times (basis = 'schedule'); hourly
 * crew at their actual clock times (basis = 'clock').
 */
export const LABOR_SHIFTS = 'smoothieking.vw_labor_floor_shifts'

// ── UNITS + SALES BY HALF-HOUR (the Now screen) ─────────────────────────────
/**
 * A MADE UNIT is the unit of work behind the counter (Sam, 2026-10-01: staffing is judged
 * in units, not orders — an order averages 1.33 units but runs 2+ in one busy half-hour in
 * ten). One unit = one non-modifier sales line (Brink writes one line per item sold) that is
 *   • a Smoothie, Smoothie Bowl or Food item in smoothieking.menu_item_category — names
 *     normalised, because the POS swaps spaces for underscores ('Angel Food_Slim 20'), or
 *   • an item the taxonomy does not know that carries a price (the Hi Pro coffee drinks).
 * A bowl counts as one unit, the same as a smoothie. NOT units: modifiers, retail, and two
 * $0 HEADER lines whose contents are already their own lines — "Olo ID: …" (one per online
 * order, ~3,650/month) and "20oz & Flatbread/Toast Bundle" (its smoothie and its food are
 * separate lines with the money). Counting either would double-count.
 *
 * `where` filters smoothieking.sales aliased `s`, e.g. "s.closed_datetime >= '2026-10-01'".
 * slot = half-hour of the day, 0–47 (slot 19 = 9:30–10:00). net is NET_SALES, so slots sum
 * to the same daily net every other surface shows.
 */
export const salesBySlot = (where: string) => `
  WITH c AS (
    SELECT LOWER(REPLACE(LTRIM(RTRIM(item_name)), '_', ' ')) AS k, MAX(category) AS category
      FROM smoothieking.menu_item_category
     GROUP BY LOWER(REPLACE(LTRIM(RTRIM(item_name)), '_', ' ')))
  SELECT s.store, CONVERT(char(10), s.closed_datetime, 23) AS d,
         DATEPART(hour, s.closed_datetime) * 2 + DATEPART(minute, s.closed_datetime) / 30 AS slot,
         ${NET_SALES} AS net,
         SUM(CASE WHEN s.voided = 0 AND s.is_modifier = 0
                   AND s.item_name NOT LIKE 'Olo ID:%' AND s.item_name NOT LIKE '%Bundle'
                   AND (c.category IN ('Smoothies', 'Smoothie Bowls', 'Food')
                        OR (c.category IS NULL AND s.gross_sales > 0))
                  THEN 1 ELSE 0 END) AS units,
         COUNT(DISTINCT CASE WHEN s.voided = 0 THEN s.order_id END) AS orders
    FROM smoothieking.sales s
    LEFT JOIN c ON c.k = LOWER(REPLACE(LTRIM(RTRIM(s.item_name)), '_', ' '))
   WHERE ${where}
   GROUP BY s.store, CONVERT(char(10), s.closed_datetime, 23),
            DATEPART(hour, s.closed_datetime) * 2 + DATEPART(minute, s.closed_datetime) / 30`

/** Each employee's most-recent hourly rate — the daily recap's rate_lookup, fed to
 *  core/labor buildRateFor (which adds the store-average and DEFAULT_RATE fallbacks). */
export const LATEST_RATES = `
  SELECT store, employee, rate FROM (
    SELECT store, employee, rate,
           ROW_NUMBER() OVER (PARTITION BY store, employee ORDER BY shift_date DESC) rn
    FROM smoothieking.labor WHERE rate > 0) t WHERE rn = 1`

/** The brink-intraday job's run log: one row per 30-minute pull (ET wall clock). */
export const INTRADAY_RUNS = 'smoothieking.intraday_runs'
