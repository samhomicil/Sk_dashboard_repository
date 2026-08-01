'use client';

import { useState, useEffect, useCallback } from 'react';
import type { QbPnlRow, QbPnlMonth } from '@/lib/bills/qb';

// ── Types ──────────────────────────────────────────────────────────────
interface PnlStoreResult {
  company: string;
  name: string;
  report: { rows: QbPnlRow[]; startPeriod: string; endPeriod: string; basis: string } | null;
  error?: string;
}

interface PnlTrendResult {
  company: string;
  name: string;
  trend: QbPnlMonth[];
}

// ── Helpers ────────────────────────────────────────────────────────────
const STORE_COLORS: Record<string, string> = { margate: '#3B82F6', miramar: '#F59E0B', pines: '#10B981' };

function $f(n: number | null) {
  if (n === null) return '—';
  const abs = Math.abs(n);
  const fmt = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '(' : '') + '$' + fmt + (n < 0 ? ')' : '');
}

function periodDates(key: string): { start: string; end: string } {
  const n = new Date();
  const y = n.getFullYear();
  const m = n.getMonth();
  const pad = (x: number) => String(x).padStart(2, '0');
  const lastDay = (yr: number, mo: number) =>
    new Date(yr, mo + 1, 0).toISOString().slice(0, 10);

  if (key === 'mtd')   return { start: `${y}-${pad(m + 1)}-01`, end: n.toISOString().slice(0, 10) };
  if (key === 'last') {
    const d = new Date(y, m, 0);
    return { start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, end: d.toISOString().slice(0, 10) };
  }
  if (key === 'qtd') {
    const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
    return { start: qStart.toISOString().slice(0, 10), end: n.toISOString().slice(0, 10) };
  }
  if (key === 'lastq') {
    const qm = Math.floor(m / 3) * 3 - 3;
    const qy = qm < 0 ? y - 1 : y;
    const qmo = ((qm % 12) + 12) % 12;
    return { start: `${qy}-${pad(qmo + 1)}-01`, end: lastDay(qy, qmo + 2) };
  }
  if (key === 'ytd')  return { start: `${y}-01-01`, end: n.toISOString().slice(0, 10) };
  if (key === 'lasty') return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  return { start: `${y}-01-01`, end: n.toISOString().slice(0, 10) };
}

