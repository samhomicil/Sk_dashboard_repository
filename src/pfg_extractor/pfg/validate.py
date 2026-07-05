from __future__ import annotations
import logging
from dataclasses import dataclass, field
from typing import Optional

from .parse import OrderHeader, LineItem, ParseResult

logger = logging.getLogger(__name__)

_TOTAL_TOLERANCE = 0.02   # $0.02 to absorb rounding

@dataclass
class ValidationResult:
    order_number: str
    total_ok: bool = True
    qty_ok: bool = True
    total_diff: Optional[float] = None
    qty_diff: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    flagged: bool = False

    def flag(self, msg: str) -> None:
        self.warnings.append(msg)
        self.flagged = True


def validate_order(result: ParseResult, message_id: str) -> ValidationResult:
    h = result.header
    items = result.items
    vr = ValidationResult(order_number=h.order_number)

    # Sum line totals
    sum_line = sum(i.line_total for i in items if i.line_total is not None)
    sum_qty = sum(i.qty_line for i in items if i.qty_line is not None)

    # Total reconciliation
    if h.order_total is not None:
        diff = abs(sum_line - h.order_total)
        vr.total_diff = round(sum_line - h.order_total, 4)
        if diff > _TOTAL_TOLERANCE:
            vr.flag(
                f"Total mismatch: sum(line_total)={sum_line:.2f} vs header={h.order_total:.2f} "
                f"(diff={diff:.4f}) [msg={message_id}]"
            )

    # Qty reconciliation
    if h.order_qty_total is not None:
        qty_diff = sum_qty - h.order_qty_total
        vr.qty_diff = qty_diff
        if qty_diff != 0:
            vr.flag(
                f"Qty mismatch: sum(qty_line)={sum_qty} vs header qty_ordered={h.order_qty_total} "
                f"(diff={qty_diff}) [msg={message_id}]"
            )

    # Incomplete item blocks caught during parsing
    for err in result.parse_errors:
        vr.flag(f"Parse error: {err}")

    return vr
