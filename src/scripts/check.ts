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
  // core/onHand is the one legitimate reader: it needs the most recent FULL physical
  // inventory to anchor the nightly chain, and netchef_usage carries that a week fresher
  // than netchef_usage_api (2026-08-03 vs 2026-07-27 as of 2026-08-09). It reads only
  // qty_physical for the anchor, never usage history.
  check('the old 1-week netchef_usage table is used only to anchor core/onHand', !FILES.some(f =>
    /smoothieking\.netchef_usage\b(?!_api)/.test(f.src)
    && !f.rel.includes('scripts/check') && f.rel !== 'lib/core/onHand.ts'
    && f.rel !== 'lib/core/freshness.ts'),
    'netchef_usage holds ~1 week of usage; use netchef_usage_api (~30 weeks) for history.')
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

// ── 5b. Wide Promise.all must bind by name ───────────────────────────────────
// ops-week destructured a nine-element Promise.all positionally and had prior-year
// swapped with the trailing-4-week history. Both were SalesRow[], so the types matched,
// nothing threw, and the failure surfaced only as "—" in the PY column — while the
// same-weekday forecast was quietly built from last year's week and PFG order targets
// were sized off it (Margate's next-week forecast ran 31% low).
console.log('\nAwait shapes')
{
  // The dangerous shape is specifically N positional bindings where two or more entries
  // share the SAME row type — that is what let prior-year and history trade places with
  // tsc none the wiser. Distinct types, or self-documenting entries like
  // sub(getKpis, '/api/kpis'), are legible enough that a swap would be caught on sight.
  const offenders: string[] = []
  for (const f of FILES) {
    if (!f.rel.startsWith('app/api/') && !f.rel.startsWith('lib/')) continue
    for (const m of f.src.matchAll(/const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\n\s{0,4}\]\)/g)) {
      const names = m[1].split(',').filter(x => x.trim()).length
      if (names < 4) continue
      const types = [...m[2].matchAll(/\bquery<([^>]+?)>/g)].map(t => t[1].replace(/\s+/g, ''))
      const dupes = types.filter((t, i) => types.indexOf(t) !== i)
      if (dupes.length) offenders.push(`${f.rel} — ${names} positional bindings, type ${[...new Set(dupes)][0]} appears ${types.filter(t => t === dupes[0]).length}x`)
    }
  }
  check('no positional Promise.all mixes repeated row types', offenders.length === 0,
    offenders.join('\n') + (offenders.length
      ? '\n  -> bind by key (see allKeyed in app/api/ops-week/route.ts); two entries of the '
        + 'same type can swap silently past tsc'
      : ''))
}

// ── 6. Inventory core is the only source of on-hand, usage and sourcing ──────
// Every rule below guards a contradiction that was live in production on 2026-08-09,
// when the order guide and the daily sourcing board disagreed on the same items by
// 548 units vs 55 — including a 169-unit order against a negative on-hand.
console.log('\nInventory / order-guide core')
{
  const guide = src('lib/orderGuide.ts')
  const consumers = FILES.filter(f =>
    /netchef_usage_api|netchef_onhand/.test(f.src) && !f.rel.startsWith('lib/core/') && !f.rel.startsWith('scripts/'))

  check('order guide reads on-hand from core/onHand, not netchef_onhand.on_hand_qty',
    /buildOnHand\(/.test(guide),
    'netchef_onhand carries blank counts through as negatives; core/onHand blends and floors them.')

  // Dangerous form is `period_end = (SELECT MAX(period_end) ...)` — "give me the latest
  // period", which now returns a single night. Using MAX only to anchor a window
  // (`>= DATEADD(week,-8, MAX(period_end))`) is fine and stays allowed.
  check('no surface treats the LATEST netchef_usage_api period as a week',
    !consumers.some(f => /period_end\s*=\s*\(\s*SELECT\s+MAX\(period_end\)/i.test(f.src)),
    'MAX(period_end) now resolves to a ONE-DAY nightly period. Anything calling that '
    + 'result "weekly" forecasts a week of demand from a single night. Use core/usage.')

  check('COGS windows pair sales to each period, not to the outer span',
    !/MIN\(period_start\)\s*ps,\s*MAX\(period_end\)\s*pe/.test(src('app/api/budget/route.ts')),
    'netchef_usage_api has gaps (Jul 28-Aug 2 2026 is absent). Dividing summed COGS by '
    + 'a MIN..MAX sales span understated food cost % by 10% on the Budget module.')

  check('multi-week COGS averages exclude 1-day nightly periods',
    /period_start\s*<>\s*u?\.?period_end/.test(src('app/api/ops-week/route.ts')),
    'Averaging a single night in as if it were a week skews the derived COGS target.')

  check('the demand clamp is not wide enough to hide a broken window',
    !/Math\.min\(\s*2\s*,/.test(guide),
    'A [0.5, 2] clamp pinned at 2.00 for every store while the true ratio ran 4.5-7.7, '
    + 'capping demand at ~2/7ths of real and masking the one-day window bug.')

  check('delivery cadence is declared once, in core/targets',
    !FILES.some(f => !f.rel.startsWith('lib/core/') &&
      /(DELIVERY_DAYS|deliveryDays)\s*:?\s*Record<string, number\[\]>\s*=/.test(f.src)),
    'Pines/Miramar Tue+Fri vs Margate Tue drives every cover calculation; a second copy '
    + 'is how two surfaces start disagreeing about when a truck arrives.')

  check('transfer eligibility is declared once, in core/sourcing',
    !FILES.some(f => f.rel !== 'lib/core/sourcing.ts' && /const DRY_MICROS\s*=/.test(f.src)),
    'Fruit and frozen must never be offered as a transfer.')

  check('order quantities are expressed in purchasable units',
    /loadCasePacks\(/.test(guide) && /poolOrders\(/.test(guide),
    'PFG ships whole cases; "order 2.1 LB of Gladiator" is not an action a manager can take.')

  check('the guide collapses to buckets instead of listing every SKU',
    /bucketOf\(/.test(guide) && /collapsed/.test(guide),
    'The guide covers ~450 rows; only act/soon are worth a manager\'s morning.')
}

console.log(`\n${failures === 0 ? '\x1b[32mall ' + checks + ' checks passed\x1b[0m' : `\x1b[31m${failures} of ${checks} checks FAILED\x1b[0m`}\n`)
process.exit(failures === 0 ? 0 : 1)
