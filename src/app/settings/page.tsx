import { requireOwnerPage } from '@/lib/owner-guard';
// src/app/settings/page.tsx
import { loadBills, dataMode } from '@/lib/bills/data';
import { getAccountsMap } from '@/lib/bills/actualAdapter';
import { loadAccountMap } from '@/lib/bills/accountMap';
import { getConnections } from '@/lib/bills/qb';
import { auth } from '@/auth';
import SignOutButton from '@/components/SignOutButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORES = ['pines', 'miramar', 'margate'] as const;
const STORE_LABELS: Record<string, string> = { pines: 'Pines', miramar: 'Miramar', margate: 'Margate' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireOwnerPage();

  const session = await auth();
  const bills = await loadBills();
  const accounts = await getAccountsMap(bills);
  const map = loadAccountMap();
  const qbConnections = await getConnections();
  const qbConnectedSet = new Set(qbConnections.map((c) => c.company));
  const params = await searchParams;
  const qbConnected = params.qb_connected;
  const qbDisconnected = params.qb_disconnected;
  const qbError = params.qb_error;

  const needed = new Map<string, { store: string; paidFrom: string; count: number; account?: string }>();
  for (const b of bills) {
    const key = `${b.store}|${b.paidFrom || 'Unassigned'}`;
    const e = needed.get(key) || { store: b.store, paidFrom: b.paidFrom || 'Unassigned', count: 0, account: b.account || undefined };
    e.count++;
    needed.set(key, e);
  }

  const qbConfigured = qbConnections.length > 0;
  const accountSource = qbConfigured ? 'QuickBooks' : 'mock';

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-7">
      <a href="/bills" className="text-sm text-slate-500 hover:text-ink">← Back to bills</a>
      <h1 className="mt-3 text-xl font-semibold text-ink">Settings & setup</h1>

      {/* Signed-in account — also the mobile sign-out surface (sidebar chip is desktop-only) */}
      {session?.user && (
        <section className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex min-w-0 items-center gap-3">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="" className="h-9 w-9 flex-shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
                {(session.user.email ?? '?')[0]?.toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Signed in</p>
              <p className="truncate text-[13px] text-slate-500">{session.user.email}</p>
            </div>
          </div>
          <SignOutButton />
        </section>
      )}

      {(qbConnected || qbDisconnected || qbError) && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-sm ${qbError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {qbConnected && `QuickBooks connected for ${STORE_LABELS[qbConnected] ?? qbConnected}.`}
          {qbDisconnected && `QuickBooks disconnected for ${STORE_LABELS[qbDisconnected] ?? qbDisconnected}.`}
          {qbError && `QuickBooks error: ${qbError.replace(/_/g, ' ')}.`}
        </div>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card ok={dataMode() === 'db'} title="Database"
          body={dataMode() === 'db' ? 'Connected. Bills and sales are saved.' : 'Not connected. Set DATABASE_URL, then run db:push and import:bills.'} />
        <Card ok={qbConfigured} title="QuickBooks"
          body={qbConfigured ? `Live bank feed connected for ${qbConnections.length} of ${STORES.length} stores.` : 'Not connected. Connect each store below.'} />
      </section>

      {/* QuickBooks connections */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">QuickBooks connections</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Connect each store&apos;s QuickBooks company to feed the dashboard live transactions
          instead of simulated ones. You need <code className="rounded bg-slate-100 px-1">QBO_CLIENT_ID</code>,{' '}
          <code className="rounded bg-slate-100 px-1">QBO_CLIENT_SECRET</code>, and{' '}
          <code className="rounded bg-slate-100 px-1">QBO_REDIRECT_URI</code> set first.
        </p>

        <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
          {STORES.map((company) => {
            const connected = qbConnectedSet.has(company);
            const realm = qbConnections.find((c) => c.company === company)?.realmId;
            return (
              <div key={company} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <div>
                    <p className="text-sm font-medium text-ink">{STORE_LABELS[company]}</p>
                    {connected && realm && (
                      <p className="text-[11px] text-slate-400 font-mono">realm {realm}</p>
                    )}
                  </div>
                </div>
                {connected ? (
                  <form method="POST" action="/api/qb/disconnect">
                    <input type="hidden" name="company" value={company} />
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-500 hover:border-red-200 hover:text-red-600"
                    >
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <a
                    href={`/api/qb/auth?company=${company}`}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700"
                  >
                    Connect
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Account mapping */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Account mapping</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Map each bill&apos;s bank label to an account id from the table below, then put the result in the{' '}
          <code className="rounded bg-slate-100 px-1">ACCOUNT_MAP</code> env var (keyed <code className="rounded bg-slate-100 px-1">store|paidFrom</code>).
        </p>

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Store</th>
                <th className="px-4 py-2 font-medium">Paid from</th>
                <th className="px-4 py-2 text-right font-medium">Bills</th>
                <th className="px-4 py-2 font-medium">Mapped account id</th>
              </tr>
            </thead>
            <tbody>
              {((): { store: string; paidFrom: string; count: number; account?: string }[] => {
                const a: { store: string; paidFrom: string; count: number; account?: string }[] = [];
                needed.forEach((v) => a.push(v));
                return a;
              })()
                .sort((a, b) => a.store.localeCompare(b.store) || a.paidFrom.localeCompare(b.paidFrom))
                .map((n) => {
                  const mapped = map[`${n.store}|${n.paidFrom}`] || map[n.paidFrom] || n.account;
                  return (
                    <tr key={n.store + n.paidFrom} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-ink">{n.store}</td>
                      <td className="px-4 py-2 text-slate-600">{n.paidFrom}</td>
                      <td className="tnum px-4 py-2 text-right text-slate-500">{n.count}</td>
                      <td className="px-4 py-2 font-mono text-[12px] text-slate-500">
                        {mapped || <span className="text-amber-600">unmapped</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-[13px] font-semibold text-ink">
          Accounts available from {accountSource}
        </h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(accounts).map(([name, id]) => (
                <tr key={id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 text-ink">{name}</td>
                  <td className="px-4 py-2 font-mono text-[12px] text-slate-500">{id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Card({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
      <p className="mt-1 text-[13px] text-slate-500">{body}</p>
    </div>
  );
}
