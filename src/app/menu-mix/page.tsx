'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import type { MenuMixPayload, ProductSummary, CategorySummary } from '@/lib/menuMixUtils'
import { parseSize, parseFlavor, blendedCogs } from '@/lib/menuMixUtils'
import DaypartTrends from '@/components/DaypartTrends'

// ── Formatting ────────────────────────────────────────────────────
const money  = (n: number) => n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
const money2 = (n: number) => `$${n.toFixed(2)}`
const pct    = (n: number) => `${(n * 100).toFixed(1)}%`
const num    = (n: number) => n.toLocaleString()
const cogsColor = (v: number | null) => v === null ? '' : v < 0.28 ? 'text-emerald-600 font-semibold' : v < 0.35 ? 'text-amber-600 font-semibold' : 'text-rose-600 font-semibold'

const CAT_COLOR: Record<string, { bg: string; dot: string }> = {
  'Smoothies':      { bg: 'bg-teal-500',   dot: '#14b8a6' },
  'Smoothie Bowls': { bg: 'bg-violet-500', dot: '#8b5cf6' },
  'Food':           { bg: 'bg-amber-500',  dot: '#f59e0b' },
  'Retail Products':{ bg: 'bg-sky-400',    dot: '#38bdf8' },
  'Retail Goods':   { bg: 'bg-slate-400',  dot: '#94a3b8' },
  'Modifiers':      { bg: 'bg-rose-400',   dot: '#fb7185' },
}
const CAT_SHORT: Record<string, string> = {
  'Smoothies': 'Smoothie', 'Smoothie Bowls': 'Bowl', 'Food': 'Food',
  'Retail Products': 'Retail', 'Retail Goods': 'Retail', 'Modifiers': 'Add-On',
}
const CAT_ORDER = ['Smoothies', 'Smoothie Bowls', 'Food', 'Retail Products', 'Retail Goods']

const PERIOD_OPTIONS = [
  { key: 'l7d',       label: 'Last 7 Days' },
  { key: 'mtd',       label: 'MTD' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'l90d',      label: 'Last 90 Days' },
]
const STORE_OPTIONS = [
  { key: 'all',     label: 'All Stores' },
  { key: 'pines',   label: 'Pines' },
  { key: 'miramar', label: 'Miramar' },
  { key: 'margate', label: 'Margate' },
]

