// Exercises getOpenBudgetBalances() and getUnifiedTransactions() end-to-end
// against the real API, real Bill table, and real Huntington-filtered QB
// purchases/deposits — the same code path /api/sync and /api/transactions run.
//
//   npx tsx -r ./scripts/server-only-shim.cjs scripts/check-unified.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

(async () => {
  const { getOpenBudgetBalances } = await import('../src/lib/bills/openbudget');
  const { getUnifiedTransactions } = await import('../src/lib/bills/unifiedTransactions');

  console.log('=== getOpenBudgetBalances() ===');
  const balances = await getOpenBudgetBalances();
  for (const b of balances) {
    console.log(`  ${b.store.padEnd(8)} checking=${b.checking.toFixed(2).padStart(10)}  savings=${b.savings.toFixed(2).padStart(9)}  creditCard=${b.creditCard.toFixed(2).padStart(10)}  cashTotal=${b.cashTotal.toFixed(2).padStart(10)}  age=${b.ageHours.toFixed(1)}h  stale=${b.stale}`);
  }

  console.log('\n=== getUnifiedTransactions(last 7 days) ===');
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { rows, openBudgetOk, warning } = await getUnifiedTransactions(weekAgo, today);
  console.log(`openBudgetOk=${openBudgetOk}  warning=${warning ?? '(none)'}  rows=${rows.length}`);
  const bySource = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log('by source:', bySource);
  const matched = rows.filter((r) => r.matched).length;
  console.log(`matched to a bill vendor: ${matched} / ${rows.length}`);
  console.log('\nsample rows:');
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${r.date} ${r.amount.toFixed(2).padStart(10)}  ${r.store ?? '-'.padEnd(8)}  ${(r.payee).slice(0, 42).padEnd(43)} ${r.matched ? '[matched]' : ''}${r.isTransfer ? '[transfer]' : ''}${r.notes ? `  (raw: ${r.notes.slice(0, 40)})` : ''}`);
  }
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
