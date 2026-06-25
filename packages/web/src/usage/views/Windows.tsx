import { useState } from 'react'
import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { BurnGauge } from '../components/BurnGauge.js'
import { Metric } from '../components/Metric.js'
import { fmtDuration, fmtTime, fmtTokens, fmtUSD, fmtUSDCompact } from '../format.js'

export function Windows({ api }: { api: UsageApi }) {
  const [limit, setLimit] = useState(20)
  const { data, error } = useData(() => api.blocks({ limit }), [api, limit])

  const active = data?.find((b) => b.active)

  return (
    <>
      <div className="u-toolbar">
        <label className="u-field">
          Show
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
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
          {active && (
            <section className="u-panel u-panel-live">
              <h2 className="u-panel-title">
                <span className="u-live-dot" /> Active window
              </h2>
              <div className="u-stat-strip">
                <Metric label="Spent" tone="live" value={fmtUSDCompact(active.cost)} sub={`${active.turns} turns`} />
                <Metric label="Burn rate" value={`${fmtUSDCompact(active.burn_rate_per_hour)}/h`} />
                <Metric label="Projected" value={fmtUSDCompact(active.projected_cost)} />
                <Metric label="Remaining" value={fmtDuration(active.remaining_ms)} />
              </div>
              <BurnGauge block={active} />
            </section>
          )}
          <section className="u-panel">
            <h2 className="u-panel-title">Recent windows</h2>
            <table className="u-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Ends</th>
                  <th>Status</th>
                  <th className="u-num">Turns</th>
                  <th className="u-num">Tokens</th>
                  <th className="u-num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.start}>
                    <td className="u-dim">{fmtTime(b.start)}</td>
                    <td className="u-dim">{fmtTime(b.end)}</td>
                    <td>
                      {b.active ? (
                        <span className="u-chip u-chip-live">
                          <span className="u-live-dot" /> live
                        </span>
                      ) : (
                        <span className="u-chip u-dim">closed</span>
                      )}
                    </td>
                    <td className="u-num">{b.turns}</td>
                    <td className="u-num">{fmtTokens(b.input + b.output + b.cacheRead + b.cacheWrite)}</td>
                    <td className="u-num u-cost">{fmtUSD(b.cost)}</td>
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
