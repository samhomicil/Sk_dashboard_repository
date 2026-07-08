'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'

const INVENTORY_SUB = [
  { label: 'Overview',            href: '/inventory' },
  { label: 'By Category',         href: '/inventory/categories' },
  { label: 'By Store',            href: '/inventory/stores' },
  { label: 'By Vendor',           href: '/inventory/vendors' },
  { label: 'Actions & Watchlist', href: '/inventory/watchlist' },
]

export default function AppSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [collapsed, setCollapsed]         = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(pathname.startsWith('/inventory'))

  const onInventory = pathname.startsWith('/inventory')

  // Keep the Inventory group open while inside it — adjusted during render
  // (not an effect) per React's guidance for deriving state from a prop change.
  const [prevOnInventory, setPrevOnInventory] = useState(onInventory)
  if (onInventory !== prevOnInventory) {
    setPrevOnInventory(onInventory)
    if (onInventory) setInventoryOpen(true)
  }

  if (pathname === '/login') return null

  const item = (active: boolean, extra = '') =>
    `sk-item${active ? ' active' : ''}${extra ? ' ' + extra : ''}`

  return (
    <aside className={`sk-side${collapsed ? ' collapsed' : ''}`}>
      <Link href="/" className="sk-brand">
        <span className="sk-mark">SK</span>
        <span className="sk-nm">SK Wellness</span>
      </Link>

      <div className="sk-navlabel">Menu</div>
      <nav className="sk-nav">
        <Link href="/" className={item(pathname === '/')}>
          <svg className="sk-ico" viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
            <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
          </svg>
          <span className="sk-lbl">Dashboard</span>
        </Link>

        <Link href="/menu-mix" className={item(pathname.startsWith('/menu-mix'))}>
          <svg className="sk-ico" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
            <path d="M9 9h6M9 13h6M9 17h4" />
          </svg>
          <span className="sk-lbl">Menu Mix</span>
        </Link>

        {/* Inventory parent */}
        <Link href="/inventory" className={item(onInventory, onInventory ? 'section' : '')}>
          <svg className="sk-ico" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" />
          </svg>
          <span className="sk-lbl">Inventory</span>
          <svg
            className={`sk-chev${inventoryOpen ? '' : ' closed'}`}
            viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInventoryOpen(v => !v) }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </Link>
        <div className={`sk-subnav${inventoryOpen ? ' open' : ''}`}>
          <div className="sk-subwrap">
            {INVENTORY_SUB.map(s => {
              const active = s.href === '/inventory' ? pathname === '/inventory' : pathname.startsWith(s.href)
              return (
                <Link key={s.href} href={s.href} className={`sk-subitem${active ? ' active' : ''}`}>
                  <span className="sk-sdot" />{s.label}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      <div className="sk-spring" />

      <div className="sk-foot">
        <div className="sk-foot-actions">
          {session?.user && (
            <button className="sk-fbtn" onClick={() => signOut({ callbackUrl: '/login' })}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
              <span className="sk-fl">Sign out</span>
            </button>
          )}
          <button className="sk-fbtn sk-collapse-toggle" title="Collapse" onClick={() => setCollapsed(v => !v)}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
