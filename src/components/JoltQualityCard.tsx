'use client'

// Jolt photo quality — was the SOP done to standard, not just "a photo uploaded"?
// Per-store quality % (pass / graded). quality_rate excludes neutral (stocking) &
// can't-determine — only pass vs fail count. (Per-photo detail lives on the Ops page.)

interface Counts {
  scored: number; pass: number; fail: number; neutral: number; cant: number
  flagged: number; graded: number; quality_rate: number
}
interface ListRow extends Counts { list_name: string }
interface LocationRow extends Counts { store: string; label: string; lists: ListRow[] }
interface FeedItem {
  store: string; list_name: string; item_name: string; captured_by: string
  captured_datetime: string; verdict: string; reason: string; flags: string
  quality_score: number | null; is_duplicate: number
}
export interface SopQualityData {
  window: { start: string; end: string } | null
  locations: LocationRow[]
  feed: FeedItem[]
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`
const shortDate = (s?: string) => (s ? `${Number(s.split('-')[1])}/${Number(s.split('-')[2])}` : '')
const QUALITY_TARGET = 0.85

function QCell({ rate, graded }: { rate: number; graded: number }) {
  const color = graded === 0 ? 'text-slate-400'
    : rate >= QUALITY_TARGET ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'
  return (
    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
      {graded === 0 ? <span className="text-slate-400">—</span>
        : <><span className={color}>{pct(rate)}</span> <span className="text-slate-400">({graded})</span></>}
    </td>
  )
}
function Num({ v, tone }: { v: number; tone?: string }) {
  return <td className={`px-2 py-1.5 text-right tabular-nums ${tone ?? 'text-slate-700'}`}>{v || <span className="text-slate-300">0</span>}</td>
}
function Bar({ r }: { r: Counts }) {
  const g = r.graded || 1
  const seg = (n: number, color: string, title: string) =>
    n > 0 ? <div style={{ width: `${(n / g) * 100}%`, background: color }} className="h-2" title={title} /> : null
  return (
    <div className="flex w-full min-w-[80px] rounded-sm overflow-hidden bg-slate-100">
      {seg(r.pass, '#2563eb', `Pass ${r.pass}`)}
      {seg(r.fail, '#dc2626', `Fail ${r.fail}`)}
    </div>
  )
}

export default function JoltQualityCard({ data, loading }: { data: SopQualityData | null; loading?: boolean }) {
  const locations = data?.locations ?? []

  if (loading) {
    return (
      <div className="card">
        <div className="skeleton h-3 w-44 mb-3" />
        <div className="skeleton h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Jolt Photo Quality</span>
        <span className="text-[10px] text-slate-400">
          done-to-standard{data?.window ? ` · ${shortDate(data.window.start)}–${shortDate(data.window.end)}` : ''}
        </span>
      </div>

      {locations.length === 0 ? (
        <div className="text-xs text-slate-400 py-4">No scored photos yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="px-2 py-1.5 text-left font-semibold">Location</th>
                <th className="px-2 py-1.5 text-right font-semibold">
                  Quality <span className="font-normal text-slate-300">tgt 85%</span>
                </th>
                <th className="px-2 py-1.5 text-right font-semibold">Pass</th>
                <th className="px-2 py-1.5 text-right font-semibold">Fail</th>
                <th className="px-2 py-1.5 text-right font-semibold" title="stocking + can't-determine (not graded)">N/A</th>
                <th className="px-2 py-1.5 text-left font-semibold w-24">Pass/Fail</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => (
                <tr key={loc.store} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{loc.label}</td>
                  <QCell rate={loc.quality_rate} graded={loc.graded} />
                  <Num v={loc.pass} tone="text-slate-700" />
                  <Num v={loc.fail} tone={loc.fail ? 'text-red-600 font-medium' : 'text-slate-700'} />
                  <Num v={loc.neutral + loc.cant} tone="text-slate-400" />
                  <td className="px-2 py-1.5"><Bar r={loc} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
