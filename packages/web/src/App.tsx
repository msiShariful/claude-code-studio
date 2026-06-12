import { useCallback, useEffect, useMemo, useState } from 'react'
import { Api, type ProjectDto } from './api.js'
import { projectName, type Workspace } from './workspace.js'
import { Backups } from './views/Backups.js'
import { Editor, type EditableScope, type EditorJump } from './views/Editor.js'
import { Effective } from './views/Effective.js'
import { Files } from './views/Files.js'
import { Hooks } from './views/Hooks.js'
import { Mcp } from './views/Mcp.js'
import { Overview } from './views/Overview.js'
import { Plugins } from './views/Plugins.js'

const GLOBAL_VIEWS = [
  ['overview', 'Overview'],
  ['settings', 'Settings'],
  ['mcp', 'MCP Servers'],
  ['plugins', 'Plugins'],
  ['files', 'Agents & Files'],
  ['hooks', 'Hooks'],
  ['backups', 'Backups'],
] as const

const PROJECT_VIEWS = [
  ['effective', 'Effective'],
  ['settings', 'Settings'],
  ['mcp', 'MCP Servers'],
  ['files', 'Agents & Files'],
  ['hooks', 'Hooks'],
] as const

type GlobalView = (typeof GLOBAL_VIEWS)[number][0]
type ProjectView = (typeof PROJECT_VIEWS)[number][0]

const WORKSPACE_KEY = 'ccs-workspace'
const EXTRAS_KEY = 'ccs-extra-projects'

function loadWorkspace(): Workspace {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_KEY) ?? 'null') as
      | Workspace
      | null
    if (parsed?.kind === 'project' && typeof parsed.dir === 'string' && parsed.dir !== '') {
      return parsed
    }
  } catch {
    /* corrupted storage falls back to global */
  }
  return { kind: 'global' }
}

