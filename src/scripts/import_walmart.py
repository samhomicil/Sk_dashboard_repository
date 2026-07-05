"""
Import Walmart Business order-export CSVs into Azure SQL.

Usage:
  python3 src/scripts/import_walmart.py --dir DIR
      Imports every *.csv file found in DIR (e.g. staged from the Drive
      "Walmart" subfolder by the daily routine).

  python3 src/scripts/import_walmart.py
      Local manual mode -- reads the most recently downloaded
      "item_level_report*.csv" from ~/Downloads.

Store identity comes from `Account User Email` (e.g. ops@smoothiekingmargate.com
-> margate) -- there's no dedicated store column in smoothieking.walmart_spend,
so that email itself is used to scope the delete-window-then-reinsert per
store/date-range, same idempotent pattern as import_labor_till.py.

Connects directly to Azure SQL when AZURE_SQL_SERVER etc are set as env vars
(cloud routine); falls back to the local proxy otherwise.
"""

import argparse
import csv
import json
import os
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

PROXY = 'http://127.0.0.1:5001/query'
DOWNLOADS = Path.home() / 'Downloads'

# CSV header -> table column (1:1 by name except the two noted below)
COLUMN_MAP = {
    'Order Date':                     'order_date',
    'Order Id':                       'order_id',
    'Order Type':                     'order_type',
    'Fulfillment Method':             'fulfillment_method',
    'Order Quantity':                 'order_quantity',
    'Order Subtotal':                 'order_subtotal',
    'Order Fees':                     'order_fees',
    'Order SubTotal Tax':             'order_subtotal_tax',
    'Order Net Total':                'order_net_total',
    'Order Fulfillment Status':       'order_fulfillment_status',
    # NOTE: CSV "Order Receiving Status" (a string like "COMPLETE") is
    # intentionally NOT mapped -- the table's order_receiving_status column
    # is smallint (would error on a string) and every existing historical
    # row already has it NULL. "Order Received Quantity" (numeric) is what
    # actually maps to order_received_qty, matching existing data exactly.
    'Order Received Quantity':        'order_received_qty',
    'Walmart Product Division':       'walmart_division',
    'Walmart Product Super Department': 'walmart_super_dept',
    'Walmart Product Department':     'walmart_dept',
    'Walmart Product Category':       'walmart_category',
    'Walmart Product Sub Category':   'walmart_subcategory',
    'Item Name':                      'item_name',
    'Item Id':                        'item_id',
    'Purchase PPU':                   'purchase_ppu',
    'Item Placed Quantity':           'item_placed_qty',
    'Unit of Measure':                'unit_of_measure',
    'Unit Weight':                    'unit_weight',
    'Item Subtotal':                  'item_subtotal',
    'Item Fee':                       'item_fee',
    'Item Tax':                       'item_tax',
    'Item Net Total':                 'item_net_total',
    'Item Received Quantity':         'item_received_qty',
    'Tax Exemption Applied':          'tax_exemption_applied',
    'Payment Date':                   'payment_date',
    'Payment Amount':                 'payment_amount',
    'Payment Instrument Type':        'payment_instrument_type',
    'Payment Identifier':             'payment_identifier',
    'Payment Status':                 'payment_status',
    'Org Account group':              'org_account_group',
    'PO / Reference Number':          'po_reference_number',
    'Account User':                   'account_user',
    'Account User Email':             'account_user_email',
    'Approvers':                      'approvers',
    'Delivery Address':               'delivery_address',
    # 'Store Location' has no reliable data in these exports (always blank)
    # and is left NULL, same as all historical rows.
}

FLOAT_COLS = {
    'order_subtotal', 'order_fees', 'order_subtotal_tax', 'order_net_total',
    'purchase_ppu', 'unit_weight', 'item_subtotal', 'item_fee', 'item_tax',
    'item_net_total', 'payment_amount',
}
SMALLINT_COLS = {'order_quantity', 'item_placed_qty', 'item_received_qty'}
BIGINT_COLS = {'item_id'}
DATE_COLS = {'order_date', 'payment_date'}
BIT_COLS = {'tax_exemption_applied'}
# Everything else (order_received_qty included) stays a plain string/NULL.

STORE_FROM_EMAIL = {
    'smoothiekingmargate': 'Margate',
    'smoothiekingpines':   'Pines',
    'smoothiekingmiramar': 'Miramar',
}


