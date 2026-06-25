import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { Metric } from '../components/Metric.js'
import { ShareBar } from '../components/ShareBar.js'
import { fmtTokens, fmtUSD, fmtUSDCompact } from '../format.js'

export function Projects({ api }: { api: UsageApi }) {
  const { data, error } = useData(() => api.projects(), [api])
  if (error) return <div className="u-error">{error}</div>
  if (!data) return <div className="u-loading">Loading…</div>

  const total = data.reduce((s, p) => s + p.cost, 0)

  return (
    <>
      <div className="u-stat-strip">
        <Metric label="Projects" value={data.length} />
        <Metric label="Total spend" tone="accent" value={fmtUSDCompact(total)} />
      </div>
      <section className="u-panel">
        <h2 className="u-panel-title">Cost by project</h2>
        <table className="u-table">
          <thead>
            <tr>
              <th>Project</th>
              <th className="u-num">Sessions</th>
              <th className="u-num">Input</th>
              <th className="u-num">Output</th>
              <th>Share</th>
              <th className="u-num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.project}>
                <td className="u-mono">{p.display}</td>
                <td className="u-num">{p.sessions}</td>
                <td className="u-num">{fmtTokens(p.input)}</td>
                <td className="u-num">{fmtTokens(p.output)}</td>
                <td className="u-share-cell">
                  <ShareBar value={total ? p.cost / total : 0} />
                </td>
                <td className="u-num u-cost">{fmtUSD(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
