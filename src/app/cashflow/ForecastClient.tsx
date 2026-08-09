'use client'
import { useEffect, useMemo, useState } from 'react'

// Per-store cash forecast, rendered in the same design language as the budget tab:
// per-store tabs, a plain-English take, summary tiles, and a weekly table that
// expands to daily detail (week -> days, mirroring budget's bucket -> items).
type Store = string
const COLOR: Record<string, string> = { Margate: '#2a78d6', Miramar: '#00832f', Pines: '#cf5a92' }
const TINT: Record<string, string> = { Margate: '#eaf2fb', Miramar: '#e4f3e9', Pines: '#fbe9f1' }

interface Line { label: string; amt: number; kind: 'in' | 'out'; note: string }
interface Day { d: string; inflow: number; outflow: number; balance: number; lines?: Line[] }
interface StoreF {
  store: Store; balSrc: string; stale: boolean
  start: number; low: number; lowDate: string; end: number
  need: number; needBy: string | null; days: Day[]
  // Checking/savings split behind `start` — a snapshot of TODAY from
  // sk_bills.QbBalance, not part of the day-by-day projection. Genuinely
  // optional: undefined when that table has no row for this store (feed
  // never synced, etc.) — never assume it's there.
  checking?: number; savings?: number
}
interface Payload { ok: boolean; asOf: string | null; stores: StoreF[] }

const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dMoney = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString()
const signMoney = (n: number) => (n >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(n)).toLocaleString()
const monDay = (iso: string) => { const [, m, d] = iso.split('-'); return MON[+m] + ' ' + +d }
const dayNum = (iso: string) => +iso.split('-')[2]
const dowOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] }

interface Wk { i: number; label: string; days: Day[]; inflow: number; outflow: number; net: number; open: number; close: number; low: number; lowDate: string }
function weeksOf(f: StoreF): Wk[] {
  const out: Wk[] = []
  for (let i = 0; i < f.days.length; i += 7) {
    const chunk = f.days.slice(i, i + 7)
    if (!chunk.length) break
    const inflow = chunk.reduce((s, d) => s + d.inflow, 0)
    const outflow = chunk.reduce((s, d) => s + d.outflow, 0)
    const open = out.length ? out[out.length - 1].close : f.start
    const close = chunk[chunk.length - 1].balance
    let low = Infinity, lowDate = ''
    for (const d of chunk) if (d.balance < low) { low = d.balance; lowDate = d.d }
    const a = chunk[0].d, b = chunk[chunk.length - 1].d
    const label = a.slice(5, 7) === b.slice(5, 7) ? `${monDay(a)} – ${dayNum(b)}` : `${monDay(a)} – ${monDay(b)}`
    out.push({ i: out.length, label, days: chunk, inflow, outflow, net: inflow - outflow, open, close, low, lowDate })
  }
  return out
}

