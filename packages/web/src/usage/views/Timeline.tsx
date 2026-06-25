import { useState } from 'react'
import type { UsageApi } from '../usageApi.js'
import { useData } from '../useData.js'
import { CostBars } from '../components/CostBars.js'
import { Metric } from '../components/Metric.js'
import { fmtTokens, fmtUSD, fmtUSDCompact } from '../format.js'

interface Row {
  key: string
  input: number
  output: number
  cacheRead: number
  cost: number
}

export function Timeline({ api }: { api: UsageApi }) {
  const [mode, setMode] = useState<'daily' | 'monthly'>('daily')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  const { data, error } = useData<Row[]>(async () => {
    if (mode === 'daily') {
      const d = await api.daily({ since, until })
      return d.days.map((x) => ({ key: x.date, input: x.input, output: x.output, cacheRead: x.cacheRead, cost: x.cost }))
    }
    const d = await api.monthly({ since, until })
    return d.months.map((x) => ({ key: x.month, input: x.input, output: x.output, cacheRead: x.cacheRead, cost: x.cost }))
  }, [api, mode, since, until])

  const total = data?.reduce((s, r) => s + r.cost, 0) ?? 0
  const tokens = data?.reduce((s, r) => s + r.input + r.output + r.cacheRead, 0) ?? 0

  return (
    <>
      <div className="u-toolbar">
        <div className="u-seg">
          <button className={mode === 'daily' ? 'on' : ''} onClick={() => setMode('daily')}>
            Daily
          </button>
          <button className={mode === 'monthly' ? 'on' : ''} onClick={() => setMode('monthly')}>
            Monthly
          </button>
        </div>
        <label className="u-field">
          Since <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="u-field">
          Until <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>

      {error ? (
        <div className="u-error">{error}</div>
      ) : !data ? (
        <div className="u-loading">Loading…</div>
      ) : (
        <>
          <div className="u-stat-strip">
            <Metric label="Total spend" tone="accent" value={fmtUSDCompact(total)} sub={`${data.length} ${mode === 'daily' ? 'days' : 'months'}`} />
            <Metric label="Tokens" value={fmtTokens(tokens)} />
          </div>
          <section className="u-panel">
            <h2 className="u-panel-title">Cost over time</h2>
            <CostBars points={data.map((r) => ({ label: r.key, cost: r.cost }))} />
          </section>
          <section className="u-panel">
            <table className="u-table">
              <thead>
                <tr>
                  <th>{mode === 'daily' ? 'Date' : 'Month'}</th>
                  <th className="u-num">Input</th>
                  <th className="u-num">Output</th>
                  <th className="u-num">Cache read</th>
                  <th className="u-num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.key}>
                    <td className="u-mono">{r.key}</td>
                    <td className="u-num">{fmtTokens(r.input)}</td>
                    <td className="u-num">{fmtTokens(r.output)}</td>
                    <td className="u-num">{fmtTokens(r.cacheRead)}</td>
                    <td className="u-num u-cost">{fmtUSD(r.cost)}</td>
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
