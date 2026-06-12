import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type PendingChangeDto, type SettingsResponse } from '../api.js'
import { diffLineKind, parseEditValue } from '../utils.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

export type EditableScope = 'user' | 'project' | 'projectLocal'
export type EditorScope = EditableScope | 'managed'

export interface EditorJump {
  scope: EditableScope
  path: string
}

interface EditRow {
  path: string
  value: string
  remove: boolean
}

const EMPTY_ROW: EditRow = { path: '', value: '', remove: false }

function scopeTabs(workspace: Workspace): readonly EditorScope[] {
  return workspace.kind === 'global' ? ['user', 'managed'] : ['project', 'projectLocal']
}

export function Editor({
  api,
  workspace,
  jump,
  onJumpConsumed,
}: {
  api: Api
  workspace: Workspace
  jump?: EditorJump | null
  onJumpConsumed?: () => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const tabs = scopeTabs(workspace)
  const [scope, setScope] = useState<EditorScope>(tabs[0])
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [rows, setRows] = useState<EditRow[]>([EMPTY_ROW])
  const [pending, setPending] = useState<PendingChangeDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!jump) return
    if (scopeTabs(workspace).includes(jump.scope)) {
      setScope(jump.scope)
      setRows([{ path: jump.path, value: '', remove: false }])
      setPending(null)
      setMessage(null)
    }
    onJumpConsumed?.()
  }, [jump, onJumpConsumed, workspace])

  const reload = useCallback(async () => {
    setData(null)
    try {
      setData(await api.settings(projectDir || undefined))
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }, [api, projectDir])

  useEffect(() => {
    void reload()
    setPending(null)
    setMessage(null)
  }, [reload])

  const entry = data?.entries.find((e) => e.scope === scope)
  const readonly = scope === 'managed'

  function buildEdits() {
    return rows
      .filter((r) => r.path.trim() !== '')
      .map((r) =>
        r.remove
          ? { path: r.path.trim(), remove: true }
          : { path: r.path.trim(), value: parseEditValue(r.value) },
      )
  }

  async function preview() {
    setMessage(null)
    setPending(null)
    try {
      const change = await api.preview({
        scope: scope as EditableScope,
        projectDir: scope === 'user' ? undefined : projectDir,
        edits: buildEdits(),
      })
      setPending(change)
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  async function apply() {
    if (!pending) return
    setMessage(null)
    try {
      await api.apply({
        scope: scope as EditableScope,
        projectDir: scope === 'user' ? undefined : projectDir,
        edits: buildEdits(),
        expectedHash: pending.expectedHash,
      })
      setPending(null)
      setRows([EMPTY_ROW])
      await reload()
      setMessage({ kind: 'ok', text: 'Change applied. A backup of the previous file was kept.' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setPending(null)
        await reload()
        setMessage({
          kind: 'error',
          text: 'The file changed on disk since the preview — re-preview to see the current state.',
        })
      } else {
        setMessage({ kind: 'error', text: (e as Error).message })
      }
    }
  }

  function updateRow(i: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setPending(null)
  }

  return (
    <>
      <h2>Settings</h2>
      <div className="scope-picker">
        {tabs.map((s) => (
          <button
            key={s}
            className={scope === s ? `active ${s}` : ''}
            onClick={() => {
              setScope(s)
              setPending(null)
              setRows([EMPTY_ROW])
              setMessage(null)
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <p className="dim">{entry ? entry.state.path : ''}</p>
      {readonly ? (
        <>
          <div className="alert">
            Managed settings are machine-level policy and read-only — Studio never writes them.
          </div>
          <pre className="code">{entry?.state.raw ?? '(file does not exist)'}</pre>
        </>
      ) : entry?.state.parseError ? (
        <div className="alert error">
          This file is not valid JSON ({entry.state.parseError}). Fix it in your editor of choice —
          Studio refuses to write through a parse failure.
        </div>
      ) : (
        <>
          <pre className="code">{entry?.state.raw ?? '(file does not exist yet)'}</pre>

          <h2>Changes</h2>
          {rows.map((row, i) => (
            <div className="edit-row" key={i}>
              <input
                placeholder="model or env.FOO"
                value={row.path}
                onChange={(e) => updateRow(i, { path: e.target.value })}
              />
              <input
                placeholder='"sonnet" or {"a": 1} or plain text'
                value={row.value}
                disabled={row.remove}
                onChange={(e) => updateRow(i, { value: e.target.value })}
              />
              <label className="dim">
                <input
                  type="checkbox"
                  checked={row.remove}
                  onChange={(e) => updateRow(i, { remove: e.target.checked })}
                />{' '}
                remove
              </label>
              <button
                className="ghost"
                onClick={() => {
                  setRows((rs) => rs.filter((_, j) => j !== i))
                  setPending(null)
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="toolbar">
            <button className="ghost" onClick={() => setRows((rs) => [...rs, EMPTY_ROW])}>
              + Add change
            </button>
            <button
              className="action"
              disabled={buildEdits().length === 0}
              onClick={() => void preview()}
            >
              Preview diff
            </button>
          </div>

          {pending && (
            <>
              <pre className="diff">
                {pending.diff.split('\n').map((line, i) => (
                  <div key={i} className={diffLineKind(line)}>
                    {line}
                  </div>
                ))}
              </pre>
              <div className="toolbar">
                <button className="action" onClick={() => void apply()}>
                  Apply change
                </button>
                <button className="ghost" onClick={() => setPending(null)}>
                  Discard
                </button>
              </div>
            </>
          )}
        </>
      )}

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
    </>
  )
}
