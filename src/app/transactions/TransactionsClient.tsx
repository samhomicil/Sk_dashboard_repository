'use client';

import { useState, useEffect, useCallback } from 'react';

const STORE_COLORS: Record<string, string> = { margate: '#3B82F6', miramar: '#F59E0B', pines: '#10B981' };
const NAME: Record<string, string> = { margate: 'Margate', miramar: 'Miramar', pines: 'Pines' };
const STORES = ['All', 'Margate', 'Miramar', 'Pines'] as const;
type StoreFilter = (typeof STORES)[number];

const PERIODS = [
  { key: 'mtd',  label: 'Month to date', days: 0 },
  { key: '30d',  label: 'Last 30 days',  days: 30 },
  { key: '60d',  label: 'Last 60 days',  days: 60 },
  { key: '90d',  label: 'Last 3 months', days: 90 },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

const ACCT_TYPES = ['All accounts', 'Checking', 'Savings', 'Credit Card'] as const;
type AcctType = (typeof ACCT_TYPES)[number];

interface Txn {
  id: string; date: string; amount: number; payee: string;
  store?: string; accountLabel?: string; taxonomy?: string;
  notes?: string; isTransfer?: boolean; cleared?: boolean;
}

function periodDates(key: PeriodKey): { start: string; end: string } {
  const n = new Date();
  const today = n.toISOString().slice(0, 10);
  if (key === 'mtd') {
    const y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, '0');
    return { start: `${y}-${m}-01`, end: today };
  }
  const days = PERIODS.find(p => p.key === key)!.days;
  const from = new Date(Date.now() - days * 864e5);
  return { start: from.toISOString().slice(0, 10), end: today };
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(+y, +m - 1, +day));
}

const $f = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Derive account type + last-4 from the account name (§3.5 sanctioned name classifier).
function acctType(label: string): AcctType | 'Account' {
  const s = label.toLowerCase();
  if (/credit\s*card|creditcard|\bamex\b|\bvisa\b|mastercard|\bcc\b/.test(s)) return 'Credit Card';
  if (/sav/.test(s)) return 'Savings';
  if (/check|chk/.test(s)) return 'Checking';
  return 'Account';
}
function acctLast4(label: string): string {
  const matches = label.match(/\d{4}/g);
  return matches ? matches[matches.length - 1] : '';
}

const PAGE = 40;

