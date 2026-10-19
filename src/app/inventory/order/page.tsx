'use client'

/**
 * Inventory → Order. One store's next order as a shopping list.
 *
 * Vendor tabs (PFG / Walmart / Restaurant Depot), search across all of them, and ONE list
 * per tab ranked by what matters first: runs out before the truck → other items to order →
 * regular buys that are overdue → regular buys due → enough until the next truck. On hand,
 * the suggested amount and every rule behind it come from lib/orderList.ts; this page only
 * lets someone change a quantity, switch vendor or pack, and ask a sister store.
 *
 * Nothing here writes to a vendor. "Fill my PFG cart" stays off until it is approved.
 */
import './order.css'
import { useEffect, useMemo, useState } from 'react'
import type { OrderListPayload, ItemOut, RegularOut } from '@/lib/orderList'
import { SegControl } from '@/components/design/controls'
import { TakeCard } from '@/components/design/shell'
import { useStoreLock } from '@/components/useStoreLock'

type Vendor = 'PFG' | 'Walmart' | 'Restaurant Depot'
type StoreOpt = 'Margate' | 'Miramar' | 'Pines'

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const one = (n: number) => String(Math.round(n * 10) / 10)
const day = (iso: string | null) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' }).replace(',', '') : '—')
const cutoffEt = (utc: string | null) => {
  if (!utc) return null
  const d = new Date(utc + 'Z')
  return d.toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(',', '')
}

interface Row {
  key: string
  vendor: Vendor
  name: string
  sub: string
  onHand: string
  lasts: string
  urgent: boolean
  lastDate: string
  lastQty: string
  qty: number
  price: number | null
  rank: number
  warn: string | null
  swaps: { label: string; pick: () => void }[]
  transfer: { text: string; button: string; asked: boolean; toggle: () => void } | null
  setQty: (n: number) => void
  step: number
}

