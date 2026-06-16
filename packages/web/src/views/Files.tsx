import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type FileKind, type FileScope, type FilesListingDto } from '../api.js'
import { PageHeader } from '../components/ui.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

const GLOBAL_TABS = [
  ['claudeMd', 'CLAUDE.md'],
  ['agent', 'Agents'],
  ['skill', 'Skills'],
  ['keybindings', 'Keybindings'],
] as const

const PROJECT_TABS = [
  ['claudeMd', 'CLAUDE.md'],
  ['agent', 'Agents'],
  ['skill', 'Skills'],
] as const

type Tab = (typeof GLOBAL_TABS)[number][0]

interface Open {
  kind: FileKind
  scope: FileScope
  name?: string
  content: string
  hash: string | null
  path: string
}

export function Files({ api, workspace }: { api: Api; workspace: Workspace }) {
  const projectDir = workspaceProjectDir(workspace)
  const tabs = workspace.kind === 'project' ? PROJECT_TABS : GLOBAL_TABS
  const fileScope: FileScope = workspace.kind === 'project' ? 'project' : 'user'
  const [listing, setListing] = useState<FilesListingDto | null>(null)
  const [tab, setTab] = useState<Tab>('claudeMd')
  const [open, setOpen] = useState<Open | null>(null)
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
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

  const scopeFiles = fileScope === 'user' ? listing?.user : listing?.project

  async function openFile(kind: FileKind, name?: string) {
    setMessage(null)
    try {
      const ref = {
        kind,
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
    const kind = tab as FileKind
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
  }

  if (!listing) return <p className="dim">Loading…</p>

  return (
    <>
      <PageHeader
        title="Agents & files"
        label="Agents & Files"
        info="Custom agents, reusable skills, and the CLAUDE.md memory files that give Claude standing instructions."
      />
      <div className="scope-picker">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active projectLocal' : ''}
            onClick={() => {
              if (!confirmDiscard()) return
              setTab(key)
              setOpen(null)
              setDirty(false)
              setMessage(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      <>
        {tab === 'claudeMd' && (
          <div className="toolbar">
            <button className="ghost" onClick={() => void openFile('claudeMd')}>
              {scopeFiles?.claudeMd.exists ? 'Open CLAUDE.md' : 'Create CLAUDE.md'}
            </button>
            <span className="dim">{scopeFiles?.claudeMd.path}</span>
          </div>
        )}
        {tab === 'keybindings' && (
          <div className="toolbar">
            <button className="ghost" onClick={() => void openFile('keybindings')}>
              {listing.user.keybindings?.exists ? 'Open keybindings.json' : 'Create keybindings.json'}
            </button>
            <span className="dim">{listing.user.keybindings?.path}</span>
          </div>
        )}
        {(tab === 'agent' || tab === 'skill') && (
          <>
            {(() => {
              const list = tab === 'agent' ? scopeFiles?.agents : scopeFiles?.skills
              return list?.length === 0 ? (
                <p className="dim">None yet.</p>
              ) : (
                <table className="kv">
                  <tbody>
                    {list?.map((f) => (
                      <tr key={f.name}>
                        <td className="path">
                          <button className="ghost" onClick={() => void openFile(tab, f.name)}>
                            {f.name}
                          </button>
                        </td>
                        <td className="value dim">{f.path}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
            <div className="toolbar">
              <input
                placeholder={tab === 'agent' ? 'new-agent-name' : 'new-skill-name'}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button className="ghost" disabled={!newName.trim()} onClick={createNew}>
                + New {tab}
              </button>
            </div>
          </>
        )}

        {open && (
          <>
            <p className="dim">
              {open.path}
              {dirty ? ' — unsaved changes' : ''}
            </p>
            <textarea
              rows={18}
              style={{ width: '100%', resize: 'vertical' }}
              value={open.content}
              disabled={busy}
              onChange={(e) => {
                setOpen((prev) => (prev ? { ...prev, content: e.target.value } : prev))
                setDirty(true)
              }}
            />
            <div className="toolbar">
              <button className="action" disabled={busy || !dirty} onClick={() => void save()}>
                Save
              </button>
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
            </div>
          </>
        )}
      </>
    </>
  )
}