// ── Collapsible row ────────────────────────────────────────────────────
function PnlRowView({ row, depth }: { row: QbPnlRow; depth: number }) {
  const [open, setOpen] = useState(depth < 1); // Top sections collapsed by default at depth 0

  const isTopSection = row.isSection && depth === 0;
  const isNestedSection = row.isSection && depth > 0;
  const isNetIncome = row.group === 'NetIncome';
  const isGrossProfit = row.group === 'GrossProfit';
  const isNetOpIncome = row.group === 'NetOperatingIncome' || row.group === 'NetOtherIncome';

  // Special standalone rows (net income, gross profit, net operating income)
  if (!row.isSection && (isNetIncome || isGrossProfit || isNetOpIncome)) {
    return (
      <div className={`flex items-center justify-between px-4 py-2.5 ${
        isNetIncome ? 'bg-slate-900' :
        isGrossProfit ? 'bg-emerald-50 border-t-2 border-b-2 border-emerald-100' :
        'bg-slate-50 border-t border-slate-200'
      }`}>
        <span className={`text-[12px] font-bold ${isNetIncome ? 'text-white' : 'text-slate-800'}`}>
          {row.label}
        </span>
        <span className={`font-mono text-[13px] font-bold ${
          isNetIncome ? (row.amount !== null && row.amount >= 0 ? 'text-emerald-400' : 'text-red-400') :
          row.amount !== null && row.amount < 0 ? 'text-red-600' : 'text-emerald-700'
        }`}>
          {$f(row.amount)}
        </span>
      </div>
    );
  }

  // Summary rows (section totals)
  if (row.isSummary) {
    return (
      <div className="flex items-center justify-between border-t border-slate-100 py-1.5"
        style={{ paddingLeft: 16 + depth * 12, paddingRight: 16 }}>
        <span className="text-[11px] font-bold text-slate-600">{row.label}</span>
        <span className="font-mono text-[12px] font-bold text-slate-800">{$f(row.amount)}</span>
      </div>
    );
  }

  // Section rows (collapsible)
  if (row.isSection) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className={`w-full flex items-center justify-between text-left transition-colors ${
            isTopSection
              ? 'bg-slate-50 hover:bg-slate-100 border-b border-slate-200 py-2.5'
              : 'hover:bg-slate-50 py-1.5'
          }`}
          style={{ paddingLeft: 16 + depth * 12, paddingRight: 16 }}
        >
          <div className="flex items-center gap-2">
            <svg
              className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            >
              <path d="M4 2l4 4-4 4" />
            </svg>
            <span className={`${isTopSection ? 'text-[12px] font-bold text-slate-800' : isNestedSection ? 'text-[11.5px] font-semibold text-slate-700' : 'text-[11px] text-slate-600'}`}>
              {row.label}
            </span>
          </div>
          <span className={`font-mono ${isTopSection ? 'text-[13px] font-bold text-slate-900' : 'text-[12px] font-semibold text-slate-700'}`}>
            {$f(row.amount)}
          </span>
        </button>
        {open && (
          <div className={isTopSection ? 'bg-white border-b border-slate-100' : ''}>
            {row.children.map((child, i) => (
              <PnlRowView key={i} row={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Regular data rows (line items)
  const isZero = row.amount === 0 || row.amount === null;
  return (
    <div
      className="flex items-center justify-between py-1 hover:bg-slate-50"
      style={{ paddingLeft: 16 + depth * 12, paddingRight: 16 }}
    >
      <span className={`text-[11.5px] ${isZero ? 'text-slate-400' : 'text-slate-700'}`}>{row.label}</span>
      <span className={`font-mono text-[12px] ${
        isZero ? 'text-slate-300' :
        row.amount !== null && row.amount < 0 ? 'text-red-600' : 'text-slate-700'
      }`}>
        {$f(row.amount)}
      </span>
    </div>
  );
}

// ── Net Income Trend Chart ─────────────────────────────────────────────
function NetIncomeTrendChart({ trendResults }: { trendResults: PnlTrendResult[] }) {
  const [hovered, setHovered] = useState<{ month: string; x: number; y: number } | null>(null);

  const stores = trendResults.filter(r => r.trend.length > 0);
  if (!stores.length) return null;

  // Collect all month labels in order
  const allMonths = stores[0]?.trend.map(p => ({ month: p.month, label: p.label })) ?? [];
  if (allMonths.length < 2) return null;

  const W = 900, H = 260;
  const PAD = { top: 28, right: 24, bottom: 36, left: 76 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const n  = allMonths.length;

  // Find global min/max for consistent y-scale
  const allVals = stores.flatMap(r => r.trend.map(p => p.netIncome));
  const rawMax = Math.max(...allVals, 0);
  const rawMin = Math.min(...allVals, 0);
  const rangePad = (rawMax - rawMin) * 0.18 || 2000;
  const yMax = rawMax + rangePad;
  const yMin = rawMin - rangePad;
  const yRange = yMax - yMin;

  const xOf = (i: number) => PAD.left + (n === 1 ? cW / 2 : (i / (n - 1)) * cW);
  const yOf = (v: number) => PAD.top + ((yMax - v) / yRange) * cH;
  const zeroY = yOf(0);

  // Y-axis grid lines + labels
  const yTicks = 5;
  const gridLines: string[] = [];
  const yLabels: { y: number; label: string }[] = [];
  for (let t = 0; t <= yTicks; t++) {
    const v = yMin + (yRange * t) / yTicks;
    const y = yOf(v);
    gridLines.push(`<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#F1F5F9" stroke-width="1"/>`);
    const abs = Math.abs(v);
    const lbl = abs >= 10000 ? `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`
              : abs >= 1000  ? `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`
              : `${v < 0 ? '-' : ''}$${Math.round(abs)}`;
    yLabels.push({ y, label: lbl });
  }

  // Zero line
  const zeroLine = `<line x1="${PAD.left}" y1="${zeroY.toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="5 4"/>`;

  // Store lines + area fills
  let paths = '';
  stores.forEach(({ company, trend }) => {
    const col = STORE_COLORS[company] ?? '#6366F1';
    const pts = trend.map((p, i) => ({ x: xOf(i), y: yOf(p.netIncome) }));
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const fillPts = [...pts, { x: pts[pts.length - 1].x, y: zeroY }, { x: pts[0].x, y: zeroY }];
    const fillPath = fillPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z';
    const colHex = col.replace('#', '');
    paths += `<defs><linearGradient id="pnl-${colHex}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity=".14"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
    paths += `<path d="${fillPath}" fill="url(#pnl-${colHex})"/>`;
    paths += `<path d="${linePath}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    pts.forEach(p => {
      paths += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${col}" stroke="white" stroke-width="2"/>`;
    });
  });

  // X-axis labels
  const xAxisLabels = allMonths.map((m, i) => {
    const x = xOf(i);
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    // Show abbreviated label (e.g. "Jan" instead of "Jan 2026") if more than 8 months
    const lbl = n > 8 ? m.label.split(' ')[0] : m.label;
    return `<text x="${x.toFixed(1)}" y="${(H - 6).toFixed(1)}" font-size="11" fill="#64748B" text-anchor="${anchor}" font-family="Inter,system-ui,sans-serif" font-weight="500">${lbl}</text>`;
  }).join('');

  const svgContent = [
    ...gridLines,
    zeroLine,
    paths,
    xAxisLabels,
    yLabels.map(({ y, label }) =>
      `<text x="${(PAD.left - 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="11" fill="#64748B" text-anchor="end" font-family="Inter,system-ui,sans-serif">${label}</text>`
    ).join(''),
  ].join('\n');

  // Hover tooltip data (computed per month index)
  const hoveredMonth = hovered ? allMonths.find(m => m.month === hovered.month) : null;
  const hoveredIdx   = hoveredMonth ? allMonths.findIndex(m => m.month === hoveredMonth.month) : -1;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <div>
          <span className="text-[13px] font-bold text-slate-800">Net Income — Monthly Trend</span>
          <span className="ml-2 text-[10px] text-slate-400">from QuickBooks</span>
        </div>
        <div className="flex items-center gap-4">
          {stores.map(({ company, name }) => (
            <span key={company} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: STORE_COLORS[company] }}>
              <span className="inline-block w-2.5 h-[3px] rounded-full" style={{ background: STORE_COLORS[company] }} />
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="relative px-2 pt-2 pb-1" style={{ userSelect: 'none' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
          onMouseMove={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const rawX = ((e.clientX - rect.left) / rect.width) * W;
            const relX = rawX - PAD.left;
            const i = Math.round((relX / cW) * (n - 1));
            if (i >= 0 && i < n) setHovered({ month: allMonths[i].month, x: e.clientX, y: e.clientY });
            else setHovered(null);
          }}
          onMouseLeave={() => setHovered(null)}
        />

        {/* Tooltip */}
        {hovered && hoveredIdx >= 0 && (
          <div
            className="pointer-events-none fixed z-50 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
            style={{ left: Math.min(hovered.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 220), top: hovered.y - 10, transform: 'translateY(-100%)', minWidth: 180 }}
          >
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              {hoveredMonth?.label}
            </div>
            {stores.map(({ company, name, trend }) => {
              const pt = trend[hoveredIdx];
              if (!pt) return null;
              const pos = pt.netIncome >= 0;
              return (
                <div key={company} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: STORE_COLORS[company] }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: STORE_COLORS[company] }} />
                    {name}
                  </span>
                  <span className={`font-mono text-[12px] font-bold ${pos ? 'text-emerald-600' : 'text-red-600'}`}>
                    {pos ? '' : '('}{Math.abs(pt.netIncome) >= 1000
                      ? `$${(Math.abs(pt.netIncome) / 1000).toFixed(1)}k`
                      : `$${Math.round(Math.abs(pt.netIncome))}`}{pos ? '' : ')'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Store P&L card ─────────────────────────────────────────────────────
function StorePnl({ result, expanded, onToggleAll }: {
  result: PnlStoreResult;
  expanded: boolean;
  onToggleAll: () => void;
}) {
  const col = STORE_COLORS[result.company] ?? '#6366F1';

  if (result.error || !result.report) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="h-[3px]" style={{ background: col }} />
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full" style={{ background: col }} />
            <span className="text-[13px] font-bold text-slate-800">{result.name}</span>
          </div>
          <p className="text-[12px] text-slate-400">No data available</p>
        </div>
      </div>
    );
  }

  const { rows, startPeriod, endPeriod, basis } = result.report;
  const netRow = rows.find(r => r.group === 'NetIncome');

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="h-[3px]" style={{ background: col }} />
      {/* Store header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: col }} />
          <span className="text-[13px] font-bold text-slate-800">{result.name}</span>
          <span className="text-[10px] text-slate-400 font-medium">{basis}</span>
        </div>
        <div className="flex items-center gap-3">
          {netRow && (
            <div className="text-right">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Net Income</div>
              <div className={`font-mono text-[14px] font-bold ${
                (netRow.amount ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}>{$f(netRow.amount)}</div>
            </div>
          )}
          <button onClick={onToggleAll} className="text-[10px] font-semibold text-violet-600 hover:underline whitespace-nowrap">
            {expanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>
      {/* Period */}
      <div className="px-5 py-1.5 bg-slate-50 border-b border-slate-100">
        <span className="text-[10px] text-slate-400">
          {new Date(startPeriod + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' — '}
          {new Date(endPeriod + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
      {/* P&L rows */}
      <div>
        {rows.map((row, i) => (
          <PnlRowView key={i} row={row} depth={0} />
        ))}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'mtd',   label: 'Month to Date' },
  { key: 'last',  label: 'Last Month' },
  { key: 'qtd',   label: 'Quarter to Date' },
  { key: 'lastq', label: 'Last Quarter' },
  { key: 'ytd',   label: 'Year to Date' },
  { key: 'lasty', label: 'Last Year' },
] as const;

const STORES_UI = ['All', 'Margate', 'Miramar', 'Pines'] as const;

// For trend chart always use last 12 months to give meaningful MoM context
function trendWindow() {
  const n = new Date();
  const start = new Date(n.getFullYear() - 1, n.getMonth() + 1, 1);
  const pad = (x: number) => String(x).padStart(2, '0');
  return {
    start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`,
    end:   n.toISOString().slice(0, 10),
  };
}

export default function PnlClient() {
  const [period,      setPeriod]      = useState<string>('ytd');
  const [store,       setStore]       = useState<string>('All');
  const [basis,       setBasis]       = useState<'Accrual' | 'Cash'>('Accrual');
  const [results,     setResults]     = useState<PnlStoreResult[]>([]);
  const [trendResults,setTrendResults]= useState<PnlTrendResult[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [trendLoading,setTrendLoading]= useState(true);
  const [expandMap,   setExpandMap]   = useState<Record<string, boolean>>({});

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    const { start, end } = trendWindow();
    const sq = store !== 'All' ? `&store=${store.toLowerCase()}` : '';
    try {
      const r = await fetch(`/api/qb/pnl?by=month&start=${start}&end=${end}&basis=${basis}${sq}`, { cache: 'no-store' });
      setTrendResults(await r.json());
    } catch { setTrendResults([]); }
    setTrendLoading(false);
  }, [store, basis]);

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = periodDates(period);
    const sq = store !== 'All' ? `&store=${store.toLowerCase()}` : '';
    try {
      const r = await fetch(`/api/qb/pnl?start=${start}&end=${end}&basis=${basis}${sq}`, { cache: 'no-store' });
      const data = await r.json();
      setResults(data);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [period, store, basis]);

  useEffect(() => { load(); },      [load]);
  useEffect(() => { loadTrend(); }, [loadTrend]);

  function handleRefresh() {
    load();
    loadTrend();
    window.dispatchEvent(new CustomEvent('sk:synced', { detail: { source: 'qb', at: new Date().toISOString() } }));
  }

  useEffect(() => {
    const onRefresh = () => handleRefresh();
    window.addEventListener('sk:refresh', onRefresh);
    return () => window.removeEventListener('sk:refresh', onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadTrend]);

  function toggleAll(company: string) {
    setExpandMap(m => ({ ...m, [company]: !m[company] }));
  }

  return (
    <div className="min-h-screen">
      {/* Main */}
      <main className="pb-10">
        {/* Header */}
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur sm:px-7">
          <h1 className="text-base font-semibold text-slate-900">Profit &amp; Loss</h1>

          {/* Store filter */}
          <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {STORES_UI.map(s => (
              <button key={s} onClick={() => setStore(s)}
                className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                style={store === s
                  ? { background: s === 'All' ? '#0F172A' : STORE_COLORS[s.toLowerCase()], color: '#fff' }
                  : { color: '#64748b' }}>
                {s}
              </button>
            ))}
          </div>

          {/* Period */}
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-none">
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          {/* Basis */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {(['Accrual', 'Cash'] as const).map(b => (
              <button key={b} onClick={() => setBasis(b)}
                className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                style={basis === b ? { background: '#0F172A', color: '#fff' } : { color: '#64748b' }}>
                {b}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button onClick={handleRefresh} disabled={loading || trendLoading}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M10.5 1.5v3h-3M1.5 10.5v-3h3" />
              <path d="M2.04 4.5a4.5 4.5 0 0 1 7.74-1.24M9.96 7.5a4.5 4.5 0 0 1-7.74 1.24" />
            </svg>
            Refresh
          </button>
        </header>

        <div className="space-y-5 px-5 py-6 sm:px-7">
          {/* Trend chart — always shown, uses rolling 12-month window */}
          {trendLoading ? (
            <div className="h-[220px] animate-pulse rounded-2xl bg-slate-100" />
          ) : (
            <NetIncomeTrendChart trendResults={trendResults} />
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-[500px] animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm text-slate-500">No QuickBooks connections found. <a href="/settings" className="text-violet-600 underline">Connect QB →</a></p>
            </div>
          ) : (
            <PnlComparison results={results} />
          )}
        </div>
      </main>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Consolidated comparison statement (union of accounts across stores) ──
// Client-side merge — the sanctioned §3.5 P&L transform. No fetch/API change.
function parseStore(rows: QbPnlRow[]) {
  const sections = new Map<string, { total: number | null; lines: Map<string, number | null> }>();
  const specials = new Map<string, number | null>();
  for (const row of rows) {
    if (row.isSection) {
      const lines = new Map<string, number | null>();
      let total: number | null = row.amount;
      for (const c of row.children) {
        if (c.isSummary) { if (total == null) total = c.amount; continue; }
        lines.set(c.label, c.amount);
      }
      if (total == null) { let s = 0; lines.forEach(v => (s += v ?? 0)); total = s; }
      sections.set(row.label, { total, lines });
    } else if (row.group) {
      specials.set(row.group, row.amount);
    }
  }
  let incomeTotal = sections.get('Income')?.total ?? null;
  if (incomeTotal == null) { let t = 0; sections.forEach((v, k) => { if (/income/i.test(k) && !/other/i.test(k)) t += v.total ?? 0; }); incomeTotal = t; }
  return { sections, specials, incomeTotal };
}

const SPECIAL_STYLE: Record<string, string> = {
  GrossProfit: 'gp', NetOperatingIncome: 'noi', NetOtherIncome: 'noi', NetIncome: 'ni',
};

function PnlComparison({ results }: { results: PnlStoreResult[] }) {
  const stores = results.map(r => ({ key: r.company, name: r.name, color: STORE_COLORS[r.company] ?? '#64748B', rows: r.report?.rows ?? [] }));
  const parsed = Object.fromEntries(stores.map(s => [s.key, parseStore(s.rows)]));
  const incomeTotals: Record<string, number> = Object.fromEntries(stores.map(s => [s.key, parsed[s.key].incomeTotal || 0]));

  // Top-level order: sections + special group rows, first-seen across stores.
  const seq: Array<{ type: 'section'; label: string } | { type: 'special'; group: string; label: string }> = [];
  const seenSec = new Set<string>(), seenSpec = new Set<string>();
  for (const s of stores) {
    for (const row of s.rows) {
      if (row.isSection && !seenSec.has(row.label)) { seenSec.add(row.label); seq.push({ type: 'section', label: row.label }); }
      else if (!row.isSection && row.group && !seenSpec.has(row.group)) { seenSpec.add(row.group); seq.push({ type: 'special', group: row.group, label: row.label }); }
    }
  }

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}; seq.forEach(e => { if (e.type === 'section') m[e.label] = true; }); return m;
  });

  const money = (n: number | null) => n == null ? '—' : (n < 0 ? '(' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US') + (n < 0 ? ')' : '');
  const pctOf = (n: number | null, k: string) => { const t = incomeTotals[k]; return (n == null || !t) ? '' : (n / t * 100).toFixed(1) + '%'; };

  const cells = (per: Record<string, number | null>, opts?: { bold?: boolean; white?: boolean }) => {
    const tds = stores.map(s => {
      const v = per[s.key] ?? null;
      const has = v != null;
      const col = opts?.white ? (v != null && v < 0 ? 'text-red-400' : 'text-emerald-400') : !has ? 'text-slate-300' : v < 0 ? 'text-red-600' : 'text-slate-700';
      return (
        <td key={s.key} className="px-[18px] py-[7px] text-right align-top">
          <div className={`font-mono tabular-nums ${col} ${opts?.bold ? 'font-bold' : ''}`}>{money(v)}</div>
          {has && <div className={`mt-px font-mono text-[9.5px] tabular-nums ${opts?.white ? 'text-slate-500' : 'text-slate-400'}`}>{pctOf(v, s.key)}</div>}
        </td>
      );
    });
    const tv = stores.reduce((a, s) => a + (per[s.key] ?? 0), 0);
    const tinc = stores.reduce((a, s) => a + incomeTotals[s.key], 0);
    const tcol = opts?.white ? (tv < 0 ? 'text-red-400' : 'text-emerald-400') : tv < 0 ? 'text-red-600' : 'text-slate-800';
    tds.push(
      <td key="total" className="border-l border-slate-100 px-[18px] py-[7px] text-right align-top">
        <div className={`font-mono font-bold tabular-nums ${tcol}`}>{money(tv)}</div>
        <div className={`mt-px font-mono text-[9.5px] tabular-nums ${opts?.white ? 'text-slate-500' : 'text-slate-400'}`}>{tinc ? (tv / tinc * 100).toFixed(1) + '%' : ''}</div>
      </td>,
    );
    return tds;
  };

  const colSpan = stores.length + 2;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th className="border-b border-slate-200 px-[18px] py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.05em] text-slate-400" style={{ width: '30%' }}>Account</th>
              {stores.map(s => (
                <th key={s.key} className="border-b border-slate-200 px-[18px] py-2.5 text-right text-[11px] font-bold" style={{ color: s.color }}>
                  <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: s.color }} />{s.name}
                  <span className="block text-[8px] font-semibold uppercase tracking-[0.04em] text-slate-300">$ · % sales</span>
                </th>
              ))}
              <th className="border-b border-l border-slate-100 px-[18px] py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.05em] text-slate-600">
                Total<span className="block text-[8px] font-semibold text-slate-300">$ · % sales</span>
              </th>
            </tr>
          </thead>
          <tbody className="text-[12px]">
            {seq.map(e => {
              if (e.type === 'section') {
                const label = e.label;
                const totalPer: Record<string, number | null> = {};
                stores.forEach(s => { totalPer[s.key] = parsed[s.key].sections.get(label)?.total ?? null; });
                // union of line labels, first-seen order
                const lineLabels: string[] = []; const seen = new Set<string>();
                stores.forEach(s => { parsed[s.key].sections.get(label)?.lines.forEach((_v, k) => { if (!seen.has(k)) { seen.add(k); lineLabels.push(k); } }); });
                const isOpen = !collapsed[label];
                return (
                  <FragmentRows key={label}>
                    <tr className="cursor-pointer bg-slate-50 hover:bg-slate-100" onClick={() => setCollapsed(c => ({ ...c, [label]: !c[label] }))}>
                      <td className="border-y border-slate-100 px-[18px] py-[7px]">
                        <span className="flex items-center gap-2 text-[11.5px] font-bold text-slate-700">
                          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-400" style={{ transform: isOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}><path d="M4 2l4 4-4 4" /></svg>
                          {label}
                        </span>
                      </td>
                      {cells(totalPer, { bold: true })}
                    </tr>
                    {isOpen && lineLabels.map(ll => {
                      const per: Record<string, number | null> = {};
                      stores.forEach(s => { const v = parsed[s.key].sections.get(label)?.lines.get(ll); per[s.key] = v === undefined ? null : v; });
                      return (
                        <tr key={label + '|' + ll} className="border-b border-slate-50">
                          <td className="py-[7px] pl-[38px] pr-[18px] text-[12px] text-slate-500">{ll}</td>
                          {cells(per)}
                        </tr>
                      );
                    })}
                  </FragmentRows>
                );
              }
              // special row
              const per: Record<string, number | null> = {};
              stores.forEach(s => { per[s.key] = parsed[s.key].specials.get(e.group) ?? null; });
              const kind = SPECIAL_STYLE[e.group] ?? 'noi';
              if (kind === 'ni') {
                return (
                  <tr key={e.group} className="bg-slate-900">
                    <td className="px-[18px] py-2.5 text-[12.5px] font-bold text-white">{e.label}</td>
                    {cells(per, { white: true, bold: true })}
                  </tr>
                );
              }
              if (kind === 'gp') {
                return (
                  <tr key={e.group} className="border-y border-emerald-100 bg-emerald-50">
                    <td className="px-[18px] py-2 text-[12px] font-bold text-emerald-800">{e.label}</td>
                    {cells(per, { bold: true })}
                  </tr>
                );
              }
              return (
                <tr key={e.group} className="border-t border-slate-200 bg-slate-50">
                  <td className="px-[18px] py-2 text-[12px] font-bold text-slate-700">{e.label}</td>
                  {cells(per, { bold: true })}
                </tr>
              );
            })}
            {seq.length === 0 && <tr><td colSpan={colSpan} className="px-6 py-10 text-center text-slate-400">No P&amp;L data.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }
