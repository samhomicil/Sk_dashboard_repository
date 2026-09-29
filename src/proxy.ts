import { auth, isOwner } from '@/auth'
import { NextResponse } from 'next/server'
import { agentRole } from '@/lib/agentAuth'
import { scopeFor } from '@/lib/storeAccess'

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
 *   3. Store gate — a store's own login (storeAccess.ts) sees only that store:
 *      ?store= is forced to it on every data API, group-total APIs are refused,
 *      and a signed-in manager with no store assignment gets no store data.
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
  // Both read sk_bills and both already call requireOwner() in-handler, so they were
  // never exposed — but only one of the two required gates was doing the work. That
  // matters more now that an agent token can present credentials: the middleware is
  // where a manager-scope token gets turned away.
  '/api/budget', '/api/balances',
  // /api/employees/roster and /api/employees/profile are deliberately NOT here any more:
  // managers read the crew, pay included, because they do the hiring (Sam, 2026-09-29).
  // Both routes stay fail-closed in-handler and are store-locked (store-guard.ts), so a
  // store's own login sees only its own crew. The parent /api/employees was never here.
]

// Group-total APIs with no single-store version (combined purchasing). A store-locked
// login is refused outright rather than shown every store's spend. The handlers call
// requireAllStores() as the second gate.
const ALL_STORES_ONLY_APIS = [
  '/api/inventory/overview', '/api/inventory/categories',
  '/api/inventory/vendors', '/api/inventory/live',
]
// Inventory pages built on combined purchasing (they all read /api/inventory/live).
// A store-locked login is sent to its own order guide instead of an error screen.
const ALL_STORES_ONLY_PAGES = ['/inventory', '/inventory/categories', '/inventory/stores', '/inventory/vendors']
// Carry no store data (cache freshness only) — reachable by an unassigned login.
const STORELESS_APIS = ['/api/meta', '/api/health']

const under = (list: string[], pathname: string) =>
  list.some(p => pathname === p || pathname.startsWith(p + '/'))

function isOwnerOnly(pathname: string): boolean {
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/')
  return OWNER_PAGES.some(hit) || OWNER_APIS.some(hit)
}

export default auth(async (req) => {
  const { pathname, search } = req.nextUrl

  // 0) agent gate — the MCP connector presents a bearer token instead of a session, so
  //    other AI sessions can ask about a module and get the SAME numbers the screen
  //    shows (the routes run the rules; nothing re-implements them). The owner gate is
  //    still applied by ROLE below, so a manager-scope token cannot read financials.
  const agent = await agentRole()
  if (agent) {
    if (isOwnerOnly(pathname) && agent !== 'owner') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return NextResponse.next()
  }

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

  // 3) store gate — a store's own login sees only that store. Every data API reads its
  //    store from ?store=, so the param is forced to the caller's store here; the
  //    handlers re-derive it from the session (store-guard.ts) as the second gate.
  if (!pathname.startsWith('/api') && ALL_STORES_ONLY_PAGES.includes(pathname)) {
    const email = req.auth.user?.email
    if (scopeFor(email, isOwner(email)) !== 'all') {
      return NextResponse.redirect(new URL('/inventory/watchlist', req.nextUrl.origin))
    }
  }
  if (pathname.startsWith('/api') && !under(STORELESS_APIS, pathname)) {
    const email = req.auth.user?.email
    const scope = scopeFor(email, isOwner(email))
    if (scope === null) {
      return NextResponse.json({ error: 'forbidden', reason: 'no store is assigned to this login' }, { status: 403 })
    }
    if (scope !== 'all') {
      if (under(ALL_STORES_ONLY_APIS, pathname)) {
        return NextResponse.json({ error: 'forbidden', reason: 'group totals are not available to a single-store login' }, { status: 403 })
      }
      if (req.nextUrl.searchParams.get('store') !== scope) {
        const url = req.nextUrl.clone()
        url.searchParams.set('store', scope)
        return NextResponse.rewrite(url)
      }
    }
  }
})

export const config = {
  matcher: [
    '/((?!api/auth|api/ingest-refresh|api/sync|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|json|woff2?)$).*)',
  ],
}
