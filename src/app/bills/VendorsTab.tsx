'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  dueDatesInRange,
  resolveAmount,
  scheduleLabel,
  iso,
  ymOf,
  type RecurrenceRule,
  type SalesData,
  type AmountType,
  type Payment,
  type Bill,
} from '@/lib/bills/billsEngine';
import { money2, dayLabel } from '@/lib/bills/format';
import type { ClientBill } from './page';

// ---- Constants ----
const STORES = ['Miramar', 'Pines', 'Margate'] as const;
const CATEGORIES = [
  'Rent / Lease',
  'Franchise Fees',
  'Utilities',
  'Internet / Phone',
  'Insurance',
  'Loan / Debt',
  'Payroll',
  'Subscriptions',
  'Professional Services',
  'Maintenance',
  'Bank / Finance',
  'Taxes',
  'Food / COGS',
  'Other',
] as const;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_COLOR: Record<string, string> = {
  fixed: 'var(--fixed)',
  estimate: 'var(--est)',
  percent: 'var(--var)',
};

type Frequency =
  | 'monthly'
  | 'semimonthly'
  | 'weekly'
  | 'biweekly'
  | 'quarterly'
  | 'n_months'
  | 'n_days'
  | 'yearly';

const ANCHOR_REQUIRED: Frequency[] = ['weekly', 'biweekly', 'quarterly', 'n_months', 'n_days'];

interface DrawerForm {
  vendor: string;
  store: (typeof STORES)[number];
  category: string;
  payment: Payment;
  amountType: AmountType;
  amountValue: string;
  anchor: string;
  end: string;
  notes: string;
  active: boolean;
  accountId: string;
  accountLabel: string;
  frequency: Frequency;
  monthlyMode: 'day' | 'nth' | 'last';
  monthlyDay: number;
  monthlyNth: number;
  monthlyWeekday: number;
  semiDay1: number;
  semiDay2: number;
  weeklyWeekday: number;
  nMonths: number;
  nMonthsDay: number;
  quarterlyDay: number;
  nDays: number;
  yearlyMonth: number;
  yearlyDay: number;
}

function makeDefaultForm(currentStore: string, today: string): DrawerForm {
  return {
    vendor: '',
    store: (STORES.includes(currentStore as (typeof STORES)[number])
      ? currentStore
      : STORES[0]) as (typeof STORES)[number],
    category: 'Utilities',
    payment: 'auto',
    amountType: 'fixed',
    amountValue: '',
    anchor: today,
    end: '',
    notes: '',
    active: true,
    accountId: '',
    accountLabel: '',
    frequency: 'monthly',
    monthlyMode: 'day',
    monthlyDay: 1,
    monthlyNth: 1,
    monthlyWeekday: 0,
    semiDay1: 1,
    semiDay2: 15,
    weeklyWeekday: 0,
    nMonths: 1,
    nMonthsDay: 1,
    quarterlyDay: 1,
    nDays: 7,
    yearlyMonth: 0,
    yearlyDay: 1,
  };
}

function billToForm(bill: ClientBill, currentStore: string, today: string): DrawerForm {
  const base = makeDefaultForm(currentStore, today);
  const r = bill.recurrence;
  let frequency: Frequency = 'monthly';
  let monthlyMode: 'day' | 'nth' | 'last' = 'day';
  let monthlyDay = 1,
    monthlyNth = 1,
    monthlyWeekday = 0;
  let semiDay1 = 1,
    semiDay2 = 15;
  let weeklyWeekday = 0;
  let nMonths = 1,
    nMonthsDay = 1,
    quarterlyDay = 1;
  let nDays = 7;
  let yearlyMonth = 0,
    yearlyDay = 1;

  switch (r.type) {
    case 'monthly_day':
      frequency = 'monthly';
      monthlyMode = 'day';
      monthlyDay = r.day;
      break;
    case 'monthly_last_day':
      frequency = 'monthly';
      monthlyMode = 'last';
      break;
    case 'monthly_nth_weekday':
      frequency = 'monthly';
      monthlyMode = 'nth';
      monthlyNth = r.nth;
      monthlyWeekday = r.weekday;
      break;
    case 'semimonthly':
      frequency = 'semimonthly';
      semiDay1 = r.day1;
      semiDay2 = r.day2;
      break;
    case 'weekly':
      frequency = 'weekly';
      weeklyWeekday = r.weekday;
      break;
    case 'biweekly':
      frequency = 'biweekly';
      break;
    case 'every_n_months':
      if (r.n === 3) {
        frequency = 'quarterly';
        quarterlyDay = r.day;
      } else {
        frequency = 'n_months';
        nMonths = r.n;
        nMonthsDay = r.day;
      }
      break;
    case 'every_n_days':
      frequency = 'n_days';
      nDays = r.n;
      break;
    case 'yearly':
      frequency = 'yearly';
      yearlyMonth = r.month;
      yearlyDay = r.day;
      break;
  }

  return {
    ...base,
    vendor: bill.vendor,
    store: bill.store as (typeof STORES)[number],
    category: bill.category,
    payment: bill.payment,
    amountType: bill.amountType,
    amountValue: String(bill.amountValue),
    anchor: bill.anchor || '',
    end: bill.end || '',
    notes: bill.notes || '',
    active: bill.active,
    accountId: bill.paidFrom ?? '',
    accountLabel: bill.paidFrom ?? '',
    frequency,
    monthlyMode,
    monthlyDay,
    monthlyNth,
    monthlyWeekday,
    semiDay1,
    semiDay2,
    weeklyWeekday,
    nMonths,
    nMonthsDay,
    quarterlyDay,
    nDays,
    yearlyMonth,
    yearlyDay,
  };
}

