'use client'

import type { ChannelRow, ProductRow, CategoryRow } from '@/lib/types'

interface Props {
  channels:   ChannelRow[]
  products:   ProductRow[]
  categories: CategoryRow[]
  loading:    boolean
}

const CAT_COLORS: Record<string, string> = {
  'Smoothies':      '#0d9488',
  'Smoothie Bowls': '#5eead4',
  'Modifiers':      '#a7f3d0',
  'Food':           '#fde68a',
  'Retail':         '#fed7aa',
}

export default function BottomRow({ channels, products, categories, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card"><div className="skeleton h-40 w-full" /></div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Channels */}
      <div className="card">
        <div className="text-sm font-bold text-slate-700 mb-3">Sales by Channel</div>
        <div className="space-y-2">
          {channels.map(c => (
            <div key={c.name}>
              {/* Parent bucket row */}
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-700">{c.name}</div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-xs font-bold text-slate-700">{(c.pct * 100).toFixed(0)}%</div>
                    {c.pctPY > 0 && (
                      <div className="text-[10px] text-slate-400">py {(c.pctPY * 100).toFixed(0)}%</div>
                    )}
                  </div>
                  <div className={`text-xs w-10 text-right ${c.changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {c.changePct !== 0 ? <>{c.changePct >= 0 ? '▲' : '▼'}{Math.abs(c.changePct * 100).toFixed(0)}%</> : '—'}
                  </div>
                </div>
              </div>
              {/* Sub-category rows (delivery providers) */}
              {c.children && c.children.length > 0 && (
                <div className="ml-2 mt-1 space-y-0.5">
                  {c.children.map(ch => (
                    <div key={ch.name} className="flex items-center justify-between gap-2">
                      <div className="text-[10px] text-slate-400 truncate">
                        {ch.name.replace(' - Delivery', '').replace(' Ordering', '')}
                      </div>
                      <div className="text-[10px] text-slate-500 shrink-0">{(ch.pct * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Category table */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-slate-700">Sales by Category</div>
          <div className="text-xs text-slate-400">% of mix</div>
        </div>
        {categories.length === 0 ? (
          <div className="text-xs text-slate-400 italic">No category data for this period</div>
        ) : (
          <div className="space-y-2.5">
            {categories.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300 w-4 text-right shrink-0">{i + 1}</span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLORS[c.name] ?? '#cbd5e1' }} />
                <span className="text-xs text-slate-700 flex-1">{c.name}</span>
                <span className="text-xs text-slate-500 mr-1">${(c.sales / 1000).toFixed(1)}K</span>
                <span className="text-xs font-bold text-slate-700">{(c.pct * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Products (spans 2 cols) */}
      <div className="card md:col-span-2">
        <div className="text-sm font-bold text-slate-700 mb-3">
          Top Products <span className="text-xs text-slate-400 font-normal">qty/day · vs L4W</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {products.slice(0, 12).map((p, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-slate-300 shrink-0 w-4 text-right">{i + 1}</span>
                <span className="text-xs text-slate-700 truncate">{p.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <span className="text-xs font-bold text-slate-800">{p.qtyPerDay.toFixed(1)}/d</span>
                <span className={`text-xs ${p.changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {p.changePct >= 0 ? '▲' : '▼'}{Math.abs(p.changePct * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
