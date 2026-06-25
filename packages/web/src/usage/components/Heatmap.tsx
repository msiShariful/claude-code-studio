import type { HeatCellDto } from '../usageApi.js'
import { fmtUSDCompact } from '../format.js'

const STEP = 16
const CELL = 13

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t)
}
// Cost intensity: faint indigo → accent → magenta. The signature heat ramp.
function heat(t: number): string {
  if (t <= 0) return ''
  const base = [35, 40, 64]
  const acc = [107, 118, 255]
  const mag = [194, 100, 255]
  let c: number[]
  if (t < 0.6) {
    const k = t / 0.6
    c = base.map((x, i) => lerp(x, acc[i], k))
  } else {
    const k = (t - 0.6) / 0.4
    c = acc.map((x, i) => lerp(x, mag[i], k))
  }
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** GitHub-style calendar where each day's intensity is its spend. */
export function Heatmap({ cells }: { cells: HeatCellDto[] }) {
  if (cells.length === 0) return <p className="u-empty">No history yet.</p>
  const max = cells.reduce((m, c) => Math.max(m, c.cost), 0)
  const startWeekday = new Date(cells[0].date + 'T00:00:00Z').getUTCDay()
  const cols = Math.ceil((cells.length + startWeekday) / 7)
  const width = cols * STEP
  const height = 7 * STEP

  return (
    <div className="u-heatmap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="u-heatmap-svg"
        role="img"
        aria-label="Daily spend, last 12 weeks"
      >
        {cells.map((c, i) => {
          const pos = i + startWeekday
          const x = Math.floor(pos / 7) * STEP
          const y = (pos % 7) * STEP
          const t = max > 0 && c.cost > 0 ? Math.sqrt(c.cost / max) : 0
          const fill = heat(t)
          return (
            <rect
              key={c.date}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={2.5}
              className={fill ? 'u-cell' : 'u-cell u-cell-empty'}
              style={fill ? { fill } : undefined}
            >
              <title>{`${c.date} · ${fmtUSDCompact(c.cost)} · ${c.turns} turns`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="u-heatmap-legend">
        <span>less</span>
        {[0, 0.3, 0.55, 0.8, 1].map((t) => (
          <span
            key={t}
            className={t ? 'u-cell-swatch' : 'u-cell-swatch u-cell-empty'}
            style={t ? { background: heat(t) } : undefined}
          />
        ))}
        <span>more</span>
      </div>
    </div>
  )
}