export default function TransactionsClient() {
  const [store, setStore]     = useState<StoreFilter>('All');
  const [period, setPeriod]   = useState<PeriodKey>('30d');
  const [txns, setTxns]       = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [hideTransfers, setHideTransfers] = useState(true);
  const [search, setSearch]   = useState('');
  const [acctFilter, setAcctFilter] = useState<AcctType>('All accounts');
  const [visible, setVisible] = useState(PAGE);

  const load = useCallback(async () => {
    setLoading(true); setOffline(false);
    const { start, end } = periodDates(period);
    const sq = store !== 'All' ? `&store=${store.toLowerCase()}` : '';
    try {
      const r = await fetch(
        `/api/qb/transactions?start=${start}&end=${end}&limit=1000${sq}`,
        { cache: 'no-store' },
      );
      if (!r.ok) throw new Error(`${r.status}`);
      setTxns(await r.json());
    } catch { setOffline(true); }
    setLoading(false);
    window.dispatchEvent(new CustomEvent('sk:synced', { detail: { source: 'qb', at: new Date().toISOString() } }));
  }, [store, period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setVisible(PAGE); }, [store, period, search, acctFilter, hideTransfers]);

  useEffect(() => {
    const onRefresh = () => { load(); };
    window.addEventListener('sk:refresh', onRefresh);
    return () => window.removeEventListener('sk:refresh', onRefresh);
  }, [load]);

  const filtered = txns.filter(t => {
    if (hideTransfers && t.isTransfer) return false;
    if (acctFilter !== 'All accounts' && acctType(t.accountLabel ?? '') !== acctFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.payee?.toLowerCase().includes(q) && !t.accountLabel?.toLowerCase().includes(q) && !t.taxonomy?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const income   = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net      = income - expenses;
  const rows = filtered.slice(0, visible);

  return (
    <main className="pb-safe-mobile">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur sm:px-7">
        <h1 className="text-[22px] font-bold text-slate-900">Transactions</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Store pills */}
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {STORES.map(s => {
              const on = store === s;
              return (
                <button key={s} onClick={() => setStore(s)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
                  style={on ? { background: s === 'All' ? '#0F172A' : STORE_COLORS[s.toLowerCase()], color: '#fff' } : { color: '#64748B' }}>
                  {s}
                </button>
              );
            })}
          </div>
          {/* Period */}
          <select value={period} onChange={e => setPeriod(e.target.value as PeriodKey)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none">
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {/* Search */}
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search payee…"
              className="w-40 rounded-lg border border-slate-200 py-1.5 pl-7 pr-2.5 text-xs outline-none focus:border-violet-400" />
          </div>
          {/* Account type */}
          <select value={acctFilter} onChange={e => setAcctFilter(e.target.value as AcctType)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none">
            {ACCT_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {/* Hide transfers */}
          <button onClick={() => setHideTransfers(v => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span className={`relative h-[17px] w-[30px] rounded-full transition-colors ${hideTransfers ? 'bg-violet-600' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-[13px] w-[13px] rounded-full bg-white shadow transition-transform ${hideTransfers ? 'translate-x-[15px]' : 'translate-x-0.5'}`} />
            </span>
            Hide transfers
          </button>
        </div>
      </header>

      <div className="px-5 py-6 sm:px-7">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {offline ? (
            <div className="px-6 py-8 text-center text-sm text-red-600">
              Could not load transactions — QuickBooks may be unavailable.{' '}
              <button onClick={load} className="font-medium underline">Retry</button>
            </div>
          ) : (
            <>
              {/* Summary strip */}
              <div className="grid grid-cols-4 border-b border-slate-100 bg-slate-50">
                {[
                  { l: 'Transactions', v: loading ? '—' : String(filtered.length), c: '#0F172A' },
                  { l: 'Money in', v: loading ? '—' : '+' + $f(income), c: '#059669' },
                  { l: 'Money out', v: loading ? '—' : '−' + $f(expenses), c: '#DC2626' },
                  { l: 'Net', v: loading ? '—' : (net >= 0 ? '+' : '−') + $f(net), c: net >= 0 ? '#059669' : '#DC2626' },
                ].map((s, i) => (
                  <div key={s.l} className={`px-5 py-3 ${i > 0 ? 'border-l border-slate-100' : ''}`}>
                    <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.05em] text-slate-400">{s.l}</div>
                    <div className="font-mono text-[15px] font-bold tabular-nums" style={{ color: s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 680 }}>
                  <thead>
                    <tr className="text-[9px] font-bold uppercase tracking-[0.05em] text-slate-400">
                      <th className="border-b border-slate-200 px-[18px] py-2.5 text-left">Date</th>
                      <th className="border-b border-slate-200 px-[18px] py-2.5 text-left">Payee</th>
                      <th className="border-b border-slate-200 px-[18px] py-2.5 text-left">Store</th>
                      <th className="border-b border-slate-200 px-[18px] py-2.5 text-left">Account</th>
                      <th className="border-b border-slate-200 px-[18px] py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="text-[12px]">
                    {loading ? (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No transactions found</td></tr>
                    ) : rows.map(t => {
                      const pos = t.amount >= 0;
                      const sk = (t.store ?? '').toLowerCase();
                      const label = t.accountLabel ?? '';
                      const type = acctType(label);
                      const l4 = acctLast4(label);
                      return (
                        <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="whitespace-nowrap px-[18px] py-2.5 tabular-nums text-slate-400">{fmtDate(t.date)}</td>
                          <td className="px-[18px] py-2.5">
                            <span className="font-semibold text-slate-700">{t.payee || '—'}</span>
                            {t.isTransfer && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[0.03em] text-slate-500">Transfer</span>}
                          </td>
                          <td className="px-[18px] py-2.5">
                            {sk ? (
                              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-600">
                                <span className="h-[7px] w-[7px] rounded-full" style={{ background: STORE_COLORS[sk] }} />{NAME[sk] ?? t.store}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-[18px] py-2.5 text-[11.5px] text-slate-400">
                            <span className="font-semibold text-slate-600">{type}</span>{l4 ? ` ···${l4}` : ''}
                          </td>
                          <td className={`whitespace-nowrap px-[18px] py-2.5 text-right font-mono font-bold tabular-nums ${pos ? 'text-emerald-600' : 'text-slate-700'}`}>
                            {pos ? '+' : '−'}{$f(t.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Load more */}
              {!loading && filtered.length > visible && (
                <div className="p-3.5 text-center">
                  <button onClick={() => setVisible(v => v + PAGE)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    Load more ({filtered.length - visible} more)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
