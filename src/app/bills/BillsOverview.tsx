'use client';

import { Fragment, useMemo, useState } from 'react';
import { iso } from '@/lib/bills/billsEngine';
import type { ReconciledOccurrence } from '@/lib/bills/reconcile';
import type { Suggestion } from '@/lib/bills/suggestMatch';
import type { ClientBill } from './page';

const STORE_COLORS: Record<string, string> = { margate: '#3B82F6', miramar: '#F59E0B', pines: '#10B981' };
const NAME: Record<string, string> = { margate: 'Margate', miramar: 'Miramar', pines: 'Pines' };
const key = (s: string) => s.toLowerCase();

const $f = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dow = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' });

type StoreBalances = Record<string, { checking: number; savings: number }>;

// A merged row (see billGroups.ts) reads as the most urgent of its members —
// one overdue + one due shows overdue — and "paid" only once every member is.
const STATUS_URGENCY: ReconciledOccurrence['status'][] = ['overdue', 'missed', 'due', 'upcoming'];
function worstStatus(statuses: ReconciledOccurrence['status'][]): ReconciledOccurrence['status'] {
  if (statuses.every((s) => s === 'paid')) return 'paid';
  return STATUS_URGENCY.find((s) => statuses.includes(s)) ?? statuses[0];
}

