/**
 * Injects Sigma data from data/sigma-patch.json into data/sigma-daily.json.
 *
 * Usage: npx tsx src/scripts/sigma-inject.ts
 *
 * The patch file format:
 *   { "sales": [...], "cogs": [...], "employees": [...] }
 *
 * Any dates present in the patch are first removed from the existing file
 * to prevent duplicates, then the new rows are appended.
 */

import fs from 'fs'
import path from 'path'

const DAILY = path.resolve('data/sigma-daily.json')
const PATCH = path.resolve('data/sigma-patch.json')

if (!fs.existsSync(PATCH)) {
  console.error('❌  data/sigma-patch.json not found. Write the patch file first.')
  process.exit(1)
}

const patch = JSON.parse(fs.readFileSync(PATCH, 'utf8')) as {
  sales?:     { date: string; [k: string]: unknown }[]
  cogs?:      { date: string; [k: string]: unknown }[]
  employees?: { date: string; [k: string]: unknown }[]
}

const patchDates = new Set([
  ...(patch.sales     ?? []).map(r => r.date),
  ...(patch.cogs      ?? []).map(r => r.date),
  ...(patch.employees ?? []).map(r => r.date),
])

if (patchDates.size === 0) {
  console.log('⚠️  Patch file has no rows — nothing to do.')
  process.exit(0)
}

const daily = JSON.parse(fs.readFileSync(DAILY, 'utf8')) as {
  thruDate:    string
  refreshedAt: string
  sales:       { date: string; [k: string]: unknown }[]
  cogs:        { date: string; [k: string]: unknown }[]
  employees:   { date: string; [k: string]: unknown }[]
}

console.log(`📂 sigma-daily.json: ${daily.sales.length} sales / ${daily.employees.length} labor (thruDate: ${daily.thruDate})`)
console.log(`📋 Patch: ${[...patchDates].sort().join(', ')} (${patchDates.size} dates)`)

// Remove existing rows for patched dates then append new ones
daily.sales     = [...daily.sales    .filter(r => !patchDates.has(r.date)), ...(patch.sales     ?? [])]
daily.cogs      = [...daily.cogs     .filter(r => !patchDates.has(r.date)), ...(patch.cogs      ?? [])]
daily.employees = [...daily.employees.filter(r => !patchDates.has(r.date)), ...(patch.employees ?? [])]

// Update thruDate to the latest date in the patch
const maxDate = [...patchDates].sort().at(-1)!
if (maxDate > daily.thruDate) daily.thruDate = maxDate
daily.refreshedAt = new Date().toISOString()

fs.writeFileSync(DAILY, JSON.stringify(daily, null, 2))
console.log(`✅ sigma-daily.json updated: ${daily.sales.length} sales / ${daily.employees.length} labor (thruDate: ${daily.thruDate})`)
