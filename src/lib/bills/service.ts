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

  // The bank feed is now fetched BEFORE reconcile, because reconcile uses it too.
  // Its QuickBooks path reaches almost nothing — 57 of 68 bills have no `account`
  // and the rest carry ids that are not QB's — so the feed is what actually clears a
  // bill. Failure here must not break the page: an empty feed degrades reconcile to
  // its old QB-only behaviour and drops suggestions to a visible "—", not a 500.
  let feed: Awaited<ReturnType<typeof getUnifiedTransactions>>['rows'] = [];
  try {
    feed = (await getUnifiedTransactions(lookbackISO, horizonISO)).rows;
  } catch (e) {
    console.error('[service] bank feed unavailable:', e);
  }
  // A bill's PAID status now depends on this feed, so an empty one is not a quiet
  // no-op: it flips every bank-matched occurrence back to overdue at once. Seen for
  // real — one call returned 0 rows where the next returned 1,021, and 90 matches
  // silently became 0. Nothing here can distinguish "no payments" from "no feed",
  // so it at least says so loudly rather than rendering a page full of false
  // overdues with no explanation.
  if (feed.length === 0) {
    console.error(
      '[service] bank feed returned ZERO rows — every bank-matched bill will read as '
      + 'unpaid this render. Treat any spike in overdue as suspect until it returns.');
  }

  const occurrences = reconcile(
    bills, sales, txnsByAccount, manualPaid, lookbackISO, horizonISO, now, feed);

  // Suggestions cover what the three-signal auto-match deliberately would not clear:
  // right vendor but wrong amount, right amount but outside the window, no alias at
  // all. Never auto-applied — a human confirms these.
  let suggestions: Record<string, Suggestion> = {};
  try {
    suggestions = Object.fromEntries(suggestMatches(occurrences, feed));
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
