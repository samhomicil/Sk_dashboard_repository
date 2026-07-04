'use client'

import type { EmployeeRow } from '@/lib/types'

interface Props {
  employees: EmployeeRow[]
  loading:   boolean
}

function shortRole(role: string) {
  if (!role) return '—'
  const r = role.toLowerCase()
  if (r.includes('owner'))           return 'Owner'
  if (r.includes('general manager')) return 'GM'
  if (r.includes('assistant'))       return 'AGM'
  if (r.includes('salary'))          return 'Salary'
  if (r.includes('captain'))         return 'Capt.'
  if (r.includes('training'))        return 'Training'
  if (r.includes('shift'))           return 'Shift Lead'
  return 'TM'
}

function colorEE(v: number | null) {
  if (v === null) return 'text-slate-400'
  if (v >= 80) return 'text-emerald-600'
  if (v >= 60) return 'text-amber-500'
  return 'text-red-500 font-semibold'
}

export default function EmployeeTable({ employees, loading }: Props) {
  if (loading) return <div className="card"><div className="skeleton h-40 w-full" /></div>
  if (!employees.length) return null

  const totalHrs = employees.reduce((s, e) => s + e.hours, 0)
  const totalPay = employees.reduce((s, e) => s + e.totalPay, 0)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-bold text-slate-700">Employee Labor</div>
          <div className="text-xs text-slate-400 mt-0.5">Source: Sigma Labor · Sales/hr is store-level</div>
        </div>
        <span className="pill pill-gray">{employees.length} employees</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left pb-2">Employee</th>
              <th className="text-left pb-2">Store</th>
              <th className="text-left pb-2">Role</th>
              <th className="text-right pb-2">Rate</th>
              <th className="text-right pb-2">Hours</th>
              <th className="text-right pb-2">Pay</th>
              <th className="text-right pb-2">Sales/Hr</th>
              <th className="text-right pb-2">EE%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {employees.map((e, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="py-1.5 font-semibold text-slate-700">{e.name}</td>
                <td className="text-slate-400">{e.store}</td>
                <td className="text-slate-500">{shortRole(e.role)}</td>
                <td className="text-right text-slate-600">
                  {e.rate > 0
                    ? `$${e.rate.toFixed(2)}`
                    : <span className="italic text-slate-300">Salary</span>}
                </td>
                <td className="text-right text-slate-600">{e.hours > 0 ? `${e.hours.toFixed(1)}h` : '—'}</td>
                <td className="text-right text-slate-700 font-semibold">
                  {e.totalPay > 0 ? `$${Math.round(e.totalPay).toLocaleString()}` : '—'}
                </td>
                <td
                  className="text-right text-slate-600 cursor-help"
                  title={e.totalSales != null ? `Period sales attributed: $${Math.round(e.totalSales).toLocaleString()}` : undefined}
                >
                  {e.salesPerHour > 0 ? `$${e.salesPerHour.toFixed(0)}` : '—'}
                </td>
                <td className={`text-right ${colorEE(e.eePct)}`}>
                  {e.eePct !== null ? `${e.eePct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200">
            <tr className="text-[10px] text-slate-500 font-semibold">
              <td colSpan={4} className="pt-2">Total</td>
              <td className="text-right pt-2">{totalHrs.toFixed(1)}h</td>
              <td className="text-right pt-2 text-slate-700 font-bold">
                ${totalPay.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
