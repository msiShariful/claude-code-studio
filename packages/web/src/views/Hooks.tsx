import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  type Api,
  type EditDto,
  type PendingChangeDto,
  type SettingsEntryDto,
  type SettingsResponse,
  type SettingsScope,
} from '../api.js'
import { JsonViewer } from '../components/JsonViewer.js'
import { useConfirm, PageHeader } from '../components/ui.js'
import {
  addHook,
  asHookGroups,
  HOOK_EVENTS,
  hookRows,
  removeHookAt,
  type HookCommand,
  type HookEventDef,
  type HookGroup,
} from '../hooksCatalog.js'
import { diffLineKind, jsonEqual } from '../utils.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'
import type { EditableScope, EditorScope } from './Editor.js'

interface AddForm {
  matcher: string
  command: string
  timeout: string
  statusMessage: string
}

const BLANK_FORM: AddForm = { matcher: '', command: '', timeout: '', statusMessage: '' }

function scopeTabs(workspace: Workspace): readonly EditorScope[] {
  return workspace.kind === 'project' ? ['project', 'projectLocal'] : ['user', 'managed']
}

/** The `hooks` object from a scope's file (parsed value, else parsed raw). */
function hooksObject(entry?: SettingsEntryDto): Record<string, unknown> {
  const fromValue = entry?.state.value?.hooks
  if (fromValue && typeof fromValue === 'object') return fromValue as Record<string, unknown>
  if (entry?.state.raw) {
    try {
      const v = JSON.parse(entry.state.raw)
      if (v?.hooks && typeof v.hooks === 'object') return v.hooks as Record<string, unknown>
    } catch {
      /* a parse error is surfaced by the Settings editor, not here */
    }
  }
  return {}
}

/** "all tools" / "every Stop" / the literal matcher — what this row applies to. */
function matcherLabel(def: HookEventDef, matcher: string | undefined): string {
  if (matcher) return matcher
  if (def.matcher === 'none') return `every ${def.event}`
  if (def.matcher === 'tool') return 'all tools'
  return 'all'
}

