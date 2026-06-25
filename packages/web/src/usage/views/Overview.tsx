import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { BurnGauge } from '../components/BurnGauge.js'
import { Heatmap } from '../components/Heatmap.js'
import { Metric } from '../components/Metric.js'
import { ModelSplit } from '../components/ModelSplit.js'
import { fmtDuration, fmtTokens, fmtUSDCompact } from '../format.js'

export function Overview({ api }: { api: UsageApi }) {
  const { data, error } = useData(() => api.overview(), [api])
  if (error) return <div className="u-error">{error}</div>
  if (!data) return <div className="u-loading">Reading your transcripts…</div>

  const { today, active_block: block, stats, heatmap } = data
  const todayTokens = Object.values(today.models).reduce(
    (s, m) => s + m.input + m.output + m.cacheRead + m.cacheWrite,
    0,
  )
  const total = today.total_cost
  const slices = Object.entries(today.models).map(([model, m]) => ({
    model,
    cost: m.cost,
    share: total ? m.cost / total : 0,
  }))
  const allTokens = stats.input + stats.output + stats.cacheRead + stats.cacheWrite

  return (
    <>
      <div className="u-hero">
        <Metric
          label="Today"
          tone="accent"
          value={fmtUSDCompact(total)}
          sub={`${today.turns} turns · ${fmtTokens(todayTokens)} tokens`}
        />
        {block ? (
          <div className="u-hero-window">
            <Metric
              label="Active 5-hour window"
              tone="live"
              value={fmtUSDCompact(block.cost)}
              sub={`${fmtUSDCompact(block.burn_rate_per_hour)}/h · ${fmtDuration(block.remaining_ms)} left · ${fmtUSDCompact(block.projected_cost)} projected`}
            />
            <BurnGauge block={block} />
          </div>
        ) : (
          <Metric label="Active 5-hour window" value="—" sub="No window open right now" />
        )}
      </div>

      <section className="u-panel">
        <h2 className="u-panel-title">Spend · last 12 weeks</h2>
        <Heatmap cells={heatmap} />
      </section>

      <div className="u-stat-strip">
        <Metric label="All-time spend" value={fmtUSDCompact(stats.cost)} />
        <Metric label="Sessions" value={stats.session_count} />
        <Metric label="Projects" value={stats.project_count} />
        <Metric label="Tokens" value={fmtTokens(allTokens)} />
      </div>

      <section className="u-panel">
        <h2 className="u-panel-title">Today by model</h2>
        <ModelSplit models={slices} />
      </section>
    </>
  )
}
