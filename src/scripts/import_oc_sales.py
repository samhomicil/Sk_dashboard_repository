#!/usr/bin/env python3
"""
Import OC (Open-Close) CSV exports into smoothieking.sales DB table.
Usage:
    python src/scripts/import_oc_sales.py [path/to/OC_*.csv ...]
    (no args = auto-detect all OC_*.csv files in ~/Downloads/)

Columns in OC file (header):
  Location, Closed Date/Time, Employee Name, Item ID, Item Name, Item PLU,
  Price, Discount Total, Promotion Total, Taxes, Net Sales, Gross Sales,
  Total Sales, Revenue Center, Has Employee Discount, Destination, Voided,
  Has Customer, Is Modifier, Order ID

Maps to smoothieking.sales:
  store, closed_datetime, employee, item_id, item_name, item_plu,
  price, discount_total, promotion_total, taxes, net_sales, gross_sales,
  total_sales, revenue_center, has_employee_discount, destination, voided,
  has_customer, is_modifier, order_id
"""

import csv, sys, json, urllib.request, os
from pathlib import Path
from datetime import datetime, date

PROXY_URL  = 'http://127.0.0.1:5001/query'
DOWNLOADS  = Path.home() / 'Downloads'

STORE_MAP = {
    'Smoothie King SK-1392': 'Smoothie King #1392',
    'Smoothie King SK-1892': 'Smoothie King #1892',
    'Smoothie King SK-2384': 'Smoothie King #2384',
    'Smoothie King 1392':    'Smoothie King #1392',
    'Smoothie King 1892':    'Smoothie King #1892',
    'Smoothie King 2384':    'Smoothie King #2384',
}

def sql(query: str, params=None):
    body = json.dumps({'query': query}).encode()
    req  = urllib.request.Request(
        PROXY_URL,
        data=body,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def parse_bool(v: str) -> bool:
    return v.strip().lower() in ('true', '1', 'yes')

def parse_money(v: str) -> float:
    s = v.strip().replace('$', '').replace(',', '')
    if not s:
        return 0.0
    if s.startswith('(') and s.endswith(')'):
        return -float(s[1:-1])
    return float(s)

def parse_datetime(v: str) -> str:
    """Convert '6/13/2026 8:24 PM' → '2026-06-13 20:24:00'"""
    return datetime.strptime(v.strip(), '%m/%d/%Y %I:%M %p').strftime('%Y-%m-%d %H:%M:%S')

def load_csv(path: Path) -> list[dict]:
    rows = []
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            loc   = row['Location'].strip()
            store = STORE_MAP.get(loc)
            if not store:
                # Try partial match
                for k, v in STORE_MAP.items():
                    if k.replace('SK-', '').replace('#', '').replace(' ', '') in loc.replace(' ', ''):
                        store = v
                        break
            if not store:
                print(f'  ⚠️  Unknown location: {loc!r} — skipping row')
                continue
            try:
                closed_dt = parse_datetime(row['Closed Date/Time'])
            except Exception:
                print(f'  ⚠️  Bad datetime: {row["Closed Date/Time"]!r} — skipping row')
                continue

            emp = row.get('Employee Name', '').strip()
            if emp.lower() == 'none':
                emp = None

            rows.append({
                'store':                store,
                'closed_datetime':      closed_dt,
                'employee':             emp,
                'item_id':              row.get('Item ID', '').strip() or None,
                'item_name':            row.get('Item Name', '').strip() or None,
                'item_plu':             row.get('Item PLU', '').strip() or None,
                'price':                parse_money(row.get('Price', '0')),
                'discount_total':       parse_money(row.get('Discount Total', '0')),
                'promotion_total':      parse_money(row.get('Promotion Total', '0')),
                'taxes':                parse_money(row.get('Taxes', '0')),
                'net_sales':            parse_money(row.get('Net Sales', '0')),
                'gross_sales':          parse_money(row.get('Gross Sales', '0')),
                'total_sales':          parse_money(row.get('Total Sales', '0')),
                'revenue_center':       row.get('Revenue Center', '').strip() or None,
                'has_employee_discount': 1 if parse_bool(row.get('Has Employee Discount', 'False')) else 0,
                'destination':          row.get('Destination', '').strip() or None,
                'voided':               1 if parse_bool(row.get('Voided', 'False')) else 0,
                'has_customer':         1 if parse_bool(row.get('Has Customer', 'False')) else 0,
                'is_modifier':          1 if parse_bool(row.get('Is Modifier', 'False')) else 0,
                'order_id':             row.get('Order ID', '').strip() or None,
            })
    return rows

def import_file(path: Path):
    print(f'\n📂 {path.name}')
    rows = load_csv(path)
    if not rows:
        print('  ⚠️  No valid rows found — skipping')
        return

    # Determine date range per store
    from collections import defaultdict
    by_store: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        by_store[r['store']].append(r['closed_datetime'][:10])

    for store, dates in by_store.items():
        min_d, max_d = min(dates), max(dates)
        print(f'  🗑  Deleting {store} sales {min_d} → {max_d}')
        sql(f"DELETE FROM smoothieking.sales WHERE store='{store}' AND CONVERT(date, closed_datetime) BETWEEN '{min_d}' AND '{max_d}'")

    # Batch insert
    chunk = 200
    total = 0
    for i in range(0, len(rows), chunk):
        batch = rows[i:i+chunk]
        vals  = []
        for r in batch:
            def esc(v):
                if v is None:
                    return 'NULL'
                if isinstance(v, str):
                    return "'" + v.replace("'", "''") + "'"
                return str(v)
            vals.append(
                f"({esc(r['store'])},{esc(r['closed_datetime'])},{esc(r['employee'])},"
                f"{esc(r['item_id'])},{esc(r['item_name'])},{esc(r['item_plu'])},"
                f"{r['price']},{r['discount_total']},{r['promotion_total']},{r['taxes']},"
                f"{r['net_sales']},{r['gross_sales']},{r['total_sales']},"
                f"{esc(r['revenue_center'])},{r['has_employee_discount']},"
                f"{esc(r['destination'])},{r['voided']},{r['has_customer']},"
                f"{r['is_modifier']},{esc(r['order_id'])})"
            )
        insert_sql = (
            "INSERT INTO smoothieking.sales "
            "(store,closed_datetime,employee,item_id,item_name,item_plu,"
            "price,discount_total,promotion_total,taxes,net_sales,gross_sales,total_sales,"
            "revenue_center,has_employee_discount,destination,voided,has_customer,is_modifier,order_id)"
            " VALUES " + ','.join(vals)
        )
        sql(insert_sql)
        total += len(batch)
        print(f'  ✓ {total}/{len(rows)} rows', end='\r')

    print(f'  ✅ Inserted {total} rows from {path.name}')

def main():
    if len(sys.argv) > 1:
        files = [Path(a) for a in sys.argv[1:]]
    else:
        files = sorted(DOWNLOADS.glob('OC_*.csv'))
        if not files:
            print('No OC_*.csv files found in ~/Downloads/')
            sys.exit(1)

    print(f'Importing {len(files)} OC file(s) into smoothieking.sales ...')
    for f in files:
        import_file(f)
    print('\nDone.')

if __name__ == '__main__':
    main()
