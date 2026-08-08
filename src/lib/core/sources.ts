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
