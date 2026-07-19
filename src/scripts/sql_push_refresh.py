"""Autonomous dashboard refresh (no Sigma, no Mac-in-the-loop):
1. regenerate the data JSON from smoothieking.sales (SQL),
2. POST them to the dashboard's /api/ingest-refresh, which rebuilds the cache in-process
   on Vercel (which can reach Azure SQL) and writes smoothieking.dashboard_cache.

Env: DB_PW (Azure SQL), REFRESH_KEY (x-refresh-key = Vercel REFRESH_SECRET/AZURE_SQL_PASSWORD),
optional DASH_URL (default the delta deployment).
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parents[1] / "data"
URL = os.environ.get("DASH_URL", "https://sk-dashboard-delta.vercel.app") + "/api/ingest-refresh"
KEY = os.environ.get("REFRESH_KEY", os.environ.get("DB_PW", ""))
FILES = ["sigma-daily.json", "ee-periods.json", "ee-daily.json",
         "heatmap-daily.json", "heatmap-weekly.json"]


def run(script):
    print(f"  generating via {script} ...", flush=True)
    subprocess.run([sys.executable, str(HERE / script)], check=True, env={**os.environ})


def main():
    run("sql_sigma_daily.py")
    run("sql_ee_heatmap.py")
    files = {f: json.loads((DATA / f).read_text()) for f in FILES}
    body = json.dumps({"files": files}).encode()
    req = urllib.request.Request(URL, data=body,
                                 headers={"Content-Type": "application/json", "x-refresh-key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            print("  ingest-refresh ->", r.status, r.read().decode()[:300])
    except urllib.error.HTTPError as e:
        print("  ingest-refresh FAILED", e.code, e.read().decode()[:300]); sys.exit(1)


if __name__ == "__main__":
    main()
