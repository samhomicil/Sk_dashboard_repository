"""
Import labor (timecard) and till history files into Azure SQL.
Usage: python3 src/scripts/import_labor_till.py

Reads the most recent downloaded files from ~/Downloads automatically.
"""

import re
import json
import urllib.request
from datetime import datetime
from pathlib import Path

PROXY = 'http://127.0.0.1:5001/query'
DOWNLOADS = Path.home() / 'Downloads'

STORE_MAP = {'SK-1392': 'Pines', 'SK-1892': 'Miramar', 'SK-2384': 'Margate'}

# ── Proxy helper ─────────────────────────────────────────────────
def sql(query: str):
    body = json.dumps({'query': query}).encode()
    req  = urllib.request.Request(PROXY, data=body, headers={'Content-Type': 'application/json'})
    resp = json.loads(urllib.request.urlopen(req).read())
    if 'error' in resp:
        raise RuntimeError(resp['error'])
    return resp.get('rows', [])

# ── Value parsers ─────────────────────────────────────────────────
def parse_money(s: str) -> float:
    s = s.strip().replace('$', '').replace(',', '')
    if s.startswith('(') and s.endswith(')'):
        return -float(s[1:-1])
    return float(s) if s else 0.0

def parse_num(s: str) -> float:
    s = s.strip()
    return float(s) if s else 0.0

def parse_date(s: str) -> str:
    s = s.strip()
    for fmt in ('%m/%d/%Y', '%m/%d/%y'):
        try:
            return datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return s

def clean(s: str) -> str:
    return s.strip().replace("'", "''")  # escape single quotes for SQL

def split_row(line: str):
    return [c.strip() for c in line.rstrip('\n').split('\t')]

# ── Pick best file (longest date range) ──────────────────────────
def best_file(pattern: str) -> list[Path]:
    """Return files matching pattern, sorted newest first."""
    return sorted(DOWNLOADS.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)

# ── Parse timecard ────────────────────────────────────────────────
def parse_timecard(path: Path) -> tuple[str, list[dict]]:
    lines = path.read_text(encoding='utf-8-sig').splitlines()
    # Store from line 0 last tab field
    store_code = lines[0].split('\t')[-1].strip()
    store = STORE_MAP.get(store_code, store_code)

    records = []
    employee = None
    in_data  = False

    for line in lines:
        cols = split_row(line)
        first = cols[0]

        if first == 'Employe Name':
            in_data = False
            continue
        if first == 'Date' and 'Job' in line:
            in_data = True
            continue
        if first in ('Totals:', 'Signature', '') or not first:
            in_data = False
            continue

        # Employee name line comes right after "Employe Name" header
        # It's a non-data line with at least one real word and no date pattern
        if not in_data and re.match(r'^[A-Za-z]', first) and '/' not in first:
            employee = first
            continue

        if in_data and employee and re.match(r'^\d{1,2}/\d{1,2}/', first):
            try:
                shift_date   = parse_date(first)
                role         = clean(cols[1]) if len(cols) > 1 else ''
                time_in      = clean(cols[2]) if len(cols) > 2 else ''
                time_out_raw = cols[3].strip() if len(cols) > 3 else ''
                # time_out may contain a date prefix (overnight shifts)
                time_out = re.sub(r'^\d{1,2}/\d{1,2}/\d{4}\s+', '', time_out_raw).strip()
                time_out = clean(time_out)

                regular_hrs  = parse_num(cols[4])  if len(cols) > 4  else 0
                ot_hrs       = parse_num(cols[5])  if len(cols) > 5  else 0
                ext_hrs      = parse_num(cols[6])  if len(cols) > 6  else 0
                total_hrs    = parse_num(cols[7])  if len(cols) > 7  else 0
                paid_breaks  = parse_num(cols[8])  if len(cols) > 8  else 0
                unpaid_breaks= parse_num(cols[9])  if len(cols) > 9  else 0
                rate         = parse_money(cols[10]) if len(cols) > 10 else 0
                total_pay    = parse_money(cols[11]) if len(cols) > 11 else 0
                noncash_tips = parse_money(cols[12]) if len(cols) > 12 else 0
                declared_tips= parse_money(cols[13]) if len(cols) > 13 else 0

                records.append({
                    'store': store, 'employee': clean(employee), 'shift_date': shift_date,
                    'employee_role': role, 'shift_start': time_in, 'shift_end': time_out,
                    'regular_hrs': regular_hrs, 'ot_hrs': ot_hrs, 'ext_hrs': ext_hrs,
                    'total_hrs': total_hrs, 'paid_breaks': paid_breaks, 'unpaid_breaks': unpaid_breaks,
                    'rate': rate, 'total_pay': total_pay, 'noncash_tips': noncash_tips,
                    'declared_tips': declared_tips,
                })
            except Exception as e:
                print(f'  ⚠ Skipping timecard row ({e}): {first}')

    return store, records

