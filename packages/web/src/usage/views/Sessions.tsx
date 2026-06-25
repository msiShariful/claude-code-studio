import { useState } from 'react'
import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { fmtTime, fmtTokens, fmtUSD, modelColor } from '../format.js'

export function Sessions({ api }: { api: UsageApi }) {
  const [sort, setSort] = useState('cost')
  const [limit, setLimit] = useState(50)
  const { data, error } = useData(() => api.session({ sort, limit }), [api, sort, limit])

  return (
    <>
      <div className="u-toolbar">
        <label className="u-field">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="cost">Cost</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
        <label className="u-field">
          Show
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[20, 50, 100].map((n) => (
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
        <section className="u-panel">
          <h2 className="u-panel-title">{data.length} sessions</h2>
          <table className="u-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Project</th>
                <th>Models</th>
                <th className="u-num">Turns</th>
                <th>Last activity</th>
                <th className="u-num">Tokens</th>
                <th className="u-num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.session}>
                  <td className="u-mono u-dim">{s.session.slice(0, 8)}</td>
                  <td className="u-mono">{s.project_display}</td>
                  <td>
                    {s.models.map((m) => (
                      <span key={m} className="u-chip" style={{ color: modelColor(m), borderColor: modelColor(m) }}>
                        {m}
                      </span>
                    ))}
                  </td>
                  <td className="u-num">{s.turns}</td>
                  <td className="u-dim">{fmtTime(s.last_ts)}</td>
                  <td className="u-num">{fmtTokens(s.input + s.output + s.cacheRead + s.cacheWrite)}</td>
                  <td className="u-num u-cost">{fmtUSD(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
