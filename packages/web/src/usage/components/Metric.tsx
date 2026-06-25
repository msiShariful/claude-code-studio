import type { ReactNode } from 'react'

/** A single hero figure: an eyebrow label, the number, and an optional sub-line. */
export function Metric({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'accent' | 'live'
}) {
  return (
    <div className={`u-metric u-metric-${tone}`}>
      <div className="u-eyebrow">{label}</div>
      <div className="u-metric-value">{value}</div>
      {sub != null && <div className="u-metric-sub">{sub}</div>}
    </div>
  )
}
