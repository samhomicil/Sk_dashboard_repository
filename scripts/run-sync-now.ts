// Runs the exact same write /api/sync/route.ts performs, without needing
// CRON_SECRET — for local, one-off use only (e.g. getting sk_bills.QbBalance
// off stale pre-cutover data without waiting for tonight's 6am run).
//
//   npx tsx -r ./scripts/server-only-shim.cjs scripts/run-sync-now.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

(async () => {
  const { getOpenBudgetBalances, isConnected } = await import('../src/lib/bills/openbudget');
  const { getPrisma } = await import('../src/lib/bills/db');

  if (!(await isConnected())) throw new Error('OpenBudget not connected');
  const balances = await getOpenBudgetBalances();

  const db = getPrisma();
  if (!db) throw new Error('no DB configured');

  for (const b of balances) {
    if (!b.balanceDate) { console.log(`skip ${b.store}: no balance data`); continue; }
    await db.$executeRawUnsafe(`DELETE FROM sk_bills.QbBalance WHERE store = '${b.store}'`);
    await db.$executeRawUnsafe(
      `INSERT INTO sk_bills.QbBalance (store, checking, savings, petty, creditCard, cashTotal, updatedAt)
       VALUES ('${b.store}', ${b.checking}, ${b.savings}, 0, ${b.creditCard}, ${b.cashTotal},
               DATEADD(second, ${Math.round(b.balanceDate)}, '1970-01-01'))`,
    );
    console.log(`wrote ${b.store}: cashTotal=${b.cashTotal.toFixed(2)} age=${b.ageHours.toFixed(1)}h`);
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
