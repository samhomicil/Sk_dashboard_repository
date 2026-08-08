// Connectivity smoke test for the app's OpenBudget connection: proves
// getValidToken/refresh + the MCP client work against the real API using the
// real sk_bills.OpenBudgetToken row, independent of any route being deployed.
//
//   npx tsx scripts/check-openbudget.ts
//
// Exits non-zero on any failure so it can gate a deploy if useful later.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Static `import` of ./openbudget would be hoisted ahead of this env setup
// under ESM semantics, so it's loaded dynamically after .env.local is read.
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

(async () => {
  const { listAccounts, searchAllTransactions, isConnected } = await import('../src/lib/bills/openbudget');

  const connected = await isConnected();
  console.log('isConnected:', connected);
  if (!connected) {
    console.log('Not connected — visit /api/openbudget/auth in a browser to authorize.');
    return;
  }

  const { accounts, totalNetWorth } = await listAccounts();
  console.log(`accounts: ${accounts.length}   totalNetWorth: $${totalNetWorth.toFixed(2)}`);
  for (const a of accounts) {
    console.log(`  ${a.id}  ${a.institution.padEnd(16)} ${a.subtype.padEnd(12)} ..${a.mask}  $${a.balanceCurrent.toFixed(2)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const txns = await searchAllTransactions({ startDate: weekAgo, endDate: today });
  console.log(`\ntransactions ${weekAgo}..${today}: ${txns.length}`);
  for (const t of txns.slice(0, 5)) {
    console.log(`  ${t.date} ${t.amount.toFixed(2).padStart(9)}  ${(t.merchant || t.name).slice(0, 50)}`);
  }
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
