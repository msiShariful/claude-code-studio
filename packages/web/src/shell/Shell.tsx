import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Api, type HealthDto, type ProjectDto } from '../api.js'
import { sectionByKey, sectionsFor } from '../nav.js'
import {
  decodeProjectId,
  encodeProjectId,
  projectName,
  type Workspace,
} from '../workspace.js'
import { Backups } from '../views/Backups.js'
import { Editor, type EditableScope, type EditorJump, type EditorScope } from '../views/Editor.js'
import { Effective } from '../views/Effective.js'
import { Files } from '../views/Files.js'
import type { FileKind } from '../api.js'
import { Home } from '../views/Home.js'
import { Hooks } from '../views/Hooks.js'
import { Mcp } from '../views/Mcp.js'
import { Plugins } from '../views/Plugins.js'
import { Sidebar } from './Sidebar.js'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js'

const EXTRAS_KEY = 'ccs-extra-projects'
const LAST_ROUTE_KEY = 'ccs-last-route'

function loadExtras(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXTRAS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

interface Parsed {
  workspace: Workspace
  section: string
}

/** URL → workspace + section. The URL is the single source of truth, so reloads and deep links just work. */
function parseRoute(pathname: string): Parsed {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'project' && parts[1]) {
    const dir = decodeProjectId(parts[1])
    if (dir) {
      const kind = 'project' as const
      const section = parts[2] ?? 'home'
      const valid = sectionsFor(kind).some((s) => s.key === section)
      return { workspace: { kind, dir }, section: valid ? section : 'home' }
    }
  }
  if (parts[0] === 'user') {
    const section = parts[1] ?? 'home'
    const valid = sectionsFor('user').some((s) => s.key === section)
    return { workspace: { kind: 'user' }, section: valid ? section : 'home' }
  }
  const section = parts[0] === 'global' ? (parts[1] ?? 'home') : 'home'
  const valid = sectionsFor('global').some((s) => s.key === section)
  return { workspace: { kind: 'global' }, section: valid ? section : 'home' }
}

function pathFor(ws: Workspace, section: string): string {
  const base =
    ws.kind === 'project'
      ? `/project/${encodeProjectId(ws.dir)}`
      : ws.kind === 'user'
        ? '/user'
        : '/global'
  return section === 'home' ? base : `${base}/${section}`
}

