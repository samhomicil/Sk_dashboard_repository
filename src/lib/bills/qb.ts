import 'server-only';
import { getPrisma } from './db';

const QB_BASE =
  process.env.QBO_ENV === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com/v3/company'
    : 'https://quickbooks.api.intuit.com/v3/company';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function basicAuth() {
  return Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`,
  ).toString('base64');
}

// ── OAuth helpers ────────────────────────────────────────────────────────────

export function buildAuthUrl(company: string): string {
  const url = new URL('https://appcenter.intuit.com/connect/oauth2');
  url.searchParams.set('client_id', process.env.QBO_CLIENT_ID!);
  url.searchParams.set('redirect_uri', process.env.QBO_REDIRECT_URI!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
  url.searchParams.set('state', company);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI!,
    }),
  });
  if (!r.ok) throw new Error(`QB code exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function doRefresh(refreshTok: string): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshTok }),
  });
  if (!r.ok) throw new Error(`QB token refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// ── Token storage ────────────────────────────────────────────────────────────

export async function saveToken(
  company: string,
  realmId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  const prisma = getPrisma();
  if (!prisma) throw new Error('No DB configured');
  const expiresAt = BigInt(Date.now() + expiresIn * 1000 - 60_000); // 1 min buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).qbToken.upsert({
    where: { company },
    update: { realmId, accessToken, refreshToken, expiresAt },
    create: { company, realmId, accessToken, refreshToken, expiresAt },
  });
}

export async function deleteToken(company: string) {
  const prisma = getPrisma();
  if (!prisma) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).qbToken.delete({ where: { company } });
  } catch {
    // ignore if not found
  }
}

export async function getConnections(): Promise<{ company: string; realmId: string }[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (prisma as any).qbToken.findMany({
      select: { company: true, realmId: true },
    });
  } catch {
    return [];
  }
}

async function getValidToken(
  company: string,
): Promise<{ accessToken: string; realmId: string } | null> {
  const prisma = getPrisma();
  if (!prisma) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma as any).qbToken.findUnique({ where: { company } });
  if (!row) return null;

  if (Date.now() < Number(row.expiresAt)) {
    return { accessToken: row.accessToken, realmId: row.realmId };
  }

  try {
    const fresh = await doRefresh(row.refreshToken);
    await saveToken(company, row.realmId, fresh.access_token, fresh.refresh_token, fresh.expires_in);
    return { accessToken: fresh.access_token, realmId: row.realmId };
  } catch (e) {
    console.error(`[qb] Token refresh failed for ${company}:`, e);
    return null;
  }
}

// ── QB REST API ───────────────────────────────────────────────────────────────

async function qbQuery<T>(realmId: string, accessToken: string, query: string): Promise<T[]> {
  const url = `${QB_BASE}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`QB query failed: ${r.status} ${await r.text()}`);
  const json = await r.json();
  const body = json.QueryResponse as Record<string, unknown>;
  const key = Object.keys(body).find(
    (k) => k !== 'startPosition' && k !== 'maxResults' && k !== 'totalCount',
  );
  return key ? (body[key] as T[]) : [];
}

// ── Entity types ──────────────────────────────────────────────────────────────

export interface QbAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  CurrentBalance: number;
  CurrentBalanceWithSubAccounts?: number;
  // Present when bank feed is connected (minorversion 5+). Shows the bank's reported balance.
  BankBalance?: number;
}

export interface QbPurchase {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  AccountRef: { value: string; name: string };
  EntityRef?: { name: string };
  PrivateNote?: string;
}

export interface QbDeposit {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DepositToAccountRef: { value: string; name: string };
  PrivateNote?: string;
}

// ── Public query functions ────────────────────────────────────────────────────

export async function getAccounts(company: string): Promise<QbAccount[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  // QB IQL does not support OR — run two queries and merge
  const [banks, cards] = await Promise.all([
    qbQuery<QbAccount>(tok.realmId, tok.accessToken, `SELECT * FROM Account WHERE AccountType = 'Bank' STARTPOSITION 1 MAXRESULTS 100`),
    qbQuery<QbAccount>(tok.realmId, tok.accessToken, `SELECT * FROM Account WHERE AccountType = 'Credit Card' STARTPOSITION 1 MAXRESULTS 100`),
  ]);
  return [...banks, ...cards];
}

export async function getPurchases(
  company: string,
  accountId: string,
  start: string,
  end: string,
): Promise<QbPurchase[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  // QB does not support filtering Purchase queries by AccountRef — fetch by date and filter client-side.
  const rows = await qbQuery<QbPurchase>(
    tok.realmId,
    tok.accessToken,
    `SELECT * FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION 1 MAXRESULTS 1000`,
  );
  return rows.filter((p) => p.AccountRef?.value === accountId);
}

