import { useCallback, useEffect, useState } from 'react'
import type { Api, AvailablePluginDto, PluginDto, PluginsListDto } from '../api.js'
import {
  EmptyState,
  PageHeader,
  StatusPill,
  Toast,
  useConfirm,
  type ConfirmOptions,
} from '../components/ui.js'
import { filterPluginCatalog } from '../pluginCatalog.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

const PLUGINS_INFO =
  'Install plugins from marketplaces to add bundles of agents, commands, and tools in one step.'
const MARKETPLACES_INFO =
  'A marketplace is a catalog (usually a GitHub repo) you add once; you then install its plugins.'

/** Plugin ids look like `name@marketplace`; split so each renders in its own column. */
function splitPluginId(id: string): { name: string; marketplace: string | null } {
  const at = id.indexOf('@')
  if (at < 0) return { name: id, marketplace: null }
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) }
}

/** ISO timestamp → `YYYY-MM-DD HH:MM UTC` (deterministic, locale-independent). */
function formatTimestamp(iso?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return '—'
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

const MAX_SUGGESTIONS = 40

/** Case-insensitive filter over a plugin's name, marketplace, description, and category. */
function filterAvailable(list: AvailablePluginDto[], query: string): AvailablePluginDto[] {
  const q = query.trim().toLowerCase()
  if (q === '') return list
  return list.filter((p) =>
    [p.name, p.marketplace, p.description, p.category, p.author]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
}

export function Plugins({
  api,
  workspace,
  onInstallElsewhere,
}: {
  api: Api
  workspace: Workspace
  /** Project scope can't install (plugins are machine-wide); this jumps to the User scope where it can. */
  onInstallElsewhere?: () => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const isProject = workspace.kind === 'project'
  const [data, setData] = useState<PluginsListDto | null>(null)
  const [installId, setInstallId] = useState('')
  const [marketplaceSrc, setMarketplaceSrc] = useState('')
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState(false)
  const [pluginSearch, setPluginSearch] = useState('')
  const [available, setAvailable] = useState<AvailablePluginDto[] | null>(null)
  const [addingMarketplace, setAddingMarketplace] = useState(false)
  // The key of the operation currently running, or null. Drives both the
  // disabled state (any op blocks the others) and per-button progress labels.
  const [pending, setPending] = useState<string | null>(null)
  const busy = pending !== null
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const { confirm, confirmDialog } = useConfirm()

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

  // Action results show in a floating toast; clear it automatically so it never
  // lingers (errors stick around longer than confirmations).
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), message.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [message])

  // Lazily load the installable-plugin suggestions the first time the install
  // panel is opened — reading marketplace manifests, so it never blocks the list.
  useEffect(() => {
    if (!installing || available !== null) return
    let live = true
    api
      .availablePlugins()
      .then((r) => live && setAvailable(r.available))
      .catch(() => live && setAvailable([]))
    return () => {
      live = false
    }
  }, [installing, available, api])

  async function run(fn: () => Promise<unknown>, okText: string, key: string): Promise<boolean> {
    setPending(key)
    setMessage(null)
    try {
      await fn()
      setMessage({ kind: 'ok', text: okText })
      await reload()
      return true
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      return false
    } finally {
      setPending(null)
    }
  }

  function addMarketplace(source: string, key: string) {
    void run(() => api.marketplaceAction('add', source), `Added marketplace`, key).then((ok) => {
      if (ok) {
        setMarketplaceSrc('')
        setAddingMarketplace(false)
        setAvailable(null) // refetch suggestions: a new source means new plugins
      }
    })
  }

  if (!data) return <p className="dim">Loading…</p>

  const catalogMatches = filterPluginCatalog(search)
  // Global lists every plugin; User shows only user-scope; a project shows its
  // own project/local plugins and never the user-scope ones.
  const visiblePlugins = data.plugins.filter((p) =>
    workspace.kind === 'global'
      ? true
      : workspace.kind === 'user'
        ? p.scope === 'user'
        : p.scope !== 'user' && (!p.projectPath || p.projectPath === projectDir),
  )

  if (!data.cliFound) {
    return (
      <>
        <PageHeader title="Plugins" label="Extensions" info={PLUGINS_INFO} />
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
      <PageHeader title="Plugins" label="Extensions" info={PLUGINS_INFO} />

      <section className="section-block" aria-label="Installed plugins">
        <div className="section-head">
          <div className="section-head-title">
            <h3>Installed plugins</h3>
            <span className="section-meta">{visiblePlugins.length}</span>
          </div>
          {isProject
            ? onInstallElsewhere && (
                <button className="ghost" onClick={onInstallElsewhere}>
                  Install in User scope →
                </button>
              )
            : (
                <button className="ghost" onClick={() => setInstalling((v) => !v)}>
                  {installing ? 'Close' : '+ Install plugin'}
                </button>
              )}
        </div>

        {isProject && (
          <p className="dim section-sub">
            Plugins active for this project. Plugins are installed machine-wide, then turned on
            per project — install or manage marketplaces from the User or Global scope.
          </p>
        )}

        {!isProject && installing && (
          <div className="card">
            <input
              className="catalog-search"
              placeholder="Search plugins to install…"
              value={pluginSearch}
              onChange={(e) => setPluginSearch(e.target.value)}
            />
            {available === null ? (
              <p className="dim catalog-empty">Loading plugins from your marketplaces…</p>
            ) : (() => {
              const matches = filterAvailable(available, pluginSearch)
              if (available.length === 0) {
                return (
                  <p className="dim catalog-empty">
                    No marketplace plugins found — add a marketplace below, or install by id.
                  </p>
                )
              }
              if (matches.length === 0) {
                return <p className="dim catalog-empty">No plugins match “{pluginSearch}”.</p>
              }
              return (
                <>
                  <ul className="catalog">
                    {matches.slice(0, MAX_SUGGESTIONS).map((p) => (
                      <li className="catalog-item" key={p.installId}>
                        <div className="catalog-info">
                          <span className="catalog-title">
                            {p.name} <span className="catalog-meta">· {p.marketplace}</span>
                            {p.category && <span className="catalog-meta"> · {p.category}</span>}
                          </span>
                          {p.description && <span className="catalog-desc">{p.description}</span>}
                        </div>
                        <button
                          type="button"
                          className="action"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => api.pluginAction('install', p.installId),
                              `Installed ${p.installId}`,
                              `install:${p.installId}`,
                            ).then((ok) => ok && setInstalling(false))
                          }
                        >
                          {pending === `install:${p.installId}` ? 'Installing…' : 'Install'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {matches.length > MAX_SUGGESTIONS && (
                    <p className="dim catalog-empty">
                      Showing {MAX_SUGGESTIONS} of {matches.length} — refine your search.
                    </p>
                  )}
                </>
              )
            })()}
            <div className="catalog-sep">or install by id</div>
            <div className="toolbar" style={{ margin: 0 }}>
              <input
                style={{ flex: 1 }}
                placeholder="plugin or plugin@marketplace"
                value={installId}
                onChange={(e) => setInstallId(e.target.value)}
              />
              <button
                className="action"
                disabled={busy || !installId.trim()}
                onClick={() =>
                  void run(
                    () => api.pluginAction('install', installId.trim()),
                    `Installed ${installId}`,
                    'install',
                  ).then((ok) => {
                    if (ok) {
                      setInstallId('')
                      setInstalling(false)
                    }
                  })
                }
              >
                {pending === 'install' ? 'Installing…' : 'Install'}
              </button>
            </div>
            {pending?.startsWith('install') && (
              <p className="dim working-hint">Fetching and installing the plugin — this can take a moment.</p>
            )}
          </div>
        )}

        {visiblePlugins.length === 0 ? (
          <EmptyState title="No plugins installed">
            <p className="dim">
              {isProject
                ? 'No plugins are active for this project yet — install one in the User scope, then it can be turned on here.'
                : 'Add a marketplace below, then install a plugin from it.'}
            </p>
          </EmptyState>
        ) : (
          <table className="kv">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Marketplace</th>
                <th>Version</th>
                <th>Scope</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visiblePlugins.map((p, i) => (
                <PluginRow
                  key={`${p.id}:${p.scope}:${p.projectPath ?? i}`}
                  api={api}
                  plugin={p}
                  busy={busy}
                  pending={pending}
                  run={run}
                  confirm={confirm}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {!isProject && (
      <section className="section-block" aria-label="Marketplaces">
        <div className="section-head">
          <div className="section-head-title">
            <h3>Marketplaces</h3>
            <span className="section-meta">{data.marketplaces.length}</span>
          </div>
          <button className="ghost" onClick={() => setAddingMarketplace((v) => !v)}>
            {addingMarketplace ? 'Close' : '+ Add marketplace'}
          </button>
        </div>
        <p className="dim section-sub">{MARKETPLACES_INFO}</p>

        {addingMarketplace && (
          <div className="card">
            <input
              className="catalog-search"
              placeholder="Search marketplaces (e.g. superpowers, templates)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {catalogMatches.length === 0 ? (
              <p className="dim catalog-empty">No catalog matches — add any marketplace by source below.</p>
            ) : (
              <ul className="catalog">
                {catalogMatches.map((entry) => (
                  <li className="catalog-item" key={entry.id}>
                    <div className="catalog-info">
                      <span className="catalog-title">{entry.title}</span>
                      <span className="catalog-cmd">{entry.source}</span>
                      <span className="catalog-desc">{entry.description}</span>
                    </div>
                    <button
                      type="button"
                      className="action"
                      disabled={busy}
                      onClick={() => addMarketplace(entry.source, `add-marketplace:${entry.source}`)}
                    >
                      {pending === `add-marketplace:${entry.source}` ? 'Adding…' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="catalog-sep">or add by source</div>
            <div className="toolbar" style={{ margin: 0 }}>
              <input
                style={{ flex: 1 }}
                placeholder="github org/repo, URL, or local path"
                value={marketplaceSrc}
                onChange={(e) => setMarketplaceSrc(e.target.value)}
              />
              <button
                className="action"
                disabled={busy || !marketplaceSrc.trim()}
                onClick={() => addMarketplace(marketplaceSrc.trim(), 'add-marketplace')}
              >
                {pending === 'add-marketplace' ? 'Adding…' : 'Add marketplace'}
              </button>
            </div>
            {pending?.startsWith('add-marketplace') && (
              <p className="dim working-hint">Cloning the marketplace repository — this can take a moment.</p>
            )}
          </div>
        )}

        {data.marketplaces.length === 0 ? (
          <EmptyState title="No marketplaces configured">
            <p className="dim">Add one to browse and install its plugins.</p>
          </EmptyState>
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
                        void confirm({
                          title: `Remove marketplace ${m.name}?`,
                          body: 'Plugins you already installed from it stay installed; you just remove the source.',
                          confirmLabel: 'Remove',
                          danger: true,
                        }).then((ok) => {
                          if (ok) {
                            void run(
                              () => api.marketplaceAction('remove', m.name),
                              `Removed ${m.name}`,
                              `remove:${m.name}`,
                            ).then((done) => done && setAvailable(null))
                          }
                        })
                      }}
                    >
                      {pending === `remove:${m.name}` ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      )}
      {confirmDialog}
      <Toast message={message} onClose={() => setMessage(null)} />
    </>
  )
}

function PluginRow({
  api,
  plugin,
  busy,
  pending,
  run,
  confirm,
}: {
  api: Api
  plugin: PluginDto
  busy: boolean
  pending: string | null
  run: (fn: () => Promise<unknown>, okText: string, key: string) => Promise<boolean>
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}) {
  const { name, marketplace } = splitPluginId(plugin.id)
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr>
        <td className="path">
          <button
            type="button"
            className="row-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="row-caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {name}
          </button>
        </td>
        <td className="dim">{marketplace ?? '—'}</td>
        <td className="dim">{plugin.version}</td>
        <td>
          <span className={`badge ${plugin.scope === 'user' ? 'user' : 'projectLocal'}`}>
            {plugin.scope}
          </span>
        </td>
        <td>
          <StatusPill tone={plugin.enabled ? 'ok' : 'muted'}>
            {plugin.enabled ? 'enabled' : 'disabled'}
          </StatusPill>
        </td>
        <td>
          <span className="toolbar" style={{ margin: 0 }}>
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.pluginAction(plugin.enabled ? 'disable' : 'enable', plugin.id),
                  `${plugin.enabled ? 'Disabled' : 'Enabled'} ${plugin.id}`,
                  `toggle:${plugin.id}`,
                )
              }
            >
              {pending === `toggle:${plugin.id}`
                ? plugin.enabled
                  ? 'Disabling…'
                  : 'Enabling…'
                : plugin.enabled
                  ? 'Disable'
                  : 'Enable'}
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => {
                void confirm({
                  title: `Uninstall ${plugin.id}?`,
                  body: 'This removes the plugin and its agents, commands, and tools.',
                  confirmLabel: 'Uninstall',
                  danger: true,
                }).then((ok) => {
                  if (ok) {
                    void run(
                      () => api.pluginAction('uninstall', plugin.id),
                      `Uninstalled ${plugin.id}`,
                      `uninstall:${plugin.id}`,
                    )
                  }
                })
              }}
            >
              {pending === `uninstall:${plugin.id}` ? 'Uninstalling…' : 'Uninstall'}
            </button>
          </span>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={6}>
            <dl className="detail-grid">
              <dt>Full id</dt>
              <dd>{plugin.id}</dd>
              <dt>Installed</dt>
              <dd>{formatTimestamp(plugin.installedAt)}</dd>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(plugin.lastUpdated)}</dd>
              <dt>Install path</dt>
              <dd>{plugin.installPath}</dd>
              {plugin.projectPath && (
                <>
                  <dt>Project path</dt>
                  <dd>{plugin.projectPath}</dd>
                </>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
