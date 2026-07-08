'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/inventory',            label: 'Overview' },
  { href: '/inventory/categories', label: 'By Category' },
  { href: '/inventory/stores',     label: 'By Store' },
  { href: '/inventory/vendors',    label: 'By Vendor' },
  { href: '/inventory/watchlist',  label: 'Actions & Watchlist' },
]

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Dashboard
          </Link>
          <div className="w-px h-4 bg-slate-200" />
          <h1 className="text-xl font-bold text-slate-800">Inventory</h1>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => {
          const active = t.href === '/inventory' ? pathname === '/inventory' : pathname.startsWith(t.href)
          return (
            <Link key={t.href} href={t.href}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </Link>
          )
        })}
      </div>

      {children}
    </div>
  )
}