export async function getDeposits(
  company: string,
  accountId: string,
  start: string,
  end: string,
): Promise<QbDeposit[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  // QB does not support filtering Deposit queries by DepositToAccountRef — fetch by date and filter client-side.
  const rows = await qbQuery<QbDeposit>(
    tok.realmId,
    tok.accessToken,
    `SELECT * FROM Deposit WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION 1 MAXRESULTS 1000`,
  );
  return rows.filter((d) => d.DepositToAccountRef?.value === accountId);
}

export async function getRawAccounts(company: string, allFields = false): Promise<Record<string, unknown>[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  const url = `${QB_BASE}/${tok.realmId}/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Bank' STARTPOSITION 1 MAXRESULTS 100")}&minorversion=65`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${tok.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`QB raw accounts failed: ${r.status}`);
  const json = await r.json();
  const rows = json.QueryResponse?.Account ?? [];
  if (allFields) return rows; // return everything QB sends
  return rows.map((a: Record<string, unknown>) => ({
    Id: a.Id,
    Name: a.Name,
    AccountType: a.AccountType,
    AccountSubType: a.AccountSubType,
    CurrentBalance: a.CurrentBalance,
    CurrentBalanceWithSubAccounts: a.CurrentBalanceWithSubAccounts,
    Active: a.Active,
  }));
}

// ── P&L Reports ──────────────────────────────────────────────────────────────

export interface QbPnlRow {
  label: string;
  amount: number | null;
  children: QbPnlRow[];
  isSection: boolean;
  isSummary: boolean;
  group?: string;
}

function parseAmt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function parseQbRows(rows: unknown[]): QbPnlRow[] {
  const out: QbPnlRow[] = [];
  for (const row of (rows ?? [])) {
    const r = row as Record<string, unknown>;
    const type = r.type as string;
    const group = r.group as string | undefined;
    if (type === 'Section') {
      const hCols = ((r.Header as Record<string,unknown>)?.ColData as {value:string}[]) ?? [];
      const sCols = ((r.Summary as Record<string,unknown>)?.ColData as {value:string}[]) ?? [];
      const innerRows = ((r.Rows as Record<string,unknown>)?.Row as unknown[]) ?? [];
      const summaryAmt = parseAmt(sCols[1]?.value);
      const headerLabel = hCols[0]?.value ?? '';
      const summaryLabel = sCols[0]?.value ?? '';
      const parsedChildren = parseQbRows(innerRows);

      // Sections with no header (GrossProfit, NetIncome, etc.) are standalone bold rows
      if (!headerLabel && parsedChildren.length === 0) {
        out.push({ label: summaryLabel, amount: summaryAmt, children: [], isSection: false, isSummary: false, group });
      } else {
        out.push({
          label: headerLabel || summaryLabel,
          amount: summaryAmt,
          children: [
            ...parsedChildren,
            { label: summaryLabel, amount: summaryAmt, children: [], isSection: false, isSummary: true, group },
          ],
          isSection: true, isSummary: false, group,
        });
      }
    } else if (type === 'Data') {
      const cols = (r.ColData as {value:string}[]) ?? [];
      out.push({ label: cols[0]?.value ?? '', amount: parseAmt(cols[1]?.value), children: [], isSection: false, isSummary: false, group });
    }
  }
  return out;
}

export async function getPnlReport(
  company: string,
  start: string,
  end: string,
  basis: 'Accrual' | 'Cash' = 'Accrual',
): Promise<{ rows: QbPnlRow[]; startPeriod: string; endPeriod: string; basis: string } | null> {
  const tok = await getValidToken(company);
  if (!tok) return null;
  const url = new URL(`${QB_BASE}/${tok.realmId}/reports/ProfitAndLoss`);
  url.searchParams.set('start_date', start);
  url.searchParams.set('end_date', end);
  url.searchParams.set('accounting_method', basis);
  url.searchParams.set('minorversion', '65');
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tok.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`QB P&L failed: ${r.status} ${await r.text()}`);
  const json = await r.json();
  const header = json.Header ?? {};
  const topRows = (json.Rows?.Row as unknown[]) ?? [];
  return {
    rows: parseQbRows(topRows),
    startPeriod: header.StartPeriod ?? start,
    endPeriod: header.EndPeriod ?? end,
    basis: header.ReportBasis ?? basis,
  };
}

