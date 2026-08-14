/**
 * TYPED ABSENCE — four different things look like a blank cell and must not.
 *
 *   Measured zero      plain 0        it really is zero
 *   Not visible to us  UnknownValue   no POS attribution, no feed, no count
 *   Doesn't apply      NotMeasured    a salaried manager's $/hr
 *   Blocked upstream   NeedsInput     a %-of-sales bill with no sales yet
 *
 * This is the most consequential rule in the system. A missing POS attribution
 * rendered as 0% looks like an employee who sold nothing and gets them coached; a
 * %-fee bill with no sales to resolve against rendered as $0 looks like a bill that
 * costs nothing and gets a payment missed.
 *
 * `reason` is REQUIRED on UnknownValue for that reason — the person reading the
 * cell is deciding whether to act on it, and "we don't know" without "because"
 * is not enough to decide on.
 */

export function UnknownValue({ reason, label = 'n/a' }: { reason: string; label?: string }) {
  return (
    <span className="sk-unknown" title={reason}>
      {label}
    </span>
  )
}

/** The figure is meaningless for this row, not merely missing. */
export function NotMeasured({
  children = 'salaried — not measured',
  reason,
}: {
  children?: React.ReactNode
  reason?: string
}) {
  return (
    <span className="sk-notmeasured" title={reason}>
      {children}
    </span>
  )
}

/** A derived figure blocked on an upstream value — named as a badge, not blanked. */
export function NeedsInput({ label = 'needs sales', reason }: { label?: string; reason?: string }) {
  return (
    <span className="sk-needsinput" title={reason}>
      {label}
    </span>
  )
}

/* ── CertaintySplit ───────────────────────────────────────────────────────── */

/**
 * How much of a figure is incurred, committed, or still forecast.
 *
 * A weekly cost that is 40% forecast is a different object from one fully incurred,
 * and the two cannot sit in the same column unlabelled. Solid = spent; mid =
 * committed (scheduled labour, received invoices, dated bills); pale = forecast.
 *
 * Values are weights, not percentages — pass the dollars.
 */
export function CertaintySplit({
  actual = 0,
  committed = 0,
  forecast = 0,
  width = 64,
}: {
  actual?: number
  committed?: number
  forecast?: number
  width?: number
}) {
  const total = actual + committed + forecast || 1
  const pct = (v: number) => Math.round((v / total) * 100)
  const seg = (v: number, cls: string) =>
    v > 0 ? <i key={cls} className={cls} style={{ flex: v / total }} /> : null

  return (
    <div
      className="sk-certainty"
      style={{ maxWidth: width }}
      title={`${pct(actual)}% incurred · ${pct(committed)}% committed · ${pct(forecast)}% forecast`}
    >
      {seg(actual, 'sk-cert-actual')}
      {seg(committed, 'sk-cert-committed')}
      {seg(forecast, 'sk-cert-forecast')}
    </div>
  )
}

/**
 * REQUIRED wherever a CertaintySplit appears. Three unlabelled shades of indigo are
 * decoration; with the legend they are a statement about how much of the number is
 * real yet.
 */
export function CertaintyLegend() {
  return (
    <span className="sk-cert-legend">
      <span>
        <i className="sk-cert-actual" />
        incurred
      </span>
      <span>
        <i className="sk-cert-committed" />
        committed
      </span>
      <span>
        <i className="sk-cert-forecast" />
        forecast
      </span>
    </span>
  )
}
