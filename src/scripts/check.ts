/**
 * INVARIANT CHECKS — `npm run check`
 *
 * The rules this app depends on are the kind that are easy to state and easy to
 * break months later in a different file. Every check here exists because the thing
 * it guards actually went wrong:
 *
 *   - `config.ts` and `core/targets.ts` both claimed to be the canonical labor
 *     target and disagreed (25% vs 22%), so the same store read "on target" on the
 *     Overview and "over" on Weekly Ops in the same week.
 *   - a data source was queried whose freshness nobody tracked, and it silently fell
 *     8 days behind while three modules kept rendering confident numbers from it.
 *   - an owner-only API shipped without its in-handler guard, leaving the middleware
 *     as a single point of failure for financial data.
 *
 * These are cheap, dependency-free (plain tsx, no test framework) and run in ~1s.
 * Add a check whenever something breaks in a way a rule could have caught.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { SOURCES } from '../lib/core/freshness'
import { LABOR_TARGET, COGS_TARGET } from '../lib/core/targets'
import { TARGETS } from '../lib/config'

const ROOT = join(__dirname, '..')
let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = '') {
  checks++
  if (ok) { console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { failures++; console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? '\n      ' + detail.replace(/\n/g, '\n      ') : ''}`) }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === 'pfg_extractor') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}
const FILES = walk(ROOT).map(p => ({ path: p, rel: relative(ROOT, p), src: readFileSync(p, 'utf8') }))
const src = (rel: string) => FILES.find(f => f.rel === rel)?.src ?? ''

console.log('\nSK Dashboard — invariant checks\n')

// ── 1. One canonical value per target ────────────────────────────────────────
console.log('Targets')
check('config.TARGETS.laborPct === core LABOR_TARGET', TARGETS.laborPct === LABOR_TARGET,
  `config=${TARGETS.laborPct} core=${LABOR_TARGET} — a target must be defined once, in core/targets.ts, and re-exported.`)
check('config.TARGETS.cogsPct === core COGS_TARGET', TARGETS.cogsPct === COGS_TARGET,
  `config=${TARGETS.cogsPct} core=${COGS_TARGET}`)
{
  // no file may restate a target as a literal
  const offenders = FILES.filter(f =>
    !f.rel.includes('core/targets') && !f.rel.includes('scripts/check') &&
    /(?:laborTarget|LABOR_TARGET|labor_target)\s*[:=]\s*0\.\d+/.test(f.src))
  check('no hardcoded labor target outside core/targets.ts', offenders.length === 0,
    offenders.map(o => o.rel).join('\n'))
}

// ── 2. Every queried data source declares a freshness contract ───────────────
console.log('\nData sources')
{
  const declared = new Set(SOURCES.map(s => s.table))
  const queried = new Set<string>()
  for (const f of FILES) {
    if (f.rel.includes('core/freshness')) continue
    for (const m of f.src.matchAll(/\b(smoothieking\.[a-z_]+|sk_bills\.[A-Za-z_]+)\b/g)) queried.add(m[1])
  }
  const undeclared = [...queried].filter(t => !declared.has(t)).sort()
  check('every queried table is in the freshness registry', undeclared.length === 0,
    undeclared.length ? `undeclared: ${undeclared.join(', ')}\n  -> add it to src/lib/core/freshness.ts with a maxAgeDays` : '')
  const unused = [...declared].filter(t => !queried.has(t)).sort()
  check('registry has no entries the app never queries', unused.length === 0,
    unused.length ? `declared but unused: ${unused.join(', ')}` : '')
  check('every source names what feeds it and who consumes it',
    SOURCES.every(s => s.fedBy.length > 0 && s.consumers.length > 0))
}

// ── 3. Metric definitions live in one place ──────────────────────────────────
console.log('\nMetric sources')
{
  // Net sales is hand-typed in several queries. Importing NET_SALES everywhere is the
  // goal, but the invariant that actually protects the numbers is weaker and stricter
  // at once: every occurrence must be the SAME expression. One edited copy is how two
  // surfaces start disagreeing about the same metric.
  const NORM = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const variants = new Map<string, string[]>()
  for (const f of FILES) {
    if (f.rel.includes('scripts/check')) continue
    for (const m of f.src.matchAll(/case\s+when\s+voided[^)]*?then\s+net_sales\s+else\s+0\s+end/gi)) {
      const k = NORM(m[0]); variants.set(k, [...(variants.get(k) ?? []), f.rel])
    }
  }
  const occurrences = [...variants.values()].reduce((n, v) => n + v.length, 0)
  check(`all ${occurrences} net-sales expressions are identical`, variants.size <= 1,
    variants.size > 1
      ? [...variants.entries()].map(([k, fs]) => `  "${k}"\n     ${[...new Set(fs)].join(', ')}`).join('\n')
        + '\n  -> they must match core/sources.ts NET_SALES exactly'
      : '')
  check('the old 1-week netchef_usage table is not used', !FILES.some(f =>
    /smoothieking\.netchef_usage\b(?!_api)/.test(f.src) && !f.rel.includes('scripts/check')),
    'netchef_usage holds ~1 week; use netchef_usage_api (~30 weeks).')
}

// ── 4. Money routes are gated twice ──────────────────────────────────────────
console.log('\nSecurity')
{
  const proxy = src('proxy.ts')
  const ownerApis = [...proxy.matchAll(/'(\/api\/[a-z-]+)'/g)].map(m => m[1])
    .filter(p => proxy.split('OWNER_APIS')[1]?.split(']')[0]?.includes(p))
  const missing: string[] = []
  for (const api of ownerApis) {
    const routes = FILES.filter(f => f.rel.startsWith(`app${api}/`) && f.rel.endsWith('route.ts'))
    for (const r of routes) if (!/requireOwner\s*\(/.test(r.src)) missing.push(r.rel)
  }
  check('every owner-gated API also calls requireOwner()', missing.length === 0, missing.join('\n'))
  check('no route forwards raw SQL from its request body',
    !FILES.some(f => f.rel.startsWith('app/api/') && /body\)?\s*,?\s*\}?\s*\)/.test(f.src) &&
      /JSON\.stringify\(\s*body\s*\)/.test(f.src) && /PROXY_URL/.test(f.src)),
    'An /api/query-style passthrough lets any signed-in user run arbitrary SQL.')
}

// ── 5. Manager-facing surfaces stay unloaded ─────────────────────────────────
console.log('\nManager / owner separation')
{
  const ops = src('app/api/ops-week/route.ts')
  check('Weekly Ops carries no tips / manager salary / burden',
    !/TIP_PAYOUT|MGR_WK|empBurden|PAY_BURDEN/.test(ops),
    'Labor shown to managers is unloaded hourly wages only; loaded cost is owner-side.')
}

console.log(`\n${failures === 0 ? '\x1b[32mall ' + checks + ' checks passed\x1b[0m' : `\x1b[31m${failures} of ${checks} checks FAILED\x1b[0m`}\n`)
process.exit(failures === 0 ? 0 : 1)
