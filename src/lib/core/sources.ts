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

// ── E&E (extras & enhancers) — CrunchTime's definition ───────────────────────
/**
 * Every E&E % in the app — Overview, stores, quarters, days, employees, weekday trends, the
 * Now screen — is Σ ee_qty ÷ Σ smoothie_qty over this table: the extras and enhancers guests
 * added per smoothie sold. That is the "E&E Qty %" store managers read in NetChef →
 * Crunchtime Insights → E&E Report (a Smoothie King corporate report), to the unit.
 *
 * One row per check per server, loaded from NetChef's menu mix by
 * src/scripts/load_ee_netchef.py. NetChef files each modifier with its POS prefix as its own
 * recipe: "Add On - Banana" is microcategory Modifiers (counted), "20OZ - Angel Food - NO -
 * P2 - Turbinado" is "Non-E&E Modifiers" (not counted); kids' cups ("KIDS") and bundle
 * headers ("Bundles") are not in the Smoothies microcategory. server_name 'DIGITAL' is the
 * report's DIGITAL row — online and delivery checks have no server. check_number is the
 * Brink order id. Dates are NetChef business dates.
 *
 * NOT smoothieking.sales: Brink's item export carries no modifier prefix, so an added enhancer
 * and a "NO Turbinado" line look alike there and free cup and milk lines read as add-ons. The
 * per-order attach rate built on it (orders with a 'Modifiers' line ÷ orders with a menu item)
 * ran 3–15 points off CrunchTime and was retired on 2026-10-06.
 *
 * NetChef's same-day data trails the POS by about an hour, so today's figure is "so far, as
 * of the last check NetChef has".
 */
export const EE_CHECKS = 'smoothieking.ee_check'

/** E&E and smoothies per store, business day and half-hour of the check's close (slot 0–47).
 *  `where` filters EE_CHECKS, e.g. "business_date = '2026-10-06'". */
export const eeBySlot = (where: string) => `
  SELECT store, CONVERT(char(10), business_date, 23) AS d,
         (CAST(LEFT(close_time, 2) AS int) * 60 + CAST(RIGHT(close_time, 2) AS int)) / 30 AS slot,
         SUM(ee_qty) AS ee, SUM(smoothie_qty) AS sm
    FROM ${EE_CHECKS}
   WHERE close_time IS NOT NULL AND ${where}
   GROUP BY store, CONVERT(char(10), business_date, 23),
            (CAST(LEFT(close_time, 2) AS int) * 60 + CAST(RIGHT(close_time, 2) AS int)) / 30`

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
 * to the same daily net every other surface shows. Every line of a check shares its close
 * time, so per-slot DISTINCT order counts add up across slots without double counting.
 *
 * The other columns reuse the definitions already on other screens, not new ones (E&E is
 * not here: it comes from EE_CHECKS below, never from sales lines):
 *   digital_orders           not 'To Go' / 'For Here' — cache-builder's in-store/digital split
 *   all_orders, void_orders  void rate = orders with a voided line ÷ all orders, and gross /
 *   discounts, gross         discounts as on Labor & crew (employees.ts). A voided line carries
 *                            $0 in every money column; only `price` keeps what was voided.
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
         COUNT(DISTINCT CASE WHEN s.voided = 0 THEN s.order_id END) AS orders,
         COUNT(DISTINCT s.order_id) AS all_orders,
         COUNT(DISTINCT CASE WHEN s.voided = 0 AND s.destination NOT IN ('To Go', 'For Here')
                             THEN s.order_id END) AS digital_orders,
         COUNT(DISTINCT CASE WHEN s.voided = 1 THEN s.order_id END) AS void_orders,
         SUM(CASE WHEN s.voided = 1 THEN s.price ELSE 0 END) AS void_amount,
         SUM(CASE WHEN s.voided = 0 THEN s.gross_sales ELSE 0 END) AS gross,
         SUM(s.discount_total) AS discounts
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
