import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

// Allowlist enforcement. A Google account may sign in only if its email is on
// the ALLOWED_EMAILS list (comma-separated env, editable in Vercel without a
// redeploy) OR its domain matches ALLOWED_EMAIL_DOMAIN. Enforced in the signIn
// callback so no session is ever minted for an unauthorized account.
const DEFAULT_ALLOWED = [
  'samhomicil@gmail.com',
  'danieljaybar@gmail.com',
  'admin@smoothiekingsoflo.com',
]

function allowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS
  const list = raw && raw.trim() ? raw.split(',') : DEFAULT_ALLOWED
  return list.map(e => e.trim().toLowerCase()).filter(Boolean)
}

export function isAllowed(email?: string | null): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  if (allowedEmails().includes(e)) return true
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase()
  if (domain && e.endsWith(`@${domain}`)) return true
  return false
}

// Owner allowlist — a subset of allowed users who additionally see the financial
// (bills) modules. Everyone else who can sign in is a manager. Read from
// OWNER_EMAILS (comma-separated env, editable in Vercel) with a safe default.
const DEFAULT_OWNERS = [
  'samhomicil@gmail.com',
  'danieljaybar@gmail.com',
  'admin@smoothiekingsoflo.com',
]

function ownerEmails(): string[] {
  const raw = process.env.OWNER_EMAILS
  const list = raw && raw.trim() ? raw.split(',') : DEFAULT_OWNERS
  return list.map(e => e.trim().toLowerCase()).filter(Boolean)
}

export function isOwner(email?: string | null): boolean {
  if (!email) return false
  return ownerEmails().includes(email.toLowerCase())
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId:     process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    // Denied accounts (and any auth error) come back to the branded /login
    // screen with ?error=... rather than a raw NextAuth error page.
    error: '/login',
  },
  callbacks: {
    signIn({ profile, user }) {
      const email = profile?.email ?? user?.email
      const verified = profile ? profile.email_verified !== false : true
      return verified && isAllowed(email)
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      // Derive role from the signed-in email so the UI can hide owner-only
      // modules. The route gate (proxy.ts) enforces it server-side regardless.
      if (session.user) session.user.role = isOwner(session.user.email) ? 'owner' : 'manager'
      return session
    },
  },
  trustHost: true,
})
