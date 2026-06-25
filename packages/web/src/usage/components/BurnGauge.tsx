import type { BlockDto } from '../usageApi.js'
import { fmtTime } from '../format.js'

/** The active 5-hour billing window as a depleting bar — the area's live hero. */
export function BurnGauge({ block }: { block: BlockDto }) {
  const pct = Math.min(100, Math.max(0, block.progress_pct))
  return (
    <div className="u-gauge-wrap">
      <div className="u-gauge" role="img" aria-label={`Window ${pct.toFixed(0)}% elapsed`}>
        <div className="u-gauge-fill" style={{ width: `${pct}%` }} />
        {[20, 40, 60, 80].map((t) => (
          <span key={t} className="u-gauge-tick" style={{ left: `${t}%` }} />
        ))}
      </div>
      <div className="u-gauge-ends">
        <span>started {fmtTime(block.start)}</span>
        <span>{pct.toFixed(0)}% elapsed</span>
        <span>ends {fmtTime(block.end)}</span>
      </div>
    </div>
  )
}
