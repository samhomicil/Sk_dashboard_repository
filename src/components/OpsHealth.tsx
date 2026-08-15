'use client'

import Link from 'next/link'

import type { KpiData } from '@/lib/types'
import type { SociData } from '@/app/api/soci/route'
import type { GuestSummary } from '@/app/api/guest-satisfaction/route'
import { TARGETS } from '@/lib/config'

interface Props {
  kpis:    KpiData | null
  soci?:   SociData | null
  guest?:  GuestSummary | null
  loading: boolean
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%` }
function dol(n: number) { return n >= 0 ? `+$${Math.abs(Math.round(n))}` : `-$${Math.abs(Math.round(n))}` }

// Same shape as the Void/Discount/Till metrics above: a sub-header naming the metric and
// its target, then the dot and value. Detail lives in the tooltip.
/**
 * One measured metric: what it is and its threshold on top, then a dot beside the
 * figure, then the comparison beneath. Same block shape for the ops metrics and the
 * guest ones, so a reader learns it once.
 */
function VTile({ header, target, dot, value, unit, note, tip, tone, emphasis }: {
  header: string
  target?: string
  dot: 'g' | 'y' | 'r'
  value: string
  unit?: string
  note?: string
  tip: string
  tone?: 'bad' | 'dim'
  emphasis?: boolean
}) {
  const toneCls = tone === 'bad' ? 'sk-tone-bad' : dot === 'r' ? 'sk-tone-bad' : dot === 'y' ? 'sk-tone-warn' : ''
  return (
    <div className="sk-ops-metric tabular-nums" title={tip}>
      <div className="sk-ops-head">
        {header}
        {target ? <span className="tgt">{target}</span> : null}
      </div>
      <div className="sk-ops-value">
        <span className={`sk-dot sk-tone-${dot === 'g' ? 'good' : dot === 'y' ? 'warn' : 'bad'}`} style={{ background: 'var(--tone)' }} />
        <span className={`v tabular-nums ${toneCls}`} style={toneCls ? { color: 'var(--tone)' } : undefined}>
          {value}
          {unit ? <span className="u"> {unit}</span> : null}
        </span>
        {note ? <span className={`n${emphasis ? ' em' : ''}`}>{note}</span> : null}
      </div>
    </div>
  )
}

function GuestVoiceRow(
  { guest, soci }: { guest?: GuestSummary | null; soci?: SociData | null },
) {
  const tiles: React.ReactNode[] = []
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)

  if (guest?.connected) {
    const { osat, osatPrior, responses, goal, pace, worstMetric, cases } = guest
    const thin = responses > 0 && responses < 10
    const osatOk = osat != null && osat >= TARGETS.osatPct
    const delta = osat != null && osatPrior != null ? osat - osatPrior : null

    tiles.push(
      <VTile key="osat"
        header="Overall Satisfaction" target={`tgt ${(TARGETS.osatPct * 100).toFixed(0)}%`}
        dot={osat == null || thin ? 'y' : osatOk ? 'g' : 'r'}
        value={pct(osat)} tone={thin ? 'dim' : osatOk ? undefined : 'bad'}
        note={thin ? 'too few' : delta != null ? `${delta >= 0 ? '▲' : '▼'}${Math.abs(delta * 100).toFixed(0)}pts` : undefined}
        tip={`${guest.scope} · ${responses} responses in range · target ${(TARGETS.osatPct * 100).toFixed(0)}%`
          + (worstMetric ? ` · weakest: ${worstMetric.metric} ${pct(worstMetric.value)}` : '')
          + (thin ? ' · below 10 responses, widen the range' : '')} />,
      <VTile key="surveys"
        header="Surveys" target={`goal ${TARGETS.surveysPerStoreMonth}/store/mo`}
        dot={pace == null ? 'y' : pace >= 1 ? 'g' : pace >= 0.8 ? 'y' : 'r'}
        value={String(responses)} unit={`/ ${goal.toFixed(0)}`}
        note={pace != null ? `${(pace * 100).toFixed(0)}%` : undefined}
        tip={`Surveys collected vs a ${TARGETS.surveysPerStoreMonth}/store/month goal, prorated to the selected range`} />,
    )
    if (cases) {
      const owed = cases.pending > 0 || cases.overSla > 0
      tiles.push(
        <VTile key="cases"
          header="Incidents" target={`goal ${cases.goalHours}h`}
          dot={cases.opened === 0 ? 'g' : owed ? 'r' : 'y'}
          value={String(cases.opened)} tone={cases.opened ? 'bad' : undefined}
          note={cases.pending ? `${cases.pending} open` : undefined}
          tip={(cases.opened
            ? `Guest-recovery cases opened in range · avg close ${cases.avgHours?.toFixed(0) ?? '—'}h against a ${cases.goalHours}h callback goal · ${cases.overSla} past goal · ${cases.pending} still open`
            : 'No guest complaints raised in this range')
            + (guest.casesCombined ? ' · covers Pines and Miramar together — cases cannot be split by store yet' : '')} />,
      )
    }
  }

  if (soci?.connected) {
    const p = soci.period
    const count = p?.reviews ?? soci.newReviews
    // Always show a live rating. A quiet week is not missing data — the store still has a
    // standing Google score, and blanking it just because nobody reviewed lately hides the
    // number that actually matters. Fall back to the standing rating and say which it is.
    const inRange = count > 0 && p?.rating != null
    const rating = inRange ? p!.rating! : soci.avgRating
    const newest = p && p.newLast7 > 0 ? `${p.newLast7} new in 7d` : 'none in 7d'
    // SOCi only covers Margate, so on All this is one store's score, never a blend.
    const margateOnly = guest?.scope === 'all three stores'

    tiles.push(
      <VTile key="rating"
        header="Reviews" target={margateOnly ? 'Margate only' : 'Google + Yelp'}
        dot={rating == null ? 'y' : rating >= 4.5 ? 'g' : rating >= 4 ? 'y' : 'r'}
        value={rating == null ? '—' : rating.toFixed(2)} unit={rating == null ? undefined : '★'}
        note={inRange ? `${count} · ${newest}` : `current · ${newest}`}
        emphasis={Boolean(p && p.newLast7 > 0)}
        tip={(inRange
          ? `Rating from the ${count} review${count === 1 ? '' : 's'} inside the range`
          : `No reviews inside the range — showing the standing rating as of ${soci.snapshotDate || 'today'}`)
          + ` · lifetime ${soci.avgRating?.toFixed(2) ?? '—'} over ${soci.reviews.total} reviews`
          + (p ? ` · ${p.google} Google in range, ${p.yelp} Yelp lifetime · ${p.negative} rated 1–2★` : '')
          + (margateOnly ? ' · SOCi covers Margate only, so this is not a company figure' : '')} />,
    )
  }

  if (tiles.length === 0) return null
  return (
    <div className="sk-ops-guest">
      <div className="sk-eyebrow" style={{ marginBottom: 12 }}>
        <Link href="/guest-voice">Guest Voice &rarr;</Link>
        <span style={{ opacity: 0.7 }}> {guest?.scope ?? 'Margate'} · SMG survey + SOCi reviews</span>
      </div>
      <div className="sk-grid4">{tiles}</div>
    </div>
  )
}

export default function OpsHealth({ kpis, soci, guest, loading }: Props) {
  if (loading) return <div className="sk-card"><p className="sk-flags-empty">Loading…</p></div>
  if (!kpis) return null

  const voidOk     = kpis.voidPct     <= TARGETS.voidPct
  const discOk     = kpis.discountPct <= TARGETS.discountPct
  const tillOk     = kpis.tillVariance >= -20 // within -$20 is fine
  const allOk      = voidOk && discOk && tillOk

  const metrics = [
    {
      label: 'Void %',
      target: `<${pct(TARGETS.voidPct)}`,
      value: pct(kpis.voidPct),
      l4w: pct(kpis.voidPctL4W),
      ok: voidOk,
      warn: kpis.voidPct <= TARGETS.voidPct * 1.5,
    },
    {
      label: 'Discount %',
      target: `<${pct(TARGETS.discountPct)}`,
      value: pct(kpis.discountPct),
      l4w: pct(kpis.discountPctL4W),
      ok: discOk,
      warn: kpis.discountPct <= TARGETS.discountPct * 1.2,
    },
    {
      label: 'Till Variance',
      target: '> -$20',
      value: dol(kpis.tillVariance),
      l4w: dol(kpis.tillVarianceL4W),
      ok: tillOk,
      warn: kpis.tillVariance >= -50,
    },
  ]

  const outside = metrics.filter(m => !m.ok)

  return (
    <div className="sk-card">
      <h3 className="sk-card-title">Ops health</h3>
      <p className="sk-subline" style={{ margin: '4px 0 20px' }}>Flagged only if outside threshold</p>

      <div className="sk-grid3">
        {metrics.map(m => (
          <div key={m.label} className="sk-ops-metric tabular-nums">
            <div className="sk-ops-head">
              {m.label}<span className="tgt">{m.target}</span>
            </div>
            <div className="sk-ops-value">
              <span className={`sk-dot sk-tone-${m.ok ? 'good' : m.warn ? 'warn' : 'bad'}`} style={{ background: 'var(--tone)' }} />
              <span
                className={`v tabular-nums ${m.ok ? '' : m.warn ? 'sk-tone-warn' : 'sk-tone-bad'}`}
                style={m.ok ? undefined : { color: 'var(--tone)' }}
              >
                {m.value}
              </span>
            </div>
            <div className="sk-ops-l4w">L4W {m.l4w}</div>
          </div>
        ))}
      </div>

      {/* Silence is a result. When everything is inside its threshold this says
          nothing at all — the old green "all within target" banner was noise that
          appeared on every good week and trained people to skip the panel. */}
      {outside.length > 0 && (
        <div className="sk-ops-flags">
          {outside.map(m => (
            <div key={m.label} className={`sk-flag sk-tone-${m.warn ? 'warn' : 'bad'}`}>
              <span className="sk-flag-dot" />
              <span>{m.label} outside target — review needed</span>
            </div>
          ))}
        </div>
      )}

      <GuestVoiceRow guest={guest} soci={soci} />
    </div>
  )
}
