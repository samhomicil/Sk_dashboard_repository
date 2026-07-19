"""Generate ee-periods.json, ee-daily.json, heatmap-daily.json, heatmap-weekly.json from
smoothieking.sales — the SQL replacement for the Sigma EE/heatmap pulls.

EE defs (validated 2026-07-18): sm = distinct order_id (voided=0, is_modifier=0);
ee = distinct order_id (voided=0, revenue_center='Modifiers'); channel inStore = destination
IN ('To Go','For Here'), else digital. byEmpKey attributes checks to sales.employee → emp_key.
Heatmap: transactions/units by dow/hour (SET DATEFIRST 7 → dow = DATEPART(weekday)-1).
"""
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pymssql

DATA = Path(__file__).resolve().parents[2] / "data"
STORES = [("Pines", "pines"), ("Miramar", "miramar"), ("Margate", "margate")]


def conn():
    c = pymssql.connect(server=os.environ.get("DB_SERVER", "skwellness.database.windows.net"),
                        user=os.environ.get("DB_USER", "samhomicil"), password=os.environ["DB_PW"],
                        database=os.environ.get("DB_NAME", "master"),
                        tds_version="7.4", login_timeout=30, timeout=180)
    return c


def monday(d):          # Monday of d's week
    return d - timedelta(days=d.weekday())


