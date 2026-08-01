import 'server-only';
import { iso } from './billsEngine';
import { loadBills, loadSales, loadManualPayments, dataMode } from './data';
import { reconcile, ReconciledOccurrence } from './reconcile';
import { refresh, getTxnsByAccount, isLiveConfigured } from './actualAdapter';

export interface DashboardData {
  mode: { data: 'db' | 'seed'; actual: 'live' | 'mock' };
  now: string;
  summary: Record<string, number>;
  occurrences: ReconciledOccurrence[];
}

export async function getDashboardData(now: Date = new Date()): Promise<DashboardData> {
  const bills = await loadBills();
  const sales = await loadSales();

  await refresh();
  const back = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);
  const fwd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 120);
  const lookbackISO = iso(back);
  const horizonISO = iso(fwd);

  const allAccounts = bills.map((b) => b.account).filter(Boolean) as string[];
  const accountIds = allAccounts.filter((v, i) => allAccounts.indexOf(v) === i);
  const [txnsByAccount, manualPaid, liveConfigured] = await Promise.all([
    getTxnsByAccount(bills, sales, accountIds, lookbackISO, horizonISO, now),
    loadManualPayments(bills.map((b) => b.id)),
    isLiveConfigured(),
  ]);

  const occurrences = reconcile(bills, sales, txnsByAccount, manualPaid, lookbackISO, horizonISO, now);

  const count = (s: string) => occurrences.filter((o) => o.status === s).length;
  return {
    mode: { data: dataMode(), actual: liveConfigured ? 'live' : 'mock' },
    now: iso(now),
    summary: {
      paid: count('paid'),
      due: count('due'),
      overdue: count('overdue'),
      missed: count('missed'),
      upcoming: count('upcoming'),
    },
    occurrences,
  };
}