// ── Category metrics table ────────────────────────────────────────
function CategoryMetricsTable({ coreCats, products, coreTotal, coreUnits, days }: {
  coreCats: CategorySummary[]
  products: Record<string, ProductSummary[]>
  coreTotal: number
  coreUnits: number
  days: number
}) {
  const allProds = CAT_ORDER.flatMap(c => products[c] ?? [])
  const totCogs   = blendedCogs(allProds)
  const totMargin = totCogs != null ? 1 - totCogs : null

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-sm font-bold text-slate-700">Category Mix</div>
        <div className="text-xs text-slate-400">Revenue, units &amp; margin by category</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 uppercase border-b border-slate-100">
              {['Category','Revenue','% Mix','Units','Units/Day','Avg Price','COGS%','Margin%'].map((h, i) => (
                <th key={h} className={`pb-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coreCats.map(c => {
              const cogs   = blendedCogs(products[c.subcategory] ?? [])
              const margin = cogs != null ? 1 - cogs : null
              const dot    = (CAT_COLOR[c.subcategory] ?? {}).dot ?? '#94a3b8'
              return (
                <tr key={c.subcategory} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-700">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: dot }} />
                    {c.subcategory}
                  </td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{money(c.sales)}</td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{pct(c.sales / coreTotal)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{num(c.qty)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{(c.qty / days).toFixed(1)}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{money2(c.sales / c.qty)}</td>
                  <td className={`py-2 text-right tabular-nums ${cogsColor(cogs)}`}>{cogs != null ? pct(cogs) : '—'}</td>
                  <td className={`py-2 text-right font-medium tabular-nums ${margin != null ? (margin > 0.72 ? 'text-emerald-600' : 'text-amber-600') : ''}`}>
                    {margin != null ? pct(margin) : '—'}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
              <td className="py-2">Core total</td>
              <td className="py-2 text-right tabular-nums">{money(coreTotal)}</td>
              <td className="py-2 text-right tabular-nums">100%</td>
              <td className="py-2 text-right tabular-nums">{num(coreUnits)}</td>
              <td className="py-2 text-right tabular-nums">{(coreUnits / days).toFixed(1)}</td>
              <td className="py-2 text-right tabular-nums">{money2(coreTotal / coreUnits)}</td>
              <td className="py-2 text-right tabular-nums">{totCogs != null ? pct(totCogs) : '—'}</td>
              <td className="py-2 text-right tabular-nums">{totMargin != null ? pct(totMargin) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-400">
        COGS% &amp; Margin% are blended across cost-tracked items · modifiers &amp; discounts excluded from mix %
      </div>
    </div>
  )
}

// ── Top sellers ───────────────────────────────────────────────────
type TsCategory = 'Overall' | 'Smoothies' | 'Bowls' | 'Food' | 'Retail' | 'Modifiers'
type TsSort = 'qty' | 'sales'

function TopSellers({ products, modifiers, coreUnits, days }: {
  products: Record<string, ProductSummary[]>
  modifiers: ProductSummary[]
  coreUnits: number
  days: number
}) {
  const [cat,  setCat]  = useState<TsCategory>('Overall')
  const [sort, setSort] = useState<TsSort>('qty')

  const TS_CATS: Record<TsCategory, ProductSummary[]> = {
    'Overall':   CAT_ORDER.flatMap(c => products[c] ?? []),
    'Smoothies': products['Smoothies'] ?? [],
    'Bowls':     products['Smoothie Bowls'] ?? [],
    'Food':      products['Food'] ?? [],
    'Retail':    [...(products['Retail Products'] ?? []), ...(products['Retail Goods'] ?? [])],
    'Modifiers': modifiers,
  }

  const rows = useMemo(() =>
    [...(TS_CATS[cat] ?? [])].sort((a, b) => b[sort] - a[sort]).slice(0, 10),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat, sort, products, modifiers]
  )

  const pillOn  = 'px-3 py-1 text-xs rounded-full font-medium bg-teal-600 text-white'
  const pillOff = 'px-3 py-1 text-xs rounded-full font-medium bg-slate-100 text-slate-500 hover:bg-slate-200'
  const sortOn  = 'px-2.5 py-1 rounded-md font-medium text-xs bg-slate-800 text-white'
  const sortOff = 'px-2.5 py-1 rounded-md font-medium text-xs text-slate-500 hover:bg-slate-100'

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm font-bold text-slate-700">Top 10 Sellers</div>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <span className="mr-1">Sort</span>
          <button onClick={() => setSort('qty')}   className={sort === 'qty'   ? sortOn : sortOff}>Units</button>
          <button onClick={() => setSort('sales')} className={sort === 'sales' ? sortOn : sortOff}>Revenue</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-4">
        {(Object.keys(TS_CATS) as TsCategory[]).map(c => (
          <button key={c} onClick={() => setCat(c)} className={cat === c ? pillOn : pillOff}>{c}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left pb-2 font-medium w-5">#</th>
              <th className="text-left pb-2 font-medium">Product</th>
              <th className="text-left pb-2 font-medium w-24 hidden sm:table-cell">Category</th>
              <th className="text-right pb-2 font-medium w-16">Units</th>
              <th className="text-right pb-2 font-medium w-16">Units/Day</th>
              <th className="text-right pb-2 font-medium w-20">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const dot = (CAT_COLOR[p.subcategory] ?? {}).dot ?? '#94a3b8'
              return (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 text-slate-300 tabular-nums">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-medium text-slate-700 max-w-[230px] truncate" title={p.product}>
                    {parseFlavor(p.product)}
                  </td>
                  <td className="py-1.5 text-slate-500 hidden sm:table-cell">
                    <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: dot }} />
                    {CAT_SHORT[p.subcategory] ?? p.subcategory}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${sort === 'qty' ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{num(p.qty)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${sort === 'qty' ? 'text-slate-600' : 'text-slate-400'}`}>{(p.qty / days).toFixed(1)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${sort === 'sales' ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
                    {p.sales > 0 ? money(p.sales) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sortable + searchable product table ───────────────────────────
type SortDir = 'asc' | 'desc'

type ColKey = 'product' | 'qty' | 'perDay' | 'avgPrice' | 'cogsPct' | 'sales' | 'mix' | 'attach'

interface ColDef {
  key:      ColKey
  label:    string
  sortable: boolean
  right:    boolean
  width?:   string
  render:   (row: ProductSummary, totalSales: number, coreUnits: number) => React.ReactNode
}

function productCols(showSize: boolean, days = 90): ColDef[] {
  const cols: ColDef[] = [
    {
      key: 'product', label: 'Product', sortable: true, right: false,
      render: r => <span className="font-medium text-slate-700 truncate block max-w-[210px]">{parseFlavor(r.product)}</span>,
    },
  ]
  if (showSize) cols.push({
    key: 'qty', label: 'Size', sortable: false, right: true, width: 'w-12',
    render: r => <span className="text-slate-500">{parseSize(r.product)}</span>,
  })
  cols.push(
    { key: 'qty',      label: 'Units',     sortable: true, right: true, width: 'w-14',
      render: r => <span className="text-slate-600 tabular-nums">{num(r.qty)}</span> },
    { key: 'perDay',   label: 'Units/Day', sortable: true, right: true, width: 'w-16',
      render: r => <span className="text-slate-600 tabular-nums">{(r.qty / days).toFixed(1)}</span> },
    { key: 'avgPrice', label: 'Avg Price', sortable: true, right: true, width: 'w-20',
      render: r => <span className="text-slate-600 tabular-nums">{r.avgPrice != null ? money2(r.avgPrice) : '—'}</span> },
    { key: 'cogsPct',  label: 'COGS%',     sortable: true, right: true, width: 'w-16',
      render: r => <span className={`tabular-nums ${cogsColor(r.cogsPct)}`}>{r.cogsPct != null ? pct(r.cogsPct) : '—'}</span> },
    { key: 'sales',    label: 'Revenue',   sortable: true, right: true, width: 'w-20',
      render: r => <span className="font-semibold text-slate-700 tabular-nums">{money(r.sales)}</span> },
    { key: 'mix',      label: '% Mix',     sortable: true, right: true, width: 'w-14',
      render: (r, totalSales) => {
        const mix = totalSales > 0 ? r.sales / totalSales : 0
        return <span className="text-slate-500 tabular-nums">{pct(mix)}</span>
      } },
  )
  return cols
}

function modifierCols(days = 90): ColDef[] {
  return [
    { key: 'product', label: 'Add-On',     sortable: true, right: false,
      render: r => <span className="font-medium text-slate-700">{parseFlavor(r.product)}</span> },
    { key: 'qty',     label: 'Units',      sortable: true, right: true, width: 'w-16',
      render: r => <span className="text-slate-600 tabular-nums">{num(r.qty)}</span> },
    { key: 'perDay',  label: 'Units/Day',  sortable: true, right: true, width: 'w-16',
      render: r => <span className="text-slate-600 tabular-nums">{(r.qty / days).toFixed(1)}</span> },
    { key: 'attach',  label: 'Attach%',    sortable: true, right: true, width: 'w-16',
      render: (r, _ts, coreUnits) => <span className="text-slate-600 tabular-nums">{coreUnits > 0 ? pct(r.qty / coreUnits) : '—'}</span> },
    { key: 'cogsPct', label: 'COGS%',      sortable: true, right: true, width: 'w-16',
      render: r => <span className={`tabular-nums ${cogsColor(r.cogsPct)}`}>{r.cogsPct != null ? pct(r.cogsPct) : '—'}</span> },
    { key: 'sales',   label: 'Revenue',    sortable: true, right: true, width: 'w-20',
      render: r => <span className="font-semibold text-slate-700 tabular-nums">{r.sales > 0 ? money(r.sales) : '—'}</span> },
  ]
}

function getSortVal(r: ProductSummary, key: ColKey): number | string {
  if (key === 'product')  return r.product.toLowerCase()
  if (key === 'perDay')   return r.qty
  if (key === 'mix')      return r.sales
  if (key === 'attach')   return r.qty
  if (key === 'cogsPct')  return r.cogsPct ?? -1
  if (key === 'avgPrice') return r.avgPrice ?? -1
  if (key === 'qty')   return r.qty
  if (key === 'sales') return r.sales
  return 0
}

function SortableTable({ rows, cols, totalSales = 0, coreUnits = 0, enableSearch = false }: {
  rows:         ProductSummary[]
  cols:         ColDef[]
  totalSales?:  number
  coreUnits?:   number
  enableSearch?: boolean
}) {
  const [sortKey, setSortKey] = useState<ColKey>('sales')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [query,   setQuery]   = useState('')

  function handleSort(key: ColKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir(key === 'product' ? 'asc' : 'desc') }
  }

  const visible = useMemo(() => {
    let r = query ? rows.filter(x => x.product.toLowerCase().includes(query.toLowerCase())) : rows
    r = [...r].sort((a, b) => {
      const va = getSortVal(a, sortKey), vb = getSortVal(b, sortKey)
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
      if (va === -1 && vb !== -1) return 1
      if (vb === -1 && va !== -1) return -1
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
    return r
  }, [rows, sortKey, sortDir, query])

  return (
    <div>
      {(enableSearch && rows.length >= 8) && (
        <div className="relative mb-3 max-w-xs">
          <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-200"
            placeholder="Search items…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 uppercase border-b border-slate-100">
              {cols.map(c => {
                const active = c.key === sortKey
                const arrow  = c.sortable && active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''
                return (
                  <th
                    key={c.key}
                    onClick={c.sortable ? () => handleSort(c.key) : undefined}
                    className={`pb-2 font-medium ${c.right ? 'text-right' : 'text-left'} ${c.width ?? ''} ${c.sortable ? 'cursor-pointer select-none hover:text-slate-600' : ''} ${active ? 'text-slate-600' : ''}`}
                  >
                    {c.label}<span className="text-teal-500">{arrow}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={cols.length} className="py-4 text-center text-slate-300">No matching items</td></tr>
            ) : visible.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                {cols.map(c => (
                  <td key={c.key} className={`py-1.5 ${c.right ? 'text-right' : ''} ${!c.right ? 'pr-2' : ''}`}>
                    {c.render(r, totalSales, coreUnits)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Smoothies section with tabs ───────────────────────────────────
function SmoothiesSection({ products, totalSales, days }: { products: ProductSummary[]; totalSales: number; days: number }) {
  const [tab, setTab] = useState<'all' | 'size' | 'flavor'>('all')

  const sizeRows = useMemo(() => {
    const m = new Map<string, ProductSummary>()
    for (const p of products) {
      const sz  = parseSize(p.product)
      const cur = m.get(sz) ?? { product: sz, subcategory: 'Smoothies', qty: 0, sales: 0, cogsPct: null, avgPrice: null }
      cur.qty += p.qty; cur.sales += p.sales
      m.set(sz, cur)
    }
    return Array.from(m.values()).sort((a, b) => b.sales - a.sales)
  }, [products])

  const flavorRows = useMemo(() => {
    const m = new Map<string, ProductSummary & { _c: number }>()
    for (const p of products) {
      const fl  = parseFlavor(p.product)
      const cur = m.get(fl) ?? { product: fl, subcategory: 'Smoothies', qty: 0, sales: 0, cogsPct: null, avgPrice: null, _c: 0 }
      cur.qty += p.qty; cur.sales += p.sales
      if (p.cogsPct != null) {
        cur.cogsPct = cur.cogsPct != null ? (cur.cogsPct * cur._c + p.cogsPct) / (cur._c + 1) : p.cogsPct
        cur._c++
      }
      m.set(fl, cur)
    }
    return Array.from(m.values()).sort((a, b) => b.sales - a.sales)
  }, [products])

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${tab === key ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {tabBtn('all', 'All Items')}
        {tabBtn('size', 'By Size')}
        {tabBtn('flavor', 'By Flavor')}
      </div>
      {tab === 'all'    && <SortableTable rows={products}   cols={productCols(true, days)}  totalSales={totalSales} enableSearch />}
      {tab === 'size'   && <SortableTable rows={sizeRows}   cols={productCols(false, days)} totalSales={totalSales} />}
      {tab === 'flavor' && <SortableTable rows={flavorRows} cols={productCols(false, days)} totalSales={totalSales} enableSearch />}
    </div>
  )
}

// ── Category section card ─────────────────────────────────────────
function CategorySection({ cat, products, totalSales, days }: {
  cat: string; products: ProductSummary[]; totalSales: number; days: number
}) {
  const [open, setOpen] = useState(false)
  const cc       = CAT_COLOR[cat] ?? { bg: 'bg-slate-400' }
  const catSales = products.reduce((s, p) => s + p.sales, 0)
  const catQty   = products.reduce((s, p) => s + p.qty,   0)
  const cogs     = blendedCogs(products)

  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${cc.bg}`} />
          <span className="font-bold text-slate-700">{cat}</span>
          <span className="text-sm text-slate-400">{products.length} items</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Units / Day</div>
            <div className="font-semibold text-slate-700 tabular-nums">{(catQty / days).toFixed(1)}</div>
          </div>
          {cogs != null && (
            <div className="text-right hidden sm:block">
              <div className="text-xs text-slate-400">Avg COGS%</div>
              <div className={`font-semibold tabular-nums ${cogs < 0.28 ? 'text-emerald-600' : 'text-amber-600'}`}>{pct(cogs)}</div>
            </div>
          )}
          <div className="text-right">
            <div className="text-xs text-slate-400">Revenue</div>
            <div className="font-bold text-slate-800 tabular-nums">{money(catSales)}</div>
          </div>
          <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {cat === 'Smoothies'
            ? <SmoothiesSection products={products} totalSales={totalSales} days={days} />
            : <SortableTable rows={products} cols={productCols(false, days)} totalSales={totalSales} enableSearch />
          }
        </div>
      )}
    </div>
  )
}

// ── Modifiers card ────────────────────────────────────────────────
function ModifiersSection({ mods, coreUnits, days }: { mods: ProductSummary[]; coreUnits: number; days: number }) {
  const [open, setOpen] = useState(false)
  const modTotal = mods.reduce((s, m) => s + m.sales, 0)
  const modUnits = mods.reduce((s, m) => s + m.qty,   0)
  const attach   = coreUnits > 0 ? modUnits / coreUnits : 0

  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <div className="text-left">
          <div className="font-bold text-slate-700">Add-Ons (Modifiers)</div>
          <div className="text-xs text-slate-400 mt-0.5">Not included in category mix — tracked separately</div>
        </div>
        <div className="flex items-center gap-6 text-sm text-right">
          <div>
            <div className="text-xs text-slate-400">Attach Rate</div>
            <div className="font-bold text-slate-700 tabular-nums">{pct(attach)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Revenue</div>
            <div className="font-bold text-slate-700 tabular-nums">{money(modTotal)}</div>
          </div>
          <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <SortableTable rows={mods} cols={modifierCols(days)} coreUnits={coreUnits} enableSearch />
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function MenuMixPage() {
  const [period,  setPeriod]  = useState('l90d')
  const [store,   setStore]   = useState('all')
  const [data,    setData]    = useState<MenuMixPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/menu-mix?period=${period}&store=${store}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period, store])

  const coreCats  = (data?.categories ?? []).filter(c => c.subcategory !== 'Discounts' && c.sales > 0)
  const coreTotal = coreCats.reduce((s, c) => s + c.sales, 0)
  const coreUnits = coreCats.reduce((s, c) => s + c.qty,   0)
  const days      = data?.days ?? 90

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Dashboard
          </Link>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">Menu Mix &amp; Velocity</h1>
            {data && <p className="text-xs text-slate-400 mt-0.5">Data through {data.thruDate}{period === 'l7d' ? ' · showing current month (day-level data not yet available)' : ''}</p>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {PERIOD_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setPeriod(o.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === o.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {STORE_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setStore(o.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${store === o.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="card"><div className="animate-pulse h-16 bg-slate-100 rounded-lg w-full" /></div>)}
        </div>
      ) : !data ? (
        <div className="card text-center text-slate-400 py-12">No menu mix data available</div>
      ) : (
        <div className="space-y-4">

          <CategoryMetricsTable
            coreCats={coreCats}
            products={data.products}
            coreTotal={coreTotal}
            coreUnits={coreUnits}
            days={days}
          />

          <TopSellers
            products={data.products}
            modifiers={data.modifiers}
            coreUnits={coreUnits}
            days={days}
          />

          <DaypartTrends store={store} />

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Drill Down</div>
            <div className="space-y-4">
              {CAT_ORDER.map(cat => {
                const products = data.products[cat] ?? []
                return products.length ? (
                  <CategorySection key={cat} cat={cat} products={products} totalSales={coreTotal} days={days} />
                ) : null
              })}
            </div>
          </div>

          <ModifiersSection mods={data.modifiers} coreUnits={coreUnits} days={days} />

        </div>
      )}
    </div>
  )
}