export default function ForecastClient() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<Store>('Margate')
  const [openWk, setOpenWk] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetch('/api/forecast', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Payload) => {
        setData(d)
        if (d?.stores?.length && !d.stores.some(s => s.store === 'Margate')) setStore(d.stores[0].store)
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const toggle = (i: number) => setOpenWk(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })

  const sel = useMemo(() => data?.stores?.find(s => s.store === store) ?? data?.stores?.[0] ?? null, [data, store])
  const weeks = useMemo(() => (sel ? weeksOf(sel) : []), [sel])

  if (loading) return <Shell><p className="muted">Loading cash forecast…</p></Shell>
  if (!data?.stores?.length || !sel)
    return <Shell><p className="muted">No forecast yet — run <code>python3 forecast.py --write</code>.</p></Shell>

  const stores = data.stores
  const totalIn = sel.days.reduce((s, d) => s + d.inflow, 0)
  const totalOut = sel.days.reduce((s, d) => s + d.outflow, 0)
  const n = sel.days.length
  const staleStores = stores.filter(s => s.stale)
  const funding = stores.filter(s => s.need > 0)
    .map(s => ({ store: s.store, need: s.need, by: s.needBy! }))
    .sort((a, b) => a.by.localeCompare(b.by) || b.need - a.need)
  const totalNeed = funding.reduce((s, f) => s + f.need, 0)

  const take = sel.need > 0
    ? `${sel.store} has ${dMoney(sel.start)} in the bank today and, on the current pace, dips to ${dMoney(sel.low)} on ${monDay(sel.lowDate)} — move ${dMoney(sel.need)} in before then to stay above zero.`
    : `${sel.store} has ${dMoney(sel.start)} today and stays positive the whole ${n} days — the tightest it gets is ${dMoney(sel.low)} on ${monDay(sel.lowDate)}. It self-funds.`

  // Breakdown only when the sync actually gave us both parts — a store with
  // checking but no savings account (e.g. Pines) still has a real, non-zero
  // split worth showing; a store with neither should fall back to the plain
  // "live bank balance" label rather than print "checking $0 · savings $0".
  const hasSplit = sel.checking != null && sel.savings != null
  const bankSub = sel.stale
    ? 'bank feed stale'
    : hasSplit
      ? `checking ${dMoney(sel.checking!)} · savings ${dMoney(sel.savings!)}`
      : 'live bank balance'

  const tiles = [
    { nm: 'In the bank now', v: dMoney(sel.start), cls: '', sub: bankSub },
    { nm: 'Lowest point', v: dMoney(sel.low), cls: sel.low < 0 ? 'crit' : 'good', sub: monDay(sel.lowDate) },
    { nm: `Money in · ${n}d`, v: dMoney(totalIn), cls: '', sub: 'card + cash + delivery' },
    { nm: `Money out · ${n}d`, v: dMoney(totalOut), cls: '', sub: 'payroll + bills + food' },
  ]

  return (
    <Shell store={sel.store}>
      <header className="fin-head">
        <div>
          <div className="eyebrow">SK Wellness · cash forecast</div>
          <h1>Cash Flow</h1>
          <div className="sub">What each account&apos;s bank balance does over the next {n} days — click a week to see the days.</div>
        </div>
        <div className="tabs" role="tablist">
          {stores.map(s => (
            <button key={s.store} role="tab" aria-selected={s.store === store} className="tab" onClick={() => setStore(s.store)}>
              <span className="dot" style={{ background: COLOR[s.store] ?? '#888' }} />{s.store}
              {s.need > 0 ? <span className="tabneed">fund</span> : null}
            </button>
          ))}
        </div>
      </header>

      {staleStores.length > 0 && (
        <div className="warn">⚠ Stale bank feed: {staleStores.map(s => s.store).join(', ')} — check the OpenBudget connection in Settings before trusting these numbers.</div>
      )}

      <div className="take">
        <span className={'pill ' + (sel.need > 0 ? 'crit' : 'good')}>{sel.need > 0 ? 'Needs funding' : 'Self-funds'}</span>
        <div><span className="big">{take}</span>{data.asOf ? <span className="lede"> As of {monDay(data.asOf)}.</span> : null}</div>
      </div>

      <div className="tiles">
        {tiles.map(t => (
          <div className="tile" key={t.nm}>
            <div className="tnm">{t.nm}</div>
            <div className={'tval ' + t.cls}>{t.v}</div>
            <div className="tsub">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="cap">
          <div className="t">Weekly cash <span className="tag">this account · click a week to expand its days</span></div>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rowlab">Week</th>
                <th>Opening</th><th>Money in</th><th>Money out</th><th>Net</th>
                <th>Ending balance</th><th>Low</th>
              </tr>
            </thead>
            <tbody>
              <tr className="now">
                <td className="rowlab">Now <span className="tag">{data.asOf ? monDay(data.asOf) : ''}</span></td>
                <td /><td /><td /><td />
                <td className="cell"><span className="bal">{dMoney(sel.start)}</span></td>
                <td />
              </tr>
              {weeks.map(w => (
                <WeekRows key={w.i} w={w} open={openWk.has(w.i)} dips={w.low < 0} toggle={toggle} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="rowlab">Over the {n} days</td>
                <td className="cell"><span className="mv muted">{dMoney(sel.start)}</span></td>
                <td className="cell"><span className="mv">{dMoney(totalIn)}</span></td>
                <td className="cell"><span className="mv">{dMoney(totalOut)}</span></td>
                <td className="cell"><span className={'mv ' + (totalIn - totalOut >= 0 ? 'pos' : 'neg')}>{signMoney(totalIn - totalOut)}</span></td>
                <td className="cell"><span className={'bal ' + (sel.end < 0 ? 'neg' : '')}>{dMoney(sel.end)}</span></td>
                <td className="cell"><span className={'mv ' + (sel.low < 0 ? 'neg' : 'muted')}>{dMoney(sel.low)}</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="cap"><div className="t">Funding needed <span className="tag">LOC draw or inter-account transfer to hold each account above $0</span></div></div>
        <div className="fundbody">
          {funding.length === 0 ? (
            <p className="allgood">✓ All accounts self-fund through the horizon — no transfers needed.</p>
          ) : (
            <table className="fund">
              <thead><tr><th className="rowlab">By</th><th className="rowlab">Account</th><th>Amount</th></tr></thead>
              <tbody>
                {funding.map(f => (
                  <tr key={f.store}>
                    <td className="rowlab">{monDay(f.by)}</td>
                    <td className="rowlab"><span className="dot" style={{ background: COLOR[f.store] ?? '#888' }} />{f.store}</td>
                    <td className="cell"><span className="mv neg">{dMoney(f.need)}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td className="rowlab" /><td className="rowlab">Total to move</td><td className="cell"><span className="mv neg">{dMoney(totalNeed)}</span></td></tr></tfoot>
            </table>
          )}
        </div>
      </div>

      <div className="foot">
        <b>Reading it:</b> expand a week to see its days, and each day lists what its money actually <i>is</i> — with the event that produced it, because almost nothing originates on the day it moves. Each week rolls the days up into one line — <i>opening</i> balance, <i>money in</i>, <i>money out</i>, and the <i>ending balance</i> the account lands at. Click a week to see the day-by-day register; the <b>Low</b> column flags the tightest point, and a red edge marks a week that dips below $0.{' '}
        <b>Money in</b> = card deposits (T+2, daily), cash (same day), and 3rd-party delivery (≈73% net, paid weekly). <b>Money out</b> = payroll on payday, fixed bills on their day of the month (rent → 1st, debt → 4–5th, franchise → ~16th/23rd, sales tax → 16th), and food (PFG net-7, Walmart same-day).{' '}
        <b>Balances</b> are anchored on the live bank balance (OpenBudget), not QuickBooks book value.{' '}
        <b>Funding</b> sizes the smallest transfer that keeps each account above $0 — accounts are separate, so a store that dips needs its own cash even if another is flush.
      </div>
    </Shell>
  )
}

function WeekRows({ w, open, dips, toggle }: { w: Wk; open: boolean; dips: boolean; toggle: (i: number) => void }) {
  const rows: React.ReactNode[] = []
  rows.push(
    <tr key={'w' + w.i} className={'wk' + (open ? ' open' : '') + (dips ? ' dips' : '')} onClick={() => toggle(w.i)}>
      <td className="rowlab"><span className="wklab"><span className="caret">▸</span>{w.label}</span></td>
      <td className="cell"><span className="mv muted">{dMoney(w.open)}</span></td>
      <td className="cell"><span className="mv">{dMoney(w.inflow)}</span></td>
      <td className="cell"><span className="mv">{dMoney(w.outflow)}</span></td>
      <td className="cell"><span className={'mv ' + (w.net >= 0 ? 'pos' : 'neg')}>{signMoney(w.net)}</span></td>
      <td className="cell"><span className={'bal ' + (w.close < 0 ? 'neg' : '')}>{dMoney(w.close)}</span></td>
      <td className="cell"><span className={'mv ' + (w.low < 0 ? 'neg' : 'muted')}>{dMoney(w.low)}</span></td>
    </tr>
  )
  if (open) {
    w.days.forEach((d, di) => {
      const big = d.outflow > 1500
      rows.push(
        <tr key={'w' + w.i + 'd' + di} className={'day' + (d.balance < 0 ? ' neg' : '')}>
          <td className="rowlab"><span className="dlab">{dowOf(d.d)} {monDay(d.d)}</span></td>
          <td className="cell" />
          <td className="cell"><span className={'dv' + (d.inflow > 0 ? '' : ' z')}>{d.inflow > 0 ? dMoney(d.inflow) : '—'}</span></td>
          <td className="cell"><span className={'dv' + (d.outflow > 0 ? '' : ' z') + (big ? ' big' : '')}>{d.outflow > 0 ? dMoney(d.outflow) : '—'}</span></td>
          <td className="cell" />
          <td className="cell"><span className={'dv bal' + (d.balance < 0 ? ' neg' : '')}>{dMoney(d.balance)}</span></td>
          <td className="cell" />
        </tr>
      )
      // What the day's money actually IS. Almost nothing originates on the day it
      // moves — card money is sales from two days back, food is a week-old invoice,
      // payroll is a pay period that already closed — so each line names its source.
      for (const [li, ln] of (d.lines ?? []).entries()) {
        rows.push(
          <tr key={'w' + w.i + 'd' + di + 'l' + li} className="line">
            <td className="rowlab"><span className="lnlab">{ln.label}</span></td>
            <td className="cell lnnote">{ln.note}</td>
            <td className="cell">{ln.kind === 'in' && <span className="lnamt in">{dMoney(ln.amt)}</span>}</td>
            <td className="cell">{ln.kind === 'out' && <span className="lnamt out">{dMoney(ln.amt)}</span>}</td>
            <td className="cell" /><td className="cell" /><td className="cell" />
          </tr>
        )
      }
    })
  }
  return <>{rows}</>
}

function Shell({ children, store }: { children: React.ReactNode; store?: string }) {
  return (
    <div className="fin" style={store ? { ['--store' as string]: COLOR[store] ?? '#2a78d6', ['--store-tint' as string]: TINT[store] ?? '#eaf2fb' } : undefined}>
      {children}
      <Style />
    </div>
  )
}

function Style() {
  return (
    <style>{`
    .fin{--bg:#f3f5f8;--surface:#fff;--elev:#f9fbfe;--ink:#182231;--muted:#586376;--faint:#8a95a6;--line:#e5e9ef;--line2:#eef1f5;
      --good:#137a4c;--good-bg:#e5f3ea;--crit:#c5352f;--crit-bg:#fbe6e5;--pos:#137a4c;--neg:#c5352f;
      --store:#2a78d6;--store-tint:#eaf2fb;--shadow:0 1px 2px rgba(24,34,49,.05),0 8px 22px rgba(24,34,49,.06);
      background:var(--bg);color:var(--ink);min-height:100vh;padding:24px 20px 60px;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;}
.fin *{box-sizing:border-box;}.fin table{font-variant-numeric:tabular-nums;}.fin .mv, .fin .bal, .fin .tval, .fin .dv{font-variant-numeric:tabular-nums;}
.fin .muted{color:var(--muted);}.fin code{background:var(--elev);padding:1px 5px;border-radius:4px;font-size:12px;}
.fin .eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:10.5px;font-weight:700;color:var(--faint);}
.fin-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px;max-width:1080px;}
.fin h1{font-size:21px;font-weight:680;margin:2px 0 3px;letter-spacing:-.01em;}.fin .sub{color:var(--muted);font-size:13px;max-width:52ch;}
.fin .tabs{display:flex;gap:6px;}.fin .tab{border:1px solid var(--line);background:var(--surface);color:var(--muted);font:600 13px/1 inherit;padding:9px 14px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:8px;}
.fin .tab:hover{color:var(--ink);}.fin .tab .dot{width:9px;height:9px;border-radius:50%;}.fin .tab[aria-selected="true"]{color:var(--ink);border-color:var(--store);background:var(--store-tint);box-shadow:inset 0 -2px 0 var(--store);}
.fin .tabneed{font-size:9px;font-weight:800;color:var(--crit);background:var(--crit-bg);padding:1px 5px;border-radius:9px;letter-spacing:.03em;text-transform:uppercase;}
.fin .warn{background:var(--crit-bg);color:var(--crit);border:1px solid var(--crit);border-radius:9px;padding:9px 13px;margin:0 0 14px;font-size:13px;max-width:1080px;}
.fin .take{display:flex;align-items:center;gap:12px;margin:0 0 20px;padding:13px 16px;border-radius:11px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--store);box-shadow:var(--shadow);max-width:1080px;flex-wrap:wrap;}
.fin .take .big{font-weight:600;}.fin .take .lede{color:var(--muted);}
.fin .pill{font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap;}.fin .pill.good{background:var(--good-bg);color:var(--good);}.fin .pill.crit{background:var(--crit-bg);color:var(--crit);}
.fin .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;max-width:1080px;}
.fin .tile{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:13px 15px 14px;box-shadow:var(--shadow);}
.fin .tnm{font-size:11.5px;font-weight:640;color:var(--muted);margin-bottom:5px;}
.fin .tval{font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1;}.fin .tval.pos{color:var(--pos);}.fin .tval.neg{color:var(--neg);}.fin .tval.good{color:var(--good);}.fin .tval.crit{color:var(--crit);}
.fin .tsub{font-size:11px;color:var(--faint);margin-top:5px;}
.fin .card{background:var(--surface);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow);overflow:hidden;margin-bottom:22px;max-width:1080px;padding:0;}
.fin .cap{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 16px 11px;border-bottom:1px solid var(--line2);flex-wrap:wrap;}.fin .cap .t{font-weight:660;font-size:14px;}.fin .tag{font-size:9.5px;color:var(--faint);font-weight:600;margin-left:6px;text-transform:none;letter-spacing:0;}
.fin .scroll{overflow-x:auto;}.fin table{border-collapse:collapse;width:100%;min-width:720px;}.fin th, .fin td{text-align:right;padding:0;}
.fin thead th{position:sticky;top:0;background:var(--surface);z-index:1;padding:9px 14px 8px;border-bottom:1px solid var(--line);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);white-space:nowrap;}
.fin .rowlab{position:sticky;left:0;background:var(--surface);text-align:left;font-weight:600;white-space:nowrap;border-right:1px solid var(--line);min-width:150px;z-index:2;}
.fin thead .rowlab{z-index:3;}
.fin td.cell{padding:9px 14px;border-top:1px solid var(--line2);}.fin .mv{font-weight:600;font-size:13px;}.fin .mv.pos{color:var(--pos);}.fin .mv.neg{color:var(--neg);}.fin .mv.muted{color:var(--muted);font-weight:500;}
.fin .bal{font-weight:750;font-size:14px;}.fin .bal.neg{color:var(--neg);}
.fin tr.now .rowlab{padding:9px 14px;border-top:none;}.fin tr.now td.cell{border-top:none;}
.fin tr.wk{cursor:pointer;}.fin tr.wk:hover .rowlab, .fin tr.wk:hover td{background:var(--elev);}.fin tr.wk .rowlab{padding:11px 14px;border-top:1px solid var(--line);}.fin tr.wk td.cell{border-top:1px solid var(--line);}
.fin .wklab{display:flex;align-items:center;gap:8px;}.fin .caret{width:12px;color:var(--faint);font-size:10px;display:inline-block;transition:transform .12s;}.fin tr.wk.open .caret{transform:rotate(90deg);}
.fin tr.wk.dips .rowlab{box-shadow:inset 3px 0 0 var(--crit);}
.fin tr.day{background:var(--elev);}.fin tr.day .rowlab{background:var(--elev);font-weight:500;color:var(--muted);padding:5px 14px 5px 30px;font-size:12px;border-top:1px solid var(--line2);}
.fin tr.day td.cell{padding:5px 14px;border-top:1px solid var(--line2);}.fin .dv{font-size:12px;font-weight:500;color:var(--muted);}.fin .dv.pos{color:var(--pos);}.fin .dv.neg{color:var(--neg);}.fin .dv.big{font-weight:700;}.fin .dv.z{color:var(--faint);}.fin .dv.bal{font-weight:650;color:var(--ink);}
.fin tr.day.neg .rowlab, .fin tr.day.neg .dv.bal{color:var(--neg);}
    .fin tr.line td{border-top:none;background:var(--elev);padding:1px 14px;}
    .fin tr.line .rowlab{background:var(--elev);border-top:none;padding:1px 14px 1px 44px;font-weight:400;font-size:11.5px;color:var(--muted);}
    .fin tr.line:last-child td{padding-bottom:7px;}
    .fin .lnnote{text-align:left;font-size:11px;color:var(--faint);white-space:nowrap;}
    .fin .lnamt{font-size:11.5px;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums;}
.fin tfoot td{border-top:2px solid var(--line);background:var(--elev);}.fin tfoot .rowlab{background:var(--elev);padding:11px 14px;font-weight:700;}.fin tfoot .cell{padding:11px 14px;}
.fin .fundbody{padding:6px 16px 14px;}.fin .allgood{color:var(--good);font-weight:600;padding:8px 0;}
.fin table.fund{min-width:0;}.fin table.fund thead th{position:static;text-transform:none;letter-spacing:0;font-size:11px;}.fin table.fund .rowlab{min-width:0;position:static;border-right:none;padding:8px 14px 8px 0;display:flex;align-items:center;gap:7px;}.fin table.fund .dot{width:9px;height:9px;border-radius:50%;display:inline-block;}.fin table.fund td.cell{padding:8px 0;border-top:1px solid var(--line2);}
.fin .foot{color:var(--faint);font-size:11.5px;margin-top:14px;line-height:1.65;max-width:1080px;}.fin .foot b{color:var(--muted);font-weight:640;}
    @media (max-width:760px){.fin .tiles{grid-template-columns:repeat(2,1fr);}}
    `}</style>
  )
}
