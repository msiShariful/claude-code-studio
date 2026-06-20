import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type FileKind, type FileScope, type FilesListingDto } from '../api.js'
import type { CodeLanguage } from '../components/CodeEditor.js'
import { PageHeader } from '../components/ui.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

// CodeMirror is heavy — split it into its own chunk loaded only when a file is opened.
const CodeEditor = lazy(() =>
  import('../components/CodeEditor.js').then((m) => ({ default: m.CodeEditor })),
)

/** keybindings is JSON; everything else we edit here is Markdown. */
const LANGUAGE: Record<FileKind, CodeLanguage> = {
  claudeMd: 'markdown',
  agent: 'markdown',
  skill: 'markdown',
  keybindings: 'json',
}

/** Each file kind is its own view now (the sidebar tree is the navigation). */
const HEADERS: Record<FileKind, { title: string; label: string; info: string }> = {
  claudeMd: {
    title: 'CLAUDE.md',
    label: 'Memory',
    info: 'Standing instructions Claude reads every session — the CLAUDE.md memory file.',
  },
  agent: {
    title: 'Agents',
    label: 'Agents',
    info: 'Custom subagents you can hand specialized tasks. One Markdown file each.',
  },
  skill: {
    title: 'Skills',
    label: 'Skills',
    info: 'Reusable skills Claude can invoke on demand, each a SKILL.md with frontmatter.',
  },
  keybindings: {
    title: 'Keybindings',
    label: 'Keybindings',
    info: 'Your own keyboard shortcuts for Claude Code, stored in ~/.claude/keybindings.json.',
  },
}

interface Open {
  kind: FileKind
  scope: FileScope
  name?: string
  content: string
  hash: string | null
  path: string
}

/**
 * A single file view, chosen by the sidebar (`kind`): the CLAUDE.md memory file, the
 * agents list, the skills list, or the keybindings file. No in-view tabs — each tree
 * node routes straight to its own content.
 */
export function Files({
  api,
  workspace,
  kind,
}: {
  api: Api
  workspace: Workspace
  kind: FileKind
}) {
  const projectDir = workspaceProjectDir(workspace)
  const fileScope: FileScope = workspace.kind === 'project' ? 'project' : 'user'
  const [listing, setListing] = useState<FilesListingDto | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setListing(await api.files(projectDir || undefined))
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setListing({ user: { claudeMd: { path: '', exists: false }, agents: [], skills: [] } })
    }
  }, [api, projectDir])

  useEffect(() => {
    void reload()
    setOpen(null)
    setMessage(null)
  }, [reload])

  // Single-file views (CLAUDE.md, keybindings) open straight into the editor —
  // there's nothing to list, so no "Open" button: just edit it.
  const isSingle = kind === 'claudeMd' || kind === 'keybindings'
  useEffect(() => {
    if (!isSingle || !listing || open) return
    void openFile(kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSingle, listing, kind])

  const scopeFiles = fileScope === 'user' ? listing?.user : listing?.project

  async function openFile(fileKind: FileKind, name?: string) {
    setMessage(null)
    try {
      const ref = {
        kind: fileKind,
        scope: fileScope,
        name,
        projectDir: fileScope === 'project' ? projectDir : undefined,
      }
      const file = await api.fileRead(ref)
      setOpen({ ...ref, content: file.content, hash: file.hash, path: file.path })
      setDirty(false)
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  async function save() {
    if (!open) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.fileSave({
        kind: open.kind,
        scope: open.scope,
        name: open.name,
        projectDir: open.scope === 'project' ? projectDir : undefined,
        content: open.content,
        expectedHash: open.hash,
      })
      await reload()
      setOpen((prev) => (prev ? { ...prev, hash: result.hash } : prev))
      setDirty(false)
      setMessage({ kind: 'ok', text: 'Saved. The previous version was backed up.' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({
          kind: 'error',
          text: 'This file changed on disk since you opened it — reopen it to see the current content.',
        })
      } else {
        setMessage({ kind: 'error', text: (e as Error).message })
      }
    } finally {
      setBusy(false)
    }
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('You have unsaved changes. Discard them?')
  }

  function createNew() {
    if (!newName.trim()) return
    const name = kind === 'agent' && !newName.endsWith('.md') ? `${newName}.md` : newName
    setOpen({
      kind,
      scope: fileScope,
      name,
      content: kind === 'skill' ? `---\nname: ${newName}\ndescription: \n---\n\n` : '',
      hash: null,
      path: '(new file)',
    })
    setDirty(true)
    setNewName('')
    setCreating(false)
  }

  if (!listing) return <p className="dim">Loading…</p>

  const header = HEADERS[kind]
  const isList = kind === 'agent' || kind === 'skill'
  const list = kind === 'agent' ? scopeFiles?.agents : kind === 'skill' ? scopeFiles?.skills : undefined

  return (
    <>
      <PageHeader
        title={header.title}
        label={header.label}
        info={header.info}
        actions={
          isList ? (
            <>
              {list && list.length > 0 && <span className="section-meta">{list.length}</span>}
              <button className="ghost" onClick={() => setCreating((v) => !v)}>
                {creating ? 'Cancel' : `+ New ${kind}`}
              </button>
            </>
          ) : undefined
        }
      />
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      {isList && creating && (
        <div className="toolbar">
          <input
            autoFocus
            placeholder={kind === 'agent' ? 'new-agent-name' : 'new-skill-name'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createNew()
              if (e.key === 'Escape') setCreating(false)
            }}
          />
          <button className="action" disabled={!newName.trim()} onClick={createNew}>
            Create {kind}
          </button>
        </div>
      )}

      {/* The editor sits above the list so opening or creating a file is front-and-centre,
          even when the list below is long. */}
      {open && (
        <div className="file-editor">
          <p className="dim">
            {open.path}
            {dirty ? ' — unsaved changes' : ''}
          </p>
          <Suspense fallback={<p className="dim">Loading editor…</p>}>
            <CodeEditor
              key={`${open.kind}:${open.name ?? ''}:${open.path}`}
              value={open.content}
              language={LANGUAGE[open.kind]}
              disabled={busy}
              minHeight="22rem"
              onChange={(next) => {
                setOpen((prev) => (prev ? { ...prev, content: next } : prev))
                setDirty(true)
              }}
            />
          </Suspense>
          <div className="toolbar">
            <button className="action" disabled={busy || !dirty} onClick={() => void save()}>
              Save
            </button>
            {isList && (
              <button
                className="ghost"
                onClick={() => {
                  if (!confirmDiscard()) return
                  setOpen(null)
                  setDirty(false)
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {isList &&
        (list && list.length > 0 ? (
          <div className="file-list">
            <table className="kv">
              <tbody>
                {list.map((f) => (
                  <tr key={f.name}>
                    <td className="path">
                      <button className="ghost" onClick={() => void openFile(kind, f.name)}>
                        {f.name}
                      </button>
                    </td>
                    <td className="value dim">{f.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !open && <p className="dim">None yet — create your first {kind}.</p>
        ))}
    </>
  )
}
