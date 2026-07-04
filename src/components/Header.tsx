'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { STORE_LABELS } from '@/lib/config'
import type { Store, Period } from '@/lib/types'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'weekly',    label: 'Weekly'    },
  { key: 'monthly',   label: 'Monthly'   },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'ytd',       label: 'YTD'       },
  { key: 'custom',    label: 'Custom'    },
]

interface Props {
  store:    Store
  period:   Period
  dates:    { start: string; end: string; pyStart: string; pyEnd: string }
  onStore:  (s: Store)  => void
  onPeriod: (p: Period) => void
  onCustomRange: (start: string, end: string) => void
  refreshedAt:  string | null
  onRefresh:    () => void
  refreshing:   boolean
  refreshMsg:   string | null
}

function fmt(iso: string) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${m}/${d}`
}

function fmtRefreshed(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const NAV_LINKS = [
  { href: '/',          label: 'Dashboard' },
  { href: '/menu-mix',  label: 'Menu Mix'  },
]

export default function Header({ store, period, dates, onStore, onPeriod, onCustomRange, refreshedAt, onRefresh, refreshing, refreshMsg }: Props) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [showCustom, setShowCustom] = useState(false)
  const [cStart, setCStart] = useState(dates.start)
  const [cEnd,   setCEnd]   = useState(dates.end)

  function handlePeriod(p: Period) {
    if (p === 'custom') {
      const e = new Date(); e.setDate(e.getDate() - 1)
      const s = new Date(e); s.setDate(s.getDate() - 13)
      const se = s.toISOString().slice(0, 10)
      const ee = e.toISOString().slice(0, 10)
      setCStart(se); setCEnd(ee)
      setShowCustom(true)
      onPeriod(p)
      onCustomRange(se, ee)
    } else {
      setShowCustom(false)
      onPeriod(p)
    }
  }

  function applyCustom() {
    if (cStart && cEnd) onCustomRange(cStart, cEnd)
  }

  return (
    <div className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Logo + nav */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-teal-700 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">SK</div>
              <div className="hidden sm:block">
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">SK Wellness</div>
              </div>
            </div>
            <div className="flex gap-1">
              {NAV_LINKS.map(({ href, label }) => (
                <Link key={href} href={href}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    pathname === href
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}>
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Store selector */}
            <select
              value={store}
              onChange={e => onStore(e.target.value as Store)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 font-semibold text-slate-700 bg-white cursor-pointer"
              style={{ appearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '28px' }}
            >
              {Object.entries(STORE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{k === 'all' ? '🏪' : '📍'} {v}</option>
              ))}
            </select>

            {/* Period tabs */}
            <div className="flex gap-1">
              {PERIODS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => handlePeriod(key)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                    period === key
                      ? 'bg-teal-700 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Date label */}
            <div className="text-xs text-slate-400">
              <span className="font-semibold text-slate-500">{fmt(dates.start)}–{fmt(dates.end)}</span>
              <span className="mx-1">·</span>
              PY <span className="font-semibold text-slate-500">{fmt(dates.pyStart)}–{fmt(dates.pyEnd)}</span>
            </div>

            {/* Refresh button + status */}
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title={refreshMsg ?? (refreshedAt ? `Data as of ${fmtRefreshed(refreshedAt)}` : 'No data yet')}
              className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors
                ${refreshing
                  ? 'bg-amber-50 text-amber-700 border-amber-200 cursor-default'
                  : refreshedAt
                    ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100 cursor-pointer'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 cursor-pointer'
                }`}
            >
              {refreshing ? (
                <>
                  <svg className="animate-spin w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {refreshMsg ?? 'Refreshing...'}
                </>
              ) : (
                <>
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {refreshedAt ? `Updated ${fmtRefreshed(refreshedAt)}` : 'Refresh Data'}
                </>
              )}
            </button>

            {/* User avatar + sign out */}
            {session?.user && (
              <div className="flex items-center gap-2 ml-1">
                {session.user.image
                  ? <img src={session.user.image} alt="" className="w-7 h-7 rounded-full" />
                  : <div className="w-7 h-7 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-bold">
                      {session.user.name?.[0] ?? '?'}
                    </div>
                }
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Custom date picker */}
        {showCustom && (
          <div className="mt-3 flex items-center gap-3 flex-wrap border-t border-slate-100 pt-3">
            <span className="text-xs font-semibold text-slate-500">Custom Range:</span>
            <div className="flex items-center gap-2">
              <input type="date" value={cStart} onChange={e => setCStart(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700" />
              <span className="text-slate-400 text-sm">to</span>
              <input type="date" value={cEnd} onChange={e => setCEnd(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700" />
            </div>
            <div className="flex gap-2">
              {[
                { label: 'Last 14d', days: 14 },
                { label: 'Last 30d', days: 30 },
                { label: 'Last 90d', days: 90 },
              ].map(({ label, days }) => (
                <button key={label} onClick={() => {
                  const e = new Date(); e.setDate(e.getDate() - 1)
                  const s = new Date(e); s.setDate(s.getDate() - days + 1)
                  const se = s.toISOString().slice(0,10); const ee = e.toISOString().slice(0,10)
                  setCStart(se); setCEnd(ee); onCustomRange(se, ee)
                }} className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:border-teal-400 hover:text-teal-700">
                  {label}
                </button>
              ))}
            </div>
            <button onClick={applyCustom}
              className="px-4 py-1.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800">
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
