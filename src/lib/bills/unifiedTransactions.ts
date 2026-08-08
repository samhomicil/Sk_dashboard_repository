import 'server-only';
import { loadBills } from './data';
import { expandSpec, resolveVendor, type AliasRule, type AliasTxn } from './vendorAlias';
import { SPEC, ACCOUNTS } from './vendorAliasSpec';
import { searchAllTransactions, isConnected, type ObTxn } from './openbudget';
import { getAllPurchases, getAllDeposits } from './qb';

// The unified transaction feed: OpenBudget (raw bank/card activity) enriched
// with the vendor-alias mapping, plus Huntington activity from QuickBooks —
// the one gap OpenBudget can't see, since neither Huntington account is
// Plaid-linked (see project_openbudget.md). This is what /api/transactions
// and the balance-relevant callers should read; /api/qb/transactions is left
// alone as the QB-only view.
//
// Sign convention returned to callers matches the existing QB route:
// outflow = negative dollars, inflow = positive — so TransactionsClient does
// not need to change.

export interface UnifiedTxn {
  id: string;
  date: string;
  amount: number;
  payee: string;
  store: string | null;
  accountLabel: string;
  notes?: string;
  isTransfer: boolean;
  cleared: boolean;
  source: 'openbudget' | 'quickbooks-huntington';
  /** True when the vendor-alias table resolved this to a specific Bill. */
  matched: boolean;
}

const storeByAccount: Record<string, string | null> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.id, a.store]),
);
const accountLabel = (accountId: string): string => {
  const a = ACCOUNTS.find((x) => x.id === accountId);
  return a ? `${a.institution} ••${a.mask}` : accountId;
};

// A card payment appears TWICE in this feed — once as an outflow on the
// checking account, once as a balance-reducing credit on the card's own
// ledger (Plaid tracks each account's transaction history independently).
// The card-side line is not income; if left untagged it inflates "Money in"
// by exactly the store's own debt paydown. TransactionsClient already nets
// isTransfer rows out of its income/expense totals by default, so tagging
// these here (rather than teaching the UI a second exclusion rule) is enough.
const TRANSFER_RE = /\b(transfer|zelle|online (scheduled|banking))\b/i;
const CARD_PAYMENT_RE = /\b(autopay|crcardpmt|payment thank you|card\s*pmt)\b/i;

// `rules` is per-request (expanded fresh from the live Bill table by the
// caller below), not module state — this runs in a warm serverless instance
// shared across concurrent requests, so caching it on the function itself
// would let one request's rule set leak into another's.
function fromOpenBudget(t: ObTxn, rules: AliasRule[], billVendorById: Map<string, string>): UnifiedTxn {
  const resolution = resolveVendor(t as unknown as AliasTxn, rules, storeByAccount);
  const matchedVendor = resolution ? billVendorById.get(resolution.billId) : undefined;
  return {
    id: t.id,
    date: t.date,
    amount: -t.amount, // OpenBudget: outflow positive -> flip to match QB route's convention
    payee: matchedVendor ?? t.merchant ?? t.name,
    store: storeByAccount[t.account] ?? null,
    accountLabel: accountLabel(t.account),
    // Keep the raw descriptor once it's been translated to a human vendor name —
    // that raw string ("SKFI OPERATING DES:P4_ROYALTY", "MTC-Payment") is exactly
    // what made these unrecognizable in the first place; don't throw it away.
    notes: matchedVendor ? t.name : undefined,
    isTransfer: TRANSFER_RE.test(t.name) || (t.amount < 0 && CARD_PAYMENT_RE.test(t.name)),
    cleared: !t.pending,
    source: 'openbudget',
    matched: !!matchedVendor,
  };
}

export interface UnifiedResult {
  rows: UnifiedTxn[];
  /** False when OpenBudget couldn't be reached — rows may be Huntington-only. */
  openBudgetOk: boolean;
  warning?: string;
}

export async function getUnifiedTransactions(start: string, end: string): Promise<UnifiedResult> {
  const bills = await loadBills();
  const { rules } = expandSpec(SPEC, bills);
  const billVendorById = new Map(bills.map((b) => [b.id, b.vendor]));

  const rows: UnifiedTxn[] = [];
  let openBudgetOk = true;
  let warning: string | undefined;

  if (await isConnected()) {
    try {
      const obTxns = await searchAllTransactions({ startDate: start, endDate: end });
      for (const t of obTxns) rows.push(fromOpenBudget(t, rules, billVendorById));
    } catch (e) {
      openBudgetOk = false;
      warning = `OpenBudget fetch failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[unifiedTransactions]', warning);
    }
  } else {
    openBudgetOk = false;
    warning = 'OpenBudget not connected — visit /api/openbudget/auth to authorize';
  }

  // Huntington: Margate's bank account and Miramar's LOC. Neither is linked in
  // OpenBudget, so without this the app is blind to them entirely.
  const HUNTINGTON_COMPANIES = ['margate', 'miramar'] as const;
  await Promise.all(
    HUNTINGTON_COMPANIES.map(async (company) => {
      let purchases, deposits;
      try {
        [purchases, deposits] = await Promise.all([
          getAllPurchases(company, start, end),
          getAllDeposits(company, start, end),
        ]);
      } catch (e) {
        console.error(`[unifiedTransactions] QB fetch failed for ${company}:`, e);
        return;
      }
      const store = company === 'margate' ? 'Margate' : 'Miramar';
      for (const p of purchases) {
        if (!/huntington/i.test(p.AccountRef.name)) continue;
        rows.push({
          id: `qb:${company}:p:${p.Id}`, date: p.TxnDate, amount: -p.TotalAmt,
          payee: p.EntityRef?.name ?? 'Unknown', store, accountLabel: p.AccountRef.name,
          notes: p.PrivateNote, isTransfer: false, cleared: true,
          source: 'quickbooks-huntington', matched: false,
        });
      }
      for (const d of deposits) {
        if (!/huntington/i.test(d.DepositToAccountRef.name)) continue;
        rows.push({
          id: `qb:${company}:d:${d.Id}`, date: d.TxnDate, amount: d.TotalAmt,
          payee: 'Deposit', store, accountLabel: d.DepositToAccountRef.name,
          notes: d.PrivateNote, isTransfer: false, cleared: true,
          source: 'quickbooks-huntington', matched: false,
        });
      }
    }),
  );

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return { rows, openBudgetOk, warning };
}
