/**
 * Injects Sigma MCP patch data into all dashboard data files.
 *
 * Usage: npm run inject   (reads data/mcp-patch.json)
 *
 * Write data/mcp-patch.json first (via Claude + Sigma MCP queries),
 * then run this script. Each top-level key is optional — omit or set
 * to null to skip that data file.
 *
 * Patch file format:
 * {
 *   "sigmaDaily": {           // → data/sigma-daily.json (append new days)
 *     "sales":     [...],     // {date, location, net_sales, gross_sales, voids_amount, orders}
 *     "cogs":      [...],     // {date, location, actual_cogs, theoretical_cogs}
 *     "employees": [...]      // {date, location_code, location, first_name, last_name, position, rate, hours, pay}
 *   },
 *   "eePeriods": {            // → data/ee-periods.json (full replacement)
 *     "weekly":    {...},     // {start, end, byEmpKey, storeTotals, channelEE}
 *     "monthly":   {...},
 *     "quarterly": {...},
 *     "ytd":       {...}
 *   },
 *   "eeDaily": {              // → data/ee-daily.json (full replacement)
 *     "weekStart": "YYYY-MM-DD",
 *     "pines":   [{date, sm, ee}, ...],
 *     "miramar": [...],
 *     "margate": [...]
 *   },
 *   "heatmap": {              // → data/heatmap-daily.json (full replacement, monthly)
 *     "pines":   [{dow, hour, avg_txn, days}, ...],
 *     "miramar": [...],
 *     "margate": [...]
 *   },
 *   "menuMix": {              // → data/menu-mix.json (full replacement, monthly)
 *     "thruDate": "YYYY-MM-DD",
 *     "mix": [{month, location, subcategory, product, qty, sales}, ...]
 *   }
 * }
 */

import fs from 'fs'
import path from 'path'

const DATA_DIR = path.resolve('data')
const PATCH    = path.resolve(DATA_DIR, 'mcp-patch.json')

if (!fs.existsSync(PATCH)) {
  console.error('❌  data/mcp-patch.json not found.')
  console.error('   Write the patch file (via Claude + Sigma MCP queries) then re-run.')
  process.exit(1)
}

const patch = JSON.parse(fs.readFileSync(PATCH, 'utf8')) as {
  sigmaDaily?: {
    sales?:     { date: string; [k: string]: unknown }[]
    cogs?:      { date: string; [k: string]: unknown }[]
    employees?: { date: string; [k: string]: unknown }[]
  } | null
  eePeriods?: {
    weekly?:    unknown
    monthly?:   unknown
    quarterly?: unknown
    ytd?:       unknown
  } | null
  eeDaily?: {
    weekStart: string
    pines:     unknown[]
    miramar:   unknown[]
    margate:   unknown[]
  } | null
  heatmap?: {
    pines:   unknown[]
    miramar: unknown[]
    margate: unknown[]
  } | null
  menuMix?: {
    thruDate: string
    mix:      unknown[]
  } | null
}

let anyWork = false

// ── 1. sigma-daily.json ──────────────────────────────────────────────
if (patch.sigmaDaily) {
  const { sales = [], cogs = [], employees = [] } = patch.sigmaDaily
  const patchDates = new Set([
    ...sales    .map(r => r.date),
    ...cogs     .map(r => r.date),
    ...employees.map(r => r.date),
  ])

  if (patchDates.size === 0) {
    console.log('⚠️  sigmaDaily patch has no rows — skipping.')
  } else {
    const dailyPath = path.join(DATA_DIR, 'sigma-daily.json')
    const d = JSON.parse(fs.readFileSync(dailyPath, 'utf8')) as {
      thruDate: string; refreshedAt: string
      sales:     { date: string; [k: string]: unknown }[]
      cogs:      { date: string; [k: string]: unknown }[]
      channels?: { date: string; [k: string]: unknown }[]
      employees: { date: string; [k: string]: unknown }[]
    }

    const before = { sales: d.sales.length, employees: d.employees.length, thruDate: d.thruDate }

    d.sales     = [...d.sales    .filter(r => !patchDates.has(r.date)), ...sales]
    d.cogs      = [...d.cogs     .filter(r => !patchDates.has(r.date)), ...cogs]
    d.employees = [...d.employees.filter(r => !patchDates.has(r.date)), ...employees]

    const maxDate = [...patchDates].sort().at(-1)!
    if (maxDate > d.thruDate) d.thruDate = maxDate
    d.refreshedAt = new Date().toISOString()

    fs.writeFileSync(dailyPath, JSON.stringify(d, null, 2))
    console.log(`✅ sigma-daily.json: ${before.sales}→${d.sales.length} sales, ${before.employees}→${d.employees.length} labor (thruDate: ${before.thruDate}→${d.thruDate})`)
    anyWork = true
  }
}