# ── DB helper (direct Azure SQL if configured, else local proxy) ──
def sql(query: str):
    if os.environ.get('AZURE_SQL_SERVER'):
        import pymssql
        conn = pymssql.connect(
            server=os.environ['AZURE_SQL_SERVER'],
            user=os.environ['AZURE_SQL_USER'],
            password=os.environ['AZURE_SQL_PASSWORD'],
            database=os.environ.get('AZURE_SQL_DATABASE', 'master'),
            as_dict=True,
        )
        cursor = conn.cursor()
        cursor.execute(query)
        rows = cursor.fetchall() if cursor.description else []
        conn.commit()
        conn.close()
        return rows
    body = json.dumps({'query': query}).encode()
    req  = urllib.request.Request(PROXY, data=body, headers={'Content-Type': 'application/json'})
    resp = json.loads(urllib.request.urlopen(req).read())
    if 'error' in resp:
        raise RuntimeError(resp['error'])
    return resp.get('rows', [])


def store_from_email(email: str) -> str:
    local = (email or '').split('@')[-1].split('.')[0].lower()
    for key, store in STORE_FROM_EMAIL.items():
        if key in local:
            return store
    return email or 'unknown'


def _q(v) -> str:
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def _num(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _bit(v) -> str:
    return '1' if str(v).strip().upper() in ('Y', 'YES', 'TRUE', '1') else ('0' if v not in (None, '') else 'NULL')


def parse_csv(path: Path) -> list[dict]:
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = []
        for raw in reader:
            row = {}
            for csv_col, db_col in COLUMN_MAP.items():
                v = raw.get(csv_col, '')
                if db_col in FLOAT_COLS:
                    row[db_col] = _num(v)
                elif db_col in SMALLINT_COLS or db_col in BIGINT_COLS:
                    n = _num(v)
                    row[db_col] = int(n) if n is not None else None
                elif db_col in BIT_COLS:
                    row[db_col] = v  # formatted at insert time via _bit()
                else:
                    row[db_col] = v.strip() if v else None
            rows.append(row)
        return rows


def insert_rows(rows: list[dict]):
    if not rows:
        return
    cols = list(COLUMN_MAP.values())
    col_sql = ', '.join(cols)
    for i in range(0, len(rows), 50):
        batch = rows[i:i + 50]
        vals = []
        for r in batch:
            parts = []
            for c in cols:
                v = r.get(c)
                if c in BIT_COLS:
                    parts.append(_bit(v))
                elif c in FLOAT_COLS or c in SMALLINT_COLS or c in BIGINT_COLS:
                    parts.append('NULL' if v is None else str(v))
                elif c in DATE_COLS:
                    parts.append(_q(v))
                else:
                    parts.append(_q(v))
            vals.append(f"({', '.join(parts)})")
        sql(f"INSERT INTO smoothieking.walmart_spend ({col_sql}) VALUES {', '.join(vals)}")


def best_file(pattern: str) -> list[Path]:
    return sorted(DOWNLOADS.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)


def _parse_args():
    p = argparse.ArgumentParser(description='Import Walmart order-export CSVs into Azure SQL')
    p.add_argument('--dir', help='Import every *.csv file in this directory')
    return p.parse_args()


def main():
    args = _parse_args()
    using_proxy = not os.environ.get('AZURE_SQL_SERVER')

    try:
        sql('SELECT 1 AS ok')
        print('✅ Connected via proxy' if using_proxy else '✅ Connected directly to Azure SQL')
    except Exception:
        print('❌ Cannot reach proxy — run: python3 /Users/sam/azure-sql-proxy.py' if using_proxy
              else '❌ Cannot reach Azure SQL directly — check AZURE_SQL_* env vars')
        return

    if args.dir:
        files = sorted(Path(args.dir).glob('*.csv'))
    else:
        files = best_file('item_level_report*.csv')[:1]

    if not files:
        print('No Walmart export files found.')
        return

    all_rows: list[dict] = []
    for f in files:
        rows = parse_csv(f)
        print(f'  {f.name}: {len(rows)} line items')
        all_rows.extend(rows)

    if not all_rows:
        return

    # Delete-window-then-insert per (store email, date range), same idempotent
    # pattern as import_labor_till.py -- safe to rerun on the same file.
    by_email: dict[str, list[dict]] = defaultdict(list)
    for r in all_rows:
        by_email[r.get('account_user_email') or ''].append(r)

    for email, rows in by_email.items():
        dates = sorted(set(r['order_date'] for r in rows if r.get('order_date')))
        if not dates:
            continue
        min_d, max_d = dates[0], dates[-1]
        store = store_from_email(email)
        print(f'\n  Deleting existing Walmart rows {min_d} – {max_d} for {store} ({email})...')
        sql(
            f"DELETE FROM smoothieking.walmart_spend "
            f"WHERE account_user_email = {_q(email)} AND order_date BETWEEN {_q(min_d)} AND {_q(max_d)}"
        )
        print(f'  Inserting {len(rows)} rows for {store}...')
        insert_rows(rows)

    print('\n✅ Walmart import complete — run npm run refresh next')


if __name__ == '__main__':
    main()
