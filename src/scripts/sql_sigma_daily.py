"""Generate data/sigma-daily.json (sales + channels) from smoothieking.sales — the SQL
replacement for the Sigma pull. Preserves the existing cogs + employees arrays (COGS stays
weekly/Sigma). sigma.ts reads this file unchanged.

Validated formulas (2026-07-18): net = SUM(net_sales) WHERE voided=0 AND is_modifier=0;
orders = COUNT(DISTINCT order_id) WHERE voided=0; channels = same net grouped by destination.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pymssql

DATA = Path(__file__).resolve().parents[2] / "data" / "sigma-daily.json"
SINCE = os.environ.get("SIGMA_SINCE", "2025-01-01")
STORE_LOC = {"Pines": "1392 - Pembroke Pines, FL",
             "Miramar": "1892 - Miramar, FL",
             "Margate": "2384 - Margate, FL"}


def conn():
    return pymssql.connect(
        server=os.environ.get("DB_SERVER", "skwellness.database.windows.net"),
        user=os.environ.get("DB_USER", "samhomicil"),
        password=os.environ["DB_PW"],
        database=os.environ.get("DB_NAME", "master"),
        tds_version="7.4", login_timeout=30, timeout=180)


def main():
    c = conn()
    cur = c.cursor(as_dict=True)

    # daily sales per store
    cur.execute(f"""
      SELECT CONVERT(char(10), closed_datetime, 23) d, store,
        SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales   ELSE 0 END) net,
        SUM(CASE WHEN voided=0 AND is_modifier=0 THEN gross_sales ELSE 0 END) gross,
        SUM(CASE WHEN voided=1 AND is_modifier=0 THEN net_sales   ELSE 0 END) voids,
        COUNT(DISTINCT CASE WHEN voided=0 THEN order_id END) orders
      FROM smoothieking.sales WHERE closed_datetime >= '{SINCE}'
      GROUP BY CONVERT(char(10), closed_datetime, 23), store
      ORDER BY d, store""")
    sales = [{"date": r["d"], "location": STORE_LOC[r["store"]],
              "net_sales": round(float(r["net"]), 2), "gross_sales": round(float(r["gross"]), 2),
              "voids_amount": round(float(r["voids"]), 2), "orders": int(r["orders"])}
             for r in cur.fetchall() if r["store"] in STORE_LOC]

    # daily channels per store/destination
    cur.execute(f"""
      SELECT CONVERT(char(10), closed_datetime, 23) d, store, destination,
        SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales ELSE 0 END) sales,
        COUNT(DISTINCT CASE WHEN voided=0 THEN order_id END) orders
      FROM smoothieking.sales WHERE closed_datetime >= '{SINCE}' AND destination IS NOT NULL
      GROUP BY CONVERT(char(10), closed_datetime, 23), store, destination""")
    channels = [{"date": r["d"], "location": STORE_LOC[r["store"]], "destination": r["destination"],
                 "orders": int(r["orders"]), "sales": round(float(r["sales"]), 2)}
                for r in cur.fetchall() if r["store"] in STORE_LOC]

    thru = max(r["date"] for r in sales) if sales else None

    # cogs + employees come from smoothieking.dashboard_meta (updated weekly/separately) so
    # the daily push carries the latest without rebuilding the image. Fall back to the local
    # sigma-daily.json if the table has no row yet.
    def meta(key):
        cur.execute("SELECT meta_value FROM smoothieking.dashboard_meta WHERE meta_key=%s", (key,))
        r = cur.fetchone()
        return json.loads(r["meta_value"]) if r and r["meta_value"] else None
    cogs = meta("cogs")
    employees = meta("employees")
    c.close()
    existing = json.loads(DATA.read_text()) if DATA.exists() else {}
    out = {
        "refreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "thruDate": thru,
        "sales": sales,
        "cogs": cogs if cogs is not None else existing.get("cogs", []),
        "channels": channels,
        "employees": employees if employees is not None else existing.get("employees", []),
    }
    DATA.write_text(json.dumps(out))
    print(f"wrote {DATA.name}: {len(sales)} sale-days, {len(channels)} channel-rows, "
          f"thru {thru}, cogs preserved={len(out['cogs'])}, employees preserved={len(out['employees'])}")


if __name__ == "__main__":
    main()
