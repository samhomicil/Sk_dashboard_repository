'use client'
import { useEffect, useMemo, useState } from 'react'

interface Layer { a: number; c: number; f: number }
interface Item extends Layer { name: string; context?: boolean }
interface Bucket { key: string; variable?: boolean; passthrough?: boolean; plan?: number; items: Item[] }
interface Week { wk: string; phase: 'history' | 'current' | 'forecast'; sales: Layer; buckets: Bucket[]; foodPct: number; laborPct: number; primePct: number; foodPurch: number }
interface StoreData { store: string; weeks: Week[] }
interface Payload {
  asOf: string; current: string
  target: { food: number; labor: number; prime: number; primeLoaded: number }
  bucketOrder: string[]; variable: string[]; stores: StoreData[]
}

const COLOR: Record<string, string> = { Margate: '#2a78d6', Miramar: '#00832f', Pines: '#cf5a92' }
const TINT: Record<string, string> = { Margate: '#eaf2fb', Miramar: '#e4f3e9', Pines: '#fbe9f1' }
const BUCKET_LABEL: Record<string, string> = {
  Food: 'Food', Labor: 'Labor', Management: 'Management salary', Franchise: 'Franchise & corporate', Occupancy: 'Rent / occupancy',
  Debt: 'Debt service', Utilities: 'Utilities', Insurance: 'Insurance', Operating: 'Operating & admin', 'Sales tax': 'Sales tax',
}
const SLAB: Record<string, string> = { good: 'On plan', warn: 'Watch', crit: 'Over' }

const kMoney = (n: number) => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1000 ? s + '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : s + '$' + Math.round(a) }
const dMoney = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString()
const pct = (n: number) => (n * 100).toFixed(1) + '%'
const wkLabel = (wk: string) => { const p = wk.split('-'); return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1]] + ' ' + (+p[2]) }
const sumL = (items: Layer[]): Layer => items.reduce((o, i) => ({ a: o.a + i.a, c: o.c + i.c, f: o.f + i.f }), { a: 0, c: 0, f: 0 })
const tot = (l: Layer) => l.a + l.c + l.f
const status = (v: number, t: number) => v <= t + 0.0005 ? 'good' : v <= t + 0.02 ? 'warn' : 'crit'

