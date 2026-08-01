import 'server-only';
import type { ActualTxn } from './actual';
import type { BillRecord } from './types';
import type { SalesData } from './billsEngine';
import { getAccounts, getPurchases, getDeposits, getConnections } from './qb';

export async function isQbConfigured(): Promise<boolean> {
  try {
    const c = await getConnections();
    return c.length > 0;
  } catch {
    return false;
  }
}

// Returns { "Pines - Checking": "pines:35", ... } for all connected companies.
export async function getQbAccountsMap(): Promise<Record<string, string>> {
  const connections = await getConnections().catch(() => []);
  const out: Record<string, string> = {};
  await Promise.all(
    connections.map(async ({ company }) => {
      try {
        const accounts = await getAccounts(company);
        for (const a of accounts) {
          out[`${cap(company)} - ${a.Name}`] = `${company}:${a.Id}`;
        }
      } catch (e) {
        console.warn(`[qbAdapter] getAccounts failed for ${company}:`, e);
      }
    }),
  );
  return out;
}

// Mirrors the actualAdapter.getTxnsByAccount signature.
// accountIds are in the form "pines:35" (company:qbAccountId).
export async function getQbTxnsByAccount(
  _bills: BillRecord[],
  _sales: SalesData,
  accountIds: string[],
  startISO: string,
  endISO: string,
  _now: Date,
): Promise<Record<string, ActualTxn[]>> {
  const out: Record<string, ActualTxn[]> = {};

  await Promise.all(
    accountIds.map(async (fullId) => {
      const colon = fullId.indexOf(':');
      if (colon < 0) return;
      const company = fullId.slice(0, colon);
      const qbAccountId = fullId.slice(colon + 1);

      try {
        const [purchases, deposits] = await Promise.all([
          getPurchases(company, qbAccountId, startISO, endISO),
          getDeposits(company, qbAccountId, startISO, endISO),
        ]);

        out[fullId] = [
          ...purchases.map(
            (p): ActualTxn => ({
              id: `${company}:p:${p.Id}`,
              account: fullId,
              date: p.TxnDate,
              amount: -Math.round(p.TotalAmt * 100),
              payee_name: p.EntityRef?.name,
              notes: p.PrivateNote,
              cleared: true,
            }),
          ),
          ...deposits.map(
            (d): ActualTxn => ({
              id: `${company}:d:${d.Id}`,
              account: fullId,
              date: d.TxnDate,
              amount: Math.round(d.TotalAmt * 100),
              notes: d.PrivateNote,
              cleared: true,
            }),
          ),
        ];
      } catch (e) {
        console.warn(`[qbAdapter] getTxns failed for ${fullId}:`, e);
        out[fullId] = [];
      }
    }),
  );

  return out;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
