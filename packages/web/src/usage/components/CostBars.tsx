import { fmtUSDCompact } from '../format.js'

interface Point {
  label: string
  cost: number
}

const STEP = 10
const BAR = 7
const H = 100

/** A lightweight SVG bar chart of cost over time. Stretches to its container. */
export function CostBars({ points }: { points: Point[] }) {
  if (points.length === 0) return <p className="u-empty">Nothing in this range.</p>
  const max = points.reduce((m, p) => Math.max(m, p.cost), 0) || 1
  const width = points.length * STEP

  return (
    <svg
      viewBox={`0 0 ${width} ${H}`}
      className="u-bars"
      preserveAspectRatio="none"
      role="img"
      aria-label="Cost over time"
    >
      {points.map((p, i) => {
        const h = (p.cost / max) * H
        return (
          <rect
            key={p.label + i}
            x={i * STEP + (STEP - BAR) / 2}
            y={H - h}
            width={BAR}
            height={Math.max(h, 0.4)}
            rx={0.6}
            className="u-bar"
          >
            <title>{`${p.label} · ${fmtUSDCompact(p.cost)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}
