import 'server-only';
import { ACCOUNTS } from './vendorAliasSpec';

// OpenBudget (api.openbudget.sh) is a Plaid-backed MCP server holding the raw bank
// transactions and live balances for the accounts in project_openbudget.md.
//
// Pulse has NO OpenBudget login of its own (removed 2026-10-26). It reads through
// Account Access (account-access-pi.vercel.app), Sam's layer that holds the only
// OpenBudget connection and answers each app with just the accounts he shared with
// it: for Pulse, the three stores'. ACCOUNT_ACCESS_URL is the layer's /mcp endpoint
// and ACCOUNT_ACCESS_KEY is Pulse's key. The layer speaks OpenBudget's own MCP tools
// with the same reply shapes, keeps no sessions, and refuses anything Pulse wasn't
// granted. Sam changes Pulse's access on the Account Access page, not here.

function accessLayer(): { url: string; key: string } | null {
  const url = process.env.ACCOUNT_ACCESS_URL, key = process.env.ACCOUNT_ACCESS_KEY;
  return url && key ? { url, key } : null;
}

export async function isConnected(): Promise<boolean> {
  return !!accessLayer();
}

// ── MCP client (JSON-RPC 2.0 over HTTP) ─────────────────────────────────────

let rpcSeq = 0;

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const via = accessLayer();
  if (!via) throw new Error('Bank data is not set up: ACCOUNT_ACCESS_URL / ACCOUNT_ACCESS_KEY are missing');
  const r = await fetch(via.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${via.key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method: 'tools/call', params: { name, arguments: args } }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Account Access HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const res = (await r.json()) as JsonRpcEnvelope<{ isError?: boolean; structuredContent?: { data: T }; content?: { type: string; text: string }[] }>;
  if (res?.error) throw new Error(`OpenBudget tool ${name} failed: ${res.error.message}`);
  const result = res?.result;
  if (result?.isError) throw new Error(`OpenBudget tool ${name} failed: ${result.content?.find((c) => c.type === 'text')?.text ?? 'no detail'}`);
  if (result?.structuredContent) return result.structuredContent.data;
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text) return JSON.parse(text) as T;
  throw new Error(`OpenBudget tool ${name}: no content in response`);
}

// ── Domain types + high-level calls ─────────────────────────────────────────

export interface ObAccount {
  id: string;
  name: string;
  officialName?: string;
  type: string;
  subtype: string;
  mask: string;
  institution: string;
  balanceCurrent: number;
  balanceAvailable: number | null;
  isLiability: boolean;
  lastSync: string;
  hasError: boolean;
  source: string;
}

export async function listAccounts(): Promise<{ accounts: ObAccount[]; totalNetWorth: number }> {
  return callTool('list_accounts');
}

export interface ObTxn {
  id: string;
  date: string;
  name: string;
  merchant?: string | null;
  /** POSITIVE = outflow, NEGATIVE = inflow — opposite of ActualTxn's cents convention. */
  amount: number;
  category?: string;
  account: string;
  source: string;
  pending: boolean;
  ignored: boolean;
}

export async function searchTransactions(params: {
  startDate: string;
  endDate: string;
  accountIds?: string[];
  limit?: number;
  offset?: number;
}): Promise<{ transactions: ObTxn[]; totalCount: number }> {
  return callTool('search_transactions', {
    startDate: params.startDate,
    endDate: params.endDate,
    accountIds: params.accountIds,
    limit: params.limit ?? 500,
    offset: params.offset ?? 0,
    sortBy: 'date',
    sortDir: 'desc',
  });
}

/** Paginates to totalCount. A silent partial page (observed with a naive single
 * call during development — 1500 of 1527 rows) hid a real vendor entirely, so
 * every caller goes through this rather than a single search_transactions call. */
export async function searchAllTransactions(params: {
  startDate: string;
  endDate: string;
  accountIds?: string[];
}): Promise<ObTxn[]> {
  const pageSize = 500;
  const first = await searchTransactions({ ...params, limit: pageSize, offset: 0 });
  const all = [...first.transactions];
  for (let offset = pageSize; offset < first.totalCount; offset += pageSize) {
    const page = await searchTransactions({ ...params, limit: pageSize, offset });
    all.push(...page.transactions);
  }
  return all;
}

// ── Live balance, shaped for /api/sync -> sk_bills.QbBalance ───────────────
//
// Account -> store attribution here is CONFIRMED against the QuickBooks chart
// of accounts (see vendorAliasSpec.ts's ACCOUNTS), not inferred from the feed —
// notably, the two Chase cards and the Capital One card are each billed to a
// single store despite the feed naming them all identically ("D. AYBAR").
//
// This covers MORE than SimpleFIN: Miramar's Capital One card is invisible to
// SimpleFIN but present here. Neither source sees Huntington (Margate bank,
// Miramar LOC) — that gap is QBO-book-balance-only until Huntington is linked.
export interface StoreBalance {
  store: string;
  checking: number;
  savings: number;
  creditCard: number;
  cashTotal: number;
  balanceDate: number; // unix seconds, oldest across the store's cash accounts
  ageHours: number;
  stale: boolean;
}

const STALE_HOURS = Number(process.env.OPENBUDGET_STALE_HOURS ?? 24);

export async function getOpenBudgetBalances(): Promise<StoreBalance[]> {
  const { accounts } = await listAccounts();
  const byStore = new Map<string, StoreBalance>();
  const now = Date.now() / 1000;

  for (const a of accounts) {
    const store = storeByAccountId(a.id);
    if (!store) continue; // unattributed account (e.g. the untraced ••1151 savings) — do not guess
    const entry = byStore.get(store) ?? {
      store, checking: 0, savings: 0, creditCard: 0, cashTotal: 0,
      balanceDate: 0, ageHours: 0, stale: false,
    };
    if (a.isLiability) {
      // Credit cards refresh on their own, often slower, cadence — they must
      // never factor into cash-balance freshness. They previously did (this
      // loop set balanceDate from every account, liability or not), which
      // meant a card stuck on a stale Plaid sync silently marked the whole
      // store's CASH balance "stale" even when checking/savings were synced
      // minutes ago — the actual bug behind a "why is the feed still stale"
      // report on 2026-08-12, when the cash accounts were current the whole
      // time.
      entry.creditCard += a.balanceCurrent;
    } else {
      const syncedAt = Math.floor(new Date(a.lastSync).getTime() / 1000);
      entry.balanceDate = entry.balanceDate ? Math.min(entry.balanceDate, syncedAt) : syncedAt;
      if (a.subtype === 'savings') entry.savings += a.balanceCurrent;
      else entry.checking += a.balanceCurrent;
    }
    byStore.set(store, entry);
  }

  return [...byStore.values()].map((e) => {
    const ageHours = e.balanceDate ? (now - e.balanceDate) / 3600 : Infinity;
    return { ...e, cashTotal: e.checking + e.savings, ageHours, stale: ageHours > STALE_HOURS };
  });
}

const ACCOUNT_STORE: Record<string, string | null> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.id, a.store]),
);
const storeByAccountId = (id: string): string | null => ACCOUNT_STORE[id] ?? null;