function buildRecurrenceRule(form: DrawerForm): RecurrenceRule {
  switch (form.frequency) {
    case 'monthly':
      if (form.monthlyMode === 'day') return { type: 'monthly_day', day: form.monthlyDay };
      if (form.monthlyMode === 'nth')
        return {
          type: 'monthly_nth_weekday',
          nth: form.monthlyNth,
          weekday: form.monthlyWeekday,
        };
      return { type: 'monthly_last_day' };
    case 'semimonthly':
      return { type: 'semimonthly', day1: form.semiDay1, day2: form.semiDay2 };
    case 'weekly':
      return { type: 'weekly', weekday: form.weeklyWeekday };
    case 'biweekly':
      return { type: 'biweekly' };
    case 'quarterly':
      return { type: 'every_n_months', n: 3, day: form.quarterlyDay };
    case 'n_months':
      return { type: 'every_n_months', n: form.nMonths, day: form.nMonthsDay };
    case 'n_days':
      return { type: 'every_n_days', n: form.nDays };
    case 'yearly':
      return { type: 'yearly', month: form.yearlyMonth, day: form.yearlyDay };
  }
}

// ====================================================================
// Category multi-select dropdown
// ====================================================================
function CatFilter({ cats, selected, onChange }: {
  cats: string[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (c: string) =>
    onChange((() => { const n = new Set(selected); n.has(c) ? n.delete(c) : n.add(c); return n; })());

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="vk-select"
        style={{ width: 'auto', minWidth: 150, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ flex: 1 }}>
          {selected.size === 0 ? 'All categories' : `${selected.size} categor${selected.size === 1 ? 'y' : 'ies'}`}
        </span>
        {selected.size > 0 && (
          <span
            style={{ fontSize: 10, background: 'var(--accent)', color: 'var(--surface)', borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}
            onClick={(e) => { e.stopPropagation(); onChange(new Set()); }}
          >
            ✕
          </span>
        )}
        <span style={{ opacity: 0.4, fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth: 210, padding: '6px 0', maxHeight: 300, overflowY: 'auto',
        }}>
          {cats.map((c) => (
            <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 14px', fontSize: 13, cursor: 'pointer', userSelect: 'none', background: selected.has(c) ? 'var(--accent-faint, color-mix(in srgb, var(--brand) 8%, var(--surface)))' : 'none' }}>
              <input
                type="checkbox"
                checked={selected.has(c)}
                onChange={() => toggle(c)}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }}
              />
              {c}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// Main VendorsTab component
// ====================================================================
export default function VendorsTab({
  bills,
  sales,
  store,
  now,
  occ,
  billGroups,
}: {
  bills: ClientBill[];
  sales: SalesData;
  store: string;
  now: Date;
  occ: import('@/lib/bills/reconcile').ReconciledOccurrence[];
  /** billId -> the full set of bills settled by ONE real payment (see
   *  billGroups.ts). The Bills overview has merged these into a single row since
   *  it was asked for; this screen did not, so Pines' rent and its water bill —
   *  one draft — read as two unrelated obligations here while reading as one
   *  there. Same data, two answers, depending on which tab you opened. */
  billGroups: Record<string, string[]>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterStore, setFilterStore] = useState('All');
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState('');
  const [filterPay, setFilterPay] = useState('');
  const [sortKey, setSortKey] = useState<'vendor' | 'amount' | 'next'>('next');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [drawerBill, setDrawerBill] = useState<ClientBill | null>(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const todayISO = iso(now);
  const futureISO = iso(new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()));

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2500);
  }, []);

  // Scope to selected store
  const scopedBills = useMemo(
    () => (filterStore === 'All' ? bills : bills.filter((b) => b.store === filterStore)),
    [bills, filterStore],
  );

  // Precompute next occurrence for each bill (for sort + display)
  const nextOccs = useMemo(() => {
    const map = new Map<string, { due: Date; original: Date; shifted: boolean } | null>();
    for (const b of scopedBills) {
      const occs = dueDatesInRange(
        b.recurrence,
        b.anchor ?? null,
        b.end ?? null,
        todayISO,
        futureISO,
      ).filter((o) => iso(o.due) >= todayISO);
      map.set(b.id, occs[0] ?? null);
    }
    return map;
  }, [scopedBills, todayISO, futureISO]);

  // Distinct categories for filter dropdown
  const cats = useMemo(() => {
    const set = new Set(scopedBills.map((b) => b.category));
    return [...set].sort();
  }, [scopedBills]);

  // Filter + sort
  const shown = useMemo(() => {
    const q = search.toLowerCase();
    let result = scopedBills.filter((b) => {
      if (q && !`${b.vendor} ${b.category}`.toLowerCase().includes(q)) return false;
      if (filterCats.size > 0 && !filterCats.has(b.category)) return false;
      if (filterType && b.amountType !== filterType) return false;
      if (filterPay && b.payment !== filterPay) return false;
      return true;
    });
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'vendor') {
        cmp = a.vendor.localeCompare(b.vendor);
      } else if (sortKey === 'amount') {
        cmp = a.amountValue - b.amountValue;
      } else {
        const na = nextOccs.get(a.id);
        const nb = nextOccs.get(b.id);
        cmp = (na ? +na.due : Infinity) - (nb ? +nb.due : Infinity);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [scopedBills, search, filterCats, filterType, filterPay, sortKey, sortDir, nextOccs]);

  // Bills that leave the bank as ONE payment collapse to one row, matching what
  // the Bills overview already does. The primary carries the group's combined
  // amount; the others fold underneath it and are reachable by expanding.
  //
  // A group only merges when EVERY member survived the filters. Filtering to
  // "% of Sales" and then showing a merged row whose total silently includes a
  // Fixed member would report a number the filter says you are not looking at —
  // so in that case the survivors list individually, unmerged.
  const rows = useMemo(() => {
    const present = new Set(shown.map((b) => b.id));
    const byId = new Map(shown.map((b) => [b.id, b]));
    const consumed = new Set<string>();
    const out: { bill: ClientBill; members: ClientBill[] }[] = [];
    for (const bill of shown) {
      if (consumed.has(bill.id)) continue;
      const group = billGroups[bill.id];
      const whole = group && group.every((id) => present.has(id));
      if (!whole) { out.push({ bill, members: [] }); continue; }
      if (group[0] !== bill.id) continue;          // fold into its primary below
      const members = group.map((id) => byId.get(id)).filter((b): b is ClientBill => !!b);
      members.forEach((m) => consumed.add(m.id));
      out.push({ bill, members: members.length > 1 ? members : [] });
    }
    return out;
  }, [shown, billGroups]);

  const toggleSort = (key: 'vendor' | 'amount' | 'next') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const openCreate = () => {
    setDrawerMode('create');
    setDrawerBill(null);
    setDrawerOpen(true);
  };

  const openEdit = (bill: ClientBill) => {
    setDrawerMode('edit');
    setDrawerBill(bill);
    setDrawerOpen(true);
  };

  const openDuplicate = (bill: ClientBill) => {
    setDrawerMode('create');
    setDrawerBill(bill);
    setDrawerOpen(true);
  };

  const handleDelete = async (bill: ClientBill) => {
    if (!confirm(`Delete ${bill.vendor}? This removes it from the forecast.`)) return;
    const res = await fetch('/api/bills', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bill.id }),
    });
    if (res.ok) {
      showToast('Bill deleted');
      router.refresh();
    } else {
      showToast('Delete failed');
    }
  };

  const handleSaved = (msg: string) => {
    setDrawerOpen(false);
    showToast(msg);
    router.refresh();
  };

  const SortArr = ({ col }: { col: 'vendor' | 'amount' | 'next' }) => (
    <span className="arr" style={{ opacity: sortKey === col ? 1 : 0.35 }}>
      {sortKey === col ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
    </span>
  );

  // Empty state: no bills for this store scope
  if (scopedBills.length === 0) {
    return (
      <>
        <div
          className="vk-panel"
          style={{ textAlign: 'center', padding: '48px 24px' }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display, ui-sans-serif)',
              fontWeight: 700,
              fontSize: 18,
              color: 'var(--ink)',
              marginBottom: 8,
            }}
          >
            No bills yet
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
            Add your first recurring bill
            {store !== 'All' ? ` for ${store}` : ''}.
          </div>
          <button className="vk-btn primary" onClick={openCreate}>
            + New bill
          </button>
        </div>

        <BillDrawer
          open={drawerOpen}
          mode={drawerMode}
          bill={drawerBill}
          currentStore={store}
          todayISO={todayISO}
          onClose={() => setDrawerOpen(false)}
          onSaved={handleSaved}
        />
        <div className={`vk-toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
      </>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
        className="mobile-toolbar"
      >
        {/* Search */}
        <div className="vk-search">
          <svg
            width="14"
            height="14"
            fill="none"
            viewBox="0 0 24 24"
            stroke="var(--faint)"
            strokeWidth="2.2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendors…"
          />
        </div>

        {/* Store filter */}
        <select
          className="vk-select"
          style={{ width: 'auto', minWidth: 120 }}
          value={filterStore}
          onChange={(e) => setFilterStore(e.target.value)}
        >
          <option value="All">All stores</option>
          <option value="Margate">Margate</option>
          <option value="Miramar">Miramar</option>
          <option value="Pines">Pines</option>
        </select>

        {/* Category multi-select */}
        <CatFilter
          cats={cats}
          selected={filterCats}
          onChange={setFilterCats}
        />

        {/* Type filter */}
        <select
          className="vk-select"
          style={{ width: 'auto', minWidth: 120 }}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="fixed">Fixed</option>
          <option value="estimate">Estimate</option>
          <option value="percent">% of Sales</option>
        </select>

        {/* Payment filter */}
        <select
          className="vk-select"
          style={{ width: 'auto', minWidth: 130 }}
          value={filterPay}
          onChange={(e) => setFilterPay(e.target.value)}
        >
          <option value="">All payments</option>
          <option value="auto">Auto-pay</option>
          <option value="manual">Manual</option>
        </select>

        {/* Counter */}
        <span
          style={{
            fontSize: 12,
            color: 'var(--faint)',
            whiteSpace: 'nowrap',
          }}
        >
          {shown.length} of {scopedBills.length}
        </span>

        {/* New bill button */}
        <button className="vk-btn primary" style={{ marginLeft: 'auto' }} onClick={openCreate}>
          + New bill
        </button>
      </div>

      {/* Table */}
      <div className="vk-panel">
        <table className="vk-table">
          <thead>
            <tr>
              <th
                className="sortable"
                onClick={() => toggleSort('vendor')}
              >
                Vendor <SortArr col="vendor" />
              </th>
              <th className="col-hide-mobile">Schedule</th>
              <th className="col-hide-mobile sortable" onClick={() => toggleSort('amount')}>
                Amount <SortArr col="amount" />
              </th>
              <th className="col-hide-mobile">Payment</th>
              <th
                className="sortable"
                style={{ textAlign: 'right' }}
                onClick={() => toggleSort('next')}
              >
                Next due <SortArr col="next" />
              </th>
              <th className="col-hide-mobile" style={{ textAlign: 'right' }}>Next amount</th>
              <th style={{ textAlign: 'center' }}>Status</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: 'center',
                    color: 'var(--faint)',
                    padding: '20px 16px',
                    fontSize: 13,
                  }}
                >
                  No bills match these filters.
                </td>
              </tr>
            )}
            {rows.map(({ bill, members }) => {
              const next = nextOccs.get(bill.id) ?? null;
              return (
                <BillRow
                  key={bill.id}
                  bill={bill}
                  next={next}
                  sales={sales}
                  storeFilter={filterStore}
                  billOcc={occ.filter(o => o.billId === bill.id)}
                  members={members}
                  onEdit={() => openEdit(bill)}
                  onDuplicate={() => openDuplicate(bill)}
                  onDelete={() => handleDelete(bill)}
                  onEditMember={openEdit}
                  onDeleteMember={handleDelete}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <BillDrawer
        open={drawerOpen}
        mode={drawerMode}
        bill={drawerBill}
        currentStore={store}
        todayISO={todayISO}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
      />

      {/* Toast */}
      <div className={`vk-toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
    </>
  );
}

// ====================================================================
// Bill table row
// ====================================================================
function BillRow({
  bill,
  next,
  sales,
  storeFilter,
  billOcc,
  members,
  onEdit,
  onDuplicate,
  onDelete,
  onEditMember,
  onDeleteMember,
}: {
  bill: ClientBill;
  next: { due: Date; original: Date; shifted: boolean } | null;
  sales: SalesData;
  storeFilter: string;
  billOcc: import('@/lib/bills/reconcile').ReconciledOccurrence[];
  /** The bills this one is settled together with, INCLUDING itself. Empty when
   *  this row stands alone — so `members.length > 1` is the merged case. */
  members: ClientBill[];
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEditMember: (b: ClientBill) => void;
  onDeleteMember: (b: ClientBill) => void;
}) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [open, setOpen] = useState(false);

  const merged = members.length > 1;
  // A merged row states the whole payment, since that is the thing that leaves
  // the bank. Percent bills are deliberately NOT summed into it: 6% + 3% is 9%
  // of nothing until sales exist, and printing "9%" beside a dollar figure would
  // read as a rate someone could act on. Mixed groups fall back to the primary's
  // own amount and let the breakdown carry the detail.
  const allFixed = merged && members.every((m) => m.amountType !== 'percent');
  const groupTotal = allFixed ? members.reduce((s, m) => s + m.amountValue, 0) : null;

  // Find the most-recent non-upcoming occurrence (current or past due)
  const todayISO = iso(new Date());
  const activeOcc = billOcc
    .filter(o => o.due <= todayISO || o.status === 'due')
    .sort((a, b) => b.due.localeCompare(a.due))[0] ?? null;

  const isPaid = activeOcc?.status === 'paid';
  const isAuto = bill.payment === 'auto';

  async function togglePaid() {
    if (!activeOcc || isAuto) return;
    setToggling(true);
    await fetch('/api/payments', {
      method: isPaid ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId: bill.id, dueDate: activeOcc.due }),
    });
    router.refresh();
    setToggling(false);
  }
  // On a merged row this must total the SAME set the Amount column totals, or the
  // row reports a combined figure beside a single member's next draft and the two
  // silently disagree. Percent members resolve to real dollars here (sales for the
  // period are known), so unlike the Amount column a mixed group can be summed —
  // but only when every member resolved. One unknown member makes the total a
  // guess, and it says "needs sales" rather than printing a short number.
  const nextAmt = useMemo(() => {
    if (!next) return null;
    const set = members.length > 1 ? members : [bill];
    const parts = set.map((m) =>
      resolveAmount(m as unknown as Bill, sales, ymOf(next.due), iso(next.due)));
    if (parts.some((p) => !p?.known)) return { val: null, known: false };
    return { val: parts.reduce((s, p) => s + (p!.val ?? 0), 0), known: true };
  }, [bill, members, next, sales]);

  return (
    <>
    <tr className={bill.active === false ? 'paused' : ''}>
      {/* Vendor */}
      <td>
        <div className="vname">
          {bill.vendor}
          {merged && (
            /* Same affordance the Bills overview uses for a merged row: the count
               of what else this payment covers, click to see the breakdown. */
            <button
              type="button"
              className="vk-badge b-cat groupchip"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              title={`One payment also covers: ${members.filter((m) => m.id !== bill.id).map((m) => m.vendor).join(', ')} — click to ${open ? 'hide' : 'see'} the breakdown`}
            >+{members.length - 1}</button>
          )}
        </div>
        <div className="vmeta">
          {storeFilter === 'All' && (
            <>
              <strong>{bill.store}</strong>
              {' · '}
            </>
          )}
          <span className="vk-badge b-cat">{bill.category}</span>
          {bill.paidFrom && (
            <span style={{ marginLeft: 4, color: 'var(--faint)', fontSize: 11 }}>· {bill.paidFrom}</span>
          )}
        </div>
        {/* Mobile-only: schedule + amount inline, because those columns are hidden
            below 640px. It must NOT show on desktop, where the columns are back and
            it just prints every row's schedule and amount twice.

            It did exactly that. The class was `sm:hidden` with `display:'flex'` in an
            inline style, and an inline style outranks any class selector — so the
            block never hid, at any width. The visibility now lives entirely in CSS
            (.vmeta-mobile), where the breakpoint that hides the columns also governs
            the thing standing in for them. */}
        <div className="vmeta vmeta-mobile">
          <span>{scheduleLabel(bill.recurrence)}</span>
          <span>·</span>
          <span className="tnum">
            {bill.amountType === 'percent' ? `${bill.amountValue}% of sales` : money2(bill.amountValue)}
          </span>
          <span className="vk-badge" style={{ fontSize: 10, padding: '1px 5px' }}>
            {bill.payment === 'auto' ? '↻ Auto' : 'Manual'}
          </span>
        </div>
      </td>

      {/* Schedule */}
      <td className="col-hide-mobile" style={{ fontSize: 13, color: 'var(--muted)' }}>
        {scheduleLabel(bill.recurrence)}
      </td>

      {/* Amount */}
      <td className="col-hide-mobile">
        {bill.amountType === 'percent' ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="tnum">{bill.amountValue}%</span>
            <span className="vk-badge b-var">% of Sales</span>
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* On a merged row this is the whole draft, not this bill's share —
                the figure that leaves the bank. The share is in the breakdown. */}
            <span className="tnum">{money2(groupTotal ?? bill.amountValue)}</span>
            <span className={`vk-badge ${bill.amountType === 'fixed' ? 'b-fixed' : 'b-est'}`}>
              {bill.amountType === 'fixed' ? 'Fixed' : 'Estimate'}
            </span>
            {groupTotal != null && (
              <span className="vk-badge b-cat" title="combined total of the bills settled by this one payment">combined</span>
            )}
          </span>
        )}
      </td>

      {/* Payment */}
      <td className="col-hide-mobile">
        {bill.payment === 'auto' ? (
          <span className="vk-badge b-auto">
            ↻ Auto
          </span>
        ) : (
          <span className="vk-badge b-manual">
            Manual
          </span>
        )}
      </td>

      {/* Next due */}
      <td style={{ textAlign: 'right' }}>
        {next ? (
          <>
            <div>{dayLabel(iso(next.due))}</div>
            {next.shifted ? (
              <div className="shift-tag">↳ from {dayLabel(iso(next.original))}</div>
            ) : (
              <div className="vmeta">{WD[next.due.getDay()]}</div>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--faint)' }}>—</span>
        )}
      </td>

      {/* Next amount */}
      <td className="tnum col-hide-mobile" style={{ textAlign: 'right' }}>
        {!next ? (
          <span style={{ color: 'var(--faint)' }}>—</span>
        ) : nextAmt && nextAmt.known ? (
          money2(nextAmt.val!)
        ) : (
          <span className="vk-badge b-var">needs sales</span>
        )}
      </td>

      {/* Paid status */}
      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
        {activeOcc == null ? (
          <span style={{ color: 'var(--faint)', fontSize: 12 }}>—</span>
        ) : isPaid ? (
          isAuto ? (
            <span className="vk-badge" style={{ background: 'var(--status-good)22', color: 'var(--status-good)', fontSize: 11 }}>
              ✓ Paid
            </span>
          ) : (
            <button
              className="vk-btn ghost sm"
              disabled={toggling}
              onClick={togglePaid}
              title="Click to mark unpaid"
              style={{ color: 'var(--status-good)', fontWeight: 600, opacity: toggling ? 0.5 : 1 }}
            >
              ✓ Paid
            </button>
          )
        ) : (
          isAuto ? (
            <span className="vk-badge" style={{ background: 'var(--status-warn)', color: 'var(--surface)', fontSize: 11 }}>
              Pending
            </span>
          ) : (
            <button
              className="vk-btn ghost sm"
              disabled={toggling}
              onClick={togglePaid}
              title="Click to mark paid"
              style={{ opacity: toggling ? 0.5 : 1 }}
            >
              Mark Paid
            </button>
          )
        )}
      </td>

      {/* Actions */}
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button className="vk-btn ghost sm" onClick={onEdit}>Edit</button>
        <button className="vk-btn ghost sm" onClick={onDuplicate} title="Duplicate bill profile">⧉</button>
        <button className="vk-btn danger sm" onClick={onDelete}>Delete</button>
      </td>
    </tr>
    {merged && open && (
      <GroupBreakdown members={members} onEditMember={onEditMember} onDeleteMember={onDeleteMember} />
    )}
    </>
  );
}

