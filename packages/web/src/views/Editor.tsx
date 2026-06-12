import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type PendingChangeDto, type SettingsResponse } from '../api.js'
import { diffLineKind, parseEditValue } from '../utils.js'

const EDITABLE = ['user', 'project', 'projectLocal'] as const
type EditableScope = (typeof EDITABLE)[number]

interface EditRow {
  path: string
  value: string
  remove: boolean
}

const EMPTY_ROW: EditRow = { path: '', value: '', remove: false }

export function Editor({ api, projectDir }: { api: Api; projectDir: string }) {
  const [scope, setScope] = useState<EditableScope>('user')
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [rows, setRows] = useState<EditRow[]>([EMPTY_ROW])
  const [pending, setPending] = useState<PendingChangeDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(() => {
    setData(null)
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setMessage({ kind: 'error', text: e.message }))
  }, [api, projectDir])

  useEffect(() => {
    reload()
    setPending(null)
    setMessage(null)
  }, [reload])

  const needsProjectDir = scope !== 'user' && !projectDir
  const entry = data?.entries.find((e) => e.scope === scope)

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
        scope,
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
        scope,
        projectDir: scope === 'user' ? undefined : projectDir,
        edits: buildEdits(),
        expectedHash: pending.expectedHash,
      })
      setMessage({ kind: 'ok', text: 'Change applied. A backup of the previous file was kept.' })
      setPending(null)
      setRows([EMPTY_ROW])
      reload()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({
          kind: 'error',
          text: 'The file changed on disk since the preview — re-preview to see the current state.',
        })
        setPending(null)
        reload()
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
      <h2>Editor</h2>
      <div className="scope-picker">
        {EDITABLE.map((s) => (
          <button
            key={s}
            className={scope === s ? `active ${s}` : ''}
            onClick={() => {
              setScope(s)
              setPending(null)
              setMessage(null)
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {needsProjectDir ? (
        <div className="alert">
          Set a project directory in the sidebar to edit project-scope settings.
        </div>
      ) : (
        <>
          <p className="dim">{entry ? entry.state.path : ''}</p>
          {entry?.state.parseError ? (
            <div className="alert error">
              This file is not valid JSON ({entry.state.parseError}). Fix it in your editor of
              choice — Studio refuses to write through a parse failure.
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
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
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
        </>
      )}

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
    </>
  )
}
