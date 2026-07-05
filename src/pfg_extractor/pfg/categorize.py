from __future__ import annotations
import json
import logging
import re
import urllib.request
import urllib.error
from collections import Counter
from typing import Optional

logger = logging.getLogger(__name__)

# ── Stop words to ignore during description matching ──────────────────────────
_STOP = {
    "a", "an", "the", "and", "or", "of", "with", "for", "in", "to", "at",
    "by", "from", "no", "not", "is", "it", "its", "use", "used", "per",
    "pack", "case", "each", "ready", "eat", "added", "free", "size",
}

# ── Keyword fallback rules applied to product_description (lowercase) ─────────
# Checked in order — first match wins.
_KEYWORD_RULES: list[tuple[list[str], str]] = [
    # Frozen fruit & veg
    (["frozen", "individually quick frozen", "iqf", "crumbles", "chunk",
      "tidbit", "sliced", "diced", "chopped", "avocado", "mango", "raspberry",
      "blueberr", "strawberr", "spinach", "goji", "pitaya", "pineapple",
      "carrot"], "Canned & Frozen Fruit & Veg"),
    # Frozen dairy / sorbet / ice cream
    (["sorbet", "ice cream", "yogurt", "acai base", "almond milk",
      "oat milk", "scoopable"], "Cheese & Dairy"),
    # Beverages
    (["juice", "water", "coffee", "espresso", "cold brew",
      "coconut water", "recharge", "energy"], "Beverage"),
    # Fresh produce
    (["banana", "fresh"], "Produce"),
    # Bakery
    (["bread", "bakery", "loaf", "muffin", "croissant"], "Bakery Frozen"),
    # Chemicals / sanitation
    (["cleaner", "sanitizer", "disinfect", "bleach", "enzyme",
      "quarry tile", "floor", "concrete", "chemical"], "Chemicals"),
    # Disposables — cups, lids, straws, gloves, packaging
    (["cup", "lid", "straw", "glove", "napkin", "wipe", "bowl",
      "tray", "bag", "liner", "carrier", "roll thermal", "register",
      "sleeve", "wrap", "container", "fork", "spoon", "knife",
      "pulp", "dome", "polyethylene", "polypropylene", "foam",
      "plastic", "paper bistro"], "Disposables"),
    # Eggs
    (["egg"], "Cheese & Dairy"),
    # Supplements, boosters, protein powders
    (["protein", "gladiator", "hulk", "slim", "muscle", "fiber",
      "electrolyte", "metabolism", "joint", "gut health", "recharge",
      "booster", "blend", "powder", "supplement", "probiotic",
      "vitamin", "collagen", "omega"], "Dry Grocery"),
    # Sweeteners & pantry
    (["sugar", "honey", "stevia", "sweetener", "syrup",
      "date powder", "coconut flake"], "Dry Grocery"),
    # Nut butters
    (["butter", "almond butter", "peanut butter", "nut butter"], "Commodity Grocery"),
    # Oils, condiments
    (["oil", "vinegar", "sauce", "dressing", "seasoning",
      "pepper", "spice", "herb"], "Dry Grocery"),
    # Snacks
    (["chip", "granola", "cracker", "snack", "plantain",
      "sweet potato", "popcorn"], "Dry Grocery"),
    # Toppings / drizzles
    (["drizzle", "topping", "chocolate hazelnut", "caramel",
      "whip"], "Dry Grocery"),
    # Retail items
    (["retail", "grab & go", "grab and go"], "Retail"),
]


def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in _STOP and len(w) > 1}


# Shared with db.py: direct Azure SQL if AZURE_SQL_SERVER is set (cloud
# routine), else the local proxy — see db.py for why the proxy can't be
# reached from a cloud sandbox.
from .db import _post


# ── Lookup builder ─────────────────────────────────────────────────────────────

