import { useState } from 'react'
import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { Metric } from '../components/Metric.js'
import { ModelSplit } from '../components/ModelSplit.js'
import { ShareBar } from '../components/ShareBar.js'
import { fmtPct, fmtTokens, fmtUSD, fmtUSDCompact, modelColor } from '../format.js'

const PERIODS = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
] as const

export function Models({ api }: { api: UsageApi }) {
  const [period, setPeriod] = useState('all')
  const { data, error } = useData(() => api.models({ period }), [api, period])

  return (
    <>
      <div className="u-toolbar">
        <label className="u-field">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="u-error">{error}</div>
      ) : !data ? (
        <div className="u-loading">Loading…</div>
      ) : (
        <>
          <div className="u-stat-strip">
            <Metric label="Spend" tone="accent" value={fmtUSDCompact(data.total_cost)} sub={data.period} />
            <Metric label="Models" value={data.models.length} />
          </div>
          <section className="u-panel">
            <h2 className="u-panel-title">Cost share</h2>
            <ModelSplit models={data.models} />
          </section>
          <section className="u-panel">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="u-num">Tokens</th>
                  <th className="u-num">Input</th>
                  <th className="u-num">Output</th>
                  <th>Share</th>
                  <th className="u-num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => (
                  <tr key={m.model}>
                    <td>
                      <span className="u-chip" style={{ color: modelColor(m.model), borderColor: modelColor(m.model) }}>
                        {m.model}
                      </span>
                    </td>
                    <td className="u-num">{fmtTokens(m.input + m.output + m.cacheRead + m.cacheWrite)}</td>
                    <td className="u-num">{fmtTokens(m.input)}</td>
                    <td className="u-num">{fmtTokens(m.output)}</td>
                    <td className="u-share-cell">
                      <ShareBar value={m.share} color={modelColor(m.model)} />
                      <span className="u-share-pct">{fmtPct(m.share * 100)}</span>
                    </td>
                    <td className="u-num u-cost">{fmtUSD(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  )
}
