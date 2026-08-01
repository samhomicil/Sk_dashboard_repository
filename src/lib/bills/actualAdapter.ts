import 'server-only';
import type { SalesData } from './billsEngine';
import type { BillRecord } from './types';
import type { ActualTxn } from './actual';
import { buildMockTxns, mockAccountsMap } from './actualMock';

// QB is the live transaction source (Actual Budget was retired). Returns true
// when at least one store's QuickBooks company is connected.
export async function isLiveConfigured(): Promise<boolean> {
  try {
    const qb = await import('./qbAdapter');
    return await qb.isQbConfigured();
  } catch {
    return false;
  }
}

export async function refresh(): Promise<void> {
  // no-op: QB tokens are refreshed on demand per request
}

export async function getAccountsMap(bills: BillRecord[]): Promise<Record<string, string>> {
  try {
    const qb = await import('./qbAdapter');
    if (await qb.isQbConfigured()) return qb.getQbAccountsMap();
  } catch {}
  return mockAccountsMap(bills);
}

export async function getTxnsByAccount(
  bills: BillRecord[],
  sales: SalesData,
  _accountIds: string[],
  startISO: string,
  endISO: string,
  now: Date,
): Promise<Record<string, ActualTxn[]>> {
  try {
    const qb = await import('./qbAdapter');
    if (await qb.isQbConfigured()) {
      return qb.getQbTxnsByAccount(bills, sales, _accountIds, startISO, endISO, now);
    }
  } catch (e) {
    console.warn('[actualAdapter] QB failed:', e);
  }
  return buildMockTxns(bills, sales, startISO, now);
}
