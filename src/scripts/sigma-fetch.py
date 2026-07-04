#!/usr/bin/env python3
"""
Fetch sales + COGS data from Sigma Computing REST API.
Writes data/sigma-daily.json which refresh.ts reads for sales and COGS.

Required env vars (set in .env.local or shell environment):
  SIGMA_CLIENT_ID     — from Sigma > Administration > APIs & Embed Secrets
  SIGMA_CLIENT_SECRET — same location

Run:
  python3 src/scripts/sigma-fetch.py
"""

import json, os, sys, urllib.request, urllib.parse, urllib.error
from datetime import date, timedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────
SIGMA_BASE    = "https://api.sigmacomputing.com/v2"
CONNECTION_ID = "73b76456-d1b5-492a-989e-0479cb1591a0"
SALES_INODE   = "16djMxYA6BegwtQBHlmqTS"   # Sales Mix v2
COGS_INODE    = "nfS76ixg7sPelZxYJKlpi"    # Inventory v2
LABOR_INODE   = "7h6bIPg7uKjzp1o1dlakfJ"   # [Labor] Actual V2
LOCATIONS     = ("1392 - Pembroke Pines, FL", "1892 - Miramar, FL", "2384 - Margate, FL")
FRANCHISEE    = "DANIEL AYBAR & SAM HOMICIL"

PROJECT_ROOT  = Path(__file__).resolve().parent.parent.parent
DATA_DIR      = PROJECT_ROOT / "data"
OUT_FILE      = DATA_DIR / "sigma-daily.json"
ENV_FILE      = PROJECT_ROOT / ".env.local"


