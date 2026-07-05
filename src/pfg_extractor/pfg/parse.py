from __future__ import annotations
import re
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ── Data containers ────────────────────────────────────────────────────────────

@dataclass
class OrderHeader:
    order_number: str = ""
    po_number: str = ""
    delivery_date_raw: str = ""      # as printed: MM/DD/YY
    order_qty_total: Optional[int] = None
    order_qty_shipped_est: Optional[int] = None
    order_total: Optional[float] = None
    store_number: str = ""
    store_name: str = ""
    store_address: str = ""
    store_city: str = ""
    store_state: str = ""
    store_zip: str = ""
    pfs_branch_code: str = ""
    ordered_by: str = ""
    order_datetime_raw: str = ""     # e.g. "06/11/26 10:26 AM"


@dataclass
class LineItem:
    product_description: str = ""
    item_code: str = ""
    brand_manufacturer: str = ""
    pack_size_raw: str = ""
    qty_confirmed: Optional[int] = None
    qty_line: Optional[int] = None
    order_uom: str = ""
    unit_price: Optional[float] = None
    line_total: Optional[float] = None
    exception_note: str = ""
    # line position within order (1-based, for stable dedupe)
    line_seq: int = 0


@dataclass
class ParseResult:
    header: OrderHeader
    items: list[LineItem]
    unparsed_lines: list[str]
    parse_errors: list[str]


# ── Regex helpers ──────────────────────────────────────────────────────────────

_RE_ASTERISK_LINE = re.compile(r"^\*(.+)\*$")
_RE_EXCEPTION_LINE = re.compile(r"^\*Exception:\s*(.+)\*$", re.IGNORECASE)

# Asterisk-wrapped lines that are header/section decorators, not product names
_NON_PRODUCT_STAR_RE = re.compile(
    r"^(CustomerFirst\s+\w[\w\s]*|Smoothie\s+King\s+\d+)\s*$",
    re.IGNORECASE,
)