def periods(today):
    y = today - timedelta(days=1)                        # yesterday = data thru
    lw = monday(today) - timedelta(days=7)               # last full week Monday
    return {
        "weekly":    (lw, lw + timedelta(days=6)),
        "monthly":   (date(today.year, today.month, 1), y),
        "quarterly": (date(today.year, ((today.month - 1)//3)*3 + 1, 1), y),
        "ytd":       (date(today.year, 1, 1), y),
    }


def emp_revmap():
    raw = json.loads((DATA / "employee-key-map.json").read_text())
    rev = {}
    for k, v in raw.items():
        fn = re.sub(r"\s+", " ", v["first_name"].strip().lower())
        ln = re.sub(r"\s+", " ", v["last_name"].strip().lower())
        rev[f"{fn}|{ln}"] = int(k)
    return rev


import re

# known name typos in the POS export -> map form (from load_sales.py)
_NAME_FIXES = {"delgado|alexader": "delgado|alexander", "figureroa|miguel": "figueroa|miguel",
               "laura|laury": "lara|laury", "allen|d?nasia": "allen|d'nasia"}


def name_key(name):
    """Return 'first|last' (normalized) from either 'Last, First' or 'First Last'."""
    n = re.sub(r"\s+", " ", (name or "").strip())
    if not n:
        return None
    if "," in n:                       # "Last, First"
        last, _, first = n.partition(",")
        key = f"{first.strip().lower()}|{last.strip().lower()}"
    else:                              # "First Last"
        parts = n.split(" ")
        if len(parts) < 2:
            return None
        key = f"{parts[0].lower()}|{' '.join(parts[1:]).lower()}"
    return _NAME_FIXES.get(key, key)


def ee_for_range(cur, start, end):
    """Return storeTotals, channelEE, byEmpKey for [start,end]."""
    d0, d1 = start.isoformat(), end.isoformat()
    base = f"""FROM smoothieking.sales
      WHERE voided=0 AND CONVERT(date,closed_datetime) BETWEEN '{d0}' AND '{d1}'"""
    # store totals
    cur.execute(f"""SELECT store,
        COUNT(DISTINCT CASE WHEN is_modifier=0 THEN order_id END) sm,
        COUNT(DISTINCT CASE WHEN revenue_center='Modifiers' THEN order_id END) ee {base} GROUP BY store""")
    st = {k: {"ee": 0, "sm": 0} for _, k in STORES}
    NAME = {n: k for n, k in STORES}
    for r in cur.fetchall():
        if r["store"] in NAME:
            st[NAME[r["store"]]] = {"ee": int(r["ee"]), "sm": int(r["sm"])}
    # channel EE
    cur.execute(f"""SELECT store, CASE WHEN destination IN ('To Go','For Here') THEN 'inStore' ELSE 'digital' END ch,
        COUNT(DISTINCT CASE WHEN is_modifier=0 THEN order_id END) sm,
        COUNT(DISTINCT CASE WHEN revenue_center='Modifiers' THEN order_id END) ee {base}
        GROUP BY store, CASE WHEN destination IN ('To Go','For Here') THEN 'inStore' ELSE 'digital' END""")
    ch = {k: {"inStore": {"ee": 0, "sm": 0}, "digital": {"ee": 0, "sm": 0}} for _, k in STORES}
    for r in cur.fetchall():
        if r["store"] in NAME:
            ch[NAME[r["store"]]][r["ch"]] = {"ee": int(r["ee"]), "sm": int(r["sm"])}
    # byEmpKey
    cur.execute(f"""SELECT employee,
        COUNT(DISTINCT CASE WHEN is_modifier=0 THEN order_id END) sm,
        COUNT(DISTINCT CASE WHEN revenue_center='Modifiers' THEN order_id END) ee,
        SUM(CASE WHEN is_modifier=0 THEN net_sales ELSE 0 END) sales
        {base} AND employee IS NOT NULL GROUP BY employee""")
    rev = emp_revmap()
    acc = {}   # accumulate by emp_key (merges 'Last, First' + 'First Last' variants)
    for r in cur.fetchall():
        nk = name_key(r["employee"])
        key = rev.get(nk) if nk else None
        if not key:
            continue
        a = acc.setdefault(str(key), {"ee": 0, "sm": 0, "sales": 0.0})
        a["ee"] += int(r["ee"]); a["sm"] += int(r["sm"]); a["sales"] += float(r["sales"])
    by = {k: {"ee": v["ee"], "sm": v["sm"], "sales": round(v["sales"], 2)}
          for k, v in acc.items() if v["sm"] >= 5}   # runbook: min 5 smoothie orders
    return st, ch, by


def gen_ee_periods(cur, today):
    out = {"refreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    for name, (s, e) in periods(today).items():
        st, ch, by = ee_for_range(cur, s, e)
        out[name] = {"start": s.isoformat(), "end": e.isoformat(),
                     "byEmpKey": by, "storeTotals": st, "channelEE": ch}
    (DATA / "ee-periods.json").write_text(json.dumps(out))
    print("wrote ee-periods.json", {k: out[k]["start"] + ".." + out[k]["end"] for k in periods(today)})


def gen_ee_daily(cur, today):
    # Wide range (not just the current week) so the CUSTOM date-range tab's EE% —
    # which aggregates ee-daily via sigmaEERange — works for ANY range. weekStart still
    # points at the current week for the KPI-card sparkline (consumers filter by date).
    since = os.environ.get("EE_DAILY_SINCE", "2025-01-01")
    ws = monday(today)                               # current week Monday
    out = {"weekStart": ws.isoformat(), "thruDate": (today - timedelta(days=1)).isoformat()}
    cur.execute(f"""SELECT store, CONVERT(char(10),closed_datetime,23) d,
        COUNT(DISTINCT CASE WHEN is_modifier=0 THEN order_id END) sm,
        COUNT(DISTINCT CASE WHEN revenue_center='Modifiers' THEN order_id END) ee
        FROM smoothieking.sales WHERE voided=0 AND CONVERT(date,closed_datetime) >= '{since}'
        GROUP BY store, CONVERT(char(10),closed_datetime,23)""")
    rows = {k: [] for _, k in STORES}; NAME = {n: k for n, k in STORES}
    for r in cur.fetchall():
        if r["store"] in NAME:
            rows[NAME[r["store"]]].append({"date": r["d"], "sm": int(r["sm"]), "ee": int(r["ee"])})
    for _, k in STORES:
        out[k] = sorted(rows[k], key=lambda x: x["date"])
    (DATA / "ee-daily.json").write_text(json.dumps(out))
    print("wrote ee-daily.json (week of", ws.isoformat() + ")")


def gen_heatmap_daily(cur, today):
    end = today - timedelta(days=1); start = end - timedelta(days=89)   # ~90 day window
    cur.execute("SET DATEFIRST 7")
    cur.execute(f"""SELECT store, (DATEPART(weekday,closed_datetime)-1) dow, DATEPART(hour,closed_datetime) hour,
        CONVERT(char(10),closed_datetime,23) d,
        COUNT(DISTINCT order_id) txn,
        SUM(CASE WHEN is_modifier=0 AND item_name NOT LIKE '%add note%' AND item_name NOT LIKE '%substitut%' THEN 1 ELSE 0 END) units
        FROM smoothieking.sales WHERE voided=0 AND CONVERT(date,closed_datetime) BETWEEN '{start.isoformat()}' AND '{end.isoformat()}'
        GROUP BY store, (DATEPART(weekday,closed_datetime)-1), DATEPART(hour,closed_datetime), CONVERT(char(10),closed_datetime,23)""")
    NAME = {n: k for n, k in STORES}
    agg = {k: {} for _, k in STORES}   # (dow,hour) -> {txn:[], units:[]}
    for r in cur.fetchall():
        if r["store"] not in NAME:
            continue
        a = agg[NAME[r["store"]]].setdefault((r["dow"], r["hour"]), {"txn": 0.0, "units": 0.0, "days": 0})
        a["txn"] += r["txn"]; a["units"] += r["units"]; a["days"] += 1
    out = {"refreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "unitsWindowStart": start.isoformat(), "unitsWindowEnd": end.isoformat(),
           "unitsDefinition": "non-modifier item rows (excl add-note/substitution)"}
    for _, k in STORES:
        out[k] = [{"dow": dh[0], "hour": dh[1], "days": v["days"],
                   "avg_txn": round(v["txn"]/v["days"], 2) if v["days"] else 0,
                   "avg_units": round(v["units"]/v["days"], 2) if v["days"] else 0}
                  for dh, v in sorted(agg[k].items())]
    (DATA / "heatmap-daily.json").write_text(json.dumps(out))
    print(f"wrote heatmap-daily.json (window {start}..{end})")


def gen_heatmap_weekly(cur, today):
    ws = monday(today) - timedelta(days=7); we = ws + timedelta(days=6)   # last full week
    cur.execute("SET DATEFIRST 7")
    cur.execute(f"""SELECT store, (DATEPART(weekday,closed_datetime)-1) dow, DATEPART(hour,closed_datetime) hour,
        SUM(CASE WHEN is_modifier=0 AND item_name NOT LIKE '%add note%' AND item_name NOT LIKE '%substitut%' THEN 1 ELSE 0 END) units
        FROM smoothieking.sales WHERE voided=0 AND CONVERT(date,closed_datetime) BETWEEN '{ws.isoformat()}' AND '{we.isoformat()}'
        GROUP BY store, (DATEPART(weekday,closed_datetime)-1), DATEPART(hour,closed_datetime)""")
    NAME = {n: k for n, k in STORES}
    out = {"weekStart": ws.isoformat(), "weekEnd": we.isoformat(), "pines": [], "miramar": [], "margate": []}
    for r in cur.fetchall():
        if r["store"] in NAME:
            out[NAME[r["store"]]].append({"dow": r["dow"], "hour": r["hour"], "units": int(r["units"])})
    (DATA / "heatmap-weekly.json").write_text(json.dumps(out))
    print(f"wrote heatmap-weekly.json (week {ws}..{we})")


def main():
    today = date.fromisoformat(os.environ["TODAY"]) if os.environ.get("TODAY") else date.today()
    c = conn(); cur = c.cursor(as_dict=True)
    gen_ee_periods(cur, today)
    gen_ee_daily(cur, today)
    gen_heatmap_daily(cur, today)
    gen_heatmap_weekly(cur, today)
    c.close()


if __name__ == "__main__":
    main()