def load_env():
    """Load .env.local into os.environ (skip if already set)."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if key not in os.environ:
            os.environ[key] = val.strip()


def get_token(client_id: str, client_secret: str) -> str:
    payload = urllib.parse.urlencode({
        "grant_type":    "client_credentials",
        "client_id":     client_id,
        "client_secret": client_secret,
    }).encode()
    req = urllib.request.Request(
        f"{SIGMA_BASE}/auth/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def sigma_query(token: str, sql: str) -> list[dict]:
    body = json.dumps({
        "sql":           sql,
        "connection_id": CONNECTION_ID,
    }).encode()
    req = urllib.request.Request(
        f"{SIGMA_BASE}/queries",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.load(r)
    columns = resp["columns"]   # list of {"name": ..., "columnIndex": ...}
    col_names = [c["name"] for c in sorted(columns, key=lambda c: c["columnIndex"])]
    return [dict(zip(col_names, row)) for row in resp["rows"]]


def fetch_all(token: str, thru: str) -> tuple[list, list, list]:
    loc_list = ", ".join(f"'{l}'" for l in LOCATIONS)

    sales_sql = f"""
        SELECT
            CAST("SALES DATE" AS DATE)                                  AS sale_date,
            "LOCATION NAME"                                             AS location,
            SUM("TOT TOTAL NET SALES")                                  AS net_sales,
            SUM("TOT GROSS SALES")                                      AS gross_sales,
            SUM("VOIDS AMOUNT")                                         AS voids_amount,
            SUM("Customer Count End") + SUM("Customer Count Morning")
              + SUM("Customer Count Midday")                            AS orders
        FROM "connection"."{SALES_INODE}"
        WHERE "SALES DATE" >= '2025-01-01'
          AND "SALES DATE" <= '{thru}'
          AND "LOCATION NAME" IN ({loc_list})
        GROUP BY CAST("SALES DATE" AS DATE), "LOCATION NAME"
        ORDER BY sale_date, location
    """

    cogs_sql = f"""
        SELECT
            CAST("Transaction Date" AS DATE)    AS txn_date,
            "Location Name"                     AS location,
            SUM("Actual Consumpt Value")        AS actual_cogs,
            SUM("Theoretical Value")            AS theoretical_cogs
        FROM "connection"."{COGS_INODE}"
        WHERE "Transaction Date" >= '2025-01-01'
          AND "Transaction Date" <= '{thru}'
          AND "Location Name" IN ({loc_list})
        GROUP BY CAST("Transaction Date" AS DATE), "Location Name"
        ORDER BY txn_date, location
    """

    # Employee shifts from [Labor] Actual V2 — per-employee per-day aggregation
    labor_sql = f"""
        SELECT
            CAST("LABOR DATE" AS DATE)      AS labor_date,
            "LOCATION CODE"                 AS location_code,
            "LOCATION NAME"                 AS location,
            "Employee First Name"           AS first_name,
            "Employee Last Name"            AS last_name,
            "LABOR POSITION NAME"           AS position,
            MAX("PAY RATE")                 AS rate,
            SUM("ACTUAL HOURS")             AS hours,
            SUM("ACTUAL VALUE")             AS pay
        FROM "connection"."{LABOR_INODE}"
        WHERE "FRANCHISEE NAME" = '{FRANCHISEE}'
          AND "LABOR DATE" >= '2025-01-01'
          AND "LABOR DATE" <= '{thru}'
        GROUP BY CAST("LABOR DATE" AS DATE), "LOCATION CODE", "LOCATION NAME",
                 "Employee First Name", "Employee Last Name", "LABOR POSITION NAME"
        ORDER BY labor_date, location, last_name, first_name
    """

    print("  Fetching sales ...", flush=True)
    raw_sales = sigma_query(token, sales_sql)
    sales = [
        {
            "date":         str(r["sale_date"])[:10],
            "location":     r["location"],
            "net_sales":    float(r["net_sales"] or 0),
            "gross_sales":  float(r["gross_sales"] or 0),
            "voids_amount": float(r["voids_amount"] or 0),
            "orders":       int(r["orders"] or 0),
        }
        for r in raw_sales
    ]
    print(f"  → {len(sales)} daily sales rows", flush=True)

    print("  Fetching COGS ...", flush=True)
    raw_cogs = sigma_query(token, cogs_sql)
    cogs = [
        {
            "date":              str(r["txn_date"])[:10],
            "location":         r["location"],
            "actual_cogs":      float(r["actual_cogs"] or 0),
            "theoretical_cogs": float(r["theoretical_cogs"] or 0),
        }
        for r in raw_cogs
    ]
    print(f"  → {len(cogs)} COGS rows", flush=True)

    print("  Fetching employee labor ...", flush=True)
    try:
        raw_labor = sigma_query(token, labor_sql)
        employees = [
            {
                "date":          str(r["labor_date"])[:10],
                "location_code": str(r["location_code"] or "").strip(),
                "location":      r["location"],
                "first_name":    r["first_name"],
                "last_name":     r["last_name"],
                "position":      r["position"],
                "rate":          float(r["rate"] or 0),
                "hours":         float(r["hours"] or 0),
                "pay":           float(r["pay"] or 0),
            }
            for r in raw_labor
        ]
        print(f"  → {len(employees)} employee-day rows", flush=True)
    except Exception as e:
        print(f"  ⚠️  Labor fetch failed ({e}) — using empty list", flush=True)
        employees = []

    return sales, cogs, employees


def main():
    load_env()

    client_id     = os.environ.get("SIGMA_CLIENT_ID", "")
    client_secret = os.environ.get("SIGMA_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        print("❌  SIGMA_CLIENT_ID and SIGMA_CLIENT_SECRET are not set.")
        print("   Add them to .env.local:")
        print("     SIGMA_CLIENT_ID=your_client_id")
        print("     SIGMA_CLIENT_SECRET=your_secret")
        print()
        print("   Get them from: Sigma > Administration > APIs & Embed Secrets > Create New")
        sys.exit(1)

    thru = str(date.today() - timedelta(days=1))   # one-day lag
    print(f"🔄  Fetching Sigma data through {thru} ...", flush=True)

    try:
        token = get_token(client_id, client_secret)
        print("✅  Authenticated with Sigma API", flush=True)
    except urllib.error.HTTPError as e:
        print(f"❌  Sigma auth failed: {e.code} {e.reason}")
        sys.exit(1)

    try:
        sales, cogs, employees = fetch_all(token, thru)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"❌  Sigma query failed: {e.code} {e.reason}\n{body}")
        sys.exit(1)

    # Preserve existing channels from prior fetch if present (channels not re-fetched each run)
    existing = json.loads(OUT_FILE.read_text()) if OUT_FILE.exists() else {}

    DATA_DIR.mkdir(exist_ok=True)
    payload = {
        "refreshedAt": thru,
        "thruDate":    thru,
        "sales":       sales,
        "cogs":        cogs,
        "channels":    existing.get("channels", []),
        "employees":   employees,
    }
    OUT_FILE.write_text(json.dumps(payload, indent=2))
    print(f"✅  Written to {OUT_FILE}  ({OUT_FILE.stat().st_size // 1024} KB)", flush=True)


if __name__ == "__main__":
    main()
