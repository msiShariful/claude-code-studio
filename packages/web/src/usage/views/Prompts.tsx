import { useState } from 'react'
import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { fmtTime, fmtUSD } from '../format.js'

export function Prompts({ api }: { api: UsageApi }) {
  const [limit, setLimit] = useState(100)
  const { data, error } = useData(() => api.history({ limit }), [api, limit])

  return (
    <>
      <div className="u-toolbar">
        <label className="u-field">
          Show
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[50, 100, 250].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="u-note">Reads full transcripts — a touch slower than the other views.</span>
      </div>

      {error ? (
        <div className="u-error">{error}</div>
      ) : !data ? (
        <div className="u-loading">Loading…</div>
      ) : (
        <section className="u-panel">
          <h2 className="u-panel-title">{data.length} prompts</h2>
          <table className="u-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Project</th>
                <th>Prompt</th>
                <th>Session</th>
                <th className="u-num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p, i) => (
                <tr key={i}>
                  <td className="u-dim">{fmtTime(p.timestamp)}</td>
                  <td className="u-mono">{p.project}</td>
                  <td className="u-prompt">{p.prompt}</td>
                  <td className="u-mono u-dim">{(p.session ?? '').slice(0, 8)}</td>
                  <td className="u-num u-cost">{p.cost != null ? fmtUSD(p.cost) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