export function Hooks({
  api,
  workspace,
  onEdit,
}: {
  api: Api
  workspace: Workspace
  /** jump into the raw Settings editor for hooks Studio can't edit structurally */
  onEdit?: (scope: EditableScope, path: string) => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const tabs = scopeTabs(workspace)
  const [scope, setScope] = useState<EditorScope>(tabs[0])
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [edits, setEdits] = useState<Record<string, HookGroup[]>>({})
  const [forms, setForms] = useState<Record<string, AddForm>>({})
  const [pending, setPending] = useState<PendingChangeDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const { confirm, confirmDialog } = useConfirm()

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
  }, [reload])

  function reset() {
    setEdits({})
    setForms({})
    setPending(null)
    setMessage(null)
  }

  if (!data) return <p className="dim">Loading…</p>

  const entry = data.entries.find((e) => e.scope === scope)
  const readonly = scope === 'managed'
  const diskHooks = hooksObject(entry)

  const groupsFor = (event: string): HookGroup[] => edits[event] ?? asHookGroups(diskHooks[event])

  function setGroups(event: string, next: HookGroup[]) {
    setEdits((e) => ({ ...e, [event]: next }))
    setPending(null)
  }

  function submitAdd(def: HookEventDef) {
    const form = forms[def.event] ?? BLANK_FORM
    const command = form.command.trim()
    if (command === '') return
    const cmd: HookCommand = { type: 'command', command }
    const timeout = Number(form.timeout)
    if (form.timeout.trim() !== '' && !Number.isNaN(timeout)) cmd.timeout = timeout
    if (form.statusMessage.trim() !== '') cmd.statusMessage = form.statusMessage.trim()
    const matcher = def.matcher === 'none' ? undefined : form.matcher.trim() || undefined
    setGroups(def.event, addHook(groupsFor(def.event), matcher, cmd))
    setForms((f) => ({ ...f, [def.event]: BLANK_FORM }))
  }

  async function removeRow(def: HookEventDef, gi: number, hi: number) {
    const ok = await confirm({
      title: `Remove this ${def.event} hook?`,
      body: 'It stops running once you apply the change. A backup of the file is kept.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setGroups(def.event, removeHookAt(groupsFor(def.event), gi, hi))
  }

  function buildEdits(): EditDto[] {
    const out: EditDto[] = []
    for (const [event, groups] of Object.entries(edits)) {
      const disk = asHookGroups(diskHooks[event])
      if (jsonEqual(groups, disk)) continue
      const path = `hooks.${event}`
      if (groups.length === 0) out.push({ path, remove: true })
      else out.push({ path, value: groups })
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
      reset()
      await reload()
      setMessage({ kind: 'ok', text: 'Hooks updated. A backup of the previous file was kept.' })
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

  const pendingCount = buildEdits().length

  function renderEvent(def: HookEventDef) {
    const groups = groupsFor(def.event)
    const rows = hookRows(groups)
    const form = forms[def.event]
    const edited = edits[def.event] && !jsonEqual(edits[def.event], asHookGroups(diskHooks[def.event]))

    return (
      <div className={`card hook-card ${edited ? 'edited' : ''}`} key={def.event}>
        <div className="hook-head">
          <span className="hook-event">{def.event}</span>
          {def.matcher !== 'none' && <span className="hook-matcher-kind">matches {def.matcherLabel?.toLowerCase()}</span>}
        </div>
        <p className="set-desc">{def.description}</p>

        {rows.length === 0 ? (
          <p className="hook-empty dim">No hooks here.</p>
        ) : (
          <ul className="hook-list">
            {rows.map((row) => (
              <li className="hook-row" key={`${row.gi}-${row.hi}`}>
                <span className="hook-target">{matcherLabel(def, row.matcher)}</span>
                <code className="hook-cmd">
                  {row.cmd.type === 'command' ? row.cmd.command : `[${row.cmd.type} hook]`}
                </code>
                <span className="hook-meta">{row.cmd.timeout ? `${row.cmd.timeout}s` : ''}</span>
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Remove ${def.event} hook`}
                  onClick={() => void removeRow(def, row.gi, row.hi)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {form ? (
          <div className="hook-add">
            {def.matcher === 'enum' ? (
              <select
                aria-label={`${def.matcherLabel} for ${def.event}`}
                value={form.matcher}
                onChange={(e) => setForms((f) => ({ ...f, [def.event]: { ...form, matcher: e.target.value } }))}
              >
                <option value="">all</option>
                {def.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : def.matcher !== 'none' ? (
              <input
                aria-label={`${def.matcherLabel} for ${def.event}`}
                placeholder={def.placeholder}
                list={def.suggestions ? `hk-${def.event}` : undefined}
                value={form.matcher}
                onChange={(e) => setForms((f) => ({ ...f, [def.event]: { ...form, matcher: e.target.value } }))}
              />
            ) : null}
            {def.suggestions && (
              <datalist id={`hk-${def.event}`}>
                {def.suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
            <input
              className="hook-cmd-input"
              aria-label={`Command for ${def.event}`}
              placeholder="shell command, e.g. ./.claude/hooks/check.sh"
              value={form.command}
              onChange={(e) => setForms((f) => ({ ...f, [def.event]: { ...form, command: e.target.value } }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitAdd(def)
                }
              }}
            />
            <input
              className="hook-timeout"
              aria-label={`Timeout for ${def.event}`}
              placeholder="timeout s"
              value={form.timeout}
              onChange={(e) => setForms((f) => ({ ...f, [def.event]: { ...form, timeout: e.target.value } }))}
            />
            <button className="action" disabled={form.command.trim() === ''} onClick={() => submitAdd(def)}>
              Add hook
            </button>
            <button
              className="ghost"
              onClick={() => setForms((f) => ({ ...f, [def.event]: undefined as unknown as AddForm }))}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="toolbar hook-toolbar">
            <button className="ghost" onClick={() => setForms((f) => ({ ...f, [def.event]: BLANK_FORM }))}>
              + Add hook
            </button>
            {onEdit && (
              <button className="ghost" onClick={() => onEdit(scope as EditableScope, `hooks.${def.event}`)}>
                Edit raw
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Hooks"
        label="Automation"
        info="Run your own shell commands automatically at Claude lifecycle events."
      />
      <p className="dim">
        Hooks run shell commands at lifecycle events — they live under the <code>hooks</code> key of
        your settings files. Treat them like code you ship to yourself: review every command.
      </p>

      <div className="scope-picker">
        {tabs.map((s) => (
          <button
            key={s}
            className={scope === s ? `active ${s}` : ''}
            onClick={() => {
              setScope(s)
              reset()
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
          {Object.keys(diskHooks).length > 0 ? (
            <JsonViewer value={JSON.stringify(diskHooks, null, 2)} />
          ) : (
            <p className="dim">No managed hooks.</p>
          )}
        </>
      ) : (
        <>
          {HOOK_EVENTS.map(renderEvent)}

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
                  Apply changes
                </button>
              ) : (
                <button className="action" onClick={() => void preview()}>
                  Preview diff
                </button>
              )}
              <button className="ghost" onClick={reset}>
                Discard
              </button>
            </div>
          )}
        </>
      )}

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      {confirmDialog}
    </>
  )
}
