// Expands the alias spec against the live Bill table, runs the real resolver
// over OpenBudget history, and reports what it would and would not catch.
//
//   npx tsx scripts/validate-vendor-aliases.ts <transactions.json> <bills.json>
//
// Read-only: prints a report and writes the expanded rules to
// scripts/out/vendor-aliases.json. Nothing is written to the database.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveVendor, type AliasRule, type AliasTxn } from '../src/lib/bills/vendorAlias';
import { SPEC, ACCOUNTS } from './vendor-alias-spec';

interface Bill { id: string; store: string; vendor: string; amountValue: number; amountType: string; paidFrom: string | null }

const [txPath, billPath] = process.argv.slice(2);
const txns: AliasTxn[] = JSON.parse(readFileSync(txPath, 'utf8'));
const bills: Bill[] = JSON.parse(readFileSync(billPath, 'utf8'));

const storeByAccount: Record<string, string | null> =
  Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.store]));
const STORES = [...new Set(bills.map((b) => b.store))];

// ---- expand spec -> concrete rules -----------------------------------------
const rules: AliasRule[] = [];
const unresolved: string[] = [];
let seq = 0;
for (const s of SPEC) {
  const targets = s.store ? [s.store] : STORES;
  for (const store of targets) {
    // Prefer an exact vendor match. Substring alone binds "Workstream — Payroll"
    // to "Workstream — Payroll Module", a $35 subscription, and books $5k of
    // payroll against it.
    const inStore = bills.filter((b) => b.store === store);
    const exact = inStore.filter((b) => b.vendor === s.vendorLike);
    const hits = exact.length ? exact : inStore.filter((b) => b.vendor.includes(s.vendorLike));
    if (hits.length === 0) {
      unresolved.push(`${s.pattern}  ->  no "${s.vendorLike}" bill in ${store}`);
      continue;
    }
    if (hits.length > 1 && s.amountMin == null && s.amountMax == null) {
      unresolved.push(`${s.pattern}  ->  ${hits.length} "${s.vendorLike}" bills in ${store} (${hits.map((h) => h.vendor).join(' | ')}) — ambiguous, needs an amount range`);
    }
    for (const b of hits.slice(0, 1)) {
      rules.push({
        id: `va${String(++seq).padStart(3, '0')}`,
        pattern: s.pattern,
        matchType: s.matchType ?? 'contains',
        field: s.field ?? 'name',
        store,
        amountMin: s.amountMin ?? null,
        amountMax: s.amountMax ?? null,
        billId: b.id,
        alsoSettles: (s.alsoSettles ?? []).flatMap((v) => {
          const extra = bills.filter((x) => x.store === store && x.vendor.includes(v));
          if (!extra.length) unresolved.push(`${s.pattern}  ->  alsoSettles "${v}" not found in ${store}`);
          return extra.map((x) => x.id);
        }),
        variableAmount: s.variableAmount ?? false,
        weekday: s.weekday ?? [],
        priority: s.priority ?? 0,
        confirmed: s.confirmed ?? false,
        enabled: s.enabled ?? true,
        note: s.note ?? null,
      });
    }
  }
}

mkdirSync('scripts/out', { recursive: true });
writeFileSync('scripts/out/vendor-aliases.json', JSON.stringify(rules, null, 1));

// ---- run the resolver -------------------------------------------------------
const billById = new Map(bills.map((b) => [b.id, b]));
const ruleById = new Map(rules.map((r) => [r.id, r]));

// Debits enriched as "Smoothie King" are NOT a feed anomaly: the underlying ACH is
// "PERFORMACE FOODS DES:PAYMENT ... INDN:SMOOTHIE KING", and the feed took the
// merchant from the receiver name rather than the originator. Sales deposits carry
// the identical name — only the sign separates food purchases from revenue.
const outflows = txns.filter((t) => t.amount > 0);
const hitByBill = new Map<string, { n: number; total: number; confirmed: boolean; amounts: number[] }>();
// A single payment can settle more than one occurrence — a catch-up after a
// missed month, or one insurance charge covering two policies. Anything paid at
// well over the bill's per-occurrence amount is flagged so it is not silently
// booked as a single period.
const multiPeriod: { bill: string; store: string; paid: number; expected: number; ratio: number; date: string }[] = [];
const unmatched = new Map<string, { n: number; total: number; store: string | null; sample: string }>();