# Header field patterns
_RE_ORDER_NUM = re.compile(r"Order\s*#\s*:?\s*(\d+)", re.IGNORECASE)
_RE_PO_NUM = re.compile(r"PO\s*#\s*:?\s*(\S*)", re.IGNORECASE)
_RE_DELIVERY_DATE = re.compile(r"Est\.?\s*delivery\s*date\s*:?\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.IGNORECASE)
_RE_QTY_ORDERED = re.compile(r"Qty\s+ordered\s*:?\s*(\d+)", re.IGNORECASE)
_RE_QTY_SHIPPED = re.compile(r"Qty\s+shipped\s*\(est\)\s*:?\s*(\d+)", re.IGNORECASE)
_RE_ORDER_TOTAL = re.compile(r"Order\s+total\s*:?\s*\$?([\d,]+\.?\d*)", re.IGNORECASE)

# Store block
_RE_STORE_NAME = re.compile(r"(Smoothie\s+King\s+(\d+))", re.IGNORECASE)
_RE_ZIP_LINE = re.compile(r"^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$")

# Footer
_RE_ORDERED_DT = re.compile(r"Ordered\s*:\s*(\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M)", re.IGNORECASE)
_RE_ORDERED_BY = re.compile(r"Ordered\s+by\s+(.+)", re.IGNORECASE)

# Branch code from subject: "PFS Orlando - 03783"
_RE_BRANCH_SUBJECT = re.compile(r"PFS\s+Orlando\s*-\s*(\d+)", re.IGNORECASE)
_RE_STORE_SUBJECT = re.compile(r"Smoothie\s+King\s+['\"]?(\d+)", re.IGNORECASE)

# Line-item line 3: "<pack_size> Confirmed: <n> Qty: <n>"
_RE_LINE3 = re.compile(
    r"^(.+?)\s+Confirmed:\s*(\d+)\s+Qty:\s*(\d+)\s*$", re.IGNORECASE
)

# Line-item line 4: "<UOM> $<price> *$<total>*" or "<UOM> $<price> $<total>"
_RE_LINE4 = re.compile(
    r"^(CS|EA)\s+\$\s*([\d,]+\.?\d*)\s+\*?\$\s*([\d,]+\.?\d*)\*?$", re.IGNORECASE
)

# Pack-size decomposition: "6/5 Lb", "25/20Cnt", "1/44.09#", "24/16.9"
_RE_PACK = re.compile(r"^(\d+)\/([\d.]+)\s*([A-Za-z#]*)$")

# Substitution in exception: "subbed with TV456" or "substituted with TV456"
_RE_SUBSTITUTION = re.compile(r"\bsubbed?\s+with\s+(\S+)", re.IGNORECASE)

# Forward-wrapper noise lines to skip
_FORWARD_NOISE = re.compile(
    r"(^-{3,}\s*(Forwarded|Original)|^From:\s|^To:\s|^Date:\s|^Subject:\s|"
    r"^Cc:\s|^\[SK\s+|^>{1,}|^This e-?mail|^Disclaimer|"
    r"^\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}:\d{2}\s+[AP]M\b.*$|"
    r"https?://|^CustomerFirst\s+Electronic|^pfgc\.com)",
    re.IGNORECASE,
)

# Generic boilerplate lines (footer page artifacts, PFG disclaimers)
_BOILERPLATE = re.compile(
    r"(^Performance\s+Food|^PFG|^Billing\s+to:|^www\.|"
    r"^\s*Page\s+\d+\s+of\s+\d+|^Confidential|^This\s+document)",
    re.IGNORECASE,
)


# ── Utilities ─────────────────────────────────────────────────────────────────

def _strip_stars(s: str) -> str:
    s = s.strip()
    m = _RE_ASTERISK_LINE.match(s)
    return m.group(1).strip() if m else s


def _parse_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _parse_int(s: str) -> Optional[int]:
    try:
        return int(s.strip())
    except (ValueError, AttributeError):
        return None


def parse_pack_size(raw: str) -> tuple[Optional[int], Optional[float], str, bool]:
    """
    Returns (pack_count, unit_size, unit_size_uom, uom_unknown_flag).
    Maps '#' -> 'Lb'. Sets uom_unknown_flag=True when unit is missing.
    """
    raw = raw.strip()
    m = _RE_PACK.match(raw)
    if not m:
        return None, None, "", True

    count = int(m.group(1))
    size_str = m.group(2)
    uom = m.group(3).strip()

    size = _parse_float(size_str)

    if uom == "#":
        uom = "Lb"

    uom_unknown = (uom == "")

    return count, size, uom, uom_unknown


def _is_asterisk_content_line(line: str) -> bool:
    """True if line is *...* and content is a product description (not a section header)."""
    line = line.strip()
    if not (line.startswith("*") and line.endswith("*") and len(line) > 2):
        return False
    if _RE_EXCEPTION_LINE.match(line):
        return False
    content = _strip_stars(line)
    if _NON_PRODUCT_STAR_RE.match(content):
        return False
    return True


def _is_noise(line: str) -> bool:
    """True for forwarded-wrapper or boilerplate lines to skip."""
    stripped = line.strip()
    if not stripped:
        return False
    return bool(_FORWARD_NOISE.match(stripped) or _BOILERPLATE.match(stripped))


# ── Subject parsing ────────────────────────────────────────────────────────────

def parse_subject(subject: str) -> tuple[str, str]:
    """Return (store_number, branch_code) from the email subject."""
    store_m = _RE_STORE_SUBJECT.search(subject)
    branch_m = _RE_BRANCH_SUBJECT.search(subject)
    store = store_m.group(1) if store_m else ""
    branch = branch_m.group(1) if branch_m else ""
    return store, branch


# ── Header parsing ─────────────────────────────────────────────────────────────

def _parse_header_section(lines: list[str]) -> tuple[OrderHeader, int]:
    """
    Walk lines top-to-bottom collecting header fields.
    Returns (header, index_of_first_item_line).
    """
    h = OrderHeader()
    in_delivering = False
    delivering_lines: list[str] = []
    first_item_idx = len(lines)

    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()

        # Product description line — marks start of items section
        if _is_asterisk_content_line(line):
            first_item_idx = i
            break

        if not line:
            if in_delivering:
                in_delivering = False   # blank line closes the delivering block
            i += 1
            continue

        if _is_noise(line):
            i += 1
            continue

        # "Delivering to:" block open
        if re.search(r"Delivering\s+to\s*:", line, re.IGNORECASE):
            in_delivering = True
            i += 1
            continue

        # Collect delivering-block lines (everything until blank or section header)
        if in_delivering:
            delivering_lines.append(line)
            i += 1
            continue

        # ── Header field extraction — check ALL patterns per line ────────────
        m = _RE_ORDER_NUM.search(line)
        if m and not h.order_number:
            h.order_number = m.group(1)

        m = _RE_PO_NUM.search(line)
        if m and h.po_number == "":
            h.po_number = m.group(1).strip()

        m = _RE_DELIVERY_DATE.search(line)
        if m and not h.delivery_date_raw:
            h.delivery_date_raw = m.group(1).strip()

        m = _RE_QTY_ORDERED.search(line)
        if m and h.order_qty_total is None:
            h.order_qty_total = _parse_int(m.group(1))

        m = _RE_ORDER_TOTAL.search(line)
        if m and h.order_total is None:
            h.order_total = _parse_float(m.group(1))

        m = _RE_QTY_SHIPPED.search(line)
        if m and h.order_qty_shipped_est is None:
            h.order_qty_shipped_est = _parse_int(m.group(1))

        m = _RE_BRANCH_SUBJECT.search(line)
        if m and not h.pfs_branch_code:
            h.pfs_branch_code = m.group(1).strip()

        m = _RE_ORDERED_DT.search(line)
        if m and not h.order_datetime_raw:
            h.order_datetime_raw = m.group(1).strip()

        m = _RE_ORDERED_BY.search(line)
        if m and not h.ordered_by:
            h.ordered_by = m.group(1).strip()

        i += 1

    _parse_delivering_block(delivering_lines, h)
    return h, first_item_idx


def _parse_delivering_block(lines: list[str], h: OrderHeader) -> None:
    """Extract store fields from the 'Delivering to:' text block."""
    for raw in lines:
        # Strip surrounding asterisks — store name may arrive as *Smoothie King 1892*
        line = _strip_stars(raw.strip())
        if not line:
            continue

        # Store name line: "Smoothie King 1892"
        sm = _RE_STORE_NAME.match(line)
        if sm and not h.store_name:
            h.store_name = sm.group(1).strip()
            h.store_number = sm.group(2).strip()
            continue

        # City, State ZIP
        zm = _RE_ZIP_LINE.match(line)
        if zm and not h.store_city:
            h.store_city = zm.group(1).strip()
            h.store_state = zm.group(2).strip()
            h.store_zip = zm.group(3).strip()
            continue

        # Street address (anything not matched above that contains a digit)
        if not h.store_address and re.search(r"\d", line):
            h.store_address = line


# ── Line-item parsing ──────────────────────────────────────────────────────────

def _parse_items(lines: list[str], start: int) -> tuple[list[LineItem], list[str], list[str]]:
    """
    Parse product line items from lines[start:].
    Returns (items, unparsed_lines, parse_error_messages).
    """
    items: list[LineItem] = []
    unparsed: list[str] = []
    errors: list[str] = []

    # Footer signal lines — once seen, stop item parsing
    _FOOTER_RE = re.compile(
        r"(Ordered\s*:|Ordered\s+by\s*:|Billing\s+to\s*:|"
        r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}/\d{1,2}\s+Order)",
        re.IGNORECASE,
    )

    i = start
    pending_item: Optional[LineItem] = None
    pending_state: int = 0   # 0=none, 1=got desc, 2=got code, 3=got pack, 4=complete

    def flush_pending():
        nonlocal pending_item, pending_state
        if pending_item is not None:
            if pending_state < 4:
                errors.append(
                    f"Incomplete item block (state={pending_state}): "
                    f"'{pending_item.product_description}'"
                )
            else:
                pending_item.line_seq = len(items) + 1
                items.append(pending_item)
            pending_item = None
            pending_state = 0

    while i < len(lines):
        raw = lines[i]
        line = raw.strip()

        if not line or _is_noise(line):
            i += 1
            continue

        # Footer reached — stop item parsing
        if _FOOTER_RE.search(line):
            flush_pending()
            break

        # Exception line — attach to previous item
        em = _RE_EXCEPTION_LINE.match(line)
        if em:
            exc_text = em.group(1).strip()
            if pending_state >= 4:
                # Exception for the current completed item (not yet flushed)
                if pending_item:
                    pending_item.exception_note = (
                        (pending_item.exception_note + " | " + exc_text).strip(" | ")
                    )
            elif items:
                last = items[-1]
                last.exception_note = (
                    (last.exception_note + " | " + exc_text).strip(" | ")
                )
            else:
                unparsed.append(line)
            i += 1
            continue

        # New product description line: *text* (not Exception)
        if _is_asterisk_content_line(line):
            flush_pending()
            pending_item = LineItem(product_description=_strip_stars(line))
            pending_state = 1
            i += 1
            continue

        # Item code + brand line (state 1→2)
        if pending_state == 1:
            parts = line.split(None, 1)
            if parts:
                pending_item.item_code = parts[0]
                pending_item.brand_manufacturer = parts[1].strip() if len(parts) > 1 else ""
                pending_state = 2
            else:
                errors.append(f"Empty item-code line after desc '{pending_item.product_description}'")
                pending_state = 0
            i += 1
            continue

        # Pack-size / Confirmed / Qty line (state 2→3)
        if pending_state == 2:
            m3 = _RE_LINE3.match(line)
            if m3:
                pending_item.pack_size_raw = m3.group(1).strip()
                pending_item.qty_confirmed = _parse_int(m3.group(2))
                pending_item.qty_line = _parse_int(m3.group(3))
                pending_state = 3
            else:
                errors.append(
                    f"Unexpected line (expected pack/Confirmed): '{line}' "
                    f"after item '{pending_item.product_description}'"
                )
                # Try to recover by treating next *...* as new item
                if _is_asterisk_content_line(line):
                    flush_pending()
                    pending_item = LineItem(product_description=_strip_stars(line))
                    pending_state = 1
            i += 1
            continue

        # UOM / price / total line (state 3→4)
        if pending_state == 3:
            m4 = _RE_LINE4.match(line)
            if m4:
                pending_item.order_uom = m4.group(1).upper()
                pending_item.unit_price = _parse_float(m4.group(2))
                pending_item.line_total = _parse_float(m4.group(3))
                pending_state = 4
            else:
                errors.append(
                    f"Unexpected line (expected UOM/price): '{line}' "
                    f"after item '{pending_item.product_description}'"
                )
                if _is_asterisk_content_line(line):
                    flush_pending()
                    pending_item = LineItem(product_description=_strip_stars(line))
                    pending_state = 1
            i += 1
            continue

        # state == 4: look for Exception or new item; anything else is unparsed
        if pending_state == 4:
            if _is_asterisk_content_line(line):
                flush_pending()
                pending_item = LineItem(product_description=_strip_stars(line))
                pending_state = 1
            else:
                unparsed.append(line)
            i += 1
            continue

        # state == 0: not in an item block
        unparsed.append(line)
        i += 1

    flush_pending()
    return items, unparsed, errors