class CategoryLookup:
    """
    Loads category knowledge from pfs_invoices.
    Provides exact-code match, description-similarity match, and keyword fallback.
    """

    def __init__(self, proxy_url: str) -> None:
        self._by_code: dict[str, str] = {}        # item_code → category
        self._desc_index: list[tuple[set, str]] = []  # (tokens, category)
        self._load(proxy_url)

    def _load(self, proxy_url: str) -> None:
        result = _post(
            "SELECT DISTINCT product_num, product_description, category "
            "FROM smoothieking.pfs_invoices "
            "WHERE category IS NOT NULL AND category != '' "
            "AND category NOT IN ('ZZZ_Non-Items') "
            "AND product_num IS NOT NULL AND product_num != ''",
            proxy_url,
        )
        if "error" in result:
            logger.warning("Could not load pfs_invoices for categorization: %s", result["error"])
            return

        for row in result.get("rows", []):
            code = (row.get("product_num") or "").strip()
            desc = (row.get("product_description") or "").strip()
            cat = (row.get("category") or "").strip()
            if not cat or not code:
                continue
            # Exact code lookup — prefer most common category for a given code
            if code not in self._by_code:
                self._by_code[code] = cat
            # Description index
            tokens = _tokenize(desc)
            if tokens:
                self._desc_index.append((tokens, cat))

        logger.info(
            "Category lookup: %d known codes, %d description entries",
            len(self._by_code),
            len(self._desc_index),
        )

    def categorize(
        self, item_code: str, description: str, brand: str
    ) -> tuple[str, str]:
        """
        Returns (category, source) where source is one of:
          'code_match'  — direct item_code match in pfs_invoices
          'desc_match'  — description similarity match
          'keyword'     — keyword rule fallback
          'suggested'   — new category inferred, needs review
        """
        # 1. Exact code match
        if item_code in self._by_code:
            return self._by_code[item_code], "code_match"

        # 2. Description similarity against pfs_invoices descriptions
        item_tokens = _tokenize(description)
        if item_tokens and self._desc_index:
            best_cat, best_score = self._best_desc_match(item_tokens)
            if best_score >= 2:   # at least 2 meaningful words in common
                return best_cat, "desc_match"

        # 3. Keyword rules on the product description
        desc_lower = description.lower()
        for keywords, cat in _KEYWORD_RULES:
            if any(kw in desc_lower for kw in keywords):
                return cat, "keyword"

        # 4. Nothing matched — suggest based on brand
        if brand.strip().lower() == "smoothie king":
            return "Dry Grocery", "suggested"
        return "Uncategorized", "suggested"

    def _best_desc_match(self, item_tokens: set) -> tuple[str, int]:
        """Return (category, overlap_score) for the best-matching pfs_invoices description."""
        cat_scores: Counter = Counter()
        for known_tokens, cat in self._desc_index:
            overlap = len(item_tokens & known_tokens)
            if overlap > 0:
                cat_scores[cat] += overlap

        if not cat_scores:
            return "", 0
        best_cat = cat_scores.most_common(1)[0][0]
        best_score = cat_scores.most_common(1)[0][1]
        return best_cat, best_score


# ── DB update helpers ──────────────────────────────────────────────────────────

def _q(v) -> str:
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def apply_categories(proxy_url: str, dry_run: bool = False) -> dict:
    """
    Categorize all rows in pfg_order_line_items that have no category yet.
    Returns summary counts.
    """
    lookup = CategoryLookup(proxy_url)

    # Fetch uncategorized rows
    result = _post(
        "SELECT line_item_id, item_code, product_description, brand_manufacturer "
        "FROM smoothieking.pfg_order_line_items "
        "WHERE category IS NULL OR category = ''",
        proxy_url,
    )
    if "error" in result:
        raise RuntimeError(f"Failed to fetch uncategorized rows: {result['error']}")

    rows = result.get("rows", [])
    if not rows:
        logger.info("No uncategorized rows found.")
        return {"total": 0, "code_match": 0, "desc_match": 0, "keyword": 0, "suggested": 0}

    logger.info("Categorizing %d rows...", len(rows))

    counts: Counter = Counter()
    # Group updates by (category, source) to batch UPDATE statements
    updates: list[tuple[str, str, str]] = []  # (line_item_id, category, source)

    for row in rows:
        cat, source = lookup.categorize(
            row.get("item_code", ""),
            row.get("product_description", ""),
            row.get("brand_manufacturer", ""),
        )
        counts[source] += 1
        updates.append((row["line_item_id"], cat, source))

    if dry_run:
        logger.info("[dry-run] Would update %d rows", len(updates))
        for lid, cat, src in updates[:20]:
            logger.info("  %s → %s (%s)", lid[:12], cat, src)
        return dict(counts)

    # Batch UPDATE — group by (category, source) to minimise round trips
    from collections import defaultdict
    buckets: dict[tuple, list[str]] = defaultdict(list)
    for lid, cat, src in updates:
        buckets[(cat, src)].append(lid)

    for (cat, src), ids in buckets.items():
        # UPDATE in chunks of 500 IDs
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            id_list = ", ".join(_q(lid) for lid in chunk)
            sql = (
                f"UPDATE smoothieking.pfg_order_line_items "
                f"SET category = {_q(cat)}, category_source = {_q(src)} "
                f"WHERE line_item_id IN ({id_list})"
            )
            res = _post(sql, proxy_url)
            if "error" in res:
                logger.error("Category update failed: %s", res["error"])

    total = len(updates)
    suggested = [f"  {_q(cat)}: {', '.join(ids[:3])}" for (cat, src), ids in buckets.items() if src == "suggested"]
    if suggested:
        logger.warning(
            "The following items got 'suggested' categories (review recommended):\n%s",
            "\n".join(suggested),
        )

    logger.info(
        "Categorized %d rows → code_match=%d, desc_match=%d, keyword=%d, suggested=%d",
        total,
        counts["code_match"],
        counts["desc_match"],
        counts["keyword"],
        counts["suggested"],
    )
    return dict(counts)