export function Shell({ api }: { api: Api }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [projects, setProjects] = useState<ProjectDto[] | null>(null)
  const [extras, setExtras] = useState<string[]>(loadExtras)
  const [editorJump, setEditorJump] = useState<EditorJump | null>(null)
  // the settings scope tab the Editor currently shows — mirrored in the sidebar
  const [settingsScope, setSettingsScope] = useState<EditorScope | null>(null)
  const [cli, setCli] = useState<HealthDto['cli'] | null>(null)

  useEffect(() => {
    api
      .listProjects(extras)
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]))
  }, [api, extras])

  useEffect(() => {
    api
      .health()
      .then((h) => setCli(h.cli))
      .catch(() => setCli({ found: false }))
  }, [api])

  // Land on the last-used workspace (or Global) so the bare URL isn't a dead end.
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      const last = window.localStorage.getItem(LAST_ROUTE_KEY)
      navigate(last && last !== '/' ? last : '/global', { replace: true })
    }
  }, [location.pathname, navigate])

  const { workspace, section } = useMemo(() => parseRoute(location.pathname), [location.pathname])

  // Remember where we were for the next bare-URL landing.
  useEffect(() => {
    if (location.pathname !== '/') window.localStorage.setItem(LAST_ROUTE_KEY, location.pathname)
  }, [location.pathname])

  const go = useCallback(
    (nextSection: string) => {
      setEditorJump(null)
      navigate(pathFor(workspace, nextSection))
    },
    [navigate, workspace],
  )

  const switchWorkspace = useCallback(
    (ws: Workspace) => {
      setEditorJump(null)
      navigate(pathFor(ws, 'home'))
    },
    [navigate],
  )

  const jumpToEditor = useCallback(
    (scope: EditableScope, path: string) => {
      setEditorJump({ scope, path })
      navigate(scope === 'user' ? pathFor({ kind: 'user' }, 'settings') : pathFor(workspace, 'settings'))
    },
    [navigate, workspace],
  )
  const onJumpConsumed = useCallback(() => setEditorJump(null), [])

  // Plugins are machine-wide; a project can only toggle them. Jump to the User
  // scope's Extensions page so an install is actually reachable from a project.
  const installPluginsInUserScope = useCallback(() => {
    setEditorJump(null)
    navigate(pathFor({ kind: 'user' }, 'extensions'))
  }, [navigate])

  function saveExtras(next: string[]) {
    setExtras(next)
    window.localStorage.setItem(EXTRAS_KEY, JSON.stringify(next))
  }

  function addProject(dir: string) {
    const known = projects?.some((p) => p.dir === dir) ?? false
    if (!known && !extras.includes(dir)) saveExtras([...extras, dir])
    switchWorkspace({ kind: 'project', dir })
  }

  function removeExtra(dir: string) {
    saveExtras(extras.filter((d) => d !== dir))
    if (workspace.kind === 'project' && workspace.dir === dir) switchWorkspace({ kind: 'global' })
  }

  const activeProject =
    workspace.kind === 'project' ? (projects?.find((p) => p.dir === workspace.dir) ?? null) : null
  const crumbRoot =
    workspace.kind === 'global'
      ? 'Global'
      : workspace.kind === 'user'
        ? 'User'
        : (activeProject?.name ?? projectName(workspace.dir))
  const crumbTitle = sectionByKey(section)?.label ?? 'Home'

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <span className="wordmark">Claude Code Studio</span>
          <WorkspaceSwitcher
            workspace={workspace}
            projects={projects}
            extras={extras}
            onSwitch={switchWorkspace}
            onAddProject={addProject}
            onRemoveExtra={removeExtra}
          />
        </div>
        <div className="topbar-right">
          <div className="breadcrumb">
            <span className="crumb">{crumbRoot}</span>
            <span className="crumb-sep">/</span>
            <span className="crumb current">{crumbTitle}</span>
          </div>
          {cli && (
            <span
              className="cli-status"
              title={
                cli.found
                  ? `Claude CLI detected${cli.version ? ` (v${cli.version})` : ''}`
                  : 'Claude CLI not found on PATH — some actions fall back to editing files directly'
              }
            >
              <span className={`cli-dot ${cli.found ? 'ok' : 'bad'}`} aria-hidden="true" />
              {cli.found ? `CLI ${cli.version ?? 'ready'}` : 'CLI not found'}
            </span>
          )}
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <Sidebar
            workspace={workspace}
            api={api}
            active={section}
            settingsScope={section === 'settings' ? settingsScope : null}
            onOpen={go}
            onEditSettings={(scope) => jumpToEditor(scope, '')}
          />
        </aside>
        <main className="content" key={workspace.kind === 'project' ? workspace.dir : workspace.kind}>
          {workspace.kind === 'project' && activeProject && !activeProject.exists && (
            <div className="alert error">
              This project directory no longer exists on disk: {workspace.dir}
            </div>
          )}
          {renderSection(section, workspace, api, {
            editorJump,
            onJumpConsumed,
            onScopeChange: setSettingsScope,
            jumpToEditor,
            go,
            installPluginsInUserScope,
          })}
        </main>
      </div>
    </div>
  )
}

interface ViewDeps {
  editorJump: EditorJump | null
  onJumpConsumed: () => void
  onScopeChange: (scope: EditorScope) => void
  jumpToEditor: (scope: EditableScope, path: string) => void
  go: (section: string) => void
  installPluginsInUserScope: () => void
}

/** The four file views all use <Files>, differing only in which kind they show. */
const FILE_SECTION_KIND: Record<string, FileKind> = {
  memory: 'claudeMd',
  agents: 'agent',
  skills: 'skill',
  keybindings: 'keybindings',
}

function renderSection(section: string, workspace: Workspace, api: Api, deps: ViewDeps) {
  switch (section) {
    case 'home':
      return <Home api={api} workspace={workspace} onOpen={deps.go} />
    case 'settings':
      return (
        <Editor
          api={api}
          workspace={workspace}
          jump={deps.editorJump}
          onJumpConsumed={deps.onJumpConsumed}
          onScopeChange={deps.onScopeChange}
        />
      )
    case 'tools':
      return <Mcp api={api} workspace={workspace} />
    case 'memory':
    case 'agents':
    case 'skills':
    case 'keybindings':
      return <Files api={api} workspace={workspace} kind={FILE_SECTION_KIND[section]} />
    case 'automation':
      return <Hooks api={api} workspace={workspace} onEdit={deps.jumpToEditor} />
    case 'extensions':
      return (
        <Plugins
          api={api}
          workspace={workspace}
          onInstallElsewhere={deps.installPluginsInUserScope}
        />
      )
    case 'effective':
      return workspace.kind === 'project' ? (
        <Effective api={api} projectDir={workspace.dir} onEdit={deps.jumpToEditor} />
      ) : null
    case 'history':
      return <Backups api={api} />
    default:
      return <Home api={api} workspace={workspace} onOpen={deps.go} />
  }
}