function loadExtras(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXTRAS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function App({ token }: { token: string | null }) {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace)
  const [globalView, setGlobalView] = useState<GlobalView>('overview')
  const [projectView, setProjectView] = useState<ProjectView>('effective')
  const [projects, setProjects] = useState<ProjectDto[] | null>(null)
  const [extras, setExtras] = useState<string[]>(loadExtras)
  const [addPath, setAddPath] = useState('')
  const [editorJump, setEditorJump] = useState<EditorJump | null>(null)
  const api = useMemo(() => (token ? new Api(token) : null), [token])

  useEffect(() => {
    if (!api) return
    api
      .listProjects(extras)
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]))
  }, [api, extras])

  const onJumpConsumed = useCallback(() => setEditorJump(null), [])

  const jumpToEditor = useCallback((scope: EditableScope, path: string) => {
    setEditorJump({ scope, path })
    if (scope === 'user') {
      setWorkspace({ kind: 'global' })
      window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ kind: 'global' }))
      setGlobalView('settings')
    } else {
      setProjectView('settings')
    }
  }, [])

  if (!api) {
    return (
      <main className="gate">
        <h1 className="wordmark">Claude Code Studio</h1>
        <p>
          No session token found. Start the app from your terminal with{' '}
          <code>npx cc-studio</code> and open the URL it prints — the token rides along in
          that URL.
        </p>
      </main>
    )
  }

  function activate(ws: Workspace) {
    setWorkspace(ws)
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws))
  }

  function openGlobal(view: GlobalView) {
    activate({ kind: 'global' })
    setGlobalView(view)
    setEditorJump(null)
  }

  function openProject(dir: string, view: ProjectView = 'effective') {
    activate({ kind: 'project', dir })
    setProjectView(view)
    setEditorJump(null)
  }

  function saveExtras(next: string[]) {
    setExtras(next)
    window.localStorage.setItem(EXTRAS_KEY, JSON.stringify(next))
  }

  function addProject() {
    const dir = addPath.trim()
    if (!dir) return
    const known = projects?.some((p) => p.dir === dir) ?? false
    if (!known && !extras.includes(dir)) {
      saveExtras([...extras, dir])
    }
    setAddPath('')
    openProject(dir)
  }

  function removeExtra(dir: string) {
    saveExtras(extras.filter((d) => d !== dir))
    if (workspace.kind === 'project' && workspace.dir === dir) {
      openGlobal('overview')
    }
  }

  const activeDir = workspace.kind === 'project' ? workspace.dir : null
  const activeProject = activeDir ? (projects?.find((p) => p.dir === activeDir) ?? null) : null
  const crumbRoot =
    workspace.kind === 'global' ? 'Global' : (activeProject?.name ?? projectName(workspace.dir))
  const crumbTitle =
    workspace.kind === 'global'
      ? GLOBAL_VIEWS.find(([k]) => k === globalView)![1]
      : PROJECT_VIEWS.find(([k]) => k === projectView)![1]

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="wordmark">Claude Code Studio</h1>
        <nav>
          <div className="nav-group-title">Global</div>
          {GLOBAL_VIEWS.map(([key, label]) => (
            <button
              key={key}
              className={
                workspace.kind === 'global' && globalView === key ? 'nav-item active' : 'nav-item'
              }
              onClick={() => openGlobal(key)}
            >
              {label}
            </button>
          ))}

          <div className="nav-group-title">Projects</div>
          {projects === null && <p className="dim nav-note">Loading…</p>}
          {projects?.map((p) => {
            const isActive = activeDir === p.dir
            return (
              <div key={p.dir}>
                <div className="project-row">
                  <button
                    className={isActive ? 'nav-item active' : 'nav-item'}
                    disabled={!p.exists}
                    title={p.dir}
                    onClick={() => openProject(p.dir)}
                  >
                    {/* span wrapper keeps RTL getByText(name) working when the badge is present */}
                    <span className="project-name">{p.name}</span>
                    {!p.exists && <span className="missing-badge">missing</span>}
                  </button>
                  {extras.includes(p.dir) && (
                    <button
                      className="remove-extra"
                      title="Remove from list"
                      onClick={() => removeExtra(p.dir)}
                    >
                      ×
                    </button>
                  )}
                </div>
                {isActive && (
                  <div className="sub-nav">
                    {PROJECT_VIEWS.map(([key, label]) => (
                      <button
                        key={key}
                        className={projectView === key ? 'nav-item active' : 'nav-item'}
                        onClick={() => openProject(p.dir, key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="add-project">
            <input
              placeholder="/path/to/project"
              value={addPath}
              onChange={(e) => setAddPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addProject()
              }}
            />
            <button className="ghost" disabled={!addPath.trim()} onClick={addProject}>
              + Add project
            </button>
          </div>
        </nav>
      </aside>
      <main className="content">
        <div className="topbar">
          <span className="crumb">{crumbRoot}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb current">{crumbTitle}</span>
        </div>
        {workspace.kind === 'project' && activeProject && !activeProject.exists && (
          <div className="alert error">
            This project directory no longer exists on disk: {workspace.dir}
          </div>
        )}
        {workspace.kind === 'global' ? (
          <>
            {globalView === 'overview' && <Overview api={api} />}
            {globalView === 'settings' && (
              <Editor
                api={api}
                workspace={workspace}
                jump={editorJump}
                onJumpConsumed={onJumpConsumed}
              />
            )}
            {globalView === 'mcp' && <Mcp api={api} workspace={workspace} />}
            {globalView === 'plugins' && <Plugins api={api} />}
            {globalView === 'files' && <Files api={api} workspace={workspace} />}
            {globalView === 'hooks' && <Hooks api={api} workspace={workspace} onEdit={jumpToEditor} />}
            {globalView === 'backups' && <Backups api={api} />}
          </>
        ) : (
          // key remounts every project view on switch, resetting per-project state
          <div key={workspace.dir}>
            {projectView === 'effective' && (
              <Effective api={api} projectDir={workspace.dir} onEdit={jumpToEditor} />
            )}
            {projectView === 'settings' && (
              <Editor
                api={api}
                workspace={workspace}
                jump={editorJump}
                onJumpConsumed={onJumpConsumed}
              />
            )}
            {projectView === 'mcp' && <Mcp api={api} workspace={workspace} />}
            {projectView === 'files' && <Files api={api} workspace={workspace} />}
            {projectView === 'hooks' && <Hooks api={api} workspace={workspace} onEdit={jumpToEditor} />}
          </div>
        )}
      </main>
    </div>
  )
}