export default function BillsOverview({
  occ, bills, visibleStores, storeBalances, suggestions, billGroups, now, onChanged,
}: {
  occ: ReconciledOccurrence[];
  bills: ClientBill[];
  visibleStores: string[]; // lowercase keys
  storeBalances: StoreBalances;
  suggestions: Record<string, Suggestion>;
  /** billId -> full group (incl. itself) it's structurally paid together
   *  with — see billGroups.ts. Drives the Bills table's row merging. */
  billGroups: Record<string, string[]>;
  now: Date;
  onChanged: () => void;
}) {
  const [horizon, setHorizon] = useState<7 | 14 | 30>(14);
  const [statusTab, setStatusTab] = useState<'open' | 'paid' | 'all'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; o: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const todayMid = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);
  const catOf = useMemo(() => { const m = new Map<string, string>(); bills.forEach(b => m.set(b.id, b.category)); return m; }, [bills]);

  // Attach an offset (days from today) to each occurrence.
  const items = useMemo(() => occ.map(o => {
    const [y, m, d] = o.due.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    const offset = Math.round((due.getTime() - todayMid.getTime()) / 864e5);
    return { o, due, offset, amt: o.expected ?? 0, unpaid: o.status !== 'paid', cat: catOf.get(o.billId) ?? 'Other' };
  }), [occ, todayMid, catOf]);

  const unpaid = items.filter(i => i.unpaid);

  // ── KPIs (unpaid only) ──
  const week = unpaid.filter(i => i.offset >= 0 && i.offset <= 6);
  const m30  = unpaid.filter(i => i.offset >= 0 && i.offset <= 30);
  const act  = unpaid.filter(i => i.o.payment === 'manual' && i.offset <= 30 && i.offset >= -30);
  const over = unpaid.filter(i => i.o.status === 'overdue' || i.o.status === 'missed');
  const sum = (a: typeof unpaid) => a.reduce((s, i) => s + i.amt, 0);

  // Mark one or several occurrences paid/unpaid together — a merged row's
  // members are structurally one payment (see billGroups.ts), so confirming
  // or undoing any one of them applies to all of them at once.
  async function markPaid(members: ReconciledOccurrence[], paid: boolean) {
    if (!members.length) return;
    setBusy(members[0].billId + members[0].due);
    try {
      await Promise.all(members.map((m) =>
        fetch('/api/payments', {
          method: paid ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billId: m.billId, dueDate: m.due }),
        }),
      ));
      onChanged();
    } finally { setBusy(null); }
  }

  function toggleExpand(rowKey: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(rowKey)) n.delete(rowKey); else n.add(rowKey);
      return n;
    });
  }

  // ── Timeline geometry ──
  const timeline = useMemo(() => buildTimeline(unpaid, horizon, todayMid), [unpaid, horizon, todayMid]);

  function onTimelineMove(e: React.MouseEvent) {
    const svg = (e.currentTarget as HTMLElement).querySelector('svg');
    if (!svg || !timeline) return;
    const rect = svg.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * 1000;
    const o = timeline.offsetAtX(svgX);
    setTip(o == null ? null : { x: e.clientX, y: e.clientY, o });
  }

  // ── Coverage ──
  const coverage = visibleStores.map(k => {
    const bal = storeBalances[k];
    const cash = bal ? bal.checking + bal.savings : null;
    const wk = unpaid.filter(i => key(i.o.store) === k && i.offset >= 0 && i.offset <= 6).reduce((s, i) => s + i.amt, 0);
    const after = cash == null ? null : cash - wk;
    const ok = after == null ? null : after > 1000;
    return { k, cash, wk, after, ok };
  });

  // ── Bills table (merges structurally-linked bills into one row) ──
  // The underlying Bill records and occurrences stay distinct — this only
  // changes what one table row represents.

  const mergedItems = useMemo(() => {
    const byKey = new Map(items.map((i) => [i.o.billId + '|' + i.o.due, i]));
    const seen = new Set<string>();
    const out: (typeof items[number] & { status: ReconciledOccurrence['status']; members?: typeof items })[] = [];
    for (const i of items) {
      const k = i.o.billId + '|' + i.o.due;
      if (seen.has(k)) continue;
      const group = billGroups[i.o.billId];
      if (group && group[0] !== i.o.billId) continue; // secondary — rendered when we reach the primary below
      const memberIds = group ?? [i.o.billId];
      const memberItems = memberIds
        .map((id) => byKey.get(id + '|' + i.o.due))
        .filter((x): x is typeof items[number] => !!x);
      memberItems.forEach((m) => seen.add(m.o.billId + '|' + m.o.due));
      if (memberItems.length <= 1) { out.push({ ...i, status: i.o.status }); continue; }
      out.push({
        ...i,
        amt: memberItems.reduce((s, m) => s + m.amt, 0),
        status: worstStatus(memberItems.map((m) => m.o.status)),
        members: memberItems,
      });
    }
    return out;
  }, [items, billGroups]);

  // A bill more than 14 days out has nothing actionable yet — no bank match
  // is possible before the money moves, and the schedule itself already
  // lives on /bills/vendors. Overdue/missed bills are never capped on the
  // low end, no matter how old, since those always need attention.
  let tableItems = mergedItems;
  if (statusTab === 'open') tableItems = mergedItems.filter(i => i.status !== 'paid' && i.offset <= 14);
  else if (statusTab === 'paid') tableItems = mergedItems.filter(i => i.status === 'paid' && i.offset >= -10);
  else tableItems = mergedItems.filter(i => i.offset >= -14 && i.offset <= 14);
  tableItems = [...tableItems].sort((a, b) => statusTab === 'paid' ? b.due.getTime() - a.due.getTime() : a.due.getTime() - b.due.getTime());

  return (
    <div className="flex flex-col gap-4">
      {/* This week: KPIs + per-store coverage in one comprehensive section */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-slate-100 sm:grid-cols-4">
          <Kpi k="Due this week" v={$f(sum(week))} sub={`${week.length} bills`} />
          <Kpi k="Due next 30 days" v={$f(sum(m30))} sub={`${m30.length} bills`} />
          <Kpi k="Needs action" v={$f(sum(act))} sub={`${act.length} manual · not scheduled`} tone="warn" />
          <Kpi k="Overdue" v={sum(over) > 0 ? $f(sum(over)) : 'None'} sub={sum(over) > 0 ? `${over.length} bill${over.length > 1 ? 's' : ''}` : 'all current'} tone={sum(over) > 0 ? 'bad' : 'good'} />
        </div>
        <div className="flex items-baseline justify-between border-t border-slate-100 px-5 pb-0.5 pt-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-slate-400">Coverage this week</span>
          <span className="text-[11px] text-slate-400">unpaid bills vs cash on hand</span>
        </div>
        <div className="grid pb-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, coverage.length)}, 1fr)` }}>
          {coverage.map((c, i) => (
            <div key={c.k} className={`px-5 py-3.5 ${i > 0 ? 'border-l border-slate-100' : ''}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-bold text-slate-800">
                  <span className="h-2 w-2 rounded-full" style={{ background: STORE_COLORS[c.k] }} />{NAME[c.k]}
                </span>
                {c.ok != null && (
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${c.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{c.ok ? 'Covered' : 'Monitor'}</span>
                )}
              </div>
              <Kv k="Unpaid this week" v={$f(c.wk)} />
              <Kv k="Cash today" v={c.cash == null ? '—' : $f(c.cash)} />
              <Kv k="After this week's bills" v={c.after == null ? '—' : $f(c.after)} red={c.after != null && c.after < 1000} />
            </div>
          ))}
        </div>
      </div>

      {/* Bill Timeline */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-0.5 pt-4">
          <span className="text-sm font-bold text-slate-900">Bill Timeline</span>
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {([7, 14, 30] as const).map(h => (
              <button key={h} onClick={() => setHorizon(h)}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
                style={horizon === h ? { background: '#fff', color: '#0F172A', boxShadow: '0 1px 2px rgba(0,0,0,.06)' } : { color: '#64748B' }}>{h}d</button>
            ))}
          </div>
        </div>
        <div className="relative px-3 pb-2 pt-1" onMouseMove={onTimelineMove} onMouseLeave={() => setTip(null)}>
          {timeline
            ? <svg viewBox="0 0 1000 150" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 'auto', display: 'block' }} dangerouslySetInnerHTML={{ __html: timeline.svg }} />
            : <div className="flex h-[120px] items-center justify-center text-sm text-slate-300">No upcoming bills</div>}
          {tip && timeline && <TimelineTip tip={tip} unpaid={unpaid} todayMid={todayMid} />}
        </div>
        <div className="px-5 pb-2.5 text-[10.5px] text-slate-400">Dot size = amount due · number = bills that day. Paid bills drop off. Hover a day for detail.</div>
      </div>

      {/* Bills table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
          <span className="text-sm font-bold text-slate-900">Bills</span>
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {(['open', 'paid', 'all'] as const).map(t => (
              <button key={t} onClick={() => setStatusTab(t)}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors"
                style={statusTab === t ? { background: '#fff', color: '#0F172A', boxShadow: '0 1px 2px rgba(0,0,0,.06)' } : { color: '#64748B' }}>{t}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 720 }}>
            <thead>
              <tr className="text-[9px] font-bold uppercase tracking-[0.05em] text-slate-400">
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Due</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Vendor</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Store</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Category</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-right">Amount</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Bank match</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Method</th>
                <th className="border-b border-slate-200 px-[18px] py-2 text-left">Status</th>
                <th className="border-b border-slate-200 px-[18px] py-2" />
              </tr>
            </thead>
            <tbody className="text-[12.5px]">
              {tableItems.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-7 text-center text-slate-400">No bills in this view.</td></tr>
              ) : tableItems.map(i => {
                const paid = i.status === 'paid';
                const over = i.status === 'overdue' || i.status === 'missed';
                const today = i.offset === 0;
                const sk = key(i.o.store);
                const dueLbl = over ? 'Overdue' : today ? 'Today' : fmtShort(i.due);
                const rowKey = i.o.billId + '|' + i.o.due;
                const rowBusy = busy === i.o.billId + i.o.due;
                const sug = paid ? undefined : suggestions[rowKey];
                const members = i.members?.map((m) => m.o) ?? [i.o];
                const isOpen = expanded.has(rowKey);
                return (
                  <Fragment key={rowKey}>
                    <tr key={rowKey} className={`border-b border-slate-100 ${over ? 'bg-[#FEF7F7]' : ''} ${paid ? 'opacity-70' : ''}`}>
                      <td className="px-[18px] py-[11px]">
                        <span className={`block whitespace-nowrap font-bold ${today || over ? 'text-red-600' : 'text-slate-700'}`}>{dueLbl}</span>
                        <span className="block text-[10px] font-medium text-slate-400">{dow(i.due)} {fmtShort(i.due)}</span>
                      </td>
                      <td className="px-[18px] py-[11px] font-semibold text-slate-800">
                        {i.o.vendor}
                        {i.members && i.members.length > 1 && (
                          <button
                            onClick={() => toggleExpand(rowKey)}
                            title={`One payment also covers: ${i.members.slice(1).map((m) => m.o.vendor).join(', ')} — click to ${isOpen ? 'hide' : 'see'} the breakdown`}
                            className="ml-1.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-slate-100 px-1 align-middle text-[9px] font-bold text-slate-500 hover:bg-slate-200"
                          >+{i.members.length - 1}</button>
                        )}
                      </td>
                      <td className="px-[18px] py-[11px]"><span className="mr-[7px] inline-block h-2 w-2 rounded-full align-middle" style={{ background: STORE_COLORS[sk] }} />{NAME[sk] ?? i.o.store}</td>
                      <td className="px-[18px] py-[11px] text-[10.5px] text-slate-400">{i.cat}</td>
                      <td className="px-[18px] py-[11px] text-right font-mono font-bold tabular-nums text-slate-700">{$f(i.amt)}</td>
                      <td className="px-[18px] py-[11px]">
                        {!sug ? <span className="text-slate-300">—</span> : (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${sug.confidence === 'vendor' ? 'bg-emerald-500' : 'bg-amber-400'}`}
                              title={sug.confidence === 'vendor' ? 'Matched by vendor' : 'Matched by amount + date, and vendor-related text'}
                            />
                            <div className="min-w-0 leading-tight">
                              <div className="whitespace-nowrap font-mono text-[11px] font-bold tabular-nums text-slate-700">
                                {$f(sug.amount)} · {fmtShort(new Date(sug.date + 'T00:00:00'))}
                              </div>
                              <div className="max-w-[130px] truncate text-[10px] text-slate-400" title={sug.name}>{sug.name}</div>
                            </div>
                            <button
                              disabled={rowBusy} onClick={() => markPaid(members, false)} title="Confirm and mark paid"
                              className="flex-shrink-0 rounded-full bg-emerald-50 px-[7px] py-[3px] text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >✓</button>
                          </div>
                        )}
                      </td>
                      <td className="px-[18px] py-[11px]">
                        <span className={`rounded-full px-2 py-0.5 text-[8.5px] font-bold ${i.o.payment === 'auto' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>{i.o.payment === 'auto' ? 'Auto' : 'Manual'}</span>
                      </td>
                      <td className="px-[18px] py-[11px]"><StatusPill status={i.status} /></td>
                      <td className="px-[18px] py-[11px] text-right">
                        {paid
                          ? <button disabled={rowBusy} onClick={() => markPaid(members, true)} className="rounded-[7px] border border-slate-200 bg-white px-3 py-1.5 text-[10.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Undo</button>
                          : <button disabled={rowBusy} onClick={() => markPaid(members, false)} className="rounded-[7px] bg-slate-900 px-3 py-1.5 text-[10.5px] font-bold text-white hover:bg-slate-800 disabled:opacity-50">{rowBusy ? '…' : 'Mark paid'}</button>}
                      </td>
                    </tr>
                    {i.members && i.members.length > 1 && isOpen && (
                      <tr key={rowKey + '-detail'} className="border-b border-slate-100 bg-slate-50/70">
                        <td colSpan={9} className="px-[18px] py-2 pl-[44px]">
                          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
                            {i.members.map((m) => (
                              <span key={m.o.billId}>
                                <span className="text-slate-400">{m.o.vendor}:</span>{' '}
                                <span className="font-mono font-semibold text-slate-600">{$f(m.amt)}</span>
                              </span>
                            ))}
                            <span className="text-slate-300">— one payment, shown as one bill above</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: 'warn' | 'bad' | 'good' }) {
  const color = tone === 'warn' ? '#B45309' : tone === 'bad' ? '#DC2626' : tone === 'good' ? '#059669' : '#0F172A';
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-semibold text-slate-400">{k}</div>
      <div className="mt-1.5 font-mono text-[22px] font-bold tabular-nums" style={{ color }}>{v}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}

function Kv({ k, v, red }: { k: string; v: string; red?: boolean }) {
  return (
    <div className="mt-1 flex justify-between text-[11.5px]">
      <span className="text-slate-400">{k}</span>
      <span className={`font-mono font-semibold tabular-nums ${red ? 'text-red-600' : 'text-slate-700'}`}>{v}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
    overdue: { label: 'Overdue', cls: 'bg-red-50 text-red-600' },
    missed: { label: 'Overdue', cls: 'bg-red-50 text-red-600' },
    due: { label: 'Due', cls: 'bg-blue-50 text-blue-600' },
    upcoming: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-600' },
  };
  const s = map[status] ?? map.upcoming;
  return <span className={`rounded-full px-2 py-[3px] text-[9px] font-bold ${s.cls}`}>{s.label}</span>;
}

// ── Timeline SVG builder ──────────────────────────────────────────────
function buildTimeline(
  unpaid: { o: ReconciledOccurrence; due: Date; offset: number; amt: number }[],
  horizon: number, todayMid: Date,
) {
  const W = 1000, H = 150, PAD = { t: 16, r: 16, b: 28, l: 16 }, cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
  // Forward-looking only: today (0) through the horizon.
  const days: number[] = []; for (let o = 0; o <= horizon; o++) days.push(o);
  const n = days.length, slot = cW / n;
  const xOf = (o: number) => PAD.l + slot * o + slot / 2;
  const baseY = PAD.t + cH - 6;
  const dateFor = (o: number) => new Date(todayMid.getFullYear(), todayMid.getMonth(), todayMid.getDate() + o);
  const at = (o: number) => unpaid.filter(i => i.offset === o);
  const forward = unpaid.filter(i => i.offset >= 0 && i.offset <= horizon);
  const maxAmt = Math.max(8200, ...forward.map(i => i.amt));
  if (forward.length === 0) return null;

  let svg = '';
  days.forEach(o => { const wd = dateFor(o).getDay(); if (wd === 0 || wd === 6) svg += `<rect x="${(xOf(o) - slot / 2).toFixed(1)}" y="${PAD.t}" width="${slot.toFixed(1)}" height="${cH}" fill="#0F172A" opacity=".025"/>`; });
  svg += `<line x1="${PAD.l}" y1="${baseY.toFixed(1)}" x2="${W - PAD.r}" y2="${baseY.toFixed(1)}" stroke="#E2E8F0"/>`;
  const tx = xOf(0);
  svg += `<line x1="${tx.toFixed(1)}" y1="${PAD.t}" x2="${tx.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="#0F172A" stroke-dasharray="2 3" opacity=".35"/>`;
  svg += `<text x="${tx.toFixed(1)}" y="${(PAD.t + 8).toFixed(1)}" font-size="8" fill="#64748B" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700">TODAY</text>`;
  const GAP = 2.5;
  const availH = baseY - PAD.t - 12; // keep the stack (and its count badge) inside the plot
  days.forEach(o => {
    const bl = at(o).slice().sort((a, b) => b.amt - a.amt);
    if (!bl.length) { if (o % (horizon > 20 ? 5 : 2) === 0) svg += `<text x="${xOf(o).toFixed(1)}" y="${(H - 8).toFixed(1)}" font-size="8" fill="#CBD5E1" text-anchor="middle" font-family="Inter,sans-serif">${fmtShort(dateFor(o))}</text>`; return; }
    const radii = bl.map(i => 3 + Math.min(6.5, (i.amt / maxAmt) * 6.5));
    const needed = radii.reduce((s, r) => s + 2 * r, 0) + GAP * (bl.length - 1);
    const scale = needed > availH ? availH / needed : 1;
    let y = baseY - 6, topY = y;
    bl.forEach((i, idx) => { const r = radii[idx] * scale; y -= r;
      svg += `<circle cx="${xOf(o).toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${STORE_COLORS[key(i.o.store)]}" opacity=".9"/>`;
      topY = y - r; y -= (r + GAP * scale); });
    if (bl.length > 1) { const by = Math.max(PAD.t + 7, topY - 3);
      svg += `<circle cx="${(xOf(o) + 11).toFixed(1)}" cy="${by.toFixed(1)}" r="7" fill="#1E293B"/><text x="${(xOf(o) + 11).toFixed(1)}" y="${(by + 3).toFixed(1)}" font-size="8.5" fill="#fff" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700">${bl.length}</text>`; }
    svg += `<text x="${xOf(o).toFixed(1)}" y="${(H - 8).toFixed(1)}" font-size="8" fill="#94A3B8" text-anchor="middle" font-family="Inter,sans-serif">${fmtShort(dateFor(o))}</text>`;
  });

  const offsetAtX = (svgX: number): number | null => {
    let best: number | null = null, bestD = Infinity;
    for (const o of days) { const d = Math.abs(svgX - xOf(o)); if (d < bestD) { bestD = d; best = o; } }
    return best != null && at(best).length ? best : null;
  };
  return { svg, offsetAtX };
}

function TimelineTip({ tip, unpaid, todayMid }: {
  tip: { x: number; y: number; o: number };
  unpaid: { o: ReconciledOccurrence; due: Date; offset: number; amt: number }[];
  todayMid: Date;
}) {
  const bl = unpaid.filter(i => i.offset === tip.o);
  if (!bl.length) return null;
  const d = new Date(todayMid.getFullYear(), todayMid.getMonth(), todayMid.getDate() + tip.o);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const left = Math.min(tip.x + 14, vw - 216);
  return (
    <div style={{ position: 'fixed', left, top: tip.y - 10, transform: 'translateY(-100%)', width: 200, zIndex: 60, pointerEvents: 'none', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', boxShadow: '0 6px 20px rgba(15,23,42,.14)' }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94A3B8', marginBottom: 6 }}>
        {tip.o === 0 ? 'Today' : `${dow(d)} · ${fmtShort(d)}`}
      </div>
      {bl.map((i, idx) => (
        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4, fontSize: 11 }}>
          <span style={{ color: '#475569' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STORE_COLORS[key(i.o.store)], marginRight: 6, verticalAlign: 'middle' }} />{i.o.vendor}</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{$f(i.amt)}</span>
        </div>
      ))}
    </div>
  );
}
