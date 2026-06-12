import { useEffect, useState } from 'react'
import type { Api, SettingsEntryDto, SettingsResponse, SettingsScope } from '../api.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'
import type { EditableScope } from './Editor.js'

const HOOK_EVENTS: ReadonlyArray<[string, string]> = [
  ['PreToolUse', 'Runs before a tool call; can block or modify it.'],
  ['PostToolUse', 'Runs after a tool call completes.'],
  ['UserPromptSubmit', 'Runs when you submit a prompt, before Claude sees it.'],
  ['Notification', 'Runs when Claude Code sends a notification.'],
  ['Stop', 'Runs when Claude finishes responding.'],
  ['SubagentStop', 'Runs when a subagent finishes.'],
  ['PreCompact', 'Runs before the conversation context is compacted.'],
  ['SessionStart', 'Runs when a session starts or resumes.'],
  ['SessionEnd', 'Runs when a session ends.'],
]

function hookConfig(entry: SettingsEntryDto, event: string): unknown {
  const hooks = entry.state.value?.hooks
  if (typeof hooks !== 'object' || hooks === null) return undefined
  return (hooks as Record<string, unknown>)[event]
}

export function Hooks({
  api,
  workspace,
  onEdit,
}: {
  api: Api
  workspace: Workspace
  onEdit?: (scope: EditableScope, path: string) => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const scopes: readonly SettingsScope[] =
    workspace.kind === 'global' ? ['user', 'managed'] : ['project', 'projectLocal']
  const fallbackScope: EditableScope = workspace.kind === 'global' ? 'user' : 'project'
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!data) return <p className="dim">Loading…</p>

  const visible = data.entries.filter((e) => scopes.includes(e.scope))

  return (
    <>
      <h2>Hooks</h2>
      <p className="dim">
        Hooks run shell commands at lifecycle events — they live under the <code>hooks</code> key
        of your settings files. Treat them like code you ship to yourself: review every command.
      </p>
      {HOOK_EVENTS.map(([event, description]) => {
        const configured = visible
          .map((entry) => ({ scope: entry.scope, editable: entry.editable, config: hookConfig(entry, event) }))
          .filter((c) => c.config !== undefined)
        return (
          <div className="card" key={event} style={{ marginBottom: '1rem' }}>
            <div className="label">{event}</div>
            <p className="dim" style={{ margin: '0.25rem 0 0.75rem' }}>
              {description}
            </p>
            {configured.length === 0 ? (
              <p className="dim" style={{ margin: 0 }}>
                Not configured.
              </p>
            ) : (
              configured.map(({ scope, config }) => (
                <div key={scope} style={{ marginBottom: '0.5rem' }}>
                  <span className={`badge ${scope}`}>{scope}</span>
                  <pre className="code" style={{ marginTop: '0.4rem' }}>
                    {JSON.stringify(config, null, 2)}
                  </pre>
                </div>
              ))
            )}
            {onEdit && (
              <div className="toolbar" style={{ margin: 0 }}>
                {configured.length > 0
                  ? configured
                      .filter((c) => c.editable)
                      .map((c) => (
                        <button
                          key={c.scope}
                          className="ghost"
                          onClick={() => onEdit(c.scope as EditableScope, `hooks.${event}`)}
                        >
                          Edit in Editor
                        </button>
                      ))
                  : (
                    <button
                      className="ghost"
                      title={`Adds the hook at the ${fallbackScope} scope`}
                      onClick={() => onEdit(fallbackScope, `hooks.${event}`)}
                    >
                      Edit in Editor
                    </button>
                  )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
