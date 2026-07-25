import { auth } from '@/auth'
import { NextResponse } from 'next/server'

/**
 * Route gate (Next.js 16 "proxy" — the renamed middleware convention).
 *
 * Every route requires a valid session. Unauthenticated page requests redirect
 * to /login; API requests get a clean 401 JSON.
 *
 * Public exceptions (handled by the matcher — they never reach here):
 *   - /api/auth/*          NextAuth's own sign-in / callback / session routes
 *   - /api/ingest-refresh  the 6am cloud routine POSTs here with x-refresh-key
 *   - /login               the sign-in screen
 *   - Next internals and static assets
 */
export default auth((req) => {
  if (req.auth) return

  const { pathname, search } = req.nextUrl

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL('/login', req.nextUrl.origin)
  url.searchParams.set('callbackUrl', pathname + search)
  return NextResponse.redirect(url)
})

export const config = {
  matcher: [
    '/((?!api/auth|api/ingest-refresh|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|json|woff2?)$).*)',
  ],
}