export async function getRawPnlMonthly(
  company: string,
  start: string,
  end: string,
  basis: 'Accrual' | 'Cash' = 'Accrual',
): Promise<unknown> {
  const tok = await getValidToken(company);
  if (!tok) return { error: 'no token' };
  const url = new URL(`${QB_BASE}/${tok.realmId}/reports/ProfitAndLoss`);
  url.searchParams.set('start_date', start);
  url.searchParams.set('end_date', end);
  url.searchParams.set('accounting_method', basis);
  url.searchParams.set('summarize_column_by', 'Month');
  url.searchParams.set('minorversion', '65');
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tok.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  return r.json();
}

// ── P&L Monthly Trend ────────────────────────────────────────────────────────

export interface QbPnlMonth {
  month: string;   // "2026-01"
  label: string;   // "Jan 2026"
  netIncome: number;
  grossProfit: number;
  totalIncome: number;
  totalExpenses: number;
}

export async function getPnlTrend(
  company: string,
  start: string,
  end: string,
  basis: 'Accrual' | 'Cash' = 'Accrual',
): Promise<QbPnlMonth[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  const url = new URL(`${QB_BASE}/${tok.realmId}/reports/ProfitAndLoss`);
  url.searchParams.set('start_date', start);
  url.searchParams.set('end_date', end);
  url.searchParams.set('accounting_method', basis);
  url.searchParams.set('summarize_column_by', 'Month');
  url.searchParams.set('minorversion', '65');
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tok.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`QB P&L trend failed: ${r.status}`);
  const json = await r.json();

  type QbCol = { ColTitle: string; ColType: string; MetaData?: { Name: string; Value: string }[] };
  const columns = (json.Columns?.Column as QbCol[]) ?? [];
  // Month columns have ColType=Money AND MetaData with StartDate
  const monthCols = columns.filter(c =>
    c.ColType === 'Money' &&
    (c.MetaData ?? []).some(m => m.Name === 'StartDate'),
  );
  const n = monthCols.length;
  if (!n) return [];

  // In the monthly P&L all top-level rows are Sections; values are in Summary.ColData
  // ColData layout: [label, month1, month2, ..., Total]
  const topRows = (json.Rows?.Row as Record<string, unknown>[]) ?? [];
  function extractSummary(group: string): number[] {
    const row = topRows.find(rr => rr.group === group);
    if (!row) return new Array(n).fill(0);
    const cols = (((row.Summary as Record<string, unknown>)?.ColData) as { value: string }[]) ?? [];
    return cols.slice(1, 1 + n).map(c => parseFloat(c.value) || 0);
  }

  const netIncomeVals    = extractSummary('NetIncome');
  const grossProfitVals  = extractSummary('GrossProfit');
  const totalIncomeVals  = extractSummary('Income');
  const totalExpenseVals = extractSummary('Expenses');

  return monthCols.map((col, i) => {
    const meta  = col.MetaData ?? [];
    const start = meta.find(m => m.Name === 'StartDate')?.Value ?? '';
    const month = start ? start.slice(0, 7) : col.ColTitle;
    return {
      month,
      label: col.ColTitle,
      netIncome:     netIncomeVals[i]    ?? 0,
      grossProfit:   grossProfitVals[i]  ?? 0,
      totalIncome:   totalIncomeVals[i]  ?? 0,
      totalExpenses: totalExpenseVals[i] ?? 0,
    };
  });
}

// Reads a single Account entity directly (vs. IQL query) — exposes BankBalance when bank feed is connected
export async function getRawAccountById(company: string, accountId: string): Promise<Record<string, unknown> | null> {
  const tok = await getValidToken(company);
  if (!tok) return null;
  const r = await fetch(
    `${QB_BASE}/${tok.realmId}/account/${accountId}?minorversion=65`,
    { headers: { Authorization: `Bearer ${tok.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10_000) },
  );
  if (!r.ok) return null;
  const json = await r.json().catch(() => null);
  return json?.Account ?? null;
}

// Unfiltered — all purchases / deposits for a company in a date range.
export async function getAllPurchases(company: string, start: string, end: string): Promise<QbPurchase[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  return qbQuery<QbPurchase>(
    tok.realmId,
    tok.accessToken,
    `SELECT * FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION 1 MAXRESULTS 1000`,
  );
}

export async function getAllDeposits(company: string, start: string, end: string): Promise<QbDeposit[]> {
  const tok = await getValidToken(company);
  if (!tok) return [];
  return qbQuery<QbDeposit>(
    tok.realmId,
    tok.accessToken,
    `SELECT * FROM Deposit WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION 1 MAXRESULTS 1000`,
  );
}