export default function OrderPage() {
  const lock = useStoreLock()
  const [picked, setStore] = useState<StoreOpt>('Margate')
  // a store-locked login always sees its own store; owners pick
  const store: StoreOpt = lock ? ((lock[0].toUpperCase() + lock.slice(1)) as StoreOpt) : picked
  const [res, setRes] = useState<{ store: StoreOpt; data?: OrderListPayload; error?: string } | null>(null)
  const [vendor, setVendor] = useState<Vendor>('PFG')
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [qty, setQtyMap] = useState<Record<string, number>>({})
  const [pick, setPick] = useState<Record<string, number>>({})
  const [asked, setAsked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let live = true
    fetch(`/api/inventory/order?store=${store}`)
      .then(r => r.json())
      .then(j => {
        if (!live) return
        setQtyMap({}); setPick({}); setAsked({})
        setRes(j.error ? { store, error: String(j.error) } : { store, data: j })
      })
      .catch(e => { if (live) setRes({ store, error: String(e) }) })
    return () => { live = false }
  }, [store])
  const data = res && res.store === store ? res.data ?? null : null
  const error = res && res.store === store ? res.error ?? null : null

  const rows: Row[] = useMemo(() => {
    if (!data) return []
    const truckDay = day(data.truck.date)
    const setQtyFor = (k: string) => (n: number) => setQtyMap(m => ({ ...m, [k]: Math.max(0, n) }))
    const items = data.items.map((it: ItemOut): Row => {
      const oi = pick[it.id] ?? it.defaultOffer
      const o = it.offers[oi]
      const isAsked = !!asked[it.id]
      const sug = o.suggested
      const n = qty[it.id] ?? (isAsked || it.route === 'transfer' ? 0 : sug)
      let warn: string | null = o.outOfStock ? `Out of stock at ${o.vendor} today` : null
      if (!warn && !it.perRunItem && n > sug && it.daily) {
        const after = (Math.max(it.atTruck ?? 0, 0) + n * o.perPack) / it.daily
        const limit = it.maxPacks ? 6 : it.maxDays
        if (after > limit + 0.5) warn = `Too much: ${Math.round(after)} days of stock`
      }
      const swaps = it.offers.map((x, j) => ({ x, j })).filter(({ j }) => j !== oi).map(({ x, j }) => ({
        label: x.vendor === o.vendor ? `Switch to ${x.pack}` : `Move to ${x.vendor}`,
        pick: () => { setPick(p => ({ ...p, [it.id]: j })); setQtyMap(m => { const c = { ...m }; delete c[it.id]; return c }) },
      }))
      // the dot marks only what runs out before this truck arrives; later run-outs are just a date
      const urgent = sug > 0 && it.atTruck != null && it.atTruck <= 0.05
      const daysLeft = it.onHand != null && it.daily ? it.onHand / it.daily : 99
      const lasts = it.perRunItem ? 'Walmart run'
        : it.onHand == null ? '—'
        : it.atTruck != null && it.atTruck <= 0.05 ? `Out by ${truckDay}` : day(it.runsOut)
      const transfer = it.transfer && sug > 0 ? {
        text: it.route === 'transfer'
          ? `${sug} × ${o.pack.toLowerCase()} would leave ${money(it.idle)} sitting. ${it.transfer.from} has extra: ~${it.transfer.has} ${it.unit}`
          : `${it.transfer.from} has extra: ~${it.transfer.has} ${it.unit}, needs ${it.transfer.keeps} until its truck + buffer`,
        button: `Ask ${it.transfer.from} for ${it.transfer.qty} ${it.unit}`,
        asked: isAsked,
        toggle: () => { setAsked(a => ({ ...a, [it.id]: !a[it.id] })); setQtyMap(m => { const c = { ...m }; delete c[it.id]; return c }) },
      } : null
      return {
        key: it.id, vendor: o.vendor, name: it.name,
        sub: `${o.pack} · ${o.price != null ? money(o.price) : 'no price'}${it.route === 'decide' && n > 0 ? ` · leaves ${money(it.idle)} on the shelf` : ''}`,
        onHand: it.onHand == null ? '—' : `${it.estimate ? '~' : ''}${one(it.onHand)} ${it.unit}`,
        lasts, urgent,
        lastDate: it.lastOrder ? `${day(it.lastOrder.date)}${it.lastOrder.vendor !== 'PFG' ? ' · ' + it.lastOrder.vendor : ''}` : '—',
        lastQty: it.lastOrder ? `${one(it.lastOrder.qty)} · ${money(it.lastOrder.amount)}` : '',
        qty: n, price: o.price, warn, swaps, transfer, setQty: setQtyFor(it.id), step: 1,
        rank: sug > 0 ? (urgent ? daysLeft : 1000 + daysLeft) : 4000 + daysLeft,
      }
    })
    const regs = data.regulars.map((r: RegularOut): Row => {
      const k = 'R:' + r.code
      const n = qty[k] ?? 0
      return {
        key: k, vendor: 'PFG', name: r.name, sub: `${r.pack} · ${r.price != null ? money(r.price) : 'no price'} · usually every ${Math.round(r.everyDays / 7) || 1} wk`,
        onHand: '—', lasts: r.lateDays >= 7 ? `${Math.round(r.lateDays / 7)} wk late` : `Due ${truckDay}`, urgent: r.lateDays >= 7,
        lastDate: day(r.lastBought), lastQty: `usually ${r.typicalQty}`,
        qty: n, price: r.price, warn: null, swaps: [], transfer: null,
        setQty: (v: number) => setQtyMap(m => ({ ...m, [k]: Math.max(0, v) })), step: r.typicalQty,
        rank: r.lateDays >= 7 ? 2000 - r.lateDays : 3000,
      }
    })
    return [...items, ...regs]
  }, [data, qty, pick, asked])

  const search = q.trim().toLowerCase()
  const listed = (search ? rows.filter(r => r.name.toLowerCase().includes(search)) : rows.filter(r => r.vendor === vendor))
    .sort((a, b) => a.rank - b.rank)
  // items with enough on hand fold away; search, or anything given a quantity, still shows
  const enough = (r: Row) => r.rank >= 4000 && r.qty === 0
  const folded = search || showAll ? 0 : listed.filter(enough).length
  const shown = search || showAll ? listed : listed.filter(r => !enough(r))

  const basket = (v: Vendor) => rows.filter(r => r.vendor === v && r.qty > 0)
  const total = (v: Vendor) => basket(v).reduce((s, r) => s + r.qty * (r.price ?? 0), 0)
  const grand = total('PFG') + total('Walmart')
  const transfers = rows.filter(r => r.transfer?.asked)

  if (error) return <div className="ord-card ord-card-pad"><b>Order list unavailable</b><span className="ord-note">{error}</span></div>
  if (!data) return <div className="ord-card ord-card-pad"><span className="ord-note">Loading {store}…</span></div>

  const pfgTotal = total('PFG')
  const minPct = Math.min(100, Math.round((pfgTotal / data.pfgMinimum.amount) * 100))
  const budgetPct = Math.min(100, Math.round((grand / Math.max(1, data.budget.weekly)) * 100))
  const tabs: { v: Vendor; when: string }[] = [
    { v: 'PFG', when: `Arrives ${day(data.truck.date)}${data.truck.cutoffUtc ? ' · order by ' + cutoffEt(data.truck.cutoffUtc) : ''}` },
    { v: 'Walmart', when: 'Next run' },
    { v: 'Restaurant Depot', when: 'Nothing approved yet' },
  ]
  const sel = search ? null : vendor

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sk-filterbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        {!lock && (
          <SegControl label="Store" value={store} onChange={setStore}
            options={(['Margate', 'Miramar', 'Pines'] as StoreOpt[]).map(s => ({ value: s, label: s }))} />
        )}
        <span className="ord-note">
          <span style={data.asOf.countStale ? { color: 'var(--status-warn)', fontWeight: 600 } : undefined}>Counted {day(data.asOf.count)}</span> · PFG prices {day(data.asOf.pfgPrices)} · invoices to {day(data.asOf.invoices)} · Walmart to {day(data.asOf.walmart)}
        </span>
      </div>

      <TakeCard tone={rows.some(r => r.urgent && r.qty === 0) ? 'warn' : 'neutral'}
        headline={`Order by ${data.truck.cutoffUtc ? cutoffEt(data.truck.cutoffUtc) : 'the day before ' + day(data.truck.date)}: ${basket('PFG').length} PFG items, ${money(total('PFG'))}${basket('Walmart').length ? ` · ${basket('Walmart').length} Walmart, ${money(total('Walmart'))}` : ''}.`} />

      <input className="ord-search" type="search" aria-label="Search all items" placeholder="Search all items, e.g. honey"
        value={q} onChange={e => setQ(e.target.value)} />

      <div className="ord-tabs" role="tablist" aria-label="Vendor">
        {tabs.map(t => {
          const n = basket(t.v).length
          return (
            <button key={t.v} role="tab" aria-selected={!search && vendor === t.v} className="ord-tab" onClick={() => { setVendor(t.v); setQ('') }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b>{t.v === 'PFG' ? 'PFG truck' : t.v}</b>
                <b className="ord-num">{total(t.v) > 0 ? money(total(t.v)) : '—'}</b>
              </span>
              <span className="ord-tab-sub">{t.when}</span>
              <span className="ord-tab-sub">{n === 0 ? 'No items' : `${n} item${n === 1 ? '' : 's'}`}</span>
            </button>
          )
        })}
      </div>

      <div className="ord-wrap">
        <div className="ord-main">
          {!search && vendor === 'Restaurant Depot' ? (
            <div className="ord-card ord-card-pad">
              <b>Nothing approved from Restaurant Depot yet</b>
              <span className="ord-note">Items move here once corporate approves them for local buying and NetChef can take them in. The Prices tab shows what an approval would save.</span>
            </div>
          ) : (
            <section className="ord-card" aria-label="Items">
              <div className="ord-head">
                <b>{search ? `Results for "${q}"` : vendor === 'PFG' ? `PFG order · ${day(data.truck.date)}` : 'Walmart'}</b>
                <span className="ord-note">{listed.length} items</span>
              </div>
              <div className="ord-row ord-hd"><span>Item · most important first</span><span>On hand</span><span>Runs out</span><span>Last order</span><span>Order</span><span style={{ textAlign: 'right' }}>Cost</span></div>
              {shown.map(r => (
                <div key={r.key} className={`ord-row${r.qty > 0 ? '' : ' ord-quiet'}`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span className="ord-name">{r.name}</span>
                    <span className="ord-sub">{search ? r.vendor + ' · ' : ''}{r.sub}</span>
                    {r.warn && <span className="ord-strong"><span className="ord-dot" aria-hidden="true" />{r.warn}</span>}
                    {r.swaps.map(s => <button key={s.label} className="ord-pill" onClick={s.pick}>{s.label}</button>)}
                    {r.transfer && (
                      <div className="ord-xfer">
                        <span className={r.transfer.asked ? 'ord-strong' : ''}>
                          {r.transfer.asked ? `${r.transfer.button.replace('Ask', 'Asked')} · waiting for them to confirm` : r.transfer.text}
                        </span>
                        <button className={`ord-pill${r.transfer.asked ? '' : ' ord-solid'}`} onClick={r.transfer.toggle}>
                          {r.transfer.asked ? 'Undo' : r.transfer.button}
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="ord-onhand">{r.onHand}{r.urgent && <span className="ord-lasts-sm ord-strong"><span className="ord-dot" aria-hidden="true" />{r.lasts}</span>}</span>
                  <span className={`ord-sm-hide ord-num ${r.urgent ? 'ord-strong' : 'ord-soft'}`}>{r.urgent && <span className="ord-dot" aria-hidden="true" />}{r.lasts}</span>
                  <span className="ord-sm-hide ord-num" style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                    <span>{r.lastDate}</span><span className="ord-soft">{r.lastQty}</span>
                  </span>
                  <div className="ord-step">
                    <button aria-label={`One less ${r.name}`} onClick={() => r.setQty(r.qty - 1)}>−</button>
                    <span aria-live="polite">{r.qty}</span>
                    <button aria-label={`One more ${r.name}`} onClick={() => r.setQty(r.qty + (r.qty === 0 ? r.step : 1))}>+</button>
                  </div>
                  <span className="ord-sm-hide ord-right">{r.qty > 0 && r.price != null ? money(r.qty * r.price) : '—'}</span>
                </div>
              ))}
              {shown.length === 0 && folded === 0 && <div className="ord-card-pad ord-note">Nothing matches.</div>}
              {(folded > 0 || (showAll && !search)) && (
                <div className="ord-row ord-quiet" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="ord-note">{showAll ? 'Showing everything' : `${folded} more with enough on hand`}</span>
                  <button className="ord-pill" onClick={() => setShowAll(v => !v)}>{showAll ? 'Hide them' : 'Show them'}</button>
                </div>
              )}
            </section>
          )}
          <p className="ord-note" style={{ margin: '8px 4px 0' }}>On hand = last count + deliveries − usage · ~ = estimate (left blank on the last count)</p>
        </div>

        <aside className="ord-cart" aria-label="Your order">
          <div className="ord-card ord-card-pad">
            {sel && sel !== 'Restaurant Depot' && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="ord-line"><b>{sel === 'PFG' ? 'PFG truck' : 'Walmart'}</b><b>{money(total(sel))}</b></div>
                {basket(sel).map(r => (
                  <div key={r.key} className="ord-line"><span><b>{r.qty} ×</b> {r.name}</span><span>{money(r.qty * (r.price ?? 0))}</span></div>
                ))}
                {sel === 'PFG' && (
                  <>
                    <div className="ord-bar"><div style={{ width: `${minPct}%`, background: pfgTotal >= data.pfgMinimum.amount ? 'var(--status-good)' : 'var(--status-warn)' }} /></div>
                    <span className="ord-note">{pfgTotal >= data.pfgMinimum.amount
                      ? `Over the ${money(data.pfgMinimum.amount)} minimum`
                      : `${money(data.pfgMinimum.amount - pfgTotal)} under the minimum: ${money(data.pfgMinimum.fee)} fee`}</span>
                    <button className="ord-cta" disabled title="Writing to PFG is not switched on yet">Fill my PFG cart</button>
                  </>
                )}
                {sel === 'Walmart' && (
                  <button className="ord-cta ord-ghost" onClick={() => navigator.clipboard?.writeText(basket('Walmart').map(r => `${r.qty} × ${r.name} (${r.sub.split(' · ')[0]})`).join('\n'))}>
                    Copy the list
                  </button>
                )}
              </section>
            )}
            {transfers.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                <b>From other stores</b>
                {transfers.map(r => <span key={r.key} className="ord-note">{r.transfer!.button.replace('Ask ', '')} · waiting</span>)}
              </section>
            )}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
              <div className="ord-line"><b>All vendors</b><b>{money(grand)}</b></div>
              <div className="ord-line ord-soft"><span>PFG</span><span>{money(total('PFG'))}</span></div>
              <div className="ord-line ord-soft"><span>Walmart</span><span>{money(total('Walmart'))}</span></div>
              <div className="ord-bar"><div style={{ width: `${budgetPct}%`, background: grand > data.budget.weekly ? 'var(--status-bad)' : 'var(--brand)' }} /></div>
              <span className="ord-note">{money(grand)} of {money(data.budget.weekly)} weekly food budget ({data.budget.basis})</span>
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}