export default function BudgetView() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState('Pines')
  const [openBk, setOpenBk] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/budget', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Payload) => {
        setData(d)
        if (d?.stores?.length && !d.stores.some(s => s.store === 'Pines')) setStore(d.stores[0].store)
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const toggle = (k: string) => setOpenBk(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const view = useMemo(() => {
    if (!data?.stores?.length) return null
    const sd = data.stores.find(s => s.store === store) ?? data.stores[0]
    const W = sd.weeks
    const cur = W.find(w => w.phase === 'current') ?? W[Math.min(3, W.length - 1)]
    const idx = W.indexOf(cur)
    const win = W.slice(Math.max(0, idx - 3), idx + 1)
    // Cost sums exclude `context` items (cash purchases shown for reference only).
    const costItems = (items: Item[]) => items.filter(i => !i.context)
    const foodOf = (w: Week) => tot(sumL(costItems(w.buckets.find(b => b.key === 'Food')!.items)))
    const food4 = win.reduce((a, w) => a + foodOf(w), 0) / (win.reduce((a, w) => a + tot(w.sales), 0) || 1)
    const opCostOf = (w: Week) => tot(sumL(w.buckets.filter(b => b.key !== 'Sales tax').flatMap(b => costItems(b.items))))
    // Flexible budget (plan) = sum of each non-tax bucket's plan (levers at target %
    // of this week's sales; fixed buckets at run-rate). Variance isolates food+labor.
    const planCostOf = (w: Week) => w.buckets.filter(b => b.key !== 'Sales tax').reduce((a, b) => a + (b.plan ?? tot(sumL(costItems(b.items)))), 0)
    return { W, cur, food4, opCostOf, planCostOf }
  }, [data, store])

  if (loading) return <Shell><p className="muted">Loading budget…</p></Shell>
  if (!data?.stores?.length || !view) return <Shell><p className="muted">No budget data yet — run the refresh or check the connection.</p></Shell>

  const { W, cur, food4, opCostOf, planCostOf } = view
  const T = data.target
  const opCost = opCostOf(cur)
  const net = tot(cur.sales) - opCost
  const takeSt = status(food4, T.food)
  const prime = cur.primePct                       // fully-loaded: recipe COGS + loaded labor + mgmt

  // Budget (plan) vs actual for the current week. Food is recipe COGS (stable, not
  // lumpy), so no pacing is needed. Variance = actual − plan; over budget is bad:
  // on/under = good, up to +3% = watch, beyond = over.
  const planCost = planCostOf(cur)
  const opCostPaced = opCost
  const variance = opCostPaced - planCost
  const varPct = planCost > 0 ? variance / planCost : 0
  const budgetSt = variance <= planCost * 0.005 ? 'good' : varPct <= 0.03 ? 'warn' : 'crit'
  const budgetWord = variance <= planCost * 0.005 ? (variance < -planCost * 0.005 ? 'Under budget' : 'On budget') : 'Over budget'

  const dials = [
    { nm: 'Prime cost', v: prime, t: T.primeLoaded, sc: 0.85, sub: `recipe COGS + loaded labor · tgt ${pct(T.primeLoaded)}`, hero: true },
    { nm: 'Food', v: cur.foodPct, t: T.food, sc: 0.45, sub: `recipe · 4-wk ${pct(food4)} · bought ${kMoney(cur.foodPurch)}`, hero: false },
    { nm: 'Labor', v: cur.laborPct, t: T.labor, sc: 0.45, sub: `hourly wages · tgt ${pct(T.labor)}`, hero: false },
  ]
  const nets = W.map(w => tot(w.sales) - opCostOf(w))
  const maxNet = Math.max(...nets.map(Math.abs)) || 1
  const curCol = (w: Week) => w.phase === 'current'

  return (
    <Shell store={store}>
      <header className="fin-head">
        <div>
          <div className="eyebrow">SK Wellness · full weekly budget</div>
          <h1>Weekly Cost Cockpit</h1>
          <div className="sub">Every dollar out — click any bucket to drill into the line items.</div>
        </div>
        <div className="tabs" role="tablist">
          {data.stores.map(s => (
            <button key={s.store} role="tab" aria-selected={s.store === store} className="tab" onClick={() => setStore(s.store)}>
              <span className="dot" style={{ background: COLOR[s.store] }} />{s.store}
            </button>
          ))}
        </div>
      </header>

      <div className="take">
        <span className={'pill ' + budgetSt}>{budgetWord}</span>
        <div>
          <span className="big">{store}: {dMoney(opCostPaced)} projected spend vs {dMoney(planCost)} budget this week — {variance >= 0 ? 'over by ' : 'under by '}{dMoney(Math.abs(variance))}.</span>{' '}
          <span className="lede">{Math.abs(variance) < planCost * 0.01
            ? `On plan. Food ${pct(cur.foodPct)} (tgt ${pct(T.food)}), labor ${pct(cur.laborPct)} (tgt ${pct(T.labor)}).`
            : `Driven by ${cur.foodPct > T.food ? 'food' : ''}${cur.foodPct > T.food && cur.laborPct > T.labor ? ' & ' : ''}${cur.laborPct > T.labor ? 'labor' : ''}${cur.foodPct <= T.food && cur.laborPct <= T.labor ? 'the variable buckets' : ' over target'} — food ${pct(cur.foodPct)} vs ${pct(T.food)}, labor ${pct(cur.laborPct)} vs ${pct(T.labor)}. Net ${dMoney(net)}.`}</span>
        </div>
      </div>

      <div className="dials">
        {dials.map(d => {
          const s = status(d.v, d.t), fw = Math.min(100, d.v / d.sc * 100), tl = d.t / d.sc * 100
          return (
            <div className={'dial' + (d.hero ? ' hero' : '')} key={d.nm}>
              <div className="dh"><span className="nm">{d.nm}</span><span className={'pill ' + s}>{SLAB[s]}</span></div>
              <div className={'val ' + s}>{pct(d.v)}</div>
              <div className="meta">{d.sub}</div>
              <div className="meter"><div className={'fill ' + s} style={{ width: fw + '%' }} /><div className="tick" style={{ left: tl + '%' }} /><div className="ticklab" style={{ left: tl + '%' }}>tgt {(d.t * 100).toFixed(0)}%</div></div>
            </div>
          )
        })}
        <div className="dial">
          <div className="dh"><span className="nm">vs Budget</span><span className={'pill ' + budgetSt}>{budgetWord}</span></div>
          <div className={'val ' + (variance > planCost * 0.005 ? 'crit' : 'good')}>{variance >= 0 ? '+' : '−'}{kMoney(Math.abs(variance))}</div>
          <div className="meta">budget {kMoney(planCost)} · pace {kMoney(opCostPaced)}</div>
          <div className="meter"><div className={'fill ' + budgetSt} style={{ width: Math.min(100, 50 + varPct * 600) + '%' }} /><div className="tick" style={{ left: '50%' }} /><div className="ticklab" style={{ left: '50%' }}>budget</div></div>
        </div>
      </div>

      <div className="card">
        <div className="cap">
          <div className="t">Weekly budget <span className="tag">this week highlighted · click a row to expand</span></div>
          <div className="legend">
            <span className="lg"><span className="sw" />Actual</span>
            <span className="lg"><span className="sw c" />Committed</span>
            <span className="lg"><span className="sw f" />Forecast</span>
          </div>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr><th className="rowlab">Line</th>{W.map(w => (
                <th key={w.wk} className={'wkh' + (curCol(w) ? ' cur cur-col' : '') + (w.phase === 'history' ? ' hist' : '')}>
                  <div className="wd">{wkLabel(w.wk)}</div>
                  <div className="ph">{w.phase === 'current' ? 'This week' : w.phase === 'history' ? 'actual' : 'forecast'}</div>
                </th>))}</tr>
            </thead>
            <tbody>
              <tr className="sum"><td className="rowlab">Net sales</td>{W.map(w => (
                <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}><span className="sumv">{kMoney(tot(w.sales))}</span><Cert l={w.sales} /></td>))}</tr>

              {data.bucketOrder.map(key => {
                const open = openBk.has(key)
                const isPass = key === 'Sales tax'
                const variable = data.variable.includes(key)
                const items = W[0].buckets.find(b => b.key === key)?.items ?? []
                return (
                  <BucketRows key={key} bucketKey={key} open={open} isPass={isPass} variable={variable}
                    W={W} items={items} toggle={toggle} curCol={curCol} target={T} />
                )
              })}

              <tr className="sum"><td className="rowlab">Total operating cost <span className="tag">excl. sales tax</span></td>{W.map(w => (
                <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}><span className="sumv">{kMoney(opCostOf(w))}</span></td>))}</tr>
              <tr className="plan"><td className="rowlab">Weekly budget <span className="tag">food 25% · labor 22% · fixed run-rate</span></td>{W.map(w => (
                <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}><span className="planv">{kMoney(planCostOf(w))}</span></td>))}</tr>
              <tr className="net"><td className="rowlab">Over / under budget</td>{W.map(w => {
                const v = opCostOf(w) - planCostOf(w)
                return <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}><span className={'netv ' + (v > planCostOf(w) * 0.005 ? 'neg' : 'pos')}>{v >= 0 ? '+' : '−'}{kMoney(Math.abs(v))}</span></td>})}</tr>
              <tr className="net"><td className="rowlab">Net operating cash</td>{W.map((w, i) => (
                <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}><span className={'netv ' + (nets[i] >= 0 ? 'pos' : 'neg')}>{kMoney(nets[i])}</span></td>))}</tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="cap"><div className="t">Net weekly cash <span className="tag">sales − all operating cost</span></div></div>
        <div className="stripwrap">
          <div className="strip">
            {W.map((w, i) => {
              const nv = nets[i], h = Math.max(3, Math.abs(nv) / maxNet * 40)
              return (
                <div className={'bar' + (curCol(w) ? ' cur' : '')} key={w.wk}>
                  <div className="amt">{kMoney(nv)}</div>
                  <div className="track"><div className={'col ' + (nv >= 0 ? 'pos' : 'neg')} style={{ height: h + 'px', [nv >= 0 ? 'marginBottom' : 'marginTop']: 'auto' } as React.CSSProperties} /></div>
                  <div className="wl">{wkLabel(w.wk)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="foot">
        <b>Prime cost</b> (hero) = recipe COGS + fully-loaded labor (wages + payroll burden + management), the number a franchise operator runs on. <b>Food</b> is <i>recipe COGS</i> — theoretical usage from NetChef ÷ sales vs 25%, the same basis as Weekly Ops — so it&apos;s stable and comparable; the PFG/Walmart <i>purchase</i> lines ride along in italics as cash-restock reference and are <i>not</i> counted in cost (that cash lives in the bill forecast).{' '}
        <b>Weekly budget</b> = the flexible plan: food at 25% and labor at 22% of <i>this week&apos;s</i> sales (same targets as Weekly Ops &amp; the daily recap), franchise at contract rate, every fixed cost at its run-rate. <b>Over / under</b> is actual − budget, so the variance is really food + labor — the two levers a manager controls.{' '}
        <b>Certainty:</b> solid = incurred · mid = committed (scheduled labor, received invoices, dated bills) · hatched = forecast.{' '}
        <b>Cash timing</b> — fixed costs shown as an even weekly run-rate; in cash they land lumpy (rent day 1, debt 4–5, royalty &amp; national ad fund ~the 16th on the just-closed 4-week period, regional ad fund month-end, tech fee ~the 23rd, sales tax day 16, payroll on payday).{' '}
        <b>Debt</b> includes loan principal — most of the weekly deficit is principal paydown funded by the LOC.{' '}
        Labor % is unloaded hourly wages (reconciles with the sales dashboard). <b>Payroll taxes &amp; WC</b> is the real employer burden — FICA 7.65% + FUTA/FL-SUI on each employee&apos;s first $7k + WC 2.2% (ADP-reconciled), so the rate shifts by store and season as caps fill; it also carries the tax on the 85% of CC tips run through payroll (the tip payout itself is customer money, offset by the card deposit, so it isn&apos;t booked as a cost). Management salary is allocated to the entities that actually pay it (Miramar &amp; Pines ADP, ~$695/wk each); Margate shows $0 — the manager works there but his comp is bundled through the other two stores&apos; payroll. Merchant fees estimated.
      </div>
    </Shell>
  )
}

function Cert({ l }: { l: Layer }) {
  const t = tot(l)
  if (t < 1) return null
  const seg = (cls: string, v: number) => v > 0 ? <i className={cls} style={{ flex: v }} /> : null
  return <div className="cert">{seg('a', l.a)}{seg('c', l.c)}{seg('f', l.f)}</div>
}

function BucketRows({ bucketKey, open, isPass, variable, W, items, toggle, curCol, target }: {
  bucketKey: string; open: boolean; isPass: boolean; variable: boolean; W: Week[]
  items: Item[]; toggle: (k: string) => void; curCol: (w: Week) => boolean; target: Payload['target']
}) {
  const rows: React.ReactNode[] = []
  rows.push(
    <tr key={bucketKey} className={'bk' + (open ? ' open' : '') + (isPass ? ' pass' : '')} onClick={() => !isPass && toggle(bucketKey)}>
      <td className="rowlab"><span className="bklab">
        {!isPass && <span className="caret">▸</span>}
        <span className="bkname">{BUCKET_LABEL[bucketKey]}</span>
        {variable && <span className="var-tag">lever</span>}
        {isPass && <span className="tag">pass-through · day 16</span>}
      </span></td>
      {W.map(w => {
        const b = w.buckets.find(x => x.key === bucketKey)!
        const l = sumL(b.items.filter(i => !i.context))   // cost total excludes cash-context lines
        const z = tot(l) < 1
        let sub: React.ReactNode = null
        if (bucketKey === 'Food') { const p = w.foodPct; sub = <div className={'subpct ' + status(p, target.food)}>{pct(p)}</div> }
        if (bucketKey === 'Labor') { const p = w.laborPct; sub = <div className={'subpct ' + status(p, target.labor)}>{pct(p)}</div> }
        return (
          <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}>
            <span className={'mval' + (z ? ' zz' : '')}>{z ? '—' : kMoney(tot(l))}</span>{sub}{!z && !isPass && <Cert l={l} />}
          </td>
        )
      })}
    </tr>
  )
  if (open) {
    items.forEach((it0, ii) => {
      const ctx = !!it0.context
      rows.push(
        <tr key={bucketKey + '-' + ii} className={'item' + (ctx ? ' ctx' : '')}>
          <td className="rowlab">{items[ii].name}{ctx && <span className="tag"> not in cost</span>}</td>
          {W.map(w => {
            const it = w.buckets.find(x => x.key === bucketKey)!.items[ii]
            const l = { a: it.a, c: it.c, f: it.f }
            const z = tot(l) < 1
            return <td key={w.wk} className={'cell' + (curCol(w) ? ' cur-col' : '')}><span className={'mval' + (z ? ' zz' : '')}>{z ? '—' : kMoney(tot(l))}</span></td>
          })}
        </tr>
      )
    })
  }
  return <>{rows}</>
}

function Shell({ children, store }: { children: React.ReactNode; store?: string }) {
  return (
    <div className="fin" style={store ? { ['--store' as string]: COLOR[store], ['--store-tint' as string]: TINT[store] } : undefined}>
      {children}
      <Style />
    </div>
  )
}

function Style() {
  return (
    <style>{`
    .fin{--bg:#f3f5f8;--surface:#fff;--elev:#f9fbfe;--ink:#182231;--muted:#586376;--faint:#8a95a6;--line:#e5e9ef;--line2:#eef1f5;
      --good:#137a4c;--good-bg:#e5f3ea;--warn:#b9770e;--warn-bg:#fbf1de;--crit:#c5352f;--crit-bg:#fbe6e5;--pos:#137a4c;--neg:#c5352f;
      --cert:#465468;--store:#2a78d6;--store-tint:#eaf2fb;--shadow:0 1px 2px rgba(24,34,49,.05),0 8px 22px rgba(24,34,49,.06);
      background:var(--bg);color:var(--ink);min-height:100vh;padding:24px 20px 60px;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;}
    .fin *{box-sizing:border-box;} .fin table{font-variant-numeric:tabular-nums;} .fin .val,.mval,.sumv,.netv,.amt,.wd,.subpct{font-variant-numeric:tabular-nums;}
    .fin .muted{color:var(--muted);} .eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:10.5px;font-weight:700;color:var(--faint);}
    .fin-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px;max-width:1080px;}
    .fin h1{font-size:21px;font-weight:680;margin:2px 0 3px;letter-spacing:-.01em;} .fin .sub{color:var(--muted);font-size:13px;}
    .tabs{display:flex;gap:6px;} .tab{border:1px solid var(--line);background:var(--surface);color:var(--muted);font:600 13px/1 inherit;padding:9px 15px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:8px;}
    .tab:hover{color:var(--ink);} .tab .dot{width:9px;height:9px;border-radius:50%;} .tab[aria-selected="true"]{color:var(--ink);border-color:var(--store);background:var(--store-tint);box-shadow:inset 0 -2px 0 var(--store);}
    .take{display:flex;align-items:center;gap:12px;margin:14px 0 20px;padding:12px 15px;border-radius:11px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--store);box-shadow:var(--shadow);max-width:1080px;flex-wrap:wrap;}
    .take .big{font-weight:680;} .take .lede{color:var(--muted);font-size:13px;}
    .pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;} .pill.good{background:var(--good-bg);color:var(--good);} .pill.warn{background:var(--warn-bg);color:var(--warn);} .pill.crit{background:var(--crit-bg);color:var(--crit);}
    .dials{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;max-width:1080px;}
    .dial{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:13px 15px 14px;box-shadow:var(--shadow);}
    .dial.hero{border:1px solid var(--store);box-shadow:inset 0 0 0 1px var(--store),var(--shadow);background:linear-gradient(180deg,var(--store-tint),var(--surface) 60%);}
    .dial.hero .nm{font-size:13.5px;font-weight:700;} .dial.hero .val{font-size:32px;}
    .dial .dh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;} .dial .nm{font-weight:640;font-size:12.5px;}
    .dial .val{font-size:27px;font-weight:700;letter-spacing:-.02em;line-height:1;margin:2px 0 3px;} .val.good{color:var(--good);} .val.warn{color:var(--warn);} .val.crit{color:var(--crit);} .val.neg{color:var(--neg);}
    .dial .meta{font-size:11.5px;color:var(--muted);margin-bottom:10px;min-height:15px;}
    .meter{position:relative;height:7px;border-radius:5px;background:var(--line2);} .meter .fill{position:absolute;left:0;top:0;bottom:0;border-radius:5px;} .fill.good{background:var(--good);} .fill.warn{background:var(--warn);} .fill.crit{background:var(--crit);}
    .meter .tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.5;border-radius:2px;} .meter .ticklab{position:absolute;top:10px;font-size:9.5px;color:var(--faint);transform:translateX(-50%);white-space:nowrap;}
    .card{background:var(--surface);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow);overflow:hidden;margin-bottom:22px;max-width:1080px;}
    .cap{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 16px 11px;border-bottom:1px solid var(--line2);flex-wrap:wrap;} .cap .t{font-weight:660;font-size:14px;} .tag{font-size:9.5px;color:var(--faint);font-weight:600;margin-left:6px;}
    .legend{display:flex;gap:13px;font-size:11px;color:var(--muted);align-items:center;} .lg{display:inline-flex;align-items:center;gap:5px;}
    .sw{width:15px;height:8px;border-radius:2px;background:var(--cert);display:inline-block;} .sw.c{opacity:.45;} .sw.f{background:transparent;background-image:repeating-linear-gradient(45deg,var(--cert) 0 1.5px,transparent 1.5px 4px);opacity:.6;}
    .scroll{overflow-x:auto;} .fin table{border-collapse:collapse;width:100%;min-width:940px;} .fin th,.fin td{text-align:right;padding:0;}
    .fin thead th{position:sticky;top:0;background:var(--surface);z-index:1;}
    .rowlab{position:sticky;left:0;background:var(--surface);text-align:left;font-weight:600;white-space:nowrap;border-right:1px solid var(--line);min-width:210px;z-index:2;padding:0;}
    .fin thead .rowlab{z-index:3;} .wkh{padding:8px 11px 7px;border-bottom:1px solid var(--line);min-width:90px;} .wkh .wd{font-size:12px;font-weight:640;} .wkh .ph{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);} .wkh.cur{color:var(--store);} .wkh.cur .ph{color:var(--store);}
    tr.bk{cursor:pointer;} tr.bk:hover .rowlab,tr.bk:hover td{background:var(--elev);} tr.bk .rowlab{padding:10px 12px;border-top:1px solid var(--line);}
    .bklab{display:flex;align-items:center;gap:8px;} .caret{width:14px;color:var(--faint);font-size:10px;display:inline-block;text-align:center;transition:transform .12s;} tr.bk.open .caret{transform:rotate(90deg);}
    .bkname{font-weight:640;} .var-tag{font-size:9.5px;font-weight:700;color:var(--store);background:var(--store-tint);padding:1px 6px;border-radius:10px;}
    td.cell{padding:9px 11px;border-top:1px solid var(--line);vertical-align:top;} .mval{font-weight:600;font-size:13px;} .mval.zz{color:var(--faint);font-weight:500;}
    .subpct{font-size:10.5px;font-weight:700;margin-top:1px;} .subpct.good{color:var(--good);} .subpct.warn{color:var(--warn);} .subpct.crit{color:var(--crit);}
    .cert{display:flex;height:4px;border-radius:3px;overflow:hidden;margin-top:4px;background:var(--line2);max-width:70px;margin-left:auto;} .cert i{display:block;height:100%;} .cert .a{background:var(--cert);} .cert .c{background:var(--cert);opacity:.45;} .cert .f{background-image:repeating-linear-gradient(45deg,var(--cert) 0 1.5px,transparent 1.5px 4px);opacity:.6;}
    tr.item{background:var(--elev);} tr.item .rowlab{background:var(--elev);font-weight:500;color:var(--muted);padding:5px 12px 5px 34px;font-size:12.5px;border-top:1px solid var(--line2);} tr.item td.cell{padding:5px 11px;border-top:1px solid var(--line2);} tr.item .mval{font-weight:500;font-size:12px;color:var(--muted);}
    tr.item.ctx .rowlab,tr.item.ctx .mval{color:var(--faint);font-style:italic;}
    .cur-col{background:var(--store-tint)!important;box-shadow:inset 1px 0 0 var(--store),inset -1px 0 0 var(--store);} .hist .mval,.hist.rowlab{color:var(--muted);}
    tr.sum .rowlab{padding:11px 12px;border-top:2px solid #d5dae2;font-weight:700;} tr.sum td.cell{border-top:2px solid #d5dae2;} .sumv{font-weight:700;font-size:13px;}
    tr.plan .rowlab{padding:9px 12px;border-top:1px dashed var(--line);font-weight:600;color:var(--muted);} tr.plan td.cell{border-top:1px dashed var(--line);} .planv{font-weight:600;font-size:12.5px;color:var(--muted);}
    tr.net .rowlab,tr.net td{border-top:1px solid var(--line);} .netv{font-weight:700;font-size:13.5px;} .netv.pos{color:var(--pos);} .netv.neg{color:var(--neg);}
    tr.pass .rowlab{padding:8px 12px;color:var(--faint);font-weight:500;font-style:italic;} tr.pass td .mval{color:var(--faint);font-weight:500;font-size:12px;}
    .stripwrap{padding:12px 16px 14px;} .strip{display:flex;align-items:center;gap:7px;height:132px;} .bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:100%;} .bar .amt{font-size:10.5px;font-weight:640;} .bar.cur .amt,.bar.cur .wl{color:var(--store);}
    .bar .track{width:100%;height:84px;display:flex;flex-direction:column;justify-content:center;} .bar .col{width:70%;margin:0 auto;border-radius:4px;min-height:2px;} .col.pos{background:var(--pos);} .col.neg{background:var(--neg);} .bar .wl{font-size:10px;color:var(--faint);}
    .foot{color:var(--faint);font-size:11.5px;margin-top:14px;line-height:1.65;max-width:1080px;} .foot b{color:var(--muted);font-weight:640;}
    @media (max-width:760px){.dials{grid-template-columns:repeat(2,1fr);}}
    `}</style>
  )
}
