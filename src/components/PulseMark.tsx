// The Pulse mark: a heartbeat line on a brass tile (Sam picked the badge, 2026-10-18).
// Colours come from tokens.css so the mark follows the design system. app/icon.svg,
// app/favicon.ico and app/apple-icon.png are the same drawing with the colours written
// in, because a browser tab or a phone's home screen can't read the page's CSS.
export default function PulseMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="var(--accent)" />
      <polyline fill="none" stroke="var(--brand-deep)" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round"
                points="14,54 31,54 40,26 52,78 61,42 68,54 86,54" />
    </svg>
  )
}
