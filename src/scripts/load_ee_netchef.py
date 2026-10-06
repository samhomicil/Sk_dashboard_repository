"""Load CrunchTime's E&E counts into smoothieking.ee_check — the one source for every EE%
the dashboard and the nightly recap show.

WHY NETCHEF, NOT smoothieking.sales
-----------------------------------
Managers read E&E in NetChef → Crunchtime Insights → "E&E Report", a Smoothie King corporate
Sigma workbook. Its "E&E Qty %" is

    Σ quantity of recipes in category SALES / subcategory Modifiers / microcategory Modifiers
    ÷ Σ quantity of recipes in category SALES / subcategory Smoothies / microcategory Smoothies

over NetChef's menu mix. NetChef imports every modifier together with its POS prefix as its
own recipe — "Add On - Banana" is in the Modifiers microcategory, "20OZ - Angel Food - NO -
P2 - Turbinado" is in "Non-E&E Modifiers" — and kids' smoothies ("KIDS") and bundle headers
("Bundles") sit outside the Smoothies microcategory. Brink's item-sales export, which feeds
smoothieking.sales, has no prefix column, so an added enhancer and a removed one look the
same there. The counts therefore come from NetChef, through the same menu-mix endpoint the
NetChef Menu Mix screen uses.

Validated 2026-10-06 against the E&E Report, to the unit: Pines Mon 10/5 = 97 / 128 with
every employee (Amanda Simmons 20/10, DIGITAL 45/49, ...); week 9/28–10/4 Pines 420/1,024,
Miramar 594/1,159, Margate 492/734, and every Pines and Miramar employee.

TABLE smoothieking.ee_check — one row per check per server, only checks with a smoothie or
an E&E. server_name is "First Last" as NetChef has it, or 'DIGITAL' when the check has no
server (online and delivery orders) — the label the E&E Report uses. check_number is the
Brink order id, so it joins smoothieking.sales.order_id. NetChef's same-day data runs about
an hour behind the POS.

RUN
    python3 load_ee_netchef.py                          # yesterday and today (idempotent)
    python3 load_ee_netchef.py 2026-01-01 2026-10-05    # a range, e.g. a backfill
NetChef creds: NETCHEF_USERNAME / NETCHEF_PASSWORD, else netchef_creds.json next to
NETCHEF_CREDS (default ~/netchef-extractor/netchef_creds.json).
Database: pymssql when DB_PW is set (cloud jobs); otherwise the local SQL proxy (PROXY_URL).
"""
import http.cookiejar
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta

HOST = "https://smoothieking0108.net-chef.com"
# NetChef's own location ids (not store numbers), from /resource/ceslogin/locations.
LOCATIONS = {"Pines": 645, "Miramar": 728, "Margate": 1168}
TABLE = "smoothieking.ee_check"
CHUNK_DAYS = 7          # a week of checks is ~3,000 menu-mix rows, well under one page
PAGE = 20000

EE = ("SALES", "Modifiers", "Modifiers")
SMOOTHIE = ("SALES", "Smoothies", "Smoothies")


# ── NetChef: two JSON calls log in; the session is bound to one location ──────────────
class NetChef:
    HEADERS = {"Content-Type": "application/json", "Accept": "application/json",
               "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0"}

    def __init__(self, store):
        self._op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        user, pw = _creds()
        self._send("GET", "/standalone/modern.ct", parse=False)
        for path, body in (("/resource/ceslogin/auth",
                            {"username": user, "password": pw, "language": None}),
                           ("/resource/ceslogin/choose-location",
                            {"locationId": LOCATIONS[store], "supplyId": None, "language": None})):
            if not self._send("POST", path, body).get("success"):
                raise RuntimeError(f"NetChef refused {path}")
        self._send("POST", "/resource/menumix/common/resources", {})

    def _send(self, method, path, body=None, parse=True):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(HOST + path, data=data, method=method, headers=self.HEADERS)
        for attempt in range(4):
            try:
                with self._op.open(req, timeout=180) as r:
                    raw = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        if not parse:
            return raw
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            raise RuntimeError(f"{path} returned non-JSON — NetChef session not logged in") from None

    def menu_mix(self, begin, end, group, secondary=None):
        """Leaf rows of NetChef's Menu Mix for this location (subtotal rows dropped)."""
        body = {"extraCriteriaMap": {"groupBy": group, "secondaryGroupBy": secondary,
                                     "currencySymbol": "$",
                                     "beginDate": begin.strftime("%m/%d/%Y"),
                                     "endDate": end.strftime("%m/%d/%Y")},
                "pagingInfo": {"page": 1, "start": 0, "limit": PAGE}}
        data = self._send("POST", "/resource/menumix/location/summary", body)["contentMap"]["data"]
        if (data.get("total") or 0) > PAGE:
            raise RuntimeError(f"menu mix {begin}..{end} has {data['total']} rows — shorten CHUNK_DAYS")
        return [r for r in data.get("rows") or []
                if not (r.get("subTotal") or r.get("total") or r.get("grandTotal"))]


def _creds():
    if os.environ.get("NETCHEF_USERNAME"):
        return os.environ["NETCHEF_USERNAME"], os.environ["NETCHEF_PASSWORD"]
    p = pathlib.Path(os.environ.get("NETCHEF_CREDS",
                                    pathlib.Path.home() / "netchef-extractor" / "netchef_creds.json"))
    c = json.loads(p.read_text())
    return c["username"], c["password"]


