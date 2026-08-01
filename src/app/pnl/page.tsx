import PnlClient from './PnlClient';
import { requireOwnerPage } from '@/lib/owner-guard';

export const dynamic = 'force-dynamic';

export default async function PnlPage() {
  await requireOwnerPage();
  return <PnlClient />;
}
