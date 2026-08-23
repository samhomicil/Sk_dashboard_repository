/**
 * Mint a local session cookie so authenticated pages can be exercised without a browser
 * sign-in. LOCAL ONLY — it signs with the AUTH_SECRET in .env.local and the cookie it
 * prints is accepted by nothing else. It exists because every inventory screen is behind
 * the session gate, so "does this page actually render real data" is otherwise
 * unanswerable from a terminal.
 *
 *   npx tsx scripts/mint-dev-cookie.ts [email]
 */
import { encode } from '@auth/core/jwt'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }))

const secret = env.AUTH_SECRET
if (!secret) throw new Error('AUTH_SECRET missing from .env.local')

const email = process.argv[2] ?? 'samhomicil@gmail.com'
// Dev server is http, so next-auth uses the un-prefixed cookie name.
const cookieName = 'authjs.session-token'

// Wrapped rather than top-level await: tsx transforms this file to CJS, where
// top-level await is a syntax error.
async function main() {
  const token = await encode({
    token: { name: 'Dev', email, sub: 'dev-local' },
    secret,
    salt: cookieName,
    maxAge: 60 * 60,
  })
  process.stdout.write(`${cookieName}=${token}\n`)
}
void main()