for (const t of outflows) {
  const r = resolveVendor(t, rules, storeByAccount);
  if (r) {
    const cur = hitByBill.get(r.billId) ?? { n: 0, total: 0, confirmed: r.confirmed, amounts: [] };
    cur.n++; cur.total += Math.abs(t.amount); cur.amounts.push(Math.abs(t.amount));
    hitByBill.set(r.billId, cur);
    const bill = billById.get(r.billId);
    if (bill && bill.amountType === 'fixed' && bill.amountValue > 0
        && !ruleById.get(r.ruleId)?.variableAmount) {
      // Compare against everything the charge settles, not just the anchor bill,
      // or a combined draft looks like a multi-period overpayment.
      const combined = r.settles.reduce((sum, id) => sum + (billById.get(id)?.amountValue ?? 0), 0);
      const ratio = Math.abs(t.amount) / combined;
      if (ratio >= 1.5) {
        multiPeriod.push({ bill: bill.vendor + (r.settles.length > 1 ? ` (+${r.settles.length - 1})` : ''), store: bill.store, paid: Math.abs(t.amount), expected: combined, ratio, date: t.date });
      }
    }
  } else {
    const key = (t.merchant || t.name.split(/\s+/).slice(0, 3).join(' ')).slice(0, 34);
    const cur = unmatched.get(key) ?? { n: 0, total: 0, store: storeByAccount[t.account] ?? null, sample: t.name };
    cur.n++; cur.total += Math.abs(t.amount);
    unmatched.set(key, cur);
  }
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const matchedTxns = [...hitByBill.values()].reduce((a, b) => a + b.n, 0);
const matchedAmt = [...hitByBill.values()].reduce((a, b) => a + b.total, 0);
const totalAmt = outflows.reduce((a, t) => a + Math.abs(t.amount), 0);

console.log(`rules expanded: ${rules.length}   (confirmed ${rules.filter((r) => r.confirmed).length})`);
console.log(`outflows: ${outflows.length}  matched: ${matchedTxns} (${((matchedTxns / outflows.length) * 100).toFixed(1)}%)`);
console.log(`outflow dollars: $${money(totalAmt)}  matched: $${money(matchedAmt)} (${((matchedAmt / totalAmt) * 100).toFixed(1)}%)\n`);

console.log('BILLS NOW LINKED');
console.log('-'.repeat(86));
for (const [billId, v] of [...hitByBill.entries()].sort((a, b) => b[1].total - a[1].total)) {
  const b = billById.get(billId)!;
  console.log(`  ${v.confirmed ? '✓' : '?'} ${b.store.padEnd(8)} ${b.vendor.slice(0, 44).padEnd(45)} ${String(v.n).padStart(3)}x  $${money(v.total).padStart(11)}`);
}

console.log(`\nTOP UNMATCHED OUTFLOWS (${unmatched.size} descriptor groups)`);
console.log('-'.repeat(86));
for (const [k, v] of [...unmatched.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 18)) {
  console.log(`    ${(v.store ?? 'shared').padEnd(8)} ${k.padEnd(34)} ${String(v.n).padStart(3)}x  $${money(v.total).padStart(11)}`);
}

if (unresolved.length) {
  console.log('\nSPEC ENTRIES NEEDING ATTENTION');
  console.log('-'.repeat(86));
  for (const u of unresolved) console.log('    ' + u);
}

if (multiPeriod.length) {
  console.log('\nPAYMENTS COVERING MORE THAN ONE OCCURRENCE  (paid >= 1.5x the bill amount)');
  console.log('-'.repeat(86));
  for (const m of multiPeriod.sort((a, b) => b.ratio - a.ratio)) {
    console.log(`    ${m.store.padEnd(8)} ${m.date}  ${m.bill.slice(0, 40).padEnd(41)} $${money(m.paid).padStart(9)} vs $${money(m.expected).padStart(9)}  ${m.ratio.toFixed(2)}x`);
  }
}

// ---- which bills still have no match, and is there anything to match them TO? --
const settledIds = new Set<string>();
for (const t of outflows) {
  const r = resolveVendor(t, rules, storeByAccount);
  if (r) for (const id of r.settles) settledIds.add(id);
}
// ---- budget drift: what the forecast assumes vs what the bank actually paid ----
// The cash forecast consumes only active, amountType='fixed' bills whose category
// is not modelled elsewhere. Drift on those lines is a real forecast error.
// Thresholds match bill-inbox/bills/reconcile.py so both surfaces agree.
const FORECAST_EXCLUDED = new Set(['COGS', 'Franchise Fees', 'Taxes']);
const usedByForecast = (b: Bill) =>
  b.amountType === 'fixed' && !FORECAST_EXCLUDED.has((b as unknown as { category: string }).category);
const drift: { store: string; vendor: string; budget: number; actual: number; n: number; delta: number }[] = [];
for (const [billId, v] of hitByBill.entries()) {
  const b = billById.get(billId);
  if (!b || !usedByForecast(b) || v.n < 2) continue;
  const rule = [...rules].find((r) => r.billId === billId);
  if (rule?.variableAmount) continue;                       // card payments have no expected amount
  const combined = b.amountValue + (rule?.alsoSettles ?? [])
    .reduce((sum, id) => sum + (billById.get(id)?.amountValue ?? 0), 0);
  const actual = v.total / v.n;
  const delta = actual - combined;
  if (Math.abs(delta) >= 5 && Math.abs(delta / combined) * 100 >= 2) {
    drift.push({ store: b.store, vendor: b.vendor, budget: combined, actual, n: v.n, delta });
  }
}
if (drift.length) {
  console.log('\nBUDGET DRIFT — forecast-consumed bills whose actual payment differs');
  console.log('-'.repeat(92));
  let net = 0;
  for (const d of drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
    net += d.delta;
    console.log(`    ${d.store.padEnd(8)} ${d.vendor.slice(0, 40).padEnd(41)} budget $${money(d.budget).padStart(9)}  actual $${money(d.actual).padStart(9)}  ${d.delta > 0 ? '+' : '-'}$${money(Math.abs(d.delta))}`);
  }
  console.log(`\n    net per cycle: ${net > 0 ? '+' : '-'}$${money(Math.abs(net))} (${net > 0 ? 'forecast UNDERSTATES outflow' : 'forecast OVERSTATES outflow'})`);
}

const billsNoAlias = bills.filter((b) => !settledIds.has(b.id));
const STOP = new Set(['the', 'and', 'inc', 'llc', 'corp', 'bank', 'fees', 'fee', 'bill',
  'payment', 'payments', 'monthly', 'package', 'program', 'policy', 'base', 'cost',
  'order', 'utilities', 'insurance', 'smoothie', 'king', 'corporate', 'local', 'market',
  'marketing', 'national', 'regional', 'royalty', 'technology']);
const vendorTokens = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));

