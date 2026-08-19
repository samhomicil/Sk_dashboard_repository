'use client'

/**
 * Inventory module chrome — the title row and the sub-tabs, shared by every tab.
 *
 * THE TIMEFRAME IS NOT SHARED BY ALL OF THEM. Five tabs are purchasing views and
 * run on a calendar window (4/8/13 weeks, YTD). Shrink does not: it measures one
 * COMPLETED INVENTORY COUNT PERIOD, chosen from the periods CrunchTime actually
 * has, and there is no meaningful way to answer it for "Jul 1 – Aug 19". Leaving
 * the control on screen there would be a lie — a filter the page visibly ignores.
 * So the header renders it only for the tabs it governs, and Shrink carries its own
 * period picker beside its own filters, which is the rule shell.tsx states: filters
 * belong to the screen, never to a global header.
 */
import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import InventoryTimeframe from '@/components/InventoryTimeframe'

const TABS = [
  { href: '/inventory',            label: 'Overview' },
  { href: '/inventory/categories', label: 'By Category' },
  { href: '/inventory/stores',     label: 'By Store' },
  { href: '/inventory/vendors',    label: 'By Vendor' },
  { href: '/inventory/watchlist',  label: 'Actions & Watchlist' },
  { href: '/inventory/shrink',     label: 'Shrink' },
]

/** Tabs that run on their own period rather than the module's calendar window. */
const OWN_TIMEFRAME = ['/inventory/shrink']

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const sharedTimeframe = !OWN_TIMEFRAME.some(p => pathname.startsWith(p))

  return (
    <div className="sk-page">
      <div className="sk-pagebar">
        <div>
          <Link href="/" className="sk-eyebrow sk-backlink">← Dashboard</Link>
          <h1>Inventory</h1>
        </div>
        {sharedTimeframe && (
          <div className="sk-pagebar-right">
            <div className="sk-pagebar-filters">
              <Suspense fallback={null}>
                <InventoryTimeframe />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      <nav className="sk-tabs" aria-label="Inventory sections">
        {TABS.map(t => {
          const active = t.href === '/inventory' ? pathname === '/inventory' : pathname.startsWith(t.href)
          return (
            <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}>
              {t.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}
