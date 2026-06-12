import { useCallback, useEffect, useState } from 'react'
import type { Api, McpListDto, McpScope } from '../api.js'
import { parseEditValue } from '../utils.js'

const TRANSPORTS = ['stdio', 'http', 'sse'] as const
type Transport = (typeof TRANSPORTS)[number]

function describeTarget(config: Record<string, unknown>): string {
  if (typeof config.url === 'string') return config.url
  const args = Array.isArray(config.args) ? (config.args as string[]).join(' ') : ''
  return [config.command, args].filter(Boolean).join(' ')
}

export function Mcp({ api, projectDir }: { api: Api; projectDir: string }) {
  const [data, setData] = useState<McpListDto | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    name: '',
    scope: 'user' as McpScope,
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

  useEffect(() => {
    void reload()
  }, [reload])

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
      if (args) base.args = args.split(/\s+/)
    } else {
      base.url = form.url
    }
    return base
  }

  async function add() {
    setMessage(null)
    try {
      const result = await api.mcpAdd({
        name: form.name.trim(),
        scope: form.scope,
        config: buildConfig(),
        projectDir: form.scope === 'user' ? undefined : projectDir,
      })
      setMessage({
        kind: 'ok',
        text:
          result.via === 'cli'
            ? `Added via the claude CLI.`
            : `Added by editing the file directly (claude CLI not found) — a backup was kept.`,
      })
      setAdding(false)
      setForm({ ...form, name: '', command: '', args: '', url: '', extra: '' })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  async function remove(name: string, scope: McpScope) {
    if (!window.confirm(`Remove MCP server "${name}" (${scope} scope)?`)) return
    setMessage(null)
    try {
      await api.mcpRemove({
        name,
        scope,
        projectDir: scope === 'user' ? undefined : projectDir,
      })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  if (!data) return <p className="dim">Loading…</p>

  const needsProjectDir = form.scope !== 'user' && !projectDir

  return (
    <>
      <h2>MCP servers</h2>
      {data.warnings.map((w) => (
        <div className="alert error" key={w}>
          {w}
        </div>
      ))}
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      {data.servers.length === 0 ? (
        <p className="dim">No MCP servers configured{projectDir ? '' : ' (set a project directory to see local/project scopes)'}.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Type</th>
              <th>Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.servers.map((s) => (
              <tr key={`${s.scope}:${s.name}`}>
                <td className="path">{s.name}</td>
                <td>
                  <span className={`badge ${s.scope === 'user' ? 'user' : s.scope === 'local' ? 'projectLocal' : 'project'}`}>
                    {s.scope}
                  </span>
                </td>
                <td className="dim">{String(s.config.type ?? 'stdio')}</td>
                <td className="value">{describeTarget(s.config)}</td>
                <td>
                  <button className="ghost" onClick={() => void remove(s.name, s.scope)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <button className="ghost" onClick={() => setAdding(!adding)}>
          + Add server
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="edit-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <input
              placeholder="server-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as McpScope })}
            >
              <option value="user">user (all projects)</option>
              <option value="local">local (this project, private)</option>
              <option value="project">project (shared via .mcp.json)</option>
            </select>
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
          {needsProjectDir && (
            <div className="alert">Set a project directory in the sidebar for this scope.</div>
          )}
          <div className="toolbar">
            <button
              className="action"
              disabled={
                !form.name.trim() ||
                needsProjectDir ||
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
