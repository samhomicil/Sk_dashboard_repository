import { requireOwnerPage } from '@/lib/owner-guard';
// src/app/bills/vendors/page.tsx
import { getDashboardData } from '@/lib/bills/service';
import { loadAllBills, loadSales } from '@/lib/bills/data';
import { mapBill } from '../page';
import VendorsTab from '../VendorsTab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function VendorsPage() {
  await requireOwnerPage();

  const [dash, allBills, sales] = await Promise.all([
    getDashboardData(),
    loadAllBills(),
    loadSales(),
  ]);

  return (
    <main className="pb-safe-mobile">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-5 py-3.5 backdrop-blur sm:px-7">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Vendors</h1>
          <p className="text-[11px] text-slate-400">Configuration · defines the bills that appear on the Bills overview</p>
        </div>
      </header>
      <div className="px-5 py-6 sm:px-7">
        <VendorsTab
          bills={allBills.map(mapBill)}
          sales={sales}
          store="All"
          now={new Date()}
          occ={dash.occurrences}
        />
      </div>
    </main>
  );
}
