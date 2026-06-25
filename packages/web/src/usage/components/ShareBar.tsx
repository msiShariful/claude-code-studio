/** A thin proportion bar for table rows — share of total in [0,1]. */
export function ShareBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  return (
    <div className="u-sharebar">
      <span style={{ width: `${pct}%`, background: color ?? 'var(--u-accent)' }} />
    </div>
  )
}
