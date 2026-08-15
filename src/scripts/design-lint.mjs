#!/usr/bin/env node
/**
 * design-lint — machine-enforces the mechanical half of the Hispaniola Wellness module checklist.
 *
 * Documentation is honour-system. This is not: it fails the build.
 *
 * It checks what a script can see. It cannot check whether a number is right, whether a total
 * reconciles with its parts, or whether a verdict sentence matches the data beneath it — those
 * stay in human review against module-contract.md.
 *
 *   node scripts/design-lint.mjs src [--json] [--quiet]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

const ROOT = process.argv[2] || 'src';
const AS_JSON = process.argv.includes('--json');
const QUIET = process.argv.includes('--quiet');

const EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.css', '.html']);
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'coverage']);
/** Files allowed to contain raw hex — the token layer has to define the colours somewhere. */
const TOKEN_FILES = /(^|\/)(tokens?|theme|styles?|palette)(\/|[.\-\w]*\.(css|ts|js)$)/;

const BRASS = /#B08D57/i;
const HEX = /#[0-9a-f]{3,8}\b/gi;
/** A cell or metric holding digits — currency, percent, or a bare figure. */
const FIGURE = /(\$\{?[\w.]*\}?[\d,]|\d[\d,]*\.?\d*\s*%|toLocaleString|toFixed\()/;

const findings = [];
const add = (file, line, rule, why, snippet) =>
  findings.push({ file, line, rule, why, snippet: (snippet || '').trim().slice(0, 110) });

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

function checkFile(path) {
  const rel = relative(process.cwd(), path);
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const isCss = extname(path) === '.css';
  const isTokenFile = TOKEN_FILES.test(rel);

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*')) return;

    // ---- hardcoded colour -------------------------------------------------
    if (!isTokenFile) {
      const hexes = raw.match(HEX);
      if (hexes) {
        add(rel, n, 'hardcoded-color',
          `Use a token, not ${hexes[0]}. A colour typed by hand is a colour that drifts.`, raw);
      }
    }

    // ---- brass on a figure ------------------------------------------------
    // Brass is a rule, underline, divider or active marker. Never a badge, number or status.
    if (BRASS.test(raw) || /var\(--accent\)/.test(raw)) {
      const isText = /\b(color|fill|WebkitTextFillColor)\s*[:=]/.test(raw) && !/border|background|outline|stroke/.test(raw);
      if (isText && FIGURE.test(raw)) {
        add(rel, n, 'brass-on-figure',
          'Brass never carries a number, badge or status — put a figure in brass and it reads as amber.', raw);
      }
    }

    // ---- shadows and gradients -------------------------------------------
    if (/box-shadow\s*[:=]\s*(?!none)[^;'"`]*(rgba|#|var)/i.test(raw) && !/inset 0 0 0 1px/.test(raw)) {
      add(rel, n, 'no-shadow', 'The system has no drop shadows — 1px borders only.', raw);
    }
    if (/linear-gradient|radial-gradient/i.test(raw)) {
      add(rel, n, 'no-gradient', 'The system has no gradients.', raw);
    }

    // ---- touch targets ----------------------------------------------------
    const target = raw.match(/\b(min-height|height|minHeight)\s*[:=]\s*['"`]?(\d+)px/);
    if (target && /button|\bbtn\b|nav-item|tab\b|\.seg/i.test(raw)) {
      const px = Number(target[2]);
      if (px > 0 && px < 44) {
        add(rel, n, 'touch-target',
          `${px}px is under the 44px minimum — this is checked on a phone at 6am.`, raw);
      }
    }

    // ---- emoji -------------------------------------------------------------
    // NARROWED from the handoff's original range. U+2600-27BF also covers the
    // typographic dingbats — check, cross, warning sign, star — and the kit's own
    // reference implementation prints "✓ 10% tgt" on the Overview, so the rule as
    // shipped flagged the design it exists to enforce. It now catches pictographic
    // emoji and anything carrying the emoji variation selector (U+FE0F), which is
    // what actually renders as a colour glyph and differs per platform.
    if (/[\u{1F300}-\u{1FAFF}\u{FE0F}]/u.test(raw)) {
      add(rel, n, 'no-emoji', 'Emoji are not part of this brand.', raw);
    }

    // ---- tabular numerals --------------------------------------------------
    // A numeric cell or metric that never opts into tabular figures.
    const isNumericCell = /<td[^>]*\bnumeric\b|className=["'`][^"'`]*\b(metric|hero|figure|amount|num)\b/.test(raw);
    if (isNumericCell && !/tabular|font-variant-numeric|\bnum\b/.test(raw)) {
      add(rel, n, 'tabular-nums',
        'Every figure needs tabular numerals — proportional digits make columns jitter.', raw);
    }
  });

  // ---- media-query ordering (whole-file check) ----------------------------
  // Equal specificity means source order decides. Getting this wrong once silently reverted
  // an entire mobile pass, so it is checked structurally rather than by eye.
  if (isCss || extname(path) === '.html') {
    const firstMedia = src.search(/@media[^{]*max-width/);
    if (firstMedia > -1) {
      const after = src.slice(firstMedia);
      const closesAt = after.lastIndexOf('}');
      const tail = after.slice(closesAt);
      const baseRulesAfter = /\n\s*\.[\w-]+[^{]*\{/.test(tail);
      if (baseRulesAfter) {
        const lineNo = src.slice(0, firstMedia).split('\n').length;
        add(rel, lineNo, 'media-query-order',
          'Responsive blocks must come last — base rules after them win at equal specificity and silently revert the mobile pass.');
      }
    }
  }

  // ---- verdict before evidence -------------------------------------------
  // A screen-level component should open with a TakeCard.
  const looksLikeScreen = /data-screen-label|export default function \w*(Page|Screen|View)\b/.test(src);
  if (looksLikeScreen && !/TakeCard/.test(src)) {
    add(rel, 1, 'missing-take',
      'A screen opens with a TakeCard verdict, not a chart — say what is true and what to do first.');
  }
}

const files = walk(ROOT);
files.forEach(checkFile);

if (AS_JSON) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

const RULES = [...new Set(findings.map(f => f.rule))];
if (!findings.length) {
  if (!QUIET) console.log(`design-lint · ${files.length} files · clean`);
  process.exit(0);
}

console.log(`\ndesign-lint · ${files.length} files · ${findings.length} finding${findings.length === 1 ? '' : 's'}\n`);
for (const rule of RULES) {
  const group = findings.filter(f => f.rule === rule);
  console.log(`  ${rule} — ${group.length}`);
  console.log(`  ${group[0].why}`);
  for (const f of group.slice(0, 12)) {
    console.log(`    ${f.file}:${f.line}${f.snippet ? '  ' + f.snippet : ''}`);
  }
  if (group.length > 12) console.log(`    …and ${group.length - 12} more`);
  console.log('');
}
console.log('These are the mechanical rules. Reconciliation, typed absence and whether the verdict');
console.log('matches its evidence stay in review — see module-contract.md.\n');
process.exit(1);
