from __future__ import annotations
import json
import logging
import os
import urllib.request
import urllib.error
from typing import Optional

logger = logging.getLogger(__name__)

PROXY_URL = "http://127.0.0.1:5001/query"
BATCH_SIZE = 100

TABLE = "smoothieking.pfg_order_line_items"

# The local proxy (127.0.0.1:5001) only exists on Sam's Mac and is unreachable
# from a cloud sandbox. When AZURE_SQL_SERVER etc are set as env vars (as they
# are in the daily cloud routine), connect straight to Azure SQL instead —
# same pattern as sk-dashboard's refresh.ts/azure-cache.ts on the Node side.
def _direct_conn():
    import pymssql  # imported lazily so local proxy-only runs don't need it installed
    return pymssql.connect(
        server=os.environ["AZURE_SQL_SERVER"],
        user=os.environ["AZURE_SQL_USER"],
        password=os.environ["AZURE_SQL_PASSWORD"],
        database=os.environ.get("AZURE_SQL_DATABASE", "master"),
        as_dict=True,
    )

CREATE_SQL = f"""
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='smoothieking' AND TABLE_NAME='pfg_order_line_items'
)
BEGIN
    CREATE TABLE {TABLE} (
        line_item_id           NVARCHAR(20)  NOT NULL,
        order_number           NVARCHAR(20)  NULL,
        po_number              NVARCHAR(50)  NULL,
        order_date             DATE          NULL,
        order_time             NVARCHAR(10)  NULL,
        order_day_of_week      NVARCHAR(10)  NULL,
        order_week             DATE          NULL,
        order_month            NVARCHAR(7)   NULL,
        order_year             SMALLINT      NULL,
        delivery_date_est      DATE          NULL,
        store_number           NVARCHAR(10)  NULL,
        store_name             NVARCHAR(100) NULL,
        store_address          NVARCHAR(200) NULL,
        store_city             NVARCHAR(100) NULL,
        store_state            CHAR(2)       NULL,
        store_zip              CHAR(10)      NULL,
        distributor            NVARCHAR(100) NULL,
        pfs_branch_code        NVARCHAR(10)  NULL,
        ordered_by             NVARCHAR(100) NULL,
        item_code              NVARCHAR(50)  NULL,
        product_description    NVARCHAR(MAX) NULL,
        brand_manufacturer     NVARCHAR(200) NULL,
        sk_proprietary_flag    BIT           NULL,
        pack_size_raw          NVARCHAR(50)  NULL,
        pack_count             INT           NULL,
        unit_size              FLOAT         NULL,
        unit_size_uom          NVARCHAR(20)  NULL,
        uom_unknown_flag       BIT           NULL,
        order_uom              NVARCHAR(5)   NULL,
        qty_confirmed          SMALLINT      NULL,
        qty_line               SMALLINT      NULL,
        unit_price             FLOAT         NULL,
        line_total             FLOAT         NULL,
        total_base_units       FLOAT         NULL,
        cost_per_base_unit     FLOAT         NULL,
        exception_note         NVARCHAR(MAX) NULL,
        substitution_item_code NVARCHAR(50)  NULL,
        stockout_flag          BIT           NULL,
        non_returnable_flag    BIT           NULL,
        order_total            FLOAT         NULL,
        order_qty_total        SMALLINT      NULL,
        order_line_count       SMALLINT      NULL,
        product_key            NVARCHAR(100) NULL,
        product_key_status     NVARCHAR(50)  NULL,
        source_message_id      NVARCHAR(200) NULL,
        source_subject         NVARCHAR(MAX) NULL,
        date_imported          DATETIME2(0)  NULL,
        CONSTRAINT PK_pfg_order_line_items PRIMARY KEY (line_item_id)
    )
END
"""