/** The members of a merged row, revealed by the +N chip.
 *
 *  This screen is where bills are CONFIGURED, which is why merging here cannot be
 *  the flat single row the Bills overview uses: every underlying bill still needs
 *  its own Edit and Delete, and a merged row that hid them would make a bill
 *  unreachable from the only screen that maintains it. So the group collapses for
 *  reading and expands for editing. */
function GroupBreakdown({
  members,
  onEditMember,
  onDeleteMember,
}: {
  members: ClientBill[];
  onEditMember: (b: ClientBill) => void;
  onDeleteMember: (b: ClientBill) => void;
}) {
  return (
    <tr className="groupdetail">
      <td colSpan={8}>
        <div className="gdwrap">
          <div className="gdhead">Settled by one payment</div>
          {members.map((m) => (
            <div key={m.id} className="gdrow">
              <span className="gdname">{m.vendor}</span>
              <span className="gdcat"><span className="vk-badge b-cat">{m.category}</span></span>
              <span className="tnum gdamt">
                {m.amountType === 'percent' ? `${m.amountValue}% of sales` : money2(m.amountValue)}
              </span>
              <span className="gdact">
                <button className="vk-btn ghost sm" onClick={() => onEditMember(m)}>Edit</button>
                <button className="vk-btn danger sm" onClick={() => onDeleteMember(m)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

// ====================================================================
// Bill drawer (Add / Edit)
// ====================================================================
function BillDrawer({
  open,
  mode,
  bill,
  currentStore,
  todayISO,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  bill: ClientBill | null;
  currentStore: string;
  todayISO: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState<DrawerForm>(() =>
    makeDefaultForm(currentStore, todayISO),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [acctOptions, setAcctOptions] = useState<{ id: string; name: string; store: string }[]>([]);
  const [customAcct, setCustomAcct] = useState(false);

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(setAcctOptions).catch(() => null);
  }, []);

  // Reset form when drawer opens
  useEffect(() => {
    if (open) {
      setErr('');
      if (bill && (mode === 'edit' || mode === 'create')) {
        const f = billToForm(bill, currentStore, todayISO);
        // In duplicate mode clear the vendor name so user fills it (but keep all other fields)
        if (mode === 'create') f.vendor = '';
        setForm(f);
        setCustomAcct(!!f.accountLabel && !acctOptions.some(a => a.id === f.accountId));
      } else {
        setForm(makeDefaultForm(currentStore, todayISO));
        setCustomAcct(false);
      }
    }
  }, [open, mode, bill, currentStore, todayISO, acctOptions]);

  // Escape key closes drawer
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const set = <K extends keyof DrawerForm>(key: K, value: DrawerForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const recurrence = buildRecurrenceRule(form);

  // Live preview: next 5 occurrences
  const preview = useMemo(() => {
    try {
      const anchor = form.anchor || null;
      const end = form.end || null;
      const futureISO = (() => {
        const [y, m, d] = todayISO.split('-').map(Number);
        return `${y + 2}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      })();
      const occs = dueDatesInRange(recurrence, anchor, end, todayISO, futureISO).filter(
        (o) => iso(o.due) >= todayISO,
      );
      return occs.slice(0, 5);
    } catch {
      return [];
    }
  }, [form, recurrence, todayISO]);

  const hasShifted = preview.some((o) => o.shifted);

  const validate = (): string => {
    if (!form.vendor.trim()) return 'Add a vendor name';
    if (ANCHOR_REQUIRED.includes(form.frequency) && !form.anchor)
      return 'This schedule needs a start date';
    if (form.amountValue === '' || form.amountValue == null) return 'Enter an amount';
    return '';
  };

  const handleSave = async () => {
    const errMsg = validate();
    if (errMsg) {
      setErr(errMsg);
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const payload = {
        store: form.store,
        vendor: form.vendor.trim(),
        category: form.category || 'Other',
        recurrence,
        amountType: form.amountType,
        amountValue: Number(form.amountValue),
        payment: form.payment,
        account: form.accountId || null,
        paidFrom: form.accountLabel.trim() || null,
        anchor: form.anchor || null,
        end: form.end || null,
        notes: form.notes || null,
        active: form.active,
      };

      if (mode === 'create') {
        const res = await fetch('/api/bills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed');
        onSaved('Bill added');
      } else {
        const res = await fetch('/api/bills', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: bill!.id, ...payload }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed');
        onSaved('Bill updated');
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const amtLabel =
    form.amountType === 'percent' ? 'Percentage of monthly sales' : 'Amount (USD)';
  const amtPlaceholder = form.amountType === 'percent' ? 'e.g. 6' : 'e.g. 1200';
  const amtHelper =
    form.amountType === 'fixed'
      ? 'Known recurring cost.'
      : form.amountType === 'estimate'
        ? 'Placeholder — flagged until confirmed.'
        : "Resolves to $ using each month's sales (actual if entered, else projected).";

  return (
    <>
      {/* Scrim */}
      <div
        className={`vk-scrim${open ? ' show' : ''}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`vk-drawer${open ? ' show' : ''}`}
        style={{ fontFamily: 'var(--font-inter, ui-sans-serif)' }}
      >
        {/* Head */}
        <div className="drawer-head">
          <span
            style={{
              fontFamily: 'var(--font-display, ui-sans-serif)',
              fontWeight: 700,
              fontSize: 16,
              color: 'var(--ink)',
            }}
          >
            {mode === 'edit' ? 'Edit bill' : bill ? 'Duplicate bill' : 'New bill'}
          </span>
          <button className="vk-btn ghost sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* Basic info */}
          <div className="vk-formgrid">
            {/* Vendor */}
            <div className="full">
              <label className="vk-label">
                Vendor name *
                <input
                  className="vk-input"
                  type="text"
                  value={form.vendor}
                  onChange={(e) => set('vendor', e.target.value)}
                  placeholder="e.g. FPL — Utilities"
                />
              </label>
            </div>

            {/* Store */}
            <div>
              <label className="vk-label">
                Store
                <select
                  className="vk-select"
                  value={form.store}
                  onChange={(e) => set('store', e.target.value as (typeof STORES)[number])}
                >
                  {STORES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Category */}
            <div>
              <label className="vk-label">
                Category
                <input
                  className="vk-input"
                  type="text"
                  list="vk-catlist"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                  placeholder="Category"
                />
                <datalist id="vk-catlist">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>

            {/* Payment */}
            <div>
              <label className="vk-label">
                Payment
                <select
                  className="vk-select"
                  value={form.payment}
                  onChange={(e) => set('payment', e.target.value as Payment)}
                >
                  <option value="auto">Auto-pay</option>
                  <option value="manual">Manual</option>
                </select>
              </label>
            </div>

            {/* Bank Account */}
            <div className="full">
              <label className="vk-label">
                Bank account
                {!customAcct ? (
                  <select
                    className="vk-select"
                    value={form.accountId}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__custom__') {
                        setCustomAcct(true);
                        set('accountId', '');
                        set('accountLabel', '');
                      } else {
                        const opt = acctOptions.find(a => a.id === val);
                        set('accountId', val);
                        set('accountLabel', opt?.name ?? '');
                      }
                    }}
                  >
                    <option value="">— None —</option>
                    {['Margate', 'Miramar', 'Pines'].map(storeName => {
                      const storeAccts = acctOptions.filter(a => a.store === storeName);
                      if (!storeAccts.length) return null;
                      return (
                        <optgroup key={storeName} label={storeName}>
                          {storeAccts.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                    <option value="__custom__">＋ Enter custom account…</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="vk-input"
                      type="text"
                      value={form.accountLabel}
                      onChange={(e) => { set('accountLabel', e.target.value); set('accountId', ''); }}
                      placeholder="e.g. BofA Business Checking"
                    />
                    <button
                      type="button"
                      className="vk-btn ghost sm"
                      onClick={() => { setCustomAcct(false); set('accountId', ''); set('accountLabel', ''); }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </label>
              {form.accountLabel && !customAcct && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{form.accountLabel}</div>
              )}
            </div>
          </div>

          {/* Schedule fieldset */}
          <div className="vk-fieldset">
            <div className="legend">Schedule</div>

            {/* Frequency */}
            <div style={{ marginBottom: 14 }}>
              <label className="vk-label">
                Frequency
                <select
                  className="vk-select"
                  value={form.frequency}
                  onChange={(e) => {
                    set('frequency', e.target.value as Frequency);
                  }}
                >
                  <option value="monthly">Monthly</option>
                  <option value="semimonthly">Twice a month</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="n_months">Every N months</option>
                  <option value="yearly">Yearly</option>
                  <option value="n_days">Every N days</option>
                </select>
              </label>
            </div>

            {/* Dynamic sub-fields */}
            <ScheduleSubFields form={form} set={set} />

            {/* Anchor + End */}
            <div className="vk-formgrid" style={{ marginTop: 14, marginBottom: 0 }}>
              <div>
                <label className="vk-label">
                  Start date{ANCHOR_REQUIRED.includes(form.frequency) ? ' *' : ''}
                  <input
                    className="vk-input-date"
                    type="date"
                    value={form.anchor}
                    onChange={(e) => set('anchor', e.target.value)}
                  />
                </label>
              </div>
              <div>
                <label className="vk-label">
                  End date (optional)
                  <input
                    className="vk-input-date"
                    type="date"
                    value={form.end}
                    onChange={(e) => set('end', e.target.value)}
                  />
                </label>
              </div>
            </div>

            {/* Preview */}
            <CadencePreview preview={preview} amountType={form.amountType} recurrence={recurrence} hasShifted={hasShifted} hasAnchor={!!form.anchor} />
          </div>

          {/* Amount fieldset */}
          <div className="vk-fieldset">
            <div className="legend">Amount</div>

            {/* Segmented radio */}
            <div className="vk-seg" style={{ marginBottom: 14 }}>
              {(
                [
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'estimate', label: 'Estimate' },
                  { value: 'percent', label: '% of Sales' },
                ] as { value: AmountType; label: string }[]
              ).map(({ value, label }) => (
                <label key={value} className={form.amountType === value ? 'on' : ''}>
                  <input
                    type="radio"
                    name="amtType"
                    value={value}
                    checked={form.amountType === value}
                    onChange={() => set('amountType', value)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <label className="vk-label">
              {amtLabel}
              <input
                className="vk-input-num"
                type="number"
                step="0.01"
                min="0"
                value={form.amountValue}
                onChange={(e) => set('amountValue', e.target.value)}
                placeholder={amtPlaceholder}
              />
            </label>
            <div className="vk-helper">{amtHelper}</div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 16 }}>
            <label className="vk-label">
              Notes (optional)
              <input
                className="vk-input"
                type="text"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Any notes…"
              />
            </label>
          </div>

          {/* Active (edit mode only) */}
          {mode === 'edit' && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
                style={{ accentColor: 'var(--brand)', width: 16, height: 16 }}
              />
              Active (uncheck to pause without deleting)
            </label>
          )}

          {/* Error */}
          {err && (
            <div
              style={{
                marginTop: 14,
                padding: '9px 13px',
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
                borderRadius: 'var(--r-sm)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="drawer-foot">
          <button className="vk-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="vk-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Add bill' : 'Save changes'}
          </button>
        </div>
      </div>
    </>
  );
}

// ====================================================================
// Dynamic schedule sub-fields
// ====================================================================
function ScheduleSubFields({
  form,
  set,
}: {
  form: DrawerForm;
  set: <K extends keyof DrawerForm>(key: K, value: DrawerForm[K]) => void;
}) {
  const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1);

  if (form.frequency === 'monthly') {
    return (
      <div>
        {/* Mode segmented radio */}
        <div className="vk-seg" style={{ marginBottom: 14 }}>
          {(
            [
              { value: 'day', label: 'Day of month' },
              { value: 'nth', label: 'Weekday position' },
              { value: 'last', label: 'Last day' },
            ] as { value: 'day' | 'nth' | 'last'; label: string }[]
          ).map(({ value, label }) => (
            <label key={value} className={form.monthlyMode === value ? 'on' : ''}>
              <input
                type="radio"
                name="mmode"
                value={value}
                checked={form.monthlyMode === value}
                onChange={() => set('monthlyMode', value)}
              />
              {label}
            </label>
          ))}
        </div>

        {form.monthlyMode === 'day' && (
          <div>
            <label className="vk-label">
              Day of month
              <select
                className="vk-select"
                value={form.monthlyDay}
                onChange={(e) => set('monthlyDay', Number(e.target.value))}
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <div className="vk-note">Days past month-end clamp to the last day.</div>
          </div>
        )}

        {form.monthlyMode === 'nth' && (
          <div className="vk-formgrid" style={{ marginBottom: 0 }}>
            <div>
              <label className="vk-label">
                Which
                <select
                  className="vk-select"
                  value={form.monthlyNth}
                  onChange={(e) => set('monthlyNth', Number(e.target.value))}
                >
                  <option value={1}>1st</option>
                  <option value={2}>2nd</option>
                  <option value={3}>3rd</option>
                  <option value={4}>4th</option>
                  <option value={-1}>Last</option>
                </select>
              </label>
            </div>
            <div>
              <label className="vk-label">
                Weekday
                <select
                  className="vk-select"
                  value={form.monthlyWeekday}
                  onChange={(e) => set('monthlyWeekday', Number(e.target.value))}
                >
                  {WDFULL.map((wd, i) => (
                    <option key={i} value={i}>
                      {wd}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {form.monthlyMode === 'last' && (
          <div className="vk-note">Fires on the last calendar day of each month.</div>
        )}
      </div>
    );
  }

  if (form.frequency === 'semimonthly') {
    return (
      <div className="vk-formgrid" style={{ marginBottom: 0 }}>
        <div>
          <label className="vk-label">
            First day
            <select
              className="vk-select"
              value={form.semiDay1}
              onChange={(e) => set('semiDay1', Number(e.target.value))}
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label className="vk-label">
            Second day
            <select
              className="vk-select"
              value={form.semiDay2}
              onChange={(e) => set('semiDay2', Number(e.target.value))}
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
  }

  if (form.frequency === 'weekly') {
    return (
      <label className="vk-label">
        Every
        <select
          className="vk-select"
          value={form.weeklyWeekday}
          onChange={(e) => set('weeklyWeekday', Number(e.target.value))}
        >
          {WDFULL.map((wd, i) => (
            <option key={i} value={i}>
              {wd}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (form.frequency === 'biweekly') {
    return <div className="vk-note">Every 14 days from the start date below.</div>;
  }

  if (form.frequency === 'quarterly') {
    return (
      <div>
        <label className="vk-label">
          On day
          <select
            className="vk-select"
            value={form.quarterlyDay}
            onChange={(e) => set('quarterlyDay', Number(e.target.value))}
          >
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <div className="vk-note">Every 3 months, phased from the start month.</div>
      </div>
    );
  }

  if (form.frequency === 'n_months') {
    return (
      <div className="vk-formgrid" style={{ marginBottom: 0 }}>
        <div>
          <label className="vk-label">
            Every N months
            <input
              className="vk-input-num"
              type="number"
              min="1"
              value={form.nMonths}
              onChange={(e) => set('nMonths', Math.max(1, Number(e.target.value)))}
            />
          </label>
        </div>
        <div>
          <label className="vk-label">
            On day
            <select
              className="vk-select"
              value={form.nMonthsDay}
              onChange={(e) => set('nMonthsDay', Number(e.target.value))}
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
  }

  if (form.frequency === 'n_days') {
    return (
      <label className="vk-label">
        Every N days
        <input
          className="vk-input-num"
          type="number"
          min="1"
          value={form.nDays}
          onChange={(e) => set('nDays', Math.max(1, Number(e.target.value)))}
        />
      </label>
    );
  }

  if (form.frequency === 'yearly') {
    return (
      <div className="vk-formgrid" style={{ marginBottom: 0 }}>
        <div>
          <label className="vk-label">
            Month
            <select
              className="vk-select"
              value={form.yearlyMonth}
              onChange={(e) => set('yearlyMonth', Number(e.target.value))}
            >
              {MON.map((m, i) => (
                <option key={i} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label className="vk-label">
            Day
            <select
              className="vk-select"
              value={form.yearlyDay}
              onChange={(e) => set('yearlyDay', Number(e.target.value))}
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
  }

  return null;
}

// ====================================================================
// Cadence preview pills
// ====================================================================
function CadencePreview({
  preview,
  amountType,
  recurrence,
  hasShifted,
  hasAnchor,
}: {
  preview: { due: Date; original: Date; shifted: boolean }[];
  amountType: AmountType;
  recurrence: RecurrenceRule;
  hasShifted: boolean;
  hasAnchor: boolean;
}) {
  const dotColor = TYPE_COLOR[amountType] ?? TYPE_COLOR.fixed;

  return (
    <div className="vk-preview">
      <div className="ttl">Next occurrences</div>
      {preview.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>
          {hasAnchor ? 'No upcoming occurrences in the next 2 years.' : 'Set a start date to preview dates.'}
        </div>
      ) : (
        <>
          <div className="cad-track">
            {preview.map((o, i) => {
              const dISO = iso(o.due);
              const origISO = iso(o.original);
              const isShifted = o.shifted;
              return (
                <div key={i} className={`cad-pill${isShifted ? ' sh' : ''}`}>
                  <div
                    className="d"
                    style={{
                      background: dotColor,
                      ...(isShifted
                        ? { outline: '2px solid var(--est)', outlineOffset: 1 }
                        : {}),
                    }}
                  />
                  <div className="lbl">
                    <b>{dayLabel(dISO)}</b>
                    {isShifted ? (
                      <span style={{ color: 'var(--est)', fontSize: 10 }}>shifted →</span>
                    ) : (
                      <span>{WD[o.due.getDay()]}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 10 }}>
            {scheduleLabel(recurrence)}
            {hasShifted && ' · amber = moved to next business day'}
          </div>
        </>
      )}
    </div>
  );
}
