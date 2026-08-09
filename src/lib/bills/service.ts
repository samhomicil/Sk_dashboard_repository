import 'server-only';
import { iso } from './billsEngine';
import { loadBills, loadSales, loadManualPayments, dataMode } from './data';
import { reconcile, ReconciledOccurrence } from './reconcile';
import { refresh, getTxnsByAccount, isLiveConfigured } from './actualAdapter';
import { getUnifiedTransactions } from './unifiedTransactions';
import { suggestMatches, type Suggestion } from './suggestMatch';
import { computeBillGroups } from './billGroups';

export interface DashboardData {
  mode: { data: 'db' | 'seed'; actual: 'live' | 'mock' };
  now: string;
  summary: Record<string, number>;
  occurrences: ReconciledOccurrence[];
  /** Keyed by `${billId}|${due}` — see suggestMatch.ts. Never auto-applied;
   *  the owner confirms via the existing mark-paid action. */
  suggestions: Record<string, Suggestion>;
  /** billId -> full group of billIds (incl. itself) it's structurally paid
   *  together with — see billGroups.ts. The Bills table merges these into
   *  one row; the underlying Bill records stay separate. */
  billGroups: Record<string, string[]>;
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

  // Suggested matches for still-open occurrences, from the real bank feed
  // (OpenBudget) — separate from the QB-based auto-match above, and never
  // auto-applied. Failure here must not break the bills page: no suggestions
  // is a visible "—" in the UI, not a 500.
  let suggestions: Record<string, Suggestion> = {};
  try {
    const { rows: txns } = await getUnifiedTransactions(lookbackISO, horizonISO);
    suggestions = Object.fromEntries(suggestMatches(occurrences, txns));
  } catch (e) {
    console.error('[service] suggestMatches failed:', e);
  }

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
    suggestions,
    billGroups: Object.fromEntries(computeBillGroups(bills)),
  };
}
