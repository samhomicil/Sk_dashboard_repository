#!/usr/bin/env node
/**
 * DESIGN LINT RATCHET — `npm run lint:design`
 *
 * design-lint.mjs (from the design handoff) reports 258 findings against the app as
 * it stands, because the app has not been redesigned yet. Wired as a plain gate it
 * would block every commit; deleted, it would report nothing. So it runs as a
 * ratchet: the per-rule counts are frozen in design-lint-baseline.json, and this
 * fails only when a rule's count RISES.
 *
 * The effect is that the redesign can land module by module — each one drives its
 * rules down and re-baselines — while no new violation can be introduced anywhere.
 *
 *   npm run lint:design            check against the baseline
 *   npm run lint:design -- --save  re-freeze after a genuine reduction
 *   npm run lint:design -- --list  the full findings, unfiltered
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LINT = join(HERE, 'design-lint.mjs')
const BASE = join(HERE, 'design-lint-baseline.json')
const TARGET = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]) ?? 'src'

let out = ''
try {
  out = execFileSync(process.execPath, [LINT, TARGET], { encoding: 'utf8' })
} catch (e) {
  out = e.stdout ?? ''        // exits non-zero whenever it finds anything
  if (!out) { console.error(e.message); process.exit(2) }
}

if (process.argv.includes('--list')) { console.log(out); process.exit(0) }

// The human report prints one "  <rule> — <n>" header per rule.
const counts = {}
for (const m of out.matchAll(/^\s{2}([a-z][a-z0-9-]*) — (\d+)$/gm)) counts[m[1]] = Number(m[2])

if (process.argv.includes('--save')) {
  writeFileSync(BASE, JSON.stringify(counts, null, 2) + '\n')
  console.log(`baseline saved — ${Object.values(counts).reduce((a, b) => a + b, 0)} findings across ${Object.keys(counts).length} rules`)
  process.exit(0)
}

if (!existsSync(BASE)) {
  console.error('no baseline — run: npm run lint:design -- --save')
  process.exit(2)
}
const base = JSON.parse(readFileSync(BASE, 'utf8'))

const risen = [], fallen = []
for (const rule of new Set([...Object.keys(base), ...Object.keys(counts)])) {
  const was = base[rule] ?? 0, now = counts[rule] ?? 0
  if (now > was) risen.push(`  ${rule}: ${was} -> ${now}  (+${now - was})`)
  else if (now < was) fallen.push(`  ${rule}: ${was} -> ${now}`)
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
const baseTotal = Object.values(base).reduce((a, b) => a + b, 0)

if (risen.length) {
  console.error(`\ndesign-lint: ${risen.length} rule(s) got worse\n`)
  console.error(risen.join('\n'))
  console.error(`\n  see the findings with:  npm run lint:design -- --list`)
  console.error(`  rules and reasons:      design_handoff/lint/README.md\n`)
  process.exit(1)
}
console.log(`design-lint: ${total} findings, baseline ${baseTotal} — nothing got worse`)
if (fallen.length) console.log(`\nimproved:\n${fallen.join('\n')}\n\n  re-freeze with:  npm run lint:design -- --save`)
