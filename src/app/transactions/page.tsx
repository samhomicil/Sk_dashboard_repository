import { requireOwnerPage } from '@/lib/owner-guard';
import TransactionsClient from './TransactionsClient';

// Owner-only (gated in proxy.ts + here). QuickBooks-sourced transactions view.
export const dynamic = 'force-dynamic';

export default async function TransactionsPage() {
  await requireOwnerPage();
  return <TransactionsClient />;
}
