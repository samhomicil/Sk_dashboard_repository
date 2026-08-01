'use client';
import { useEffect, useMemo, useState } from 'react';

// Validated categorical palette (dataviz skill): blue / green / magenta, fixed order.
const STORES = ['Margate', 'Miramar', 'Pines'] as const;
type Store = (typeof STORES)[number];
const VAR: Record<Store, string> = { Margate: 'var(--s1)', Miramar: 'var(--s2)', Pines: 'var(--s3)' };

interface Day { d: string; inflow: number; outflow: number; balance: number }
interface StoreF {
  store: Store; balSrc: string; stale: boolean;
  start: number; low: number; lowDate: string; end: number;
  need: number; needBy: string | null; days: Day[];
}
interface Payload { ok: boolean; asOf: string | null; stores: StoreF[] }

const money = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const kMoney = (n: number) => {
  const a = Math.abs(n);
  return (n < 0 ? '-' : '') + '$' + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : Math.round(a));
};
const md = (iso: string) => { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; };

export default function ForecastClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/forecast', { cache: 'no-store' })
      .then((r) => r.json()).then((d: Payload) => setData(d))
      .catch(() => setData(null)).finally(() => setLoading(false));
  }, []);

  const chart = useMemo(() => {
    if (!data?.stores?.length) return null;
    const stores = data.stores;
    const n = stores[0].days.length;
    const bals = stores.flatMap((s) => s.days.map((x) => x.balance));
    const yMax = Math.max(0, ...bals) * 1.06;
    const yMin = Math.min(0, ...bals) * 1.06;
    const W = 780, H = 340, padL = 52, padR = 66, padT = 14, padB = 26;
    const X = (i: number) => padL + (i * (W - padL - padR)) / (n - 1);
    const Y = (v: number) => padT + ((yMax - v) * (H - padT - padB)) / (yMax - yMin || 1);
    const yticks = [yMax, (yMax + Math.max(0, yMin)) / 2, 0, yMin / 2, yMin]
      .filter((v, i, a) => a.indexOf(v) === i && v >= yMin && v <= yMax);
    const xticks = stores[0].days.map((d, i) => ({ i, d: d.d })).filter((_, i) => i % 7 === 0);
    return { stores, n, W, H, padL, padR, padT, padB, X, Y, yMin, yMax, yticks, xticks };
  }, [data]);

  if (loading) return <div className="fc"><p className="muted">Loading forecast…</p><Style /></div>;
  if (!data?.stores?.length)
    return <div className="fc"><p className="muted">No forecast yet — run <code>python3 forecast.py --write</code>.</p><Style /></div>;

  const { stores } = data;
  const c = chart!;
  const totalNeed = stores.reduce((s, x) => s + x.need, 0);
  const staleStores = stores.filter((s) => s.stale);
  const funding = stores.filter((s) => s.need > 0)
    .map((s) => ({ store: s.store, need: s.need, by: s.needBy! }))
    .sort((a, b) => a.by.localeCompare(b.by) || b.need - a.need);

  return (
    <div className="fc">
      <Style />
      <header className="fc-head">
        <div>
          <h1>Cash forecast</h1>
          <p className="muted">Per-store daily balance · next {c.n} days · anchored on live bank balances (SimpleFIN)</p>
        </div>
        <div className="asof">as of {data.asOf ? md(data.asOf) : '—'}</div>
      </header>

      {staleStores.length > 0 && (
        <div className="warn">
          ⚠ Stale bank feed: {staleStores.map((s) => s.store).join(', ')} — reconnect in SimpleFIN before trusting these numbers.
        </div>
      )}

      {/* KPI tiles (double as the color legend) */}
      <div className="tiles">
        {stores.map((s) => (
          <div className="tile" key={s.store}>
            <div className="tile-top"><span className="dot" style={{ background: VAR[s.store] }} />{s.store}{s.stale && <span className="pill">stale</span>}</div>
            <div className="tile-cur">{money(s.start)}<span className="muted"> now</span></div>
            <div className="tile-low">low {money(s.low)}<span className="muted"> · {md(s.lowDate)}</span></div>
            <div className={'tile-need' + (s.need > 0 ? ' bad' : ' ok')}>
              {s.need > 0 ? `fund ${money(s.need)} by ${md(s.needBy!)}` : 'self-funds'}
            </div>
          </div>
        ))}
      </div>

      {/* Balance chart */}
      <div className="chart">
        <svg viewBox={`0 0 ${c.W} ${c.H}`} width="100%" role="img" aria-label="Projected daily cash balance per store"
             onMouseLeave={() => setHover(null)}>
          {/* danger zone below $0 */}
          {c.yMin < 0 && <rect x={c.padL} y={c.Y(0)} width={c.W - c.padL - c.padR} height={c.Y(c.yMin) - c.Y(0)} className="danger" />}
          {/* gridlines + y labels */}
          {c.yticks.map((v, i) => (
            <g key={i}>
              <line x1={c.padL} x2={c.W - c.padR} y1={c.Y(v)} y2={c.Y(v)} className={v === 0 ? 'zero' : 'grid'} />
              <text x={c.padL - 8} y={c.Y(v) + 3} className="axis" textAnchor="end">{kMoney(v)}</text>
            </g>
          ))}
          {/* x labels */}
          {c.xticks.map((t) => (
            <text key={t.i} x={c.X(t.i)} y={c.H - 8} className="axis" textAnchor="middle">{md(t.d)}</text>
          ))}
          {/* per-store lines + low marker + end label */}
          {stores.map((s) => {
            const pts = s.days.map((d, i) => `${c.X(i)},${c.Y(d.balance)}`).join(' ');
            const li = s.days.findIndex((d) => d.d === s.lowDate);
            return (
              <g key={s.store}>
                <polyline points={pts} fill="none" stroke={VAR[s.store]} strokeWidth={2}
                          strokeLinejoin="round" strokeLinecap="round" />
                {li >= 0 && (
                  <>
                    <circle cx={c.X(li)} cy={c.Y(s.low)} r={4} fill={VAR[s.store]} className="ring" />
                    {s.need > 0 && (
                      <text x={c.X(li)} y={c.Y(s.low) + 15} className="lowlab" textAnchor="middle" fill={VAR[s.store]}>{kMoney(s.low)}</text>
                    )}
                  </>
                )}
                <text x={c.X(c.n - 1) + 6} y={c.Y(s.days[c.n - 1].balance) + 3} className="endlab" fill={VAR[s.store]}>{s.store.slice(0, 3)}</text>
              </g>
            );
          })}
          {/* hover crosshair + dots */}
          {hover !== null && (
            <g>
              <line x1={c.X(hover)} x2={c.X(hover)} y1={c.padT} y2={c.H - c.padB} className="cross" />
              {stores.map((s) => (
                <circle key={s.store} cx={c.X(hover)} cy={c.Y(s.days[hover].balance)} r={3.5} fill={VAR[s.store]} className="ring" />
              ))}
            </g>
          )}
          {/* hover capture */}
          {c.stores[0].days.map((_, i) => (
            <rect key={i} x={c.X(i) - (c.W - c.padL - c.padR) / (c.n - 1) / 2} y={c.padT}
                  width={(c.W - c.padL - c.padR) / (c.n - 1)} height={c.H - c.padT - c.padB}
                  fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (
          <div className="tip">
            <div className="tip-d">{md(stores[0].days[hover].d)}</div>
            {stores.map((s) => (
              <div className="tip-r" key={s.store}>
                <span className="dot sm" style={{ background: VAR[s.store] }} />{s.store}
                <b className={s.days[hover].balance < 0 ? 'neg' : ''}>{money(s.days[hover].balance)}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Funding schedule */}
      <div className="fund">
        <div className="fund-h">Funding needed <span className="muted">— LOC draw / inter-account transfer to stay solvent</span></div>
        {funding.length === 0 ? (
          <p className="ok">All accounts self-fund through the horizon.</p>
        ) : (
          <>
            <table>
              <thead><tr><th>By</th><th>Account</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {funding.map((f) => (
                  <tr key={f.store}><td>{md(f.by)}</td>
                    <td><span className="dot sm" style={{ background: VAR[f.store] }} />{f.store}</td>
                    <td className="r bad">{money(f.need)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td /><td>Total</td><td className="r bad">{money(totalNeed)}</td></tr></tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .fc{--s1:#2a78d6;--s2:#008300;--s3:#e87ba4;--surface:#fcfcfb;--ink:#0b0b0b;--muted:#52514e;--line:#e7e6e2;--danger:#e34948;
          max-width:860px;margin:0 auto;padding:20px 16px 48px;color:var(--ink);font:14px/1.4 -apple-system,system-ui,sans-serif;}
      @media (prefers-color-scheme:dark){.fc{--s1:#3987e5;--s2:#008300;--s3:#d55181;--surface:#1a1a19;--ink:#fff;--muted:#c3c2b7;--line:#33322f;}}
      .fc h1{font-size:20px;margin:0 0 2px;font-weight:650;}
      .muted{color:var(--muted);} .neg{color:var(--danger);}
      .fc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
      .asof{font-size:12px;color:var(--muted);white-space:nowrap;padding-top:4px;}
      .warn{background:#fdecea;color:#9a2b2a;border:1px solid #f3c2bf;border-radius:8px;padding:8px 12px;margin:12px 0;font-size:13px;}
      @media (prefers-color-scheme:dark){.warn{background:#2a1615;color:#f0a6a3;border-color:#5a2321;}}
      .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0;}
      .tile{border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:var(--surface);}
      .tile-top{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;}
      .dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none;} .dot.sm{width:8px;height:8px;margin-right:5px;}
      .pill{margin-left:auto;font-size:10px;background:#fdecea;color:#9a2b2a;padding:1px 6px;border-radius:20px;}
      .tile-cur{font-size:19px;font-weight:650;margin:6px 0 1px;}
      .tile-low{font-size:12px;color:var(--muted);}
      .tile-need{margin-top:7px;font-size:12px;font-weight:600;padding:3px 7px;border-radius:6px;display:inline-block;}
      .tile-need.bad{background:#fdecea;color:#9a2b2a;} .tile-need.ok{background:#e8f4ea;color:#1c6b2c;}
      @media (prefers-color-scheme:dark){.tile-need.bad{background:#2a1615;color:#f0a6a3;}.tile-need.ok{background:#14261a;color:#7fce93;}}
      .chart{position:relative;margin:8px 0 4px;}
      .grid{stroke:var(--line);stroke-width:1;} .zero{stroke:var(--muted);stroke-width:1.25;stroke-dasharray:3 3;}
      .danger{fill:var(--danger);opacity:.07;}
      .axis{fill:var(--muted);font-size:10.5px;} .endlab{font-size:11px;font-weight:700;} .lowlab{font-size:10.5px;font-weight:700;}
      .ring{stroke:var(--surface);stroke-width:1.5;} .cross{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 2;opacity:.6;}
      .tip{position:absolute;top:6px;left:56px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.1);pointer-events:none;}
      .tip-d{font-weight:650;margin-bottom:4px;} .tip-r{display:flex;align-items:center;gap:2px;white-space:nowrap;} .tip-r b{margin-left:8px;}
      .fund{margin-top:18px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--surface);}
      .fund-h{font-weight:650;font-size:14px;margin-bottom:8px;} .ok{color:#1c6b2c;font-weight:600;}
      .fund table{width:100%;border-collapse:collapse;font-size:13px;} .fund th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:3px 4px;border-bottom:1px solid var(--line);}
      .fund td{padding:6px 4px;border-bottom:1px solid var(--line);} .fund tfoot td{font-weight:650;border-bottom:none;} .r{text-align:right;} .bad{color:var(--danger);font-weight:650;}
    `}</style>
  );
}
