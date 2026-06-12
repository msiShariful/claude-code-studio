import { useCallback, useEffect, useState } from 'react'
import type { Api, PluginsListDto } from '../api.js'

export function Plugins({ api }: { api: Api }) {
  const [data, setData] = useState<PluginsListDto | null>(null)
  const [installId, setInstallId] = useState('')
  const [marketplaceSrc, setMarketplaceSrc] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await api.plugins())
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setData({ cliFound: false, plugins: [], marketplaces: [] })
    }
  }, [api])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setMessage({ kind: 'ok', text: okText })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="dim">Loading…</p>

  if (!data.cliFound) {
    return (
      <>
        <h2>Plugins</h2>
        <div className="alert error">
          Plugin management needs the claude CLI on your PATH — Studio drives{' '}
          <code>claude plugin …</code> rather than editing plugin state by hand. Install Claude
          Code, then reload this page.
        </div>
      </>
    )
  }

  return (
    <>
      <h2>Plugins</h2>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      {data.plugins.length === 0 ? (
        <p className="dim">No plugins installed.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Version</th>
              <th>Scope</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.plugins.map((p, i) => (
              <tr key={`${p.id}:${p.scope}:${p.projectPath ?? i}`}>
                <td className="path">{p.id}</td>
                <td className="dim">{p.version}</td>
                <td>
                  <span className={`badge ${p.scope === 'user' ? 'user' : 'projectLocal'}`}>
                    {p.scope}
                  </span>
                </td>
                <td className="dim">{p.enabled ? 'enabled' : 'disabled'}</td>
                <td>
                  <span className="toolbar" style={{ margin: 0 }}>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.pluginAction(p.enabled ? 'disable' : 'enable', p.id),
                          `${p.enabled ? 'Disabled' : 'Enabled'} ${p.id}`,
                        )
                      }
                    >
                      {p.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Uninstall ${p.id}?`)) {
                          void run(() => api.pluginAction('uninstall', p.id), `Uninstalled ${p.id}`)
                        }
                      }}
                    >
                      Uninstall
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <input
          placeholder="plugin or plugin@marketplace"
          value={installId}
          onChange={(e) => setInstallId(e.target.value)}
        />
        <button
          className="action"
          disabled={busy || !installId.trim()}
          onClick={() =>
            void run(() => api.pluginAction('install', installId.trim()), `Installed ${installId}`)
          }
        >
          Install
        </button>
      </div>

      <h2>Marketplaces</h2>
      {data.marketplaces.length === 0 ? (
        <p className="dim">No marketplaces configured.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.marketplaces.map((m) => (
              <tr key={m.name}>
                <td className="path">{m.name}</td>
                <td className="value">{m.repo ?? m.source}</td>
                <td>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove marketplace ${m.name}?`)) {
                        void run(
                          () => api.marketplaceAction('remove', m.name),
                          `Removed ${m.name}`,
                        )
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <input
          placeholder="github org/repo, URL, or local path"
          value={marketplaceSrc}
          onChange={(e) => setMarketplaceSrc(e.target.value)}
        />
        <button
          className="action"
          disabled={busy || !marketplaceSrc.trim()}
          onClick={() =>
            void run(
              () => api.marketplaceAction('add', marketplaceSrc.trim()),
              `Added marketplace`,
            )
          }
        >
          Add marketplace
        </button>
      </div>
    </>
  )
}