// Unmatched outflows keyed by store, so a Margate bill is only offered Margate spend.
const unmatchedByStore = new Map<string, AliasTxn[]>();
for (const t of outflows) {
  if (resolveVendor(t, rules, storeByAccount)) continue;
  const st = storeByAccount[t.account];
  if (!st) continue;
  (unmatchedByStore.get(st) ?? unmatchedByStore.set(st, []).get(st)!).push(t);
}

console.log(`\nBILLS WITH NO MATCH: ${billsNoAlias.length} of ${bills.length}`);
console.log('-'.repeat(104));
const noTrace: typeof billsNoAlias = [];
for (const store of [...new Set(billsNoAlias.map((b) => b.store))].sort()) {
  console.log(`\n  ${store}`);
  for (const b of billsNoAlias.filter((x) => x.store === store)) {
    const toks = vendorTokens(b.vendor);
    const pool = unmatchedByStore.get(store) ?? [];
    const cand = pool.filter((t) => {
      const hay = `${t.name} ${t.merchant ?? ''}`.toLowerCase();
      // whole-word only, or "Ledger Frame Works" matches "Workstream" via "works"
      return toks.some((w) => new RegExp(`\\b${w}\\b`).test(hay));
    });
    const amt = `$${money(b.amountValue)}`;
    if (cand.length) {
      const tot = cand.reduce((a, t) => a + Math.abs(t.amount), 0);
      console.log(`    ~ ${b.vendor.slice(0, 44).padEnd(45)} ${amt.padStart(10)} ${(b.paidFrom ?? '-').slice(0, 10).padEnd(11)} ${String(cand.length).padStart(3)} candidate txn, $${money(tot)}`);
      console.log(`        e.g. ${cand[0].name.slice(0, 78)}`);
    } else {
      noTrace.push(b);
      console.log(`    · ${b.vendor.slice(0, 44).padEnd(45)} ${amt.padStart(10)} ${(b.paidFrom ?? '-').slice(0, 10).padEnd(11)} no trace in the feed`);
    }
  }
}
console.log(`\n  ${billsNoAlias.length - noTrace.length} have a candidate transaction; ${noTrace.length} have no trace at all.`);

