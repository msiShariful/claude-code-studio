import { fmtUSDCompact, fmtPct, modelColor } from '../format.js'

interface Slice {
  model: string
  cost: number
  share: number
}

/** A 100% stacked bar of model cost share, with a legend — clearer than a donut. */
export function ModelSplit({ models }: { models: Slice[] }) {
  const shown = models.filter((m) => m.share > 0)
  if (shown.length === 0) return <p className="u-empty">No spend to split yet.</p>
  return (
    <div className="u-split">
      <div className="u-split-bar">
        {shown.map((m) => (
          <span
            key={m.model}
            className="u-split-seg"
            style={{ width: `${m.share * 100}%`, background: modelColor(m.model) }}
            title={`${m.model} · ${fmtPct(m.share * 100)}`}
          />
        ))}
      </div>
      <ul className="u-legend">
        {shown.map((m) => (
          <li key={m.model}>
            <span className="u-legend-dot" style={{ background: modelColor(m.model) }} />
            <span className="u-legend-name">{m.model}</span>
            <span className="u-legend-pct">{fmtPct(m.share * 100)}</span>
            <span className="u-legend-cost">{fmtUSDCompact(m.cost)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