COLS = (
    "line_item_id, order_number, po_number, order_date, order_time, "
    "order_day_of_week, order_week, order_month, order_year, delivery_date_est, "
    "store_number, store_name, store_address, store_city, store_state, store_zip, "
    "distributor, pfs_branch_code, ordered_by, item_code, product_description, "
    "brand_manufacturer, sk_proprietary_flag, pack_size_raw, pack_count, unit_size, "
    "unit_size_uom, uom_unknown_flag, order_uom, qty_confirmed, qty_line, "
    "unit_price, line_total, total_base_units, cost_per_base_unit, exception_note, "
    "substitution_item_code, stockout_flag, non_returnable_flag, order_total, "
    "order_qty_total, order_line_count, product_key, product_key_status, "
    "source_message_id, source_subject, date_imported"
)


# ── DB helpers (direct Azure SQL if configured, else local proxy) ─────────────

def _post_direct(sql: str) -> dict:
    try:
        conn = _direct_conn()
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall() if cursor.description else []
        conn.commit()
        conn.close()
        return {"rows": rows}
    except Exception as exc:
        return {"error": str(exc)}


def _post(sql: str, proxy_url: str = PROXY_URL) -> dict:
    if os.environ.get("AZURE_SQL_SERVER"):
        return _post_direct(sql)
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        proxy_url, data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())
    except Exception as exc:
        return {"error": str(exc)}


# ── Value serialisers ─────────────────────────────────────────────────────────

def _q(v) -> str:
    """String or NULL."""
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def _n(v) -> str:
    """Numeric (int or float) or NULL."""
    if v is None or v == "":
        return "NULL"
    try:
        f = float(v)
        return str(int(f)) if f == int(f) and "." not in str(v) else str(f)
    except (ValueError, TypeError):
        return "NULL"


def _bit(v) -> str:
    """BIT: 1/0, handle Python bool and string."""
    if v is None or v == "":
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if str(v).lower() in ("true", "1", "yes"):
        return "1"
    return "0"


def _date(v) -> str:
    """DATE as 'YYYY-MM-DD' or NULL."""
    if not v:
        return "NULL"
    return f"'{v}'"


def _dt(v) -> str:
    """DATETIME2 as 'YYYY-MM-DD HH:MM:SS' (strips trailing ' UTC' if present)."""
    if not v:
        return "NULL"
    clean = str(v).replace(" UTC", "").strip()
    return f"'{clean}'"


def _build_values(row: dict) -> str:
    return (
        f"({_q(row.get('line_item_id'))},"
        f"{_q(row.get('order_number'))},"
        f"{_q(row.get('po_number'))},"
        f"{_date(row.get('order_date'))},"
        f"{_q(row.get('order_time'))},"
        f"{_q(row.get('order_day_of_week'))},"
        f"{_date(row.get('order_week'))},"
        f"{_q(row.get('order_month'))},"
        f"{_n(row.get('order_year'))},"
        f"{_date(row.get('delivery_date_est'))},"
        f"{_q(row.get('store_number'))},"
        f"{_q(row.get('store_name'))},"
        f"{_q(row.get('store_address'))},"
        f"{_q(row.get('store_city'))},"
        f"{_q(row.get('store_state'))},"
        f"{_q(row.get('store_zip'))},"
        f"{_q(row.get('distributor'))},"
        f"{_q(row.get('pfs_branch_code'))},"
        f"{_q(row.get('ordered_by'))},"
        f"{_q(row.get('item_code'))},"
        f"{_q(row.get('product_description'))},"
        f"{_q(row.get('brand_manufacturer'))},"
        f"{_bit(row.get('sk_proprietary_flag'))},"
        f"{_q(row.get('pack_size_raw'))},"
        f"{_n(row.get('pack_count'))},"
        f"{_n(row.get('unit_size'))},"
        f"{_q(row.get('unit_size_uom'))},"
        f"{_bit(row.get('uom_unknown_flag'))},"
        f"{_q(row.get('order_uom'))},"
        f"{_n(row.get('qty_confirmed'))},"
        f"{_n(row.get('qty_line'))},"
        f"{_n(row.get('unit_price'))},"
        f"{_n(row.get('line_total'))},"
        f"{_n(row.get('total_base_units'))},"
        f"{_n(row.get('cost_per_base_unit'))},"
        f"{_q(row.get('exception_note'))},"
        f"{_q(row.get('substitution_item_code'))},"
        f"{_bit(row.get('stockout_flag'))},"
        f"{_bit(row.get('non_returnable_flag'))},"
        f"{_n(row.get('order_total'))},"
        f"{_n(row.get('order_qty_total'))},"
        f"{_n(row.get('order_line_count'))},"
        f"{_q(row.get('product_key'))},"
        f"{_q(row.get('product_key_status'))},"
        f"{_q(row.get('source_message_id'))},"
        f"{_q(row.get('source_subject'))},"
        f"{_dt(row.get('date_imported'))})"
    )


