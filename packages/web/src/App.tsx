import { useCallback, useMemo, useState } from 'react'
import { Api } from './api.js'
import { Backups } from './views/Backups.js'
import { Overview } from './views/Overview.js'
import { Editor, type EditorJump } from './views/Editor.js'
import { Effective } from './views/Effective.js'
import { Files } from './views/Files.js'
import { Hooks } from './views/Hooks.js'
import { Mcp } from './views/Mcp.js'
import { Plugins } from './views/Plugins.js'

const VIEWS = [
  ['dashboard', 'Dashboard'],
  ['effective', 'Effective settings'],
  ['editor', 'Editor'],
  ['files', 'Agents & files'],
  ['hooks', 'Hooks'],
  ['mcp', 'MCP servers'],
  ['plugins', 'Plugins'],
  ['backups', 'Backups'],
] as const

type ViewKey = (typeof VIEWS)[number][0]

export function App({ token }: { token: string | null }) {
  const [view, setView] = useState<ViewKey>('dashboard')
  const [projectDir, setProjectDir] = useState(
    () => window.localStorage.getItem('ccs-project-dir') ?? '',
  )
  const [editorJump, setEditorJump] = useState<EditorJump | null>(null)
  const api = useMemo(() => (token ? new Api(token) : null), [token])

  const jumpToEditor = useCallback((scope: EditorJump['scope'], path: string) => {
    setEditorJump({ scope, path })
    setView('editor')
  }, [])

  const onJumpConsumed = useCallback(() => setEditorJump(null), [])

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

  function updateProjectDir(value: string) {
    setProjectDir(value)
    window.localStorage.setItem('ccs-project-dir', value)
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="wordmark">Claude Code Studio</h1>
        <nav>
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              className={view === key ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="project-dir">
          <span className="dim">Project directory (optional)</span>
          <input
            value={projectDir}
            placeholder="/path/to/project"
            onChange={(e) => updateProjectDir(e.target.value)}
          />
        </label>
      </aside>
      <main className="content">
        {view === 'dashboard' && <Overview api={api} />}
        {view === 'effective' && <Effective api={api} projectDir={projectDir} onEdit={jumpToEditor} />}
        {view === 'editor' && (
          <Editor
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
            jump={editorJump}
            onJumpConsumed={onJumpConsumed}
          />
        )}
        {view === 'files' && (
          <Files
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
          />
        )}
        {view === 'hooks' && (
          <Hooks
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
            onEdit={jumpToEditor}
          />
        )}
        {view === 'mcp' && (
          <Mcp
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
          />
        )}
        {view === 'plugins' && <Plugins api={api} />}
        {view === 'backups' && <Backups api={api} />}
      </main>
    </div>
  )
}
