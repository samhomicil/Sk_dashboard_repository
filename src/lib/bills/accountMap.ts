// Turns a bill's bank label (paidFrom: BOA/Chase/Huntington) into the QuickBooks
// account id used for reconciliation.
//
// Configure via the ACCOUNT_MAP env var (JSON). Keys may be either:
//   "store|paidFrom"  (per-store accounts)  — checked first
//   "paidFrom"        (shared accounts)     — fallback
//
// When there's no database (local/demo mode), we synthesize a stable id of the
// form "acct:store|paidFrom" so the mock adapter and reconciliation line up.

import { isDbConfigured } from './db';

export type AccountMap = Record<string, string>;

export function loadAccountMap(): AccountMap {
  const raw = process.env.ACCOUNT_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AccountMap;
  } catch {
    console.warn('[accountMap] ACCOUNT_MAP is not valid JSON; ignoring.');
    return {};
  }
}

export const mockAccountId = (store: string, paidFrom: string | null | undefined) =>
  `acct:${store}|${paidFrom || 'Unassigned'}`;

export function resolveAccount(
  store: string,
  paidFrom: string | null | undefined,
  map: AccountMap = loadAccountMap(),
): string | undefined {
  const byStore = paidFrom ? map[`${store}|${paidFrom}`] : undefined;
  const byLabel = paidFrom ? map[paidFrom] : undefined;
  const real = byStore || byLabel;
  if (real) return real;
  if (!isDbConfigured()) return mockAccountId(store, paidFrom);
  return undefined;
}