# ── Parse till history ────────────────────────────────────────────
def parse_till(path: Path) -> tuple[str, list[dict]]:
    lines = path.read_text(encoding='utf-8-sig').splitlines()
    store_code = lines[0].split('\t')[-1].strip()
    store = STORE_MAP.get(store_code, store_code)

    records = []
    for line in lines[3:]:   # skip 3 header rows
        cols = split_row(line)
        if not cols[0] or not re.match(r'^\d{1,2}/\d{1,2}/', cols[0]):
            continue
        employee = cols[1].strip() if len(cols) > 1 else ''
        if not employee or employee in ('EOD Till',):
            continue
        try:
            records.append({
                'store':          store,
                'till_date':      parse_date(cols[0]),
                'employee':       clean(employee),
                'drawer':         clean(cols[2]) if len(cols) > 2 else '',
                'assigned_time':  clean(cols[3]) if len(cols) > 3 else '',
                'checkout_time':  clean(cols[4]) if len(cols) > 4 else '',
                'starting_bank':  parse_money(cols[5])  if len(cols) > 5  else 0,
                'cash_received':  parse_money(cols[6])  if len(cols) > 6  else 0,
                'paid_ins':       parse_money(cols[7])  if len(cols) > 7  else 0,
                'paid_outs':      parse_money(cols[8])  if len(cols) > 8  else 0,
                'tips':           parse_money(cols[9])  if len(cols) > 9  else 0,
                'gratuities':     parse_money(cols[10]) if len(cols) > 10 else 0,
                'declared_cash':  parse_money(cols[11]) if len(cols) > 11 else 0,
                'over_short':     parse_money(cols[12]) if len(cols) > 12 else 0,
            })
        except Exception as e:
            print(f'  ⚠ Skipping till row ({e}): {cols[0]}')

    return store, records

# ── Batch insert ──────────────────────────────────────────────────
def insert_labor(records: list[dict]):
    if not records:
        return
    cols = 'store,employee,shift_date,employee_role,shift_start,shift_end,regular_hrs,ot_hrs,ext_hrs,total_hrs,paid_breaks,unpaid_breaks,rate,total_pay,noncash_tips,declared_tips'
    for i in range(0, len(records), 50):
        batch = records[i:i+50]
        vals  = ','.join(
            f"('{r['store']}','{r['employee']}','{r['shift_date']}','{r['employee_role']}',"
            f"'{r['shift_start']}','{r['shift_end']}',"
            f"{r['regular_hrs']},{r['ot_hrs']},{r['ext_hrs']},{r['total_hrs']},"
            f"{r['paid_breaks']},{r['unpaid_breaks']},"
            f"{r['rate']},{r['total_pay']},{r['noncash_tips']},{r['declared_tips']})"
            for r in batch
        )
        sql(f'INSERT INTO smoothieking.labor ({cols}) VALUES {vals}')

def insert_till(records: list[dict]):
    if not records:
        return
    cols = 'store,till_date,employee,drawer,assigned_time,checkout_time,starting_bank,cash_received,paid_ins,paid_outs,tips,gratuities,declared_cash,over_short'
    for i in range(0, len(records), 50):
        batch = records[i:i+50]
        vals  = ','.join(
            f"('{r['store']}','{r['till_date']}','{r['employee']}','{r['drawer']}',"
            f"'{r['assigned_time']}','{r['checkout_time']}',"
            f"{r['starting_bank']},{r['cash_received']},{r['paid_ins']},{r['paid_outs']},"
            f"{r['tips']},{r['gratuities']},{r['declared_cash']},{r['over_short']})"
            for r in batch
        )
        sql(f'INSERT INTO smoothieking.tillhistory ({cols}) VALUES {vals}')

# ── MAIN ─────────────────────────────────────────────────────────
def main():
    # Test connection
    try:
        sql('SELECT 1 AS ok')
        print('✅ Connected to proxy')
    except Exception:
        print('❌ Cannot reach proxy — run: python3 /Users/sam/azure-sql-proxy.py')
        return

    # (6) = Pines Jun 15-23 | (7) = Miramar Jun 15-23 | (8) = Margate Jun 15-23
    timecard_files = [
        DOWNLOADS / 'Employee Timecard (6).txt',  # Pines
        DOWNLOADS / 'Employee Timecard (7).txt',  # Miramar
        DOWNLOADS / 'Employee Timecard (8).txt',  # Margate
    ]
    till_files = [
        DOWNLOADS / 'Till History.txt',
        DOWNLOADS / 'Till History (1).txt',
        DOWNLOADS / 'Till History (2).txt',
    ]

    # ── Labor ────────────────────────────────────────────────────
    print('\n⏳ Parsing timecards...')
    all_labor: list[dict] = []
    for f in timecard_files:
        store, records = parse_timecard(f)
        print(f'  {store}: {len(records)} shifts from {f.name}')
        all_labor.extend(records)

    if all_labor:
        # Delete per-store so each store only removes its own date range
        from collections import defaultdict
        by_store: dict[str, list] = defaultdict(list)
        for r in all_labor:
            by_store[r['store']].append(r['shift_date'])
        for store_name, shift_dates in by_store.items():
            min_d, max_d = min(shift_dates), max(shift_dates)
            print(f'\n  Deleting existing labor {min_d} – {max_d} for {store_name}...')
            sql(f"DELETE FROM smoothieking.labor WHERE store='{store_name}' AND shift_date BETWEEN '{min_d}' AND '{max_d}'")

        print(f'  Inserting {len(all_labor)} labor records...')
        insert_labor(all_labor)
        print(f'  ✅ Labor done')

    # ── Till ─────────────────────────────────────────────────────
    print('\n⏳ Parsing till history...')
    all_till: list[dict] = []
    for f in till_files:
        store, records = parse_till(f)
        print(f'  {store}: {len(records)} records from {f.name}')
        all_till.extend(records)

    if all_till:
        dates = sorted(set(r['till_date'] for r in all_till))
        min_d, max_d = dates[0], dates[-1]
        stores = list(set(r['store'] for r in all_till))
        store_list = ','.join(f"'{s}'" for s in stores)

        print(f'\n  Deleting existing till {min_d} – {max_d} for {stores}...')
        sql(f"DELETE FROM smoothieking.tillhistory WHERE store IN ({store_list}) AND till_date BETWEEN '{min_d}' AND '{max_d}'")

        print(f'  Inserting {len(all_till)} till records...')
        insert_till(all_till)
        print(f'  ✅ Till done')

    print('\n✅ Import complete — run npm run refresh next')

if __name__ == '__main__':
    main()