# ── Footer rescan ──────────────────────────────────────────────────────────────

def _rescan_footer(lines: list[str], header: OrderHeader) -> None:
    """Fill in any header fields that only appear in the footer."""
    for line in lines:
        line = line.strip()
        if not line:
            continue

        m = _RE_ORDERED_DT.search(line)
        if m and not header.order_datetime_raw:
            header.order_datetime_raw = m.group(1).strip()

        m = _RE_ORDERED_BY.search(line)
        if m and not header.ordered_by:
            header.ordered_by = m.group(1).strip()

        m = _RE_QTY_SHIPPED.search(line)
        if m and header.order_qty_shipped_est is None:
            header.order_qty_shipped_est = _parse_int(m.group(1))

        m = _RE_BRANCH_SUBJECT.search(line)
        if m and not header.pfs_branch_code:
            header.pfs_branch_code = m.group(1).strip()


# ── Public entry point ─────────────────────────────────────────────────────────

def parse_email(body_text: str, subject: str = "") -> ParseResult:
    """
    Parse a PFG CustomerFirst Confirmation email body.
    Returns ParseResult with header, items, and any parse errors.
    """
    lines = body_text.splitlines()

    # Pull branch + store from subject as cross-check
    subj_store, subj_branch = parse_subject(subject)

    header, item_start = _parse_header_section(lines)
    items, unparsed, errors = _parse_items(lines, item_start)

    # Second pass over all lines for footer fields missed in the header scan
    _rescan_footer(lines[item_start:], header)

    # Fill in from subject when body was missing
    if not header.pfs_branch_code and subj_branch:
        header.pfs_branch_code = subj_branch
    if not header.store_number and subj_store:
        header.store_number = subj_store

    return ParseResult(
        header=header,
        items=items,
        unparsed_lines=unparsed,
        parse_errors=errors,
    )
