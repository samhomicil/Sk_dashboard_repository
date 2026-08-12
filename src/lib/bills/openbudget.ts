import 'server-only';
import { getPrisma } from './db';
import { ACCOUNTS } from './vendorAliasSpec';

// OpenBudget (api.openbudget.sh) — a Plaid-backed personal-finance MCP server
// giving raw bank transactions + live balances for the accounts linked in
// project_openbudget.md. This is the app's OWN OAuth identity
// (client_id iBDYVZjLmwWUsskkBJSxdYGQwuSOuUFy, registered via dynamic client
// registration, public/PKCE — no client_secret), separate from the client any
// Claude Code CLI session registers for itself. Do not reuse a CLI-minted
// refresh token here: its lifecycle is tied to that session's keychain, not to
// this app's deploy.
//
// Two things about this API that are NOT optional to get right:
//   1. Cloudflare on this zone 403s the default fetch/undici User-Agent
//      ("browser_signature_banned", error 1010). A browser UA is required on
//      every call, including token exchange/refresh.
//   2. It's an MCP server (JSON-RPC 2.0 over streamable HTTP), not a REST API.
//      Every call is a POST of a JSON-RPC envelope, and the transport can
//      reply as a single SSE `data:` line instead of a plain JSON body.

const AUTHZ = 'https://api.openbudget.sh/api/openbudget/auth/mcp/authorize';
const TOKEN_URL = 'https://api.openbudget.sh/api/openbudget/auth/mcp/token';
const REGISTER_URL = 'https://api.openbudget.sh/api/openbudget/auth/mcp/register';
const MCP_URL = 'https://api.openbudget.sh/mcp';
const RESOURCE = 'https://api.openbudget.sh';
const SCOPE = 'openid profile email offline_access openbudget:read openbudget:write';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function redirectUri(): string {
  // Must be one of the URIs registered with OpenBudget's DCR endpoint for this
  // client_id. Falls back to production; override for local dev via env.
  return (
    process.env.OPENBUDGET_REDIRECT_URI ??
    'https://sk-dashboard-delta.vercel.app/api/openbudget/callback'
  );
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

/** Generates a PKCE pair. Caller must stash `verifier` (e.g. a signed cookie) until the callback. */
export async function newPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

// ── OAuth: client registration + authorize + token exchange ────────────────

interface ClientInfo {
  clientId: string;
}

/**
 * Returns this app's registered OAuth client, registering one via dynamic
 * client registration on first use and persisting the id so every later
 * authorize/token call — and every future deploy — reuses the same identity.
 */
async function ensureClient(): Promise<ClientInfo> {
  const prisma = getPrisma();
  if (!prisma) throw new Error('No DB configured');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma as any).openBudgetToken.findUnique({ where: { id: 1 } });
  if (row?.clientId) return { clientId: row.clientId };

  const r = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      redirect_uris: [redirectUri()],
      client_name: 'SK Dashboard',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!r.ok) throw new Error(`OpenBudget client registration failed: ${r.status} ${await r.text()}`);
  const reg = (await r.json()) as { client_id: string };
  // Placeholder row so the client_id survives even before the user has
  // consented — saveTokens() upserts over it once real tokens land.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).openBudgetToken.upsert({
    where: { id: 1 },
    update: { clientId: reg.client_id },
    create: { id: 1, clientId: reg.client_id, accessToken: '', refreshToken: '', expiresAt: BigInt(0) },
  });
  return { clientId: reg.client_id };
}

export async function buildAuthUrl(challenge: string, state: string): Promise<string> {
  const { clientId } = await ensureClient();
  const url = new URL(AUTHZ);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', RESOURCE);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const { clientId } = await ensureClient();
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  if (!r.ok) throw new Error(`OpenBudget code exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function doRefresh(refreshToken: string, clientId: string): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: RESOURCE,
    }),
  });
  if (!r.ok) throw new Error(`OpenBudget token refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// ── Token storage (mirrors qb.ts's saveToken/getValidToken shape) ──────────

export async function saveTokens(tok: TokenResponse): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) throw new Error('No DB configured');
  const { clientId } = await ensureClient();
  const expiresAt = BigInt(Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000); // 1 min buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).openBudgetToken.upsert({
    where: { id: 1 },
    update: {
      clientId,
      accessToken: tok.access_token,
      // A refresh may omit refresh_token if the server doesn't rotate it; keep the old one.
      refreshToken: tok.refresh_token ?? undefined,
      expiresAt,
      scope: tok.scope ?? null,
    },
    create: {
      id: 1,
      clientId,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? '',
      expiresAt,
      scope: tok.scope ?? null,
    },
  });
}

export async function isConnected(): Promise<boolean> {
  const prisma = getPrisma();
  if (!prisma) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma as any).openBudgetToken.findUnique({ where: { id: 1 } });
  return !!row?.accessToken;
}

async function getValidToken(): Promise<string | null> {
  const prisma = getPrisma();
  if (!prisma) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma as any).openBudgetToken.findUnique({ where: { id: 1 } });
  if (!row?.accessToken) return null;

  if (Date.now() < Number(row.expiresAt)) return row.accessToken;

  try {
    const fresh = await doRefresh(row.refreshToken, row.clientId);
    await saveTokens(fresh);
    return fresh.access_token;
  } catch (e) {
    console.error('[openbudget] token refresh failed:', e);
    return null;
  }
}

// ── MCP client (JSON-RPC 2.0 over streamable HTTP) ──────────────────────────

let cachedSessionId: string | undefined;
let rpcSeq = 0;

async function mcpCall<T>(method: string, params?: unknown, notify = false): Promise<T | null> {
  const token = await getValidToken();
  if (!token) throw new Error('OpenBudget not connected — visit /api/openbudget/auth to authorize');

  const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (params !== undefined) payload.params = params;
  if (!notify) payload.id = ++rpcSeq;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'User-Agent': UA,
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (cachedSessionId) headers['Mcp-Session-Id'] = cachedSessionId;

  const r = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store' });
  if (!r.ok) throw new Error(`OpenBudget MCP HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const sid = r.headers.get('Mcp-Session-Id');
  if (sid) cachedSessionId = sid;
  if (notify) return null;

  const body = await r.text();
  for (const line of body.split('\n')) {
    if (line.startsWith('data:')) return JSON.parse(line.slice(5).trim());
  }
  return body.trim() ? JSON.parse(body) : null;
}

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function initSession(): Promise<void> {
  if (cachedSessionId) return;
  await mcpCall('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'sk-dashboard', version: '1' },
  });
  await mcpCall('notifications/initialized', undefined, true);
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  await initSession();
  const res = await mcpCall<JsonRpcEnvelope<{ structuredContent?: { data: T }; content?: { type: string; text: string }[] }>>(
    'tools/call',
    { name, arguments: args },
  );
  if (res?.error) throw new Error(`OpenBudget tool ${name} failed: ${res.error.message}`);
  const result = res?.result;
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
