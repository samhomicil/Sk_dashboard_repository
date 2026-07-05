from __future__ import annotations
import hashlib
import re
from datetime import date, datetime
from typing import Optional

from .parse import OrderHeader, LineItem, parse_pack_size
from .config import Config

_RE_SUBSTITUTION = re.compile(r"\bsubbed?\s+with\s+(\S+)", re.IGNORECASE)

# CSV/XLSX column names in order
BASE_COLUMNS = [
    "line_item_id",
    "order_number",
    "po_number",
    "order_date",
    "order_time",
    "order_day_of_week",
    "order_week",
    "order_month",
    "order_year",
    "delivery_date_est",
    "store_number",
    "store_name",
    "store_address",
    "store_city",
    "store_state",
    "store_zip",
    "distributor",
    "pfs_branch_code",
    "ordered_by",
    "item_code",
    "product_description",
    "brand_manufacturer",
    "sk_proprietary_flag",
    "pack_size_raw",
    "pack_count",
    "unit_size",
    "unit_size_uom",
    "uom_unknown_flag",
    "order_uom",
    "qty_confirmed",
    "qty_line",
    "unit_price",
    "line_total",
    "total_base_units",
    "cost_per_base_unit",
    "exception_note",
    "substitution_item_code",
    "stockout_flag",
    "non_returnable_flag",
    "order_total",
    "order_qty_total",
    "order_line_count",
    "product_key",
    "product_key_status",
    "source_message_id",
    "source_subject",
    "date_imported",
]

CATEGORY_PLACEHOLDER_COLUMNS = ["category", "subcategory"]


def columns(cfg: Config) -> list[str]:
    cols = list(BASE_COLUMNS)
    if cfg.include_category_placeholder:
        cols = cols[:1] + CATEGORY_PLACEHOLDER_COLUMNS + cols[1:]
    return cols


# ── Date helpers ───────────────────────────────────────────────────────────────

def _parse_order_date(raw: str) -> Optional[date]:
    """Parse 'MM/DD/YY HH:MM AM' or just 'MM/DD/YY'."""
    for fmt in ("%m/%d/%y %I:%M %p", "%m/%d/%Y %I:%M %p", "%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_order_time(raw: str) -> str:
    """Return HH:MM string from 'MM/DD/YY HH:MM AM'."""
    for fmt in ("%m/%d/%y %I:%M %p", "%m/%d/%Y %I:%M %p"):
        try:
            dt = datetime.strptime(raw.strip(), fmt)
            return dt.strftime("%H:%M")
        except ValueError:
            continue
    return ""


def _parse_delivery_date(raw: str) -> str:
    """Normalise MM/DD/YY or MM/DD/YYYY to YYYY-MM-DD."""
    for fmt in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def _week_start_date(d: date, week_start: str) -> str:
    """Return ISO YYYY-MM-DD of the week-start (Mon or Sun) for date d."""
    weekday = d.weekday()  # Mon=0, Sun=6
    if week_start == "Mon":
        offset = weekday
    else:  # Sun
        offset = (weekday + 1) % 7
    monday = d.toordinal() - offset
    return date.fromordinal(monday).isoformat()


# ── Derived-field helpers ──────────────────────────────────────────────────────

def _stable_id(order_number: str, item_code: str, line_total: Optional[float], line_seq: int) -> str:
    raw = f"{order_number}|{item_code}|{line_total}|{line_seq}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def _substitution(exception_note: str) -> Optional[str]:
    if not exception_note:
        return None
    m = _RE_SUBSTITUTION.search(exception_note)
    if m:
        code = m.group(1).rstrip(".")
        if code.upper() == "ITEM" or re.match(r"^NO$", code, re.IGNORECASE):
            return None
        return code
    return None


def _stockout_flag(exception_note: str) -> bool:
    if not exception_note:
        return False
    return bool(re.search(r"inventory\s+may\s+not\s+be\s+available", exception_note, re.IGNORECASE))


def _non_returnable_flag(exception_note: str) -> bool:
    if not exception_note:
        return False
    return bool(
        re.search(r"cannot\s+be\s+returned", exception_note, re.IGNORECASE)
        or re.search(r"\bHACCP\b", exception_note, re.IGNORECASE)
    )


# ── Row builder ───────────────────────────────────────────────────────────────

def build_rows(
    header: OrderHeader,
    items: list[LineItem],
    message_id: str,
    subject: str,
    run_ts: datetime,
    cfg: Config,
) -> list[dict]:
    order_date = _parse_order_date(header.order_datetime_raw)
    order_time = _parse_order_time(header.order_datetime_raw)
    order_line_count = len(items)
    delivery_date_est = _parse_delivery_date(header.delivery_date_raw) if header.delivery_date_raw else ""
    date_imported = run_ts.strftime("%Y-%m-%d %H:%M:%S UTC")

    rows = []
    for item in items:
        pack_count, unit_size, unit_size_uom, uom_unknown = parse_pack_size(item.pack_size_raw)

        # total_base_units and cost_per_base_unit
        total_base_units: Optional[float] = None
        cost_per_base_unit: Optional[float] = None
        if pack_count is not None and unit_size is not None and item.qty_line is not None:
            total_base_units = item.qty_line * pack_count * unit_size
            if total_base_units and item.line_total is not None:
                cost_per_base_unit = round(item.line_total / total_base_units, 4)

        row: dict = {
            "line_item_id": _stable_id(header.order_number, item.item_code, item.line_total, item.line_seq),
            "order_number": header.order_number,
            "po_number": header.po_number,
            "order_date": order_date.isoformat() if order_date else "",
            "order_time": order_time,
            "order_day_of_week": order_date.strftime("%A") if order_date else "",
            "order_week": _week_start_date(order_date, cfg.week_start) if order_date else "",
            "order_month": order_date.strftime("%Y-%m") if order_date else "",
            "order_year": str(order_date.year) if order_date else "",
            "delivery_date_est": delivery_date_est,
            "store_number": header.store_number,
            "store_name": header.store_name,
            "store_address": header.store_address,
            "store_city": header.store_city,
            "store_state": header.store_state,
            "store_zip": header.store_zip,
            "distributor": "Performance Food Group",
            "pfs_branch_code": header.pfs_branch_code,
            "ordered_by": header.ordered_by,
            "item_code": item.item_code,
            "product_description": item.product_description,
            "brand_manufacturer": item.brand_manufacturer,
            "sk_proprietary_flag": item.brand_manufacturer.strip().lower() == "smoothie king",
            "pack_size_raw": item.pack_size_raw,
            "pack_count": pack_count,
            "unit_size": unit_size,
            "unit_size_uom": unit_size_uom,
            "uom_unknown_flag": uom_unknown,
            "order_uom": item.order_uom,
            "qty_confirmed": item.qty_confirmed,
            "qty_line": item.qty_line,
            "unit_price": item.unit_price,
            "line_total": item.line_total,
            "total_base_units": total_base_units,
            "cost_per_base_unit": cost_per_base_unit,
            "exception_note": item.exception_note,
            "substitution_item_code": _substitution(item.exception_note),
            "stockout_flag": _stockout_flag(item.exception_note),
            "non_returnable_flag": _non_returnable_flag(item.exception_note),
            "order_total": header.order_total,
            "order_qty_total": header.order_qty_total,
            "order_line_count": order_line_count,
            "product_key": "",
            "product_key_status": "",
            "source_message_id": message_id,
            "source_subject": subject,
            "date_imported": date_imported,
        }

        if cfg.include_category_placeholder:
            row["category"] = ""
            row["subcategory"] = ""

        rows.append(row)

    return rows
