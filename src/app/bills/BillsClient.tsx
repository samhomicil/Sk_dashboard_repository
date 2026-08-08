'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  dueDatesInRange, parseISO, iso, ymOf, scheduleLabel, type SalesData,
} from '@/lib/bills/billsEngine';
import { buildForecast, type MonthTotals } from '@/lib/bills/forecast';
import { money0, money2, ymLabel, dayLabel, pct } from '@/lib/bills/format';
import type { DashboardData } from '@/lib/bills/service';
import type { ReconciledOccurrence } from '@/lib/bills/reconcile';
import type { ClientBill } from './page';
import BillsOverview from './BillsOverview';

// ---- semantic palettes (static literals so Tailwind keeps them) ----
const STATUS: Record<string, { label: string; dot: string; chip: string; bar: string }> = {
  missed: { label: 'Missed', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-1 ring-red-600/20', bar: 'bg-red-500' },
  overdue: { label: 'Overdue', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20', bar: 'bg-amber-500' },
  due: { label: 'Due', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/20', bar: 'bg-sky-500' },
  upcoming: { label: 'Upcoming', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-1 ring-slate-500/20', bar: 'bg-slate-300' },
  paid: { label: 'Paid', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20', bar: 'bg-emerald-500' },
};
const TYPE: Record<string, { label: string; seg: string; text: string; dot: string }> = {
  fixed: { label: 'Fixed', seg: 'bg-emerald-500', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  estimate: { label: 'Estimate', seg: 'bg-amber-500', text: 'text-amber-700', dot: 'bg-amber-500' },
  percent: { label: '% of Sales', seg: 'bg-indigo-500', text: 'text-indigo-700', dot: 'bg-indigo-500' },
};
const STORES = ['All', 'Margate', 'Miramar', 'Pines'] as const;
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'sales', label: 'Sales' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type DayItem = {
  bill: ClientBill;
  due: string;
  original: string;
  shifted: boolean;
  status?: string;
  expected: number | null;
};

export default function BillsClient({
  dash, bills, allBills, sales, lastSyncedAt,
}: {
  dash: DashboardData;
  bills: ClientBill[];
  allBills: ClientBill[];
  sales: SalesData;
  lastSyncedAt: string | null;
}) {
  const [tab, setTab] = useState<TabId>('overview');
  const [store, setStore] = useState<(typeof STORES)[number]>('All');
  const [storeBalances, setStoreBalances] = useState<Record<string, { checking: number; savings: number }>>({});
  const now = parseISO(dash.now);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Cash-on-hand for the Coverage panel. Same live source Cash Flow reads
  // (sk_bills.QbBalance via OpenBudget) — this used to hit QuickBooks directly
  // (/api/qb/stores), which silently falls back to QBO's lagging book balance,
  // so Bills and Cash Flow could disagree on cash on hand for the same store
  // with no indication why. One balance endpoint now, used everywhere.
  useEffect(() => {
    fetch('/api/balances', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Array<{ store: string; checking: number; savings: number }>) => {
        const m: Record<string, { checking: number; savings: number }> = {};
        for (const s of data ?? []) m[s.store.toLowerCase()] = { checking: s.checking, savings: s.savings };
        setStoreBalances(m);
      })
      .catch(() => null);
  }, []);

  // Sidebar sub-items navigate via ?tab= — sync it into local tab state.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && TABS.some((x) => x.id === t)) setTab(t as TabId);
  }, [searchParams]);

  // Sidebar "Refresh data" re-runs the server component (bills are server-fetched).
  useEffect(() => {
    const onRefresh = () => {
      router.refresh();
      window.dispatchEvent(new CustomEvent('sk:synced', { detail: { source: 'qb', at: new Date().toISOString() } }));
    };
    window.addEventListener('sk:refresh', onRefresh);
    return () => window.removeEventListener('sk:refresh', onRefresh);
  }, [router]);

  const occ = useMemo(
    () => (store === 'All' ? dash.occurrences : dash.occurrences.filter((o) => o.store === store)),
    [dash.occurrences, store],
  );
  const scopedBills = useMemo(
    () => (store === 'All' ? bills : bills.filter((b) => b.store === store)),
    [bills, store],
  );

  return (
    <div className="min-h-screen">
      {/* Main */}
      <main className="pb-safe-mobile">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur sm:px-7">
          <h1 className="text-base font-semibold capitalize text-ink">Bills — {TABS.find((t) => t.id === tab)?.label}</h1>
          {/* Tab switcher (relocated from the old sidebar) */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  tab === t.id ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {STORES.map((s) => (
              <button
                key={s}
                onClick={() => setStore(s)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  store === s ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-ink'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <RefreshButton lastSyncedAt={lastSyncedAt} />
        </header>

        {(dash.mode.data === 'seed' || dash.mode.actual === 'mock') && <SetupBanner mode={dash.mode} />}

        <div className="px-5 py-5 sm:px-7">
          {tab === 'overview' && (
            <BillsOverview
              occ={occ}
              bills={scopedBills}
              visibleStores={store === 'All' ? ['margate', 'miramar', 'pines'] : [store.toLowerCase()]}
              storeBalances={storeBalances}
              suggestions={dash.suggestions}
              now={now}
              onChanged={() => router.refresh()}
            />
          )}
          {tab === 'calendar' && <CalendarView occ={occ} bills={scopedBills} sales={sales} now={now} />}
          {tab === 'forecast' && <ForecastView bills={scopedBills} sales={sales} store={store} now={now} />}
          {tab === 'sales' && <SalesView sales={sales} store={store} now={now} />}
        </div>
      </main>
    </div>
  );
}

function RefreshButton({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState<string>('');

  // Format client-side to avoid server/client hydration mismatch.
  useEffect(() => {
    if (!lastSyncedAt) return;
    const d = new Date(lastSyncedAt);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 2) setLabel('just now');
    else if (diffMin < 60) setLabel(`${diffMin}m ago`);
    else if (diffH < 24) setLabel(`${diffH}h ago`);
    else setLabel(`${diffD}d ago`);
  }, [lastSyncedAt]);

  return (
    <div className="flex items-center gap-2">
      {label && !isPending && (
        <span className="text-[11px] text-slate-400 hidden sm:block">synced {label}</span>
      )}
      <button
        onClick={() => startTransition(() => { router.refresh(); })}
        disabled={isPending}
        title="Re-fetch latest data from the database"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
      >
        <svg
          className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M14 8A6 6 0 1 1 9 2.1" strokeLinecap="round"/>
          <path d="M9 1v3.5H12.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {isPending ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}

function SetupBanner({ mode }: { mode: DashboardData['mode'] }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[13px] text-amber-800 sm:px-7">
      Running in setup mode.{' '}
      {mode.data === 'seed' && <>Bills load from the seed file and sales are not saved permanently. Connect the database to persist edits. </>}
      {mode.actual === 'mock' && <>Transactions are simulated until QuickBooks is connected.</>}{' '}
      <a href="/settings" className="font-medium underline">See setup</a>
    </div>
  );
}

/* ---------------- Overview ---------------- */
const ALL_STORES = ['Margate', 'Miramar', 'Pines'] as const;
const CAT_COLORS = [
  'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-400', 'bg-indigo-400',
];

function OverviewView({
  occ, bills, sales, store, now,
}: {
  occ: ReconciledOccurrence[];
  bills: ClientBill[];
  sales: SalesData;
  store: string;
  now: Date;
}) {
  const todayISO = iso(now);
  const currentYM = ymOf(now);
  const next30ISO = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));
  const next7ISO  = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

  // billId → category lookup
  const catMap = useMemo(() => {
    const m = new Map<string, string>();
    bills.forEach((b) => m.set(b.id, b.category));
    return m;
  }, [bills]);

  // ---- KPI calculations ----
  const atRiskOcc  = occ.filter((o) => o.status === 'missed' || o.status === 'overdue');
  const atRiskAmt  = atRiskOcc.reduce((s, o) => s + (o.expected ?? 0), 0);

  const dueNowOcc  = occ.filter((o) => o.status === 'due');
  const dueNowAmt  = dueNowOcc.reduce((s, o) => s + (o.expected ?? 0), 0);

  // This-month window
  const thisMonthOcc      = occ.filter((o) => o.due.startsWith(currentYM));
  const thisMonthExpenses = thisMonthOcc.reduce((s, o) => s + (o.expected ?? 0), 0);
  const thisMonthPaid     = thisMonthOcc
    .filter((o) => o.status === 'paid').reduce((s, o) => s + (o.expected ?? 0), 0);

  // Next 30 days (unpaid)
  const pipeline = occ
    .filter((o) => o.due > todayISO && o.due <= next30ISO && o.status !== 'paid')
    .sort((a, b) => a.due.localeCompare(b.due));
  const pipelineAmt = pipeline.reduce((s, o) => s + (o.expected ?? 0), 0);

  // ---- Sales this month ----
  const storeScope = store === 'All' ? [...ALL_STORES] : [store];
  const salesRows = storeScope.map((s) => {
    const d = sales[s]?.[currentYM];
    const val = d?.actual ?? d?.projected ?? null;
    return { store: s, val, basis: d?.actual != null ? 'actual' : d?.projected != null ? 'projected' : null };
  });
  const totalSales     = salesRows.reduce((s, r) => s + (r.val ?? 0), 0);
  const expenseRatio   = totalSales > 0 ? thisMonthExpenses / totalSales : null;
  const hasSales       = salesRows.some((r) => r.val != null);

  // ---- Category breakdown (this month) ----
  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    thisMonthOcc.forEach((o) => {
      const cat = catMap.get(o.billId) ?? 'Other';
      map[cat] = (map[cat] ?? 0) + (o.expected ?? 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [thisMonthOcc, catMap]);
  const catMax = byCategory[0]?.[1] ?? 1;

  // ---- Per-store expenses this month ----
  const byStore = ALL_STORES.map((s) => ({
    store: s,
    amount: thisMonthOcc.filter((o) => o.store === s).reduce((sum, o) => sum + (o.expected ?? 0), 0),
    salesVal: sales[s]?.[currentYM]?.actual ?? sales[s]?.[currentYM]?.projected ?? null,
  }));

  // ---- Attention items ----
  const attention = occ
    .filter((o) => o.status === 'missed' || o.status === 'overdue' || o.status === 'due')
    .sort((a, b) =>
      ({ missed: 0, overdue: 1, due: 2 } as Record<string, number>)[a.status] -
      ({ missed: 0, overdue: 1, due: 2 } as Record<string, number>)[b.status] ||
      a.due.localeCompare(b.due),
    );

  return (
    <div className="space-y-5">

      {/* ---- KPI cards ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

        {/* At risk */}
        <div className={`rounded-xl border p-4 ${atRiskAmt > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${atRiskAmt > 0 ? 'bg-red-500' : 'bg-slate-300'}`} />
            At risk
          </div>
          <div className={`tnum mt-1.5 text-2xl font-bold ${atRiskAmt > 0 ? 'text-red-700' : 'text-slate-400'}`}>
            {money0(atRiskAmt)}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {atRiskOcc.length} missed / overdue
          </div>
        </div>

        {/* Due now */}
        <div className={`rounded-xl border p-4 ${dueNowAmt > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${dueNowAmt > 0 ? 'bg-amber-400' : 'bg-slate-300'}`} />
            Due now
          </div>
          <div className={`tnum mt-1.5 text-2xl font-bold ${dueNowAmt > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
            {money0(dueNowAmt)}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {dueNowOcc.length} bill{dueNowOcc.length !== 1 ? 's' : ''} due ≤ 3 days
          </div>
        </div>

        {/* This month */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            {ymLabel(currentYM)}
          </div>
          <div className="tnum mt-1.5 text-2xl font-bold text-ink">{money0(thisMonthExpenses)}</div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {money0(thisMonthPaid)} paid · {thisMonthOcc.length} bills
          </div>
        </div>

        {/* Next 30 days */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Next 30 days
          </div>
          <div className="tnum mt-1.5 text-2xl font-bold text-ink">{money0(pipelineAmt)}</div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {pipeline.length} bill{pipeline.length !== 1 ? 's' : ''} coming up
          </div>
        </div>
      </div>

      {/* ---- Middle row ---- */}
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">

        {/* Attention + 7-day list */}
        <div className="space-y-5">

          {/* Needs attention */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-semibold text-ink">Needs attention</div>
              {atRiskAmt > 0 && (
                <div className="tnum text-[12px] font-semibold text-red-600">{money0(atRiskAmt)} exposure</div>
              )}
            </div>
            {attention.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-slate-400">
                ✓ Nothing needs action right now.
              </div>
            ) : (
              attention.map((o) => <AttRow key={o.billId + o.due} o={o} />)
            )}
          </div>

          {/* Next 7 days */}
          {pipeline.filter((o) => o.due <= next7ISO).length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-semibold text-ink">Next 7 days</div>
              </div>
              {pipeline
                .filter((o) => o.due <= next7ISO)
                .map((o) => <AttRow key={o.billId + o.due} o={o} />)}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">

          {/* Sales vs expenses */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-ink">{ymLabel(currentYM)} · Revenue vs Expenses</div>
            {!hasSales ? (
              <div className="text-[13px] text-slate-400">
                No sales entered yet.{' '}
                <span className="text-emerald-600 underline cursor-pointer">Add in Sales tab.</span>
              </div>
            ) : (
              <div className="space-y-3">
                <SalesBar label="Revenue" value={totalSales} max={Math.max(totalSales, thisMonthExpenses, 1)} color="bg-emerald-500" basis={salesRows.find(r => r.basis)?.basis ?? null} />
                <SalesBar label="Expenses" value={thisMonthExpenses} max={Math.max(totalSales, thisMonthExpenses, 1)} color="bg-red-400" basis={null} />
                {expenseRatio != null && (
                  <div className={`tnum mt-2 rounded-lg px-3 py-2 text-center text-sm font-semibold ${expenseRatio > 0.9 ? 'bg-red-50 text-red-700' : expenseRatio > 0.6 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {pct(expenseRatio, 0)} of revenue
                  </div>
                )}
              </div>
            )}

            {/* Per-store breakdown when viewing All */}
            {store === 'All' && hasSales && (
              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                {byStore.map(({ store: s, amount, salesVal }) => (
                  <div key={s} className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-slate-600">{s}</span>
                    <span className="tnum text-slate-500">
                      {money0(amount)} exp
                      {salesVal != null && <> · {money0(salesVal)} rev</>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Category breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-ink">By category · {ymLabel(currentYM)}</div>
            {byCategory.length === 0 ? (
              <div className="text-[13px] text-slate-400">No data.</div>
            ) : (
              <div className="space-y-2.5">
                {byCategory.map(([cat, amt], i) => (
                  <div key={cat}>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-sm ${CAT_COLORS[i % CAT_COLORS.length]}`} />
                        <span className="text-[12px] font-medium text-slate-700">{cat}</span>
                      </div>
                      <span className="tnum text-[12px] text-slate-500">{money0(amt)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${CAT_COLORS[i % CAT_COLORS.length]}`}
                        style={{ width: `${Math.round((amt / catMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- 30-day pipeline ---- */}
      {pipeline.filter((o) => o.due > next7ISO).length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-ink">Coming up · 8–30 days</div>
          </div>
          <div className="divide-y divide-slate-100">
            {pipeline
              .filter((o) => o.due > next7ISO)
              .slice(0, 25)
              .map((o) => <AttRow key={o.billId + o.due} o={o} dim />)}
          </div>
        </div>
      )}
    </div>
  );
}

function SalesBar({ label, value, max, color, basis }: {
  label: string; value: number; max: number; color: string; basis: string | null;
}) {
  const pctW = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="font-medium text-slate-600">
          {label}
          {basis && <span className="ml-1 text-slate-400">({basis})</span>}
        </span>
        <span className="tnum font-semibold text-ink">{money0(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pctW}%` }} />
      </div>
    </div>
  );
}

function AttRow({ o, dim }: { o: ReconciledOccurrence; dim?: boolean }) {
  const s = STATUS[o.status];
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${dim ? 'opacity-70' : ''}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{o.vendor}</div>
        <div className="text-[11px] text-slate-500">
          {o.store} · {o.payment === 'auto' ? 'Auto' : 'Manual'}
          {o.shifted && <span className="text-slate-400"> · ↳ {dayLabel(o.original)}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tnum text-[13px] font-semibold text-ink">
          {o.expected == null ? <span className="text-indigo-400 text-[11px]">needs sales</span> : money2(o.expected)}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <span className="text-[11px] text-slate-400">{dayLabel(o.due)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.chip}`}>{s.label}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Calendar ---------------- */
function CalendarView({
  occ, bills, sales, now,
}: {
  occ: ReconciledOccurrence[];
  bills: ClientBill[];
  sales: SalesData;
  now: Date;
}) {
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = view.getFullYear();
  const m = view.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();

  // Status by billId+due, from the reconciled window when available.
  const statusByKey = useMemo(() => {
    const map = new Map<string, ReconciledOccurrence>();
    occ.forEach((o) => map.set(o.billId + o.due, o));
    return map;
  }, [occ]);

  // All scheduled occurrences this month (engine), so months beyond the reconcile
  // window still show what's due (without a live status).
  const byDay = useMemo(() => {
    const ws = iso(new Date(y, m, 1));
    const we = iso(new Date(y, m, days));
    const out: Record<string, DayItem[]> = {};
    for (const b of bills) {
      if (b.active === false) continue;
      const occs = dueDatesInRange(b.recurrence, b.anchor || null, b.end || null, ws, we);
      for (const o of occs) {
        const dueISO = iso(o.due);
        const rec = statusByKey.get(b.id + dueISO);
        (out[dueISO] ||= []).push({
          bill: b, due: dueISO, original: iso(o.original), shifted: o.shifted,
          status: rec?.status,
          expected: rec ? rec.expected : amountFor(b, sales, ymOf(o.due)),
        });
      }
    }
    return out;
  }, [bills, sales, y, m, days, statusByKey]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const todayISO = iso(now);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink">{ymLabel(ymOf(view))}</div>
          <div className="flex gap-1">
            <CalBtn onClick={() => { setOffset(offset - 1); setSel(null); }}>‹</CalBtn>
            <CalBtn onClick={() => { setOffset(0); setSel(null); }}>Today</CalBtn>
            <CalBtn onClick={() => { setOffset(offset + 1); setSel(null); }}>›</CalBtn>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d == null) return <div key={i} />;
            const dISO = iso(new Date(y, m, d));
            const items = byDay[dISO] || [];
            const isToday = dISO === todayISO;
            return (
              <button
                key={i}
                onClick={() => setSel(items.length ? dISO : null)}
                className={`min-h-[64px] rounded-lg border p-1.5 text-left transition-colors ${
                  sel === dISO ? 'border-ink' : 'border-slate-100 hover:border-slate-300'
                } ${isToday ? 'bg-slate-50' : 'bg-white'}`}
              >
                <div className={`text-[11px] ${isToday ? 'font-bold text-ink' : 'text-slate-400'}`}>{d}</div>
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {items.slice(0, 6).map((it: DayItem, k: number) => (
                    <span key={k} className={`h-1.5 w-1.5 rounded-full ${it.status ? STATUS[it.status].dot : 'bg-slate-300'}`} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        <Legend />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-ink">{sel ? dayLabel(sel) : 'Pick a day'}</div>
        {sel ? (
          <div className="space-y-2">
            {(byDay[sel] || []).map((it: DayItem, k: number) => (
              <div key={k} className="flex items-start gap-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${it.status ? STATUS[it.status].dot : 'bg-slate-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{it.bill.vendor}</div>
                  <div className="text-[11px] text-slate-500">
                    {it.bill.store} · {scheduleLabel(it.bill.recurrence)}
                    {it.shifted && <span className="text-slate-400"> · ↳ from {dayLabel(it.original)}</span>}
                  </div>
                </div>
                <div className="tnum text-[13px] font-medium text-ink">
                  {it.expected == null ? <span className="text-indigo-500 text-[11px]">needs sales</span> : money2(it.expected)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Tap a day with a dot to see what's due.</Empty>
        )}
      </div>
    </div>
  );
}

function CalBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
      {children}
    </button>
  );
}
function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {(['paid', 'due', 'overdue', 'missed', 'upcoming'] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS[s].dot}`} /> {STATUS[s].label}
        </span>
      ))}
    </div>
  );
}

/* ---------------- Forecast ---------------- */
function ForecastView({ bills, sales, store, now }: { bills: ClientBill[]; sales: SalesData; store: string; now: Date }) {
  const fc = useMemo(() => buildForecast(bills as any, sales, store, now, 12), [bills, sales, store, now]);
  const max = Math.max(1, ...fc.rows.map((r: MonthTotals) => r.total));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-6 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">12-month outflow</div>
          <div className="tnum text-3xl font-semibold text-ink">{money0(fc.grandTotal)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Avg / month</div>
          <div className="tnum text-2xl font-medium text-ink">{money0(fc.grandTotal / 12)}</div>
        </div>
        <div className="ml-auto flex gap-4 text-[12px]">
          {(['fixed', 'estimate', 'percent'] as const).map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-sm ${TYPE[t].dot}`} /> {TYPE[t].label}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-end gap-2" style={{ height: 180 }}>
          {fc.rows.map((r: MonthTotals) => (
            <div key={r.ym} className="group flex flex-1 flex-col items-center justify-end gap-1">
              <div className="relative flex w-full max-w-[34px] flex-col justify-end" style={{ height: 150 }}>
                {(['percent', 'estimate', 'fixed'] as const).map((t) => {
                  const v = r[t];
                  if (v <= 0) return null;
                  return <div key={t} className={`${TYPE[t].seg} w-full`} style={{ height: `${(v / max) * 150}px` }} title={`${TYPE[t].label}: ${money0(v)}`} />;
                })}
              </div>
              <div className="text-[10px] text-slate-400">{ymLabel(r.ym).split(' ')[0]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 text-right font-medium">Fixed</th>
              <th className="px-4 py-2 text-right font-medium">Estimate</th>
              <th className="px-4 py-2 text-right font-medium">% of Sales</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {fc.rows.map((r: MonthTotals) => (
              <tr key={r.ym} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 text-ink">{ymLabel(r.ym)}</td>
                <td className="tnum px-4 py-2 text-right text-slate-600">{money0(r.fixed)}</td>
                <td className="tnum px-4 py-2 text-right text-slate-600">{r.estimate ? money0(r.estimate) : '—'}</td>
                <td className="tnum px-4 py-2 text-right text-slate-600">
                  {r.percent ? money0(r.percent) : r.needsSales ? <span className="text-indigo-500">needs sales</span> : '—'}
                </td>
                <td className="tnum px-4 py-2 text-right font-medium text-ink">{money0(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Sales ---------------- */
function SalesView({ sales, store, now }: { sales: SalesData; store: string; now: Date }) {
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ymOf(new Date(now.getFullYear(), now.getMonth() + i, 1))),
    [now],
  );

  if (store === 'All') {
    return <Empty>Sales are tracked per store. Pick Margate, Miramar, or Pines to see the monthly net sales that drive the % -of-sales bills.</Empty>;
  }

  const money = (v: number | null | undefined) => (v == null ? '—' : `$${Math.round(Number(v)).toLocaleString()}`);

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-500">
        Auto-derived from POS. Completed months show realized net sales (actual); the current and
        upcoming months are projected with the shared sales forecast — the same figures Budget and
        Weekly Ops use. % -of-sales bills resolve against these, month by month.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Projected</th>
              <th className="px-4 py-2 font-medium">Actual</th>
              <th className="px-4 py-2 text-right font-medium">Basis</th>
            </tr>
          </thead>
          <tbody>
            {months.map((ym: string) => {
              const r = sales?.[store]?.[ym] || {};
              const basis = r.actual != null ? 'actual' : r.projected != null ? 'projected' : null;
              return (
                <tr key={ym} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 text-ink">{ymLabel(ym)}</td>
                  <td className="px-4 py-2 text-slate-600">{money(r.projected)}</td>
                  <td className="px-4 py-2 text-slate-600">{money(r.actual)}</td>
                  <td className="px-4 py-2 text-right text-[12px] text-slate-400">{basis ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <span className="text-[12px] text-slate-400">{hint}</span>}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-[13px] text-slate-400">{children}</div>;
}

// Client-side amount resolver for calendar months outside the reconcile window.
function amountFor(b: ClientBill, sales: SalesData, ym: string): number | null {
  if (b.amountType === 'fixed' || b.amountType === 'estimate') return +b.amountValue || 0;
  const s = sales?.[b.store]?.[ym];
  const v = s?.actual ?? s?.projected;
  return v != null ? (+b.amountValue / 100) * +v : null;
}
