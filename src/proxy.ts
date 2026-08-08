import { auth, isOwner } from '@/auth'
import { NextResponse } from 'next/server'

/**
 * Route gate (Next.js 16 "proxy" — the renamed middleware convention).
 *
 * Two layers:
 *   1. Session gate — every route requires a valid session. Unauthenticated page
 *      requests redirect to /login; API requests get a clean 401 JSON.
 *   2. Owner gate — the financial (bills) modules are visible to owners only.
 *      A manager (allowed to sign in, but not an owner) hitting a financial page
 *      is redirected home; a financial API returns 403 JSON. This is the security
 *      boundary — never rely on hiding nav alone.
 *
 * Public exceptions (handled by the matcher — they never reach here):
 *   - /api/auth/*          NextAuth's own sign-in / callback / session routes
 *   - /api/ingest-refresh  the 6am cloud routine POSTs here with x-refresh-key
 *   - /api/sync            the balance-sync cron, authenticated with CRON_SECRET
 *   - /login               the sign-in screen
 *   - Next internals and static assets
 */

// Owner-only route prefixes (financial / bills modules). Matched as exact path or
// path + '/'. /api/sync is intentionally absent — it's a cron (CRON_SECRET), not
// session-authenticated, and is excluded from the matcher below.
// `/api/cost-plan` has no route yet — it is pre-gated on purpose so the planned
// route can't ship ungated by accident. Keep entries here ahead of the code.
const OWNER_PAGES = ['/bills', '/cashflow', '/pnl', '/transactions', '/settings', '/financials']
const OWNER_APIS = [
  '/api/bills', '/api/forecast', '/api/cost-plan', '/api/accounts',
  '/api/payments', '/api/reconcile', '/api/qb', '/api/sales',
  '/api/openbudget', '/api/transactions',
]

function isOwnerOnly(pathname: string): boolean {
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/')
  return OWNER_PAGES.some(hit) || OWNER_APIS.some(hit)
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl

  // 1) session gate
  if (!req.auth) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const url = new URL('/login', req.nextUrl.origin)
    url.searchParams.set('callbackUrl', pathname + search)
    return NextResponse.redirect(url)
  }

  // 2) owner gate for financial modules
  if (isOwnerOnly(pathname) && !isOwner(req.auth.user?.email)) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/', req.nextUrl.origin))
  }
})

export const config = {
  matcher: [
    '/((?!api/auth|api/ingest-refresh|api/sync|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|json|woff2?)$).*)',
  ],
}