def checks_for(nc, store, begin, end):
    """One row per (business date, check, server) with E&E and smoothie quantity and sales."""
    kind = {}
    for r in nc.menu_mix(begin, end, "CATEGORY"):
        k = (r.get("categoryName"), r.get("subcategoryName"), r.get("microcategoryName"))
        kind[r["productNumber"]] = "ee" if k == EE else "sm" if k == SMOOTHIE else None
    acc = defaultdict(lambda: {"ee_qty": 0, "ee_sales": 0.0, "sm_qty": 0, "sm_sales": 0.0, "close": None})
    for r in nc.menu_mix(begin, end, "SERVER", "CHECK_NUMBER"):
        k = kind.get(r["productNumber"])
        if k is None:
            continue
        day = datetime.strptime(r["posDate"][:10], "%m/%d/%Y").date()
        server = f"{r.get('employeeFirstName') or ''} {r.get('employeeLastName') or ''}".strip() or "DIGITAL"
        a = acc[(day, r["checkNumber"], server)]
        a[f"{k}_qty"] += int(r.get("transactions") or 0)
        a[f"{k}_sales"] += float(r.get("sales") or 0)
        a["close"] = a["close"] or (r.get("checkCloseTime") or None)
    return [(store, d, chk, srv, a["close"], a["ee_qty"], round(a["ee_sales"], 2),
             a["sm_qty"], round(a["sm_sales"], 2))
            for (d, chk, srv), a in acc.items() if a["ee_qty"] or a["sm_qty"]]


# ── Database: pymssql in the cloud, the local proxy on a Mac ─────────────────────────────
class DB:
    def __init__(self):
        self.cn = None
        if os.environ.get("DB_PW"):
            import pymssql
            self.cn = pymssql.connect(server=os.environ.get("DB_SERVER", "skwellness.database.windows.net"),
                                      user=os.environ.get("DB_USER", "samhomicil"),
                                      password=os.environ["DB_PW"],
                                      database=os.environ.get("DB_NAME", "master"),
                                      tds_version="7.4", login_timeout=30, timeout=300)
        self.proxy = os.environ.get("PROXY_URL", "http://127.0.0.1:5001/query")

    def run(self, sql):
        if self.cn:
            cur = self.cn.cursor()
            cur.execute(sql)
            self.cn.commit()
            return
        req = urllib.request.Request(self.proxy, data=json.dumps({"query": sql}).encode(),
                                     headers={"Content-Type": "application/json"})
        for attempt in range(5):        # the local proxy drops the odd call; writes are idempotent
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    out = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if attempt == 4:
                    raise RuntimeError(f"proxy {e.code}: {e.read()[:300]!r}") from None
                time.sleep(2 ** attempt)
        if isinstance(out, dict) and out.get("error"):
            raise RuntimeError(out["error"])


DDL = f"""
IF OBJECT_ID('{TABLE}') IS NULL
CREATE TABLE {TABLE} (
  store          NVARCHAR(20)  NOT NULL,
  business_date  DATE          NOT NULL,
  check_number   NVARCHAR(40)  NOT NULL,
  server_name    NVARCHAR(100) NOT NULL,
  close_time     CHAR(5)       NULL,
  ee_qty         INT           NOT NULL,
  ee_sales       DECIMAL(10,2) NOT NULL,
  smoothie_qty   INT           NOT NULL,
  smoothie_sales DECIMAL(10,2) NOT NULL,
  loaded_at      DATETIME2     NOT NULL CONSTRAINT DF_ee_check_loaded_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_ee_check PRIMARY KEY (store, business_date, check_number, server_name)
)"""


def q(v):
    return "NULL" if v is None else "N'" + str(v).replace("'", "''") + "'"


def write(db, store, begin, end, rows):
    """Replace the store's rows for [begin, end] with `rows` (idempotent re-runs)."""
    db.run(f"DELETE FROM {TABLE} WHERE store = {q(store)} "
           f"AND business_date BETWEEN '{begin}' AND '{end}'")
    for i in range(0, len(rows), 900):
        values = ",".join(
            f"({q(s)},'{d}',{q(c)},{q(srv)},{q(t)},{eq},{es},{sq},{ss})"
            for s, d, c, srv, t, eq, es, sq, ss in rows[i:i + 900])
        db.run(f"INSERT INTO {TABLE} (store, business_date, check_number, server_name, close_time, "
               f"ee_qty, ee_sales, smoothie_qty, smoothie_sales) VALUES {values}")


def main(argv):
    today = date.today()
    begin = date.fromisoformat(argv[0]) if argv else today - timedelta(days=1)
    end = date.fromisoformat(argv[1]) if len(argv) > 1 else today
    db = DB()
    db.run(DDL)
    for store in LOCATIONS:
        nc = NetChef(store)
        d = begin
        while d <= end:
            e = min(end, d + timedelta(days=CHUNK_DAYS - 1))
            rows = checks_for(nc, store, d, e)
            write(db, store, d, e, rows)
            ee = sum(r[5] for r in rows); sm = sum(r[7] for r in rows)
            print(f"  [ee] {store:8} {d}..{e}: {len(rows):5} checks  E&E {ee:5} / smoothies {sm:5}",
                  file=sys.stderr, flush=True)
            d = e + timedelta(days=1)


if __name__ == "__main__":
    main(sys.argv[1:])