# ── Public API ────────────────────────────────────────────────────────────────

def ensure_table(proxy_url: str = PROXY_URL) -> None:
    """Create the table if it doesn't exist."""
    result = _post(CREATE_SQL.strip(), proxy_url)
    if "error" in result:
        raise RuntimeError(f"Failed to create table: {result['error']}")
    logger.info("Table %s ready", TABLE)


def load_existing_ids(proxy_url: str = PROXY_URL) -> set[str]:
    """Return the set of line_item_ids already in the DB."""
    result = _post(
        f"SELECT line_item_id FROM {TABLE}",
        proxy_url,
    )
    if "error" in result:
        logger.warning("Could not load existing IDs: %s — proceeding without dedup", result["error"])
        return set()
    return {r["line_item_id"] for r in result.get("rows", [])}


def get_store_watermarks(proxy_url: str = PROXY_URL) -> dict[str, str]:
    """Return {store_number: max(order_date)} already loaded, per store.

    Used instead of the local seen-message-ID state file when running in a
    cloud routine (which gets a fresh clone every run, so nothing local
    persists) — the DB itself is the source of truth for what's already in.
    """
    result = _post(
        f"SELECT store_number, MAX(order_date) AS max_date FROM {TABLE} "
        f"WHERE store_number IS NOT NULL GROUP BY store_number",
        proxy_url,
    )
    if "error" in result:
        logger.warning("Could not load store watermarks: %s", result["error"])
        return {}
    from dateutil import parser as _dateparser
    out: dict[str, str] = {}
    for r in result.get("rows", []):
        if not r.get("max_date"):
            continue
        out[r["store_number"]] = _dateparser.parse(str(r["max_date"])).strftime("%Y-%m-%d")
    return out


def insert_rows(
    rows: list[dict],
    existing_ids: set[str],
    proxy_url: str = PROXY_URL,
    dry_run: bool = False,
    batch_size: int = BATCH_SIZE,
) -> int:
    """Insert rows not already in DB. Returns count inserted."""
    new_rows = [r for r in rows if r.get("line_item_id") not in existing_ids]
    if not new_rows:
        return 0

    if dry_run:
        logger.info("[dry-run] Would insert %d rows into %s", len(new_rows), TABLE)
        return len(new_rows)

    total_inserted = 0
    for i in range(0, len(new_rows), batch_size):
        batch = new_rows[i : i + batch_size]
        values = [_build_values(r) for r in batch]
        sql = f"INSERT INTO {TABLE} ({COLS}) VALUES {', '.join(values)}"
        result = _post(sql, proxy_url)
        if "error" in result:
            logger.error("Batch %d–%d failed: %s", i, i + len(batch), result["error"])
            raise RuntimeError(f"DB insert failed: {result['error']}")
        total_inserted += len(batch)
        # Track the newly inserted IDs so subsequent inserts in the same run dedup correctly
        for r in batch:
            existing_ids.add(r["line_item_id"])

    return total_inserted
