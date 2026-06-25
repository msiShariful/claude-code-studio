import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type EditDto, type PendingChangeDto, type SettingsResponse } from '../api.js'
import { JsonViewer } from '../components/JsonViewer.js'
import { SettingControl } from '../components/SettingControl.js'
import { PageHeader } from '../components/ui.js'
import { catalogByGroup, type SettingDef } from '../settingsCatalog.js'
import { diffLineKind, getAtPath, jsonEqual, parseEditValue } from '../utils.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

export type EditableScope = 'user' | 'project' | 'projectLocal'
export type EditorScope = EditableScope | 'managed'

export interface EditorJump {
  scope: EditableScope
  path: string
}

/** A pending catalog change: a new value, or removal of the key entirely. */
type CatalogEdit = { value: unknown } | { remove: true }

interface RawRow {
  path: string
  value: string
  remove: boolean
}

const EMPTY_RAW: RawRow = { path: '', value: '', remove: false }

function scopeTabs(workspace: Workspace): readonly EditorScope[] {
  // Project workspaces edit project + local files; Global and User both edit the
  // machine-level (~/.claude) user + managed scopes.
  return workspace.kind === 'project' ? ['project', 'projectLocal'] : ['user', 'managed']
}

/** Read the active scope's settings as a parsed object (empty if absent/invalid). */
function parsedValue(raw?: string, value?: Record<string, unknown>): Record<string, unknown> {
  if (value) return value
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** A one-line, human reading of a value for the "inherited / default" hint. */
function summarize(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (Array.isArray(v)) return v.length === 1 ? '1 item' : `${v.length} items`
  if (v && typeof v === 'object') {
    const n = Object.keys(v).length
    return n === 1 ? '1 key' : `${n} keys`
  }
  return String(v)
}

export function Editor({
  api,
  workspace,
  jump,
  onJumpConsumed,
  onScopeChange,
}: {
  api: Api
  workspace: Workspace
  jump?: EditorJump | null
  onJumpConsumed?: () => void
  /** report the open scope tab up so the sidebar can mirror it (settings.json vs .local) */
  onScopeChange?: (scope: EditorScope) => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const tabs = scopeTabs(workspace)
  // Invariant: scope ∈ tabs. The shell remounts this component (key per
  // workspace) on every workspace switch, so scope never outlives its tabs.
  const [scope, setScope] = useState<EditorScope>(tabs[0])

  // Keep the shell in sync with the active tab — on mount, on tab click, and on jump.
  useEffect(() => {
    onScopeChange?.(scope)
  }, [scope, onScopeChange])
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [edits, setEdits] = useState<Record<string, CatalogEdit>>({})
  const [rawRows, setRawRows] = useState<RawRow[]>([EMPTY_RAW])
  const [rawOpen, setRawOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<PendingChangeDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  function resetEditing() {
    setEdits({})
    setRawRows([EMPTY_RAW])
    setPending(null)
    setMessage(null)
  }

  useEffect(() => {
    if (!jump) return
    if (scopeTabs(workspace).includes(jump.scope)) {
      setScope(jump.scope)
      setEdits({})
      setRawRows([{ path: jump.path, value: '', remove: false }])
      setRawOpen(true)
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
  const activeObj = parsedValue(entry?.state.raw, entry?.state.value)

  function setEdit(key: string, next: unknown) {
    setEdits((e) => ({ ...e, [key]: { value: next } }))
    setPending(null)
  }

  function resetKey(key: string, onDisk: boolean) {
    setEdits((e) => {
      const next = { ...e }
      if (onDisk) next[key] = { remove: true }
      else delete next[key]
      return next
    })
    setPending(null)
  }

  function buildEdits(): EditDto[] {
    const out: EditDto[] = []
    for (const [path, edit] of Object.entries(edits)) {
      const onDisk = getAtPath(activeObj, path) !== undefined
      if ('remove' in edit) {
        if (onDisk) out.push({ path, remove: true })
      } else if (!jsonEqual(edit.value, getAtPath(activeObj, path))) {
        out.push({ path, value: edit.value })
      }
    }
    for (const r of rawRows) {
      if (r.path.trim() === '') continue
      out.push(r.remove ? { path: r.path.trim(), remove: true } : { path: r.path.trim(), value: parseEditValue(r.value) })
    }
    return out
  }

  async function preview() {
    setMessage(null)
    setPending(null)
    try {
      setPending(
        await api.preview({
          scope: scope as EditableScope,
          projectDir: scope === 'user' ? undefined : projectDir,
          edits: buildEdits(),
        }),
      )
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
      resetEditing()
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

  function updateRaw(i: number, patch: Partial<RawRow>) {
    setRawRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setPending(null)
  }

  const pendingCount = buildEdits().length
  const groups = readonly ? [] : catalogByGroup(scope as EditableScope, search)

  function renderRow(def: SettingDef) {
    const disk = getAtPath(activeObj, def.key)
    const onDisk = disk !== undefined
    const edit = edits[def.key]
    const removing = edit && 'remove' in edit
    const display = edit
      ? removing
        ? def.default
        : (edit as { value: unknown }).value
      : (disk ?? def.default)

    const edited = edit
      ? removing
        ? onDisk
        : !jsonEqual((edit as { value: unknown }).value, disk)
      : false

    const effVal = getAtPath(data?.effective.value, def.key)
    const effSrc = data?.effective.sources[def.key]
    let state: string
    if (onDisk) state = 'set here'
    else if (effVal !== undefined && effSrc && effSrc !== scope) state = `inherited from ${effSrc}: ${summarize(effVal)}`
    else if (def.default !== undefined) state = `default: ${summarize(def.default)}`
    else state = 'not set'

    return (
      <div className={`set-row ${edited ? 'edited' : ''}`} key={def.key}>
        <span className={`set-dot ${onDisk ? 'on' : 'off'}`} aria-hidden="true" />
        <div className="set-labels">
          <div className="set-name-row">
            <span className="set-name">{def.title}</span>
            <code className="set-key">{def.key}</code>
          </div>
          <p className="set-desc">
            {def.description}
            {def.note ? <span className="set-note"> {def.note}</span> : null}
          </p>
          <span className="set-state">{state}</span>
        </div>
        <div className="set-control">
          <SettingControl def={def} value={display} onChange={(v) => setEdit(def.key, v)} />
          {(onDisk || edit) && (
            <button
              type="button"
              className="set-reset"
              aria-label={`Reset ${def.title}`}
              onClick={() => resetKey(def.key, onDisk)}
            >
              reset
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Settings"
        label="Permissions & Behavior"
        info="What Claude is allowed to do and how it behaves — model, permission rules, and environment. Saved to settings.json."
      />
      <div className="scope-picker">
        {tabs.map((s) => (
          <button
            key={s}
            className={scope === s ? `active ${s}` : ''}
            onClick={() => {
              setScope(s)
              setSearch('')
              setRawOpen(false)
              resetEditing()
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
          {entry?.state.raw ? (
            <JsonViewer value={entry.state.raw} />
          ) : (
            <pre className="code">(file does not exist)</pre>
          )}
        </>
      ) : entry?.state.parseError ? (
        <div className="alert error">
          This file is not valid JSON ({entry.state.parseError}). Fix it in your editor of choice —
          Studio refuses to write through a parse failure.
        </div>
      ) : (
        <>
          <input
            className="catalog-search"
            placeholder="Search settings (e.g. model, permission, env)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {groups.length === 0 ? (
            <p className="dim">No settings match “{search}”. Try the Advanced editor below for any key.</p>
          ) : (
            groups.map(({ group, defs }) => (
              <section className="set-group" key={group}>
                <h3 className="set-group-head">{group}</h3>
                <div className="set-list">{defs.map(renderRow)}</div>
              </section>
            ))
          )}

          <details className="raw-advanced" open={rawOpen}>
            <summary onClick={() => setRawOpen((o) => !o)}>Advanced — raw key / value</summary>
            <p className="dim set-state">
              For any key not above. Path is dotted (e.g. <code>statusLine.command</code>); value is JSON
              or plain text.
            </p>
            {rawRows.map((row, i) => (
              <div className="edit-row" key={i}>
                <input
                  placeholder="model or env.FOO"
                  value={row.path}
                  onChange={(e) => updateRaw(i, { path: e.target.value })}
                />
                <input
                  placeholder='"sonnet" or {"a": 1} or plain text'
                  value={row.value}
                  disabled={row.remove}
                  onChange={(e) => updateRaw(i, { value: e.target.value })}
                />
                <label className="dim">
                  <input
                    type="checkbox"
                    checked={row.remove}
                    onChange={(e) => updateRaw(i, { remove: e.target.checked })}
                  />{' '}
                  remove
                </label>
                <button
                  className="ghost"
                  onClick={() => {
                    setRawRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [EMPTY_RAW]))
                    setPending(null)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="toolbar">
              <button className="ghost" onClick={() => setRawRows((rs) => [...rs, EMPTY_RAW])}>
                + Add row
              </button>
            </div>
          </details>

          <details className="raw-advanced">
            <summary>View raw settings.json</summary>
            {entry?.state.raw ? (
              <JsonViewer value={entry.state.raw} />
            ) : (
              <pre className="code">(file does not exist yet)</pre>
            )}
          </details>

          {pending && (
            <pre className="diff">
              {pending.diff.split('\n').map((line, i) => (
                <div key={i} className={diffLineKind(line)}>
                  {line}
                </div>
              ))}
            </pre>
          )}

          {pendingCount > 0 && (
            <div className="save-bar">
              <span className="save-count">
                {pendingCount} {pendingCount === 1 ? 'change' : 'changes'}
              </span>
              {pending ? (
                <button className="action" onClick={() => void apply()}>
                  Apply change
                </button>
              ) : (
                <button className="action" onClick={() => void preview()}>
                  Preview diff
                </button>
              )}
              <button className="ghost" onClick={resetEditing}>
                Discard
              </button>
            </div>
          )}
        </>
      )}

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
    </>
  )
}