// ── 2. ee-periods.json ───────────────────────────────────────────────
if (patch.eePeriods) {
  const eePath = path.join(DATA_DIR, 'ee-periods.json')
  const existing = fs.existsSync(eePath)
    ? JSON.parse(fs.readFileSync(eePath, 'utf8')) as Record<string, unknown>
    : {}

  const updated = {
    refreshedAt: new Date().toISOString(),
    weekly:    patch.eePeriods.weekly    ?? existing.weekly,
    monthly:   patch.eePeriods.monthly   ?? existing.monthly,
    quarterly: patch.eePeriods.quarterly ?? existing.quarterly,
    ytd:       patch.eePeriods.ytd       ?? existing.ytd,
  }

  fs.writeFileSync(eePath, JSON.stringify(updated, null, 2))
  const periods = Object.keys(patch.eePeriods).filter(k => patch.eePeriods![k as keyof typeof patch.eePeriods])
  console.log(`✅ ee-periods.json: updated periods: ${periods.join(', ')}`)
  anyWork = true
}

// ── 3. ee-daily.json ─────────────────────────────────────────────────
if (patch.eeDaily) {
  const eeDailyPath = path.join(DATA_DIR, 'ee-daily.json')
  const updated = {
    weekStart:   patch.eeDaily.weekStart,
    refreshedAt: new Date().toISOString(),
    pines:   patch.eeDaily.pines,
    miramar: patch.eeDaily.miramar,
    margate: patch.eeDaily.margate,
  }
  fs.writeFileSync(eeDailyPath, JSON.stringify(updated, null, 2))
  const totalRows = patch.eeDaily.pines.length + patch.eeDaily.miramar.length + patch.eeDaily.margate.length
  console.log(`✅ ee-daily.json: week ${patch.eeDaily.weekStart}, ${totalRows} rows`)
  anyWork = true
}

// ── 4. heatmap-daily.json ────────────────────────────────────────────
if (patch.heatmap) {
  const hmPath = path.join(DATA_DIR, 'heatmap-daily.json')
  const updated = {
    refreshedAt: new Date().toISOString(),
    pines:   patch.heatmap.pines,
    miramar: patch.heatmap.miramar,
    margate: patch.heatmap.margate,
  }
  fs.writeFileSync(hmPath, JSON.stringify(updated, null, 2))
  const total = patch.heatmap.pines.length + patch.heatmap.miramar.length + patch.heatmap.margate.length
  console.log(`✅ heatmap-daily.json: ${total} cells`)
  anyWork = true
}

// ── 5. menu-mix.json ─────────────────────────────────────────────────
if (patch.menuMix) {
  const mmPath = path.join(DATA_DIR, 'menu-mix.json')
  const existing = fs.existsSync(mmPath)
    ? JSON.parse(fs.readFileSync(mmPath, 'utf8')) as { productMeta?: unknown }
    : {}
  const updated = {
    refreshedAt:  new Date().toISOString(),
    thruDate:     patch.menuMix.thruDate,
    mix:          patch.menuMix.mix,
    productMeta:  existing.productMeta ?? {},
  }
  fs.writeFileSync(mmPath, JSON.stringify(updated, null, 2))
  console.log(`✅ menu-mix.json: ${patch.menuMix.mix.length} rows, thruDate ${patch.menuMix.thruDate}`)
  anyWork = true
}

if (!anyWork) {
  console.log('⚠️  No sections found in patch file. Nothing updated.')
  process.exit(0)
}

console.log('\n🎯 Patch applied. Run  npm run ship  to rebuild cache and deploy.')
