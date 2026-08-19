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
{
  // Generalisation of the rule above: a target, threshold or band is a BUSINESS RULE,
  // and every one of them belongs in core/targets.ts. Six were living as literals in
  // components and route handlers (prime 0.52, the manager's $625/wk, two 0.85 quality
  // targets, the per-store UPH bands, the watchlist thresholds) — each one invisible to
  // anyone reading targets.ts and asking "what does this app grade against?".
  //
  // Two patterns are refused anywhere but core/targets.ts:
  //   a. a const NAMED like a target   — *TARGET / *THRESHOLD, any case
  //   b. a const named like one of the relocated rules, re-declared locally
  // Importing them and aliasing (`const QUALITY_TARGET = JOLT_QUALITY_TARGET`) is fine:
  // the right-hand side is an identifier, not a literal.
  const NAMED = /^[ \t]*(?:export )?const [A-Za-z_][A-Za-z0-9_]*(?:TARGET|TARGETS|THRESHOLD|THRESHOLDS|Target|Threshold)[A-Za-z0-9_]*[ \t]*(?::[^=]+)?=[ \t]*[0-9{]/m
  const RELOCATED = /^[ \t]*(?:export )?const (?:MGR_WK|MGR_WEEKLY|STORE_UPH|STORE_TARGETS|PRIME_TARGET|FAST_MOVER_(?:DAYS|THRESHOLD_DAYS)|VARIANCE_FLAG_(?:PCT|THRESHOLD_PCT)|STAFFING_BANDS)[ \t]*(?::[^=]+)?=[ \t]*[0-9{[]/m
  const offenders = FILES.filter(f =>
    !f.rel.includes('core/targets') && !f.rel.includes('scripts/check') &&
    (NAMED.test(f.src) || RELOCATED.test(f.src)))
  check('no target/threshold literal outside core/targets.ts', offenders.length === 0,
    offenders.map(o => o.rel).join('\n') +
    (offenders.length ? '\n  -> move the value to src/lib/core/targets.ts and import it' : ''))
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
  // The two usage tables are not interchangeable and neither is sufficient alone:
  //   netchef_usage      CrunchTime's own scrape. qty_issue is THEIRS, so it carries no
  //                      modelling residual — but it only reaches back to 2026-07-27.
  //   netchef_usage_api  our reconstruction. Reaches back to 2025-12-30, but qty_issue is
  //                      COMPUTED by theoretical.py, so every row needs a confidence tier.
  // Reading the scrape ALONE silently truncates history to a few weeks and hides the
  // model caveat on the weeks that still need it, so a reader must cover both.
  const scrapeOnly = FILES.filter(f =>
    /smoothieking\.netchef_usage\b(?!_api)/.test(f.src)
    && !/netchef_usage_api/.test(f.src)
    && !f.rel.includes('scripts/check') && f.rel !== 'lib/core/freshness.ts')
  check('netchef_usage is never read without netchef_usage_api alongside it',
    scrapeOnly.length === 0, scrapeOnly.map(f => '  ' + f.rel).join('\n')
    + '\n  -> netchef_usage starts 2026-07-27; fall back to netchef_usage_api for older periods.')
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

// ── 4b. Agent access must not widen the owner boundary ───────────────────────
console.log('\nAgent access')
{
  const proxy = src('proxy.ts')
  const guard = src('lib/owner-guard.ts')
  check('the agent gate is applied in proxy AND in the handler guard',
    /agentRole\(/.test(proxy) && /agentRole\(/.test(guard),
    'AGENTS.md rule 2: money routes need both gates. An agent token that only the '
    + 'middleware understands would sail past requireOwner() and 401 — or worse, a '
    + 'guard that trusted it without the middleware would have no second line.')

  check('a manager-scope agent token is refused on owner routes',
    /agent !== 'owner'/.test(proxy) && /agent === 'manager'/.test(guard),
    'The role must be enforced, not merely carried.')

  // Anything that touches sk_bills is financial. If an agent can reach it, the
  // middleware list has to name it — the in-handler guard alone leaves one gate idle.
  const billsRoutes = FILES
    .filter(f => /^app\/api\/.+route\.ts$/.test(f.rel) && /sk_bills|prisma|QbBalance/.test(f.src))
    .map(f => '/' + f.rel.replace(/^app\//, '').replace(/\/route\.ts$/, ''))
    .filter(r => r !== '/api/sync')   // the cron, authenticated with CRON_SECRET
  const listed = (proxy.match(/'\/api\/[a-z-]+'/g) ?? []).map(s2 => s2.replace(/'/g, ''))
  const unlisted = billsRoutes.filter(r => !listed.includes(r))
  check('every route touching sk_bills is in OWNER_APIS', unlisted.length === 0,
    unlisted.join(', '))
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

  // The rule above only catches the `= (SELECT MAX(period_end))` shape. Shrink picked
  // the latest period a different way — ORDER BY period_end DESC, take the first — and
  // sailed straight past it, reporting a single night's count as a week: +1006% net gap,
  // $11,964 of "overage", a 55-unit chicken count against a zero opening balance. Shrink
  // differences a count against a whole period's book stock, so its period list must be
  // filtered by length, not merely sorted.
  check('shrink measures over real count periods, not nightly counts',
    /INVENTORY_PERIOD_MIN_DAYS/.test(src('lib/shrink.ts')),
    'A one-day period differences one evening\'s shelf against a week of book stock. '
    + 'Filter the period list on core/targets INVENTORY_PERIOD_MIN_DAYS.')

  check('COGS windows pair sales to each period, not to the outer span',
    !/MIN\(period_start\)\s*ps,\s*MAX\(period_end\)\s*pe/.test(src('app/api/budget/route.ts')),
    'netchef_usage_api has gaps (Jul 28-Aug 2 2026 is absent). Dividing summed COGS by '
    + 'a MIN..MAX sales span understated food cost % by 10% on the Budget module.')

  const cogsCore = src('lib/core/cogs.ts')
  check('multi-week COGS averages exclude 1-day nightly periods',
    /period_start\s*<>\s*u?\.?period_end/.test(cogsCore),
    'Averaging a single night in as if it were a week skews the derived COGS target.')

  check('COGS values usage at netchef_onhand.inventory_price, not usage_api.price',
    /inventory_price/.test(cogsCore)
    // strip comments first — the prose in these files quotes the old expression on purpose
    && !FILES.some(f => f.rel !== 'lib/core/cogs.ts' && !f.rel.includes('scripts/check')
      && /qty_issue\s*\*\s*u?\.?price/.test(
        f.src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, ''))),
    'netchef_usage_api.price is empty on 81% of nightly rows (1510 of 1921 with real usage), '
    + 'so qty_issue*price reads 15-16% against a true 24-27%. Use core/cogs.')

  check('no COGS surface reads nightly (1-day) periods',
    [cogsCore, src('lib/cogsCache.ts')].every(f => /period_start\s*<>\s*u?\.?period_end/.test(f)),
    'Nightly rows cannot carry a cost rate: price is empty on 81% of them, and a blank '
    + 'count line makes beginning + received - physical read as total consumption '
    + '(Margate 75.8%, Miramar 61.3% against a theoretical 26.9% / 26.0%). COGS comes '
    + 'from full inventory periods only.')

  check('the COGS rate is never surfaced without the window it was measured over',
    /cogsWindow/.test(src('app/api/ops-week/route.ts')) && /cogsWindow/.test(src('app/ops-report/page.tsx')),
    'A rate shown undated is how a 14-day-old figure got read as current.')

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
