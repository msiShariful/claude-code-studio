import { useCallback, useEffect, useState } from 'react'
import type { Api, McpHealthDto, McpListDto, McpScope } from '../api.js'
import { filterCatalog, type McpCatalogEntry } from '../mcpCatalog.js'
import { parseEditValue } from '../utils.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

const TRANSPORTS = ['stdio', 'http', 'sse'] as const
type Transport = (typeof TRANSPORTS)[number]

function describeTarget(config: Record<string, unknown>): string {
  if (typeof config.url === 'string') return config.url
  const args = Array.isArray(config.args) ? (config.args as string[]).join(' ') : ''
  return [config.command, args].filter(Boolean).join(' ')
}

export function Mcp({ api, workspace }: { api: Api; workspace: Workspace }) {
  const projectDir = workspaceProjectDir(workspace)
  const [data, setData] = useState<McpListDto | null>(null)
  const [health, setHealth] = useState<McpHealthDto | null>(null)
  const [checking, setChecking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '',
    scope: (workspace.kind === 'global' ? 'user' : 'local') as McpScope,
    transport: 'stdio' as Transport,
    command: '',
    args: '',
    url: '',
    extra: '',
  })
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await api.mcp(projectDir || undefined))
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setData({ servers: [], warnings: [] })
    }
  }, [api, projectDir])

  const reloadHealth = useCallback(async () => {
    setChecking(true)
    setHealth(null)
    try {
      setHealth(await api.mcpHealth(projectDir || undefined))
    } catch {
      // The list still renders; health is best-effort and never blocks the view.
      setHealth({ available: false, status: {} })
    } finally {
      setChecking(false)
    }
  }, [api, projectDir])

  useEffect(() => {
    void reload()
    void reloadHealth()
  }, [reload, reloadHealth])

  function buildConfig(): Record<string, unknown> {
    const extra = form.extra.trim() ? parseEditValue(form.extra) : {}
    const base: Record<string, unknown> =
      typeof extra === 'object' && extra !== null && !Array.isArray(extra)
        ? { ...(extra as Record<string, unknown>) }
        : {}
    base.type = form.transport
    if (form.transport === 'stdio') {
      base.command = form.command
      const args = form.args.trim()
      // Always overwrite: extra-config JSON must not smuggle args past a blank field.
      base.args = args ? args.split(/\s+/) : []
    } else {
      base.url = form.url
    }
    return base
  }

  function useCatalogEntry(entry: McpCatalogEntry) {
    setForm((prev) => ({
      ...prev,
      name: entry.id,
      transport: 'stdio',
      command: entry.command,
      args: entry.args.join(' '),
      url: '',
      extra: entry.env ? JSON.stringify({ env: entry.env }) : '',
    }))
    setMessage({
      kind: 'ok',
      text: entry.needs
        ? `Loaded “${entry.title}”. ${entry.needs}`
        : `Loaded “${entry.title}”. Review the fields below, then Add server.`,
    })
  }

  async function add() {
    setMessage(null)
    if (form.extra.trim()) {
      const extra = parseEditValue(form.extra)
      if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
        setMessage({ kind: 'error', text: 'Extra config must be a JSON object' })
        return
      }
    }
    setBusy(true)
    try {
      const result = await api.mcpAdd({
        name: form.name.trim(),
        scope: form.scope,
        config: buildConfig(),
        projectDir: form.scope === 'user' ? undefined : projectDir || undefined,
      })
      setMessage({
        kind: 'ok',
        text:
          result.via === 'cli'
            ? `Added via the claude CLI.`
            : `Added by editing the file directly (claude CLI not found) — a backup was kept.`,
      })
      setAdding(false)
      setForm((prev) => ({ ...prev, name: '', command: '', args: '', url: '', extra: '' }))
      await reload()
      void reloadHealth()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function remove(name: string, scope: McpScope) {
    if (!window.confirm(`Remove MCP server "${name}" (${scope} scope)?`)) return
    setMessage(null)
    setBusy(true)
    try {
      await api.mcpRemove({
        name,
        scope,
        projectDir: scope === 'user' ? undefined : projectDir || undefined,
      })
      await reload()
      void reloadHealth()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="dim">Loading…</p>

  const visibleServers = data.servers.filter((s) =>
    workspace.kind === 'global' ? s.scope === 'user' : s.scope !== 'user',
  )
  const catalogMatches = filterCatalog(search)

  function statusCell(name: string) {
    if (checking || !health) return <span className="dim">checking…</span>
    if (!health.available) return <span className="dim" title="Run the claude CLI to probe health">—</span>
    const st = health.status[name] ?? 'unknown'
    if (st === 'connected') return <span className="badge connected">✓ connected</span>
    if (st === 'failed') return <span className="badge failed">✗ failed</span>
    return <span className="dim">unknown</span>
  }

  return (
    <>
      <h2>MCP servers</h2>
      {data.warnings.map((w) => (
        <div className="alert error" key={w}>
          {w}
        </div>
      ))}
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      {visibleServers.length === 0 ? (
        <p className="dim">
          {workspace.kind === 'global'
            ? 'No user-scope MCP servers configured.'
            : 'No MCP servers configured for this project.'}
        </p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Type</th>
              <th>Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleServers.map((s) => (
              <tr key={`${s.scope}:${s.name}`}>
                <td className="path">{s.name}</td>
                <td>
                  <span className={`badge ${s.scope === 'user' ? 'user' : s.scope === 'local' ? 'projectLocal' : 'project'}`}>
                    {s.scope}
                  </span>
                </td>
                <td>{statusCell(s.name)}</td>
                <td className="dim">{String(s.config.type ?? 'stdio')}</td>
                <td className="value">{describeTarget(s.config)}</td>
                <td>
                  <button className="ghost" disabled={busy} onClick={() => void remove(s.name, s.scope)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {health && !health.available && visibleServers.length > 0 && (
        <p className="dim">Connection status is unavailable — the claude CLI was not found on the server.</p>
      )}

      <div className="toolbar">
        <button className="ghost" onClick={() => setAdding(!adding)}>
          + Add server
        </button>
        {visibleServers.length > 0 && (
          <button className="ghost" disabled={checking} onClick={() => void reloadHealth()}>
            {checking ? 'Checking…' : 'Re-check status'}
          </button>
        )}
      </div>

      {adding && (
        <div className="card">
          <input
            className="catalog-search"
            placeholder="Search catalog (e.g. playwright, github, filesystem)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {catalogMatches.length === 0 ? (
            <p className="dim catalog-empty">No catalog matches — configure manually below.</p>
          ) : (
            <ul className="catalog">
              {catalogMatches.map((entry) => (
                <li className="catalog-item" key={entry.id}>
                  <div className="catalog-info">
                    <span className="catalog-title">{entry.title}</span>
                    <span className="catalog-cmd">
                      {entry.command} {entry.args.join(' ')}
                    </span>
                    <span className="catalog-desc">{entry.description}</span>
                  </div>
                  <button type="button" className="ghost" onClick={() => useCatalogEntry(entry)}>
                    Use
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="catalog-sep">or configure manually</div>

          <div className="edit-row" style={{ gridTemplateColumns: workspace.kind === 'project' ? '1fr 1fr 1fr' : '1fr 1fr' }}>
            <input
              placeholder="server-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {workspace.kind === 'project' && (
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as McpScope })}
              >
                <option value="local">local (this project, private)</option>
                <option value="project">project (shared via .mcp.json)</option>
              </select>
            )}
            <select
              value={form.transport}
              onChange={(e) => setForm({ ...form, transport: e.target.value as Transport })}
            >
              {TRANSPORTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {form.transport === 'stdio' ? (
            <div className="edit-row" style={{ gridTemplateColumns: '1fr 2fr' }}>
              <input
                placeholder="command (e.g. npx)"
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
              />
              <input
                placeholder="args (space separated)"
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
              />
            </div>
          ) : (
            <div className="edit-row" style={{ gridTemplateColumns: '1fr' }}>
              <input
                placeholder="https://example.com/mcp"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
          )}
          <div className="edit-row" style={{ gridTemplateColumns: '1fr' }}>
            <input
              placeholder='extra config JSON, e.g. {"env": {"KEY": "value"}} (optional)'
              value={form.extra}
              onChange={(e) => setForm({ ...form, extra: e.target.value })}
            />
          </div>
          <div className="toolbar">
            <button
              className="action"
              disabled={
                busy ||
                !form.name.trim() ||
                (form.transport === 'stdio' ? !form.command.trim() : !form.url.trim())
              }
              onClick={() => void add()}
            >
              Add server
            </button>
          </div>
        </div>
      )}
    </>
  )
}
